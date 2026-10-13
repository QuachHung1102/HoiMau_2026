import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { DayState, Settings, UndoRequest } from '../../../domain/contract/core.ts';
import { api, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { readCache, writeCache } from '../../shared/storage/cache';

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
 * The current logical day (`GET /day`), query key `['day']`; idle while signed out. Stale-while-revalidate: what
 * is in the query cache shows while a refetch runs, and stays when it fails. On a cold start the last day kept on
 * this device is put in until the server answers. Lay the unsent records over it with `applyPending`.
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
      // Not for someone who has left meanwhile, not over an answer that came first, and not a day that is over
      // (its counts would pass for today's).
      // ponytail: after 03:00 without a network there is no day to show; build an empty one from the cached
      // targets if recording offline first thing in the morning matters.
      if (!current || !cached || boundUserId() !== user || queryClient.getQueryData(dayKey) !== undefined) return;
      if (Date.now() < Date.parse(cached.closesAt)) queryClient.setQueryData(dayKey, cached, { updatedAt: 0 });
    });
    return () => {
      current = false;
    };
  }, [user, empty, queryClient]);
  return query;
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
