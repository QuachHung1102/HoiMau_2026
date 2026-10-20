import { skipToken, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JournalCreateRequest, JournalCreateResult, JournalEntry, JournalList, TicketUseRequest, Tickets } from '../../../domain/contract/social.ts';
import type { DateLabel } from '../../../domain/types.ts';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { meKey } from '../auth/api';
import { historyKey, progressionKey } from '../progression/api';
import { pushCelebrations } from '../progression/celebrations';
import { dayKey } from '../quests/api';
import { useServerWrite } from '../shop/api';

export const journalKey = ['journal'] as const;
export const ticketsKey = ['tickets'] as const;
const entryKey = (id: string) => [...journalKey, 'entry', id] as const;

/**
 * `GET /journal`, newest first. Paging follows `nextBefore` and nothing else: a page may hold fewer entries than the limit
 * while more exist (the server leaves out an entry it cannot open), so a short page says nothing about the end.
 */
export function useJournalList() {
  const { status } = useSession();
  return useInfiniteQuery({
    queryKey: [...journalKey, 'list'],
    queryFn: status === 'signedIn' ? ({ pageParam, signal }) => api.get<JournalList>('/journal', { before: pageParam }, { signal }) : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextBefore ?? undefined,
  });
}

/** `GET /journal/{id}`: the whole text, in memory only (nothing of it is persisted). */
export function useJournalEntry(id: string) {
  const { status } = useSession();
  return useQuery({ queryKey: entryKey(id), queryFn: status === 'signedIn' ? ({ signal }) => api.get<JournalEntry>(`/journal/${encodeURIComponent(id)}`, undefined, { signal }) : skipToken });
}

/** `GET /freeze-tickets`: tickets in hand, the cap, the dates a ticket may be used for with their preview. */
export function useTickets() {
  const { status } = useSession();
  return useQuery({ queryKey: ticketsKey, queryFn: status === 'signedIn' ? ({ signal }) => api.get<Tickets>('/freeze-tickets', undefined, { signal }) : skipToken });
}

/**
 * `POST /journal` (online only, never queued). The key is made once per text and repeated only after a lost answer, so a retry
 * never writes a second page; any answer of the server ends it. After the server confirms: the list is read again, the
 * tickets when one was granted, and the day, profile and progression when XP was paid (the level-ups of the answer are celebrated).
 */
export function useSaveJournal() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (text: string) => text,
    (key, text: string) => api.write<JournalCreateResult>('POST', '/journal', { body: text } satisfies JournalCreateRequest, { idempotencyKey: key }),
    result => {
      pushCelebrations(result.delta.events, result.entry.id);
      const stale = [journalKey, ...(result.ticket.outcome === 'GRANTED' ? [ticketsKey] : []), ...(result.xpAwarded > 0 ? [dayKey, meKey, progressionKey] : [])];
      for (const queryKey of stale) queryClient.invalidateQueries({ queryKey });
    },
  );
}

/**
 * `POST /freeze-tickets/use` (online only, one request per press). The answer is the tickets as the server now has them; the
 * journey (history, streak, progression), the day and the profile are read again.
 */
export function useUseTicket() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (date: DateLabel) => date,
    (key, date: DateLabel) => api.write<Tickets>('POST', '/freeze-tickets/use', { date } satisfies TicketUseRequest, { idempotencyKey: key }),
    tickets => {
      queryClient.setQueryData(ticketsKey, tickets);
      for (const queryKey of [ticketsKey, historyKey, progressionKey, dayKey, meKey]) queryClient.invalidateQueries({ queryKey });
    },
  );
}
