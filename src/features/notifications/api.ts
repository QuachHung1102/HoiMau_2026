import { skipToken, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { Inbox, InboxReadRequest, InboxReadResult } from '../../../domain/contract/core.ts';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { dayKey } from '../quests/api';
import { useServerWrite } from '../shop/api';

export const inboxKey = ['inbox'] as const;

/**
 * `GET /inbox`, newest first, a page of 20 at a time: `fetchNextPage` asks for the one `nextBefore` of the last page names
 * (a page is never asked for while the last one has none). Idle while signed out.
 */
export function useInbox() {
  const { status } = useSession();
  return useInfiniteQuery({
    queryKey: inboxKey,
    queryFn: status === 'signedIn' ? ({ pageParam, signal }) => api.get<Inbox>('/inbox', { before: pageParam }, { signal }) : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextBefore ?? undefined,
  });
}

/**
 * `POST /inbox/read` (online only, never queued): `markRead(ids)` for those items, `markRead(null)` for every unread one (the
 * body then names no ids). One request at a time per hook, one Idempotency-Key per distinct request (kept after a lost answer,
 * new after any answer). Nothing on screen changes before the server has answered; then the inbox and the day (the bell's
 * unread count) are read again, so both say what the server says.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (ids: string[] | null) => (ids === null ? 'all' : ids.join(',')),
    (key, ids: string[] | null) => api.write<InboxReadResult>('POST', '/inbox/read', (ids === null ? {} : { ids }) satisfies InboxReadRequest, { idempotencyKey: key }),
    () => {
      for (const queryKey of [inboxKey, dayKey]) queryClient.invalidateQueries({ queryKey });
    },
  );
}
