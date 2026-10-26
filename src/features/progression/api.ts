import { skipToken, useQuery, type QueryClient } from '@tanstack/react-query';
import type { DayDetail, DayHistory, DayState, InboxReadRequest, InboxReadResult, Progression } from '../../../domain/contract/core.ts';
import type { DateLabel } from '../../../domain/types.ts';
import { api, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { writeCache } from '../../shared/storage/cache';
import { dayKey } from '../quests/api';

/** The queue and an undo refresh this key; the perk unlock sets or invalidates it too. */
export const progressionKey = ['progression'] as const;
export const historyKey = ['history'] as const;
/** The query keys of the two history reads (a preview entry seeds them). */
export const historyRangeKey = (from: DateLabel | undefined, to: DateLabel | undefined) => [...historyKey, 'range', from, to] as const;
export const dayDetailKey = (date: DateLabel | undefined) => [...historyKey, 'day', date] as const;

/** `GET /progression`: XP, level, title, coins, streak, perk points, milestones, `breakNotice`. Idle while signed out. */
export function useProgression() {
  const { status } = useSession();
  return useQuery({ queryKey: progressionKey, queryFn: status === 'signedIn' ? ({ signal }) => api.get<Progression>('/progression', undefined, { signal }) : skipToken });
}

/**
 * `GET /day/history?from&to`: one summary per date, both ends included, oldest first, at most 92 dates. The dates are
 * labels the server gave (`DayState.logicalDate`), never this device's calendar. Idle while `from` or `to` is missing.
 */
export function useHistory(from: DateLabel | undefined, to: DateLabel | undefined) {
  const { status } = useSession();
  const ready = status === 'signedIn' && from !== undefined && to !== undefined;
  return useQuery({
    queryKey: historyRangeKey(from, to),
    queryFn: ready ? ({ signal }) => api.get<DayHistory>('/day/history', { from, to }, { signal }) : skipToken,
  });
}

/** `GET /day/history/{date}`: the summary of one logical day and what was recorded on it, newest first. */
export function useDayDetail(date: DateLabel | undefined) {
  const { status } = useSession();
  return useQuery({
    queryKey: dayDetailKey(date),
    queryFn: status === 'signedIn' && date !== undefined ? ({ signal }) => api.get<DayDetail>(`/day/history/${date}`, undefined, { signal }) : skipToken,
  });
}

/**
 * `POST /inbox/read` for these items (online only: it is not a queueable path). The day on screen and on disk then
 * lose them, so that a restart does not show the same milestone again. Check that `userId` is still the bound user
 * before acting on the answer: nothing is written for someone who has left.
 */
export async function markInboxRead(queryClient: QueryClient, userId: string, ids: string[]): Promise<void> {
  const { unreadCount } = await api.write<InboxReadResult>('POST', '/inbox/read', { ids } satisfies InboxReadRequest);
  if (boundUserId() !== userId) return;
  const held = queryClient.getQueryData<DayState>(dayKey);
  if (!held) return;
  const next = { ...held, unreadCount, celebrations: held.celebrations.filter(item => !ids.includes(item.id)) };
  // Same `updatedAt`: this is not a read of the server's day, so it must not make a kept day look fresh.
  queryClient.setQueryData(dayKey, next, { updatedAt: queryClient.getQueryState(dayKey)?.dataUpdatedAt });
  writeCache(userId, 'day', next);
}
