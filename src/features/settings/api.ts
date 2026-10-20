import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ArchetypeRequest, BiometricsRequest, Me, MePatch, PrescriptionResponse, Settings, SettingsPatch } from '../../../domain/contract/core.ts';
import { api, ApiError, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { writeCache } from '../../shared/storage/cache';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { meKey } from '../auth/api';
import { guildKey, leaderboardKey } from '../guild/api';
import { answered, mealPlanKey } from '../nutrition/api';
import { prescriptionKey } from '../onboarding/api';
import { dayKey, settingsKey } from '../quests/api';
import { useServerWrite } from '../shop/api';

export { settingsKey, useSettings } from '../quests/api';

// ---- PATCH /settings: optimistic toggles ----
//
// A toggle shows its new value at once and goes to the server as one PATCH of its own. Rapid toggles are sent one after the
// other (never two in flight), so the server sees them in the order they were made; the screen shows `confirmed` (the last
// answer of the server) with every change that has not been answered yet laid on top. An answer therefore never overwrites a
// change that is still waiting, and a refusal takes back only its own change: what comes back is the server's truth, never an
// earlier snapshot. After a failure the settings are read again once the queue is empty, because a lost answer says nothing
// about whether the change was applied.

type Waiting = { change: SettingsPatch; fail: (code: string) => void };
type Queue = { confirmed: Settings | undefined; waiting: Waiting[]; running: boolean; lost: Map<string, string> };
// One queue per query client: it lives as long as the cache it keeps in step, whichever screen made the change.
const queues = new WeakMap<QueryClient, Queue>();
const queueOf = (queryClient: QueryClient) => {
  const queue: Queue = queues.get(queryClient) ?? { confirmed: undefined, waiting: [], running: false, lost: new Map() };
  queues.set(queryClient, queue);
  return queue;
};
const show = (queryClient: QueryClient, queue: Queue) => {
  if (queue.confirmed) queryClient.setQueryData(settingsKey, queue.waiting.reduce<Settings>((shown, { change }) => ({ ...shown, ...change }), queue.confirmed));
};

async function drain(queryClient: QueryClient, queue: Queue, userId: string) {
  queue.running = true;
  let failed = false;
  while (queue.waiting.length > 0) {
    const [{ change, fail }] = queue.waiting;
    const tag = JSON.stringify(change);
    // One key per distinct request: the same change again after a lost answer repeats it, any answer of the server ends it.
    const key = queue.lost.get(tag) ?? newActionId();
    try {
      const settings = await api.write<Settings>('PATCH', '/settings', change satisfies SettingsPatch, { idempotencyKey: key });
      if (boundUserId() !== userId) break;
      queue.lost.delete(tag);
      queue.confirmed = settings;
    } catch (error) {
      if (boundUserId() !== userId) break;
      if (answered(error)) queue.lost.delete(tag);
      else queue.lost.set(tag, key);
      failed = true;
      fail(error instanceof ApiError ? error.code : 'INTERNAL');
    }
    queue.waiting.shift();
    show(queryClient, queue);
  }
  // Signed out meanwhile: what is left belongs to nobody on screen.
  queue.waiting.length = 0;
  queue.running = false;
  if (failed && boundUserId() === userId) queryClient.invalidateQueries({ queryKey: settingsKey });
}

/** `patch({ hideStreak: true })`: shown at once, one PATCH per call, a failure says so in a snackbar and takes only that change back. */
export function usePatchSettings() {
  const queryClient = useQueryClient();
  const { userId } = useSession();
  const snackbar = useSnackbar();
  return useCallback(
    (change: SettingsPatch) => {
      const current = queryClient.getQueryData<Settings>(settingsKey);
      if (!userId || !current) return;
      const queue = queueOf(queryClient);
      // Nothing waiting: what the cache holds is what the server last said.
      if (!queue.running && queue.waiting.length === 0) queue.confirmed = current;
      // A read that is on its way must not land on top of the change.
      queryClient.cancelQueries({ queryKey: settingsKey });
      queue.waiting.push({ change, fail: code => snackbar.show({ message: `${vi.notSaved} ${failureText(code)}` }) });
      show(queryClient, queue);
      if (!queue.running) drain(queryClient, queue, userId);
    },
    [queryClient, userId, snackbar],
  );
}

// ---- the profile: PATCH /me, POST /me/biometrics, PATCH /me/archetype ----

/** What a new zone, new numbers or a new direction make stale: the day, the plan and what is suggested, and the profile's own stats. */
const refreshTargets = (queryClient: QueryClient) => {
  for (const queryKey of [dayKey, mealPlanKey, ['workout'], meKey]) queryClient.invalidateQueries({ queryKey });
};

/** The `Me` the server answered replaces the cached one, in memory and on disk (the disk copy must agree with the screens). */
function useAcceptMe() {
  const queryClient = useQueryClient();
  const { userId } = useSession();
  return (me: Me) => {
    queryClient.setQueryData(meKey, me);
    if (userId) writeCache(userId, 'me', me);
  };
}

/** `PATCH /me { displayName?, timezone? }` (needs the network). A new name is read again by the guild; a new zone makes everything dated stale. */
export function usePatchMe() {
  const queryClient = useQueryClient();
  const accept = useAcceptMe();
  return useServerWrite(
    (change: MePatch) => JSON.stringify(change),
    (key, change: MePatch) => api.write<Me>('PATCH', '/me', change, { idempotencyKey: key }),
    me => {
      const before = queryClient.getQueryData<Me>(meKey)?.user;
      accept(me);
      if (before?.timezone !== me.user.timezone) queryClient.invalidateQueries({ predicate: query => query.queryKey[0] !== meKey[0] });
      else if (before?.displayName !== me.user.displayName) for (const queryKey of [guildKey, leaderboardKey]) queryClient.invalidateQueries({ queryKey });
    },
  );
}

/** `POST /me/biometrics` (needs the network): the answer is the new targets with the measurements; they never go to disk. */
export function useAddBiometrics() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (request: BiometricsRequest) => JSON.stringify(request),
    (key, request: BiometricsRequest) => api.write<PrescriptionResponse>('POST', '/me/biometrics', request, { idempotencyKey: key }),
    prescription => {
      queryClient.setQueryData(prescriptionKey, prescription);
      refreshTargets(queryClient);
    },
  );
}

/** `PATCH /me/archetype` (needs the network): the answer is `Me`; the targets of the new direction are read again. */
export function useChangeArchetype() {
  const queryClient = useQueryClient();
  const accept = useAcceptMe();
  return useServerWrite(
    (request: ArchetypeRequest) => request.archetype,
    (key, request: ArchetypeRequest) => api.write<Me>('PATCH', '/me/archetype', request, { idempotencyKey: key }),
    me => {
      accept(me);
      queryClient.invalidateQueries({ queryKey: prescriptionKey });
      refreshTargets(queryClient);
    },
  );
}
