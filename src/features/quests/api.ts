import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { DayState, Settings, UndoRequest } from '../../../domain/contract/core.ts';
import { api, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { readCache, writeCache } from '../../shared/storage/cache';
import { provisionalDay } from '../dashboard/provisionalDay';

/** The pending queue refreshes exactly this key after a flush (`usePendingSync`). */
export const dayKey = ['day'] as const;
export const settingsKey = ['settings'] as const;

/** The water quest of the tracker on Hôm nay. */
export const WATER = 'WATER_8';
/** Queueable: record it with `useQueuedWrite().send({ path: tickPath(code), body: {} })`. */
export const tickPath = (questCode: string) => `/day/quests/${questCode}/progress`;

/**
 * Takes a `DayState` that came back with a write (`ActionResult.day`) as the current day: query cache and the
 * per-user disk cache. Call it only after checking that `userId` is still the signed-in user.
 */
export function acceptDay(queryClient: QueryClient, userId: string, day: DayState) {
  queryClient.setQueryData(dayKey, day);
  writeCache(userId, 'day', day);
}

async function fetchDay(userId: string, signal: AbortSignal): Promise<DayState> {
  const day = await api.get<DayState>('/day', undefined, { signal });
  // A sign-out aborts this signal: a late answer for a user who has left never reaches the disk.
  if (!signal.aborted) writeCache(userId, 'day', day);
  return day;
}

/**
 * The current logical day (`GET /day`), query key `['day']`; idle while signed out. Lay the unsent records over
 * `data` with `applyPending`.
 * - Stale-while-revalidate: what is in the query cache shows while a refetch runs, and stays when it fails. On a cold
 *   start the last day kept on this device is put in until the server answers.
 * - It is read again whenever the app comes back to the foreground and at the moment the day closes (`closesAt`).
 * - A day that is over is never shown as today. Until the server answers, `data` is undefined (first-load state);
 *   once the read has failed, `data` is a provisional day built from it (`provisionalDay`: same quests, nothing
 *   done) and `provisional` is true. A provisional day lives in this hook only: never in the query cache or on disk.
 */
export function useDay() {
  const { status, userId } = useSession();
  const queryClient = useQueryClient();
  const user = status === 'signedIn' ? userId : null;
  const query = useQuery({ queryKey: dayKey, queryFn: user ? ({ signal }) => fetchDay(user, signal) : skipToken });
  const empty = query.data === undefined;
  useEffect(() => {
    if (!user || !empty) return;
    let current = true;
    readCache<DayState>(user, 'day').then(cached => {
      // Not for someone who has left meanwhile, and not over an answer that came first. `updatedAt: 0`: it is not
      // an answer, so it is replaced by one, and it counts as over once its close has passed (below).
      if (!current || !cached || boundUserId() !== user || queryClient.getQueryData(dayKey) !== undefined) return;
      queryClient.setQueryData(dayKey, cached, { updatedAt: 0 });
    });
    return () => {
      current = false;
    };
  }, [user, empty, queryClient]);

  const kept = query.data;
  const closes = kept ? Date.parse(kept.closesAt) : undefined;
  // Over: it was read before its close, and the close has passed. A day the server gives after that moment is
  // shown as the server's word, whatever this device's clock says.
  const over = closes !== undefined && query.dataUpdatedAt < closes && Date.now() >= closes;
  // The server could not be asked since that day ended.
  const lastFailure = query.errorUpdatedAt;
  const provisional = over && lastFailure >= closes;
  // Built again after every failed read, so that its own close moves on if the app stays open for days.
  const guess = useMemo(() => (kept && provisional ? provisionalDay(kept, Math.max(Date.now(), lastFailure)) : undefined), [kept, provisional, lastFailure]);
  const data = over ? guess : kept;

  // One request however many screens use this hook: a read already on its way is joined, not restarted.
  const revalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: dayKey }, { cancelRefetch: false });
  }, [queryClient]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') revalidate();
    });
    return () => subscription.remove();
  }, [revalidate]);
  // A timer to the close of the day on screen (or, while a day that is over waits for its answer, at once); no polling.
  // ponytail: when the server still gives the same day after its close by this device's clock (a clock that runs
  // ahead), nothing is armed: the new day comes with the next return to the app or the next delivered record.
  const nextClose = data ? Date.parse(data.closesAt) : closes;
  const closedForServer = closes !== undefined && !over && Date.now() >= closes;
  useEffect(() => {
    if (nextClose === undefined || closedForServer) return;
    const timer = setTimeout(() => {
      // Another screen's timer for the same close may have asked already (answered or failed since then).
      const state = queryClient.getQueryState(dayKey);
      if (!state || Math.max(state.dataUpdatedAt, state.errorUpdatedAt) < nextClose) revalidate();
    }, Math.max(0, nextClose - Date.now()));
    return () => clearTimeout(timer);
  }, [nextClose, closedForServer, revalidate, queryClient]);

  // `isFetching` is read here on purpose as well: "over" depends on the clock, and the start and the end of a read
  // are what make this hook look at the clock again (a read that brings back the same day changes nothing else).
  return { data, provisional, isFetching: query.isFetching, isError: query.isError, error: query.error, refetch: query.refetch };
}

/**
 * Takes back the latest tick (`POST /day/quests/{code}/undo`); needs the network, so it is never queued. Pass the
 * same `idempotencyKey` again when repeating the same undo after a lost answer.
 */
export const undoTick = (questCode: string, tickId: string, idempotencyKey: string) =>
  api.write<ActionResult>('POST', `/day/quests/${questCode}/undo`, { tickId } satisfies UndoRequest, { idempotencyKey });

/** `GET /settings`, query key `['settings']`. */
export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: ({ signal }) => api.get<Settings>('/settings', undefined, { signal }) });
}
