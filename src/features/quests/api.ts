import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { DayState, Settings, UndoRequest } from '../../../domain/contract/core.ts';
import { api, boundUserId, onRequestOutcome } from '../../shared/api/client';
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
 * An answer the server replays (the retry of a write whose first answer was lost) is the stored answer of the first
 * execution, so its day can be older than the one already held, across the 03:00 rollover or just by minutes. A day
 * with an earlier logical date, or with the same date and an earlier `serverTime`, never replaces the held one; the
 * caller still has the rest of the answer (the reward, the events).
 */
export function acceptDay(queryClient: QueryClient, userId: string, day: DayState) {
  const held = queryClient.getQueryData<DayState>(dayKey);
  if (held && (day.logicalDate < held.logicalDate || (day.logicalDate === held.logicalDate && Date.parse(day.serverTime) < Date.parse(held.serverTime)))) return;
  queryClient.setQueryData(dayKey, day);
  writeCache(userId, 'day', day);
}

const SKEW_RECHECK_MS = 60_000;
const SKEW_RECHECKS = 5;
// Shared by every user of `useDay`: for which close the day is being asked for again, how often, and when last.
const skew = { close: 0, count: 0, askedAt: 0 };

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
  // "Numbers update when the network returns": while the day shown is a guess, any request that got through says
  // it has. (The read it starts reports "ok" too; that one is joined, not repeated.)
  useEffect(() => {
    if (!provisional) return;
    return onRequestOutcome(outcome => {
      if (outcome === 'ok') revalidate();
    });
  }, [provisional, revalidate]);

  // A timer to the close of the day on screen (or, while a day that is over waits for its answer, at once); no polling.
  const nextClose = data ? Date.parse(data.closesAt) : closes;
  // The close has passed by this device's clock and the server still gives this day: the clock runs ahead.
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
  // With a clock that runs ahead the real close is still to come: the day is asked for again once a minute, at most
  // SKEW_RECHECKS times, and no more once the server gives another day. Records made meanwhile are shown on the day
  // the server gives (`applyPending` has no upper end).
  // ponytail: a clock more than 5 minutes ahead gets the new day with the next return to the app or the next
  // delivered record, not on this schedule; widen SKEW_RECHECKS if such clocks turn out to be common.
  const lastAnswer = query.dataUpdatedAt;
  useEffect(() => {
    if (closes === undefined) skew.close = 0;
    if (closes === undefined || !closedForServer) return;
    if (skew.close !== closes) Object.assign(skew, { close: closes, count: 0, askedAt: 0 });
    if (skew.count >= SKEW_RECHECKS) return;
    const armedAt = Date.now();
    const timer = setTimeout(() => {
      // Every user of this hook has such a timer; the first one to fire asks, for all of them.
      if (skew.askedAt > armedAt) return;
      Object.assign(skew, { askedAt: Date.now(), count: skew.count + 1 });
      revalidate();
    }, SKEW_RECHECK_MS);
    return () => clearTimeout(timer);
    // `lastAnswer` / `lastFailure`: each answer to a re-check, the same day again or none, arms the next one
  }, [closes, closedForServer, lastAnswer, lastFailure, revalidate]);

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

/** `GET /settings`, query key `['settings']`. Idle while signed out, and while `enabled` is false (the route is for an onboarded user). */
export function useSettings(enabled = true) {
  const { status } = useSession();
  return useQuery({ queryKey: settingsKey, queryFn: status === 'signedIn' && enabled ? ({ signal }) => api.get<Settings>('/settings', undefined, { signal }) : skipToken });
}
