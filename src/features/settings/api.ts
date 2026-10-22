import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { ArchetypeRequest, BiometricsRequest, DeleteAccountRequest, Me, MePatch, PrescriptionResponse, Settings, SettingsPatch } from '../../../domain/contract/core.ts';
import type { ExportDocument } from '../../../domain/contract/social.ts';
import { localParts } from '../../../domain/logicalDate.ts';
import { normalizePassword } from '../../../domain/validation.ts';
import { api, ApiError, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { ShareUnavailableError, shareTextFile } from '../../shared/native/hoiMauNative';
import { writeCache } from '../../shared/storage/cache';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { meKey, useMe } from '../auth/api';
import { guildKey, leaderboardKey } from '../guild/api';
import { answered, mealPlanKey, useAttemptKey } from '../nutrition/api';
import { prescriptionKey } from '../onboarding/api';
import { dayKey, settingsKey } from '../quests/api';
import { useServerWrite } from '../shop/api';
import { workoutRootKey } from '../workout/api';

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

/** What a new zone, new numbers or a new direction make stale: the day, the plan and what is suggested. */
const refreshTargets = (queryClient: QueryClient) => {
  for (const queryKey of [dayKey, mealPlanKey, workoutRootKey]) queryClient.invalidateQueries({ queryKey });
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
      // the profile's own stats follow the numbers; the answer does not carry `Me`
      queryClient.invalidateQueries({ queryKey: meKey });
      refreshTargets(queryClient);
    },
  );
}

/** `PATCH /me/archetype` (needs the network): the answer is `Me`, which is kept as it is; the targets of the new direction are read again. */
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

// ---- privacy: a copy of the data, and the deletion of the account (S44, S52) ----

export type PrivacyOutcome = { state: 'done' } | { state: 'failed'; code: string };
/** What a failure is called when it did not come from the server: the file was too big to share, or the share box could not be opened. */
export const SHARE_TOO_LARGE = 'SHARE_TOO_LARGE';
export const SHARE_FAILED = 'SHARE_FAILED';

/**
 * `GET /me/export`, then the document goes to the system's share box as one JSON file. The document exists only inside `run`:
 * it is no query, no state and no log, and it is gone when the share call returns. One run at a time (each share replaces the
 * file of the one before, and the server answers 5 an hour), and nothing is shared for a person who has signed out meanwhile.
 * `run` answers undefined when one is already on its way.
 */
export function useExportData() {
  const { userId } = useSession();
  const timeZone = useMe().data?.user.timezone;
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (): Promise<PrivacyOutcome | undefined> => {
    if (sending.current || !userId) return undefined;
    sending.current = true;
    setBusy(true);
    try {
      const document = await api.get<ExportDocument>('/me/export');
      if (boundUserId() !== userId) return undefined;
      const day = timeZone ? localParts(Date.parse(document.exportedAt), timeZone).date : document.exportedAt.slice(0, 10);
      await shareTextFile(vi.exportFileName(day), 'application/json', JSON.stringify(document, null, 2));
      return { state: 'done' };
    } catch (error) {
      if (error instanceof ApiError) return { state: 'failed', code: error.code };
      return { state: 'failed', code: error instanceof ShareUnavailableError ? SHARE_TOO_LARGE : SHARE_FAILED };
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [userId, timeZone]);
  return [run, busy] as const;
}

/**
 * `POST /me/delete` with the password (needs the network, one request at a time). `204` ends the session as a closed account.
 * A request whose answer was lost may have deleted the account: the same request again carries the same key, and a
 * `401 SESSION_INVALID` to it means the account is gone (every session was revoked), so that too ends as closed. Any other
 * answer leaves everything as it was; `401 INVALID_CREDENTIALS` is also the answer to the sixth try within 15 minutes, so
 * it is never read as "the password is wrong" by this layer.
 */
export function useDeleteAccount() {
  const { userId, closeAccount } = useSession();
  const key = useAttemptKey();
  const sending = useRef(false);
  const unanswered = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (password: string): Promise<PrivacyOutcome | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      setBusy(true);
      const secret = normalizePassword(password);
      try {
        await api.write('POST', '/me/delete', { password: secret } satisfies DeleteAccountRequest, { idempotencyKey: key.of(secret) });
        await closeAccount(userId);
        return { state: 'done' };
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'INTERNAL';
        if (code === 'SESSION_INVALID' && unanswered.current) {
          await closeAccount(userId);
          return { state: 'done' };
        }
        unanswered.current = !answered(error);
        if (!unanswered.current) key.clear();
        return { state: 'failed', code };
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [userId, key, closeAccount],
  );
  return [run, busy] as const;
}
