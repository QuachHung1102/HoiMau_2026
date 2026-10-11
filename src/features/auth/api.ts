import { skipToken, useQuery } from '@tanstack/react-query';
import type { Me } from '../../../domain/contract/core.ts';
import { ApiError, api } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { readCache, writeCache } from '../../shared/storage/cache';

export const meKey = ['me'] as const;

async function fetchMe(userId: string, signal: AbortSignal): Promise<Me> {
  try {
    const me = await api.get<Me>('/me', undefined, { signal });
    // A sign-out wipes the query cache, which aborts this signal: a late answer for a user who has left is then
    // never written to disk. The write is not awaited (the screen does not wait for the disk) and never rejects.
    if (!signal.aborted) writeCache(userId, 'me', me);
    return me;
  } catch (error) {
    // Offline start: a signed-in user is let in with the last known `Me` instead of being locked out.
    // ponytail: the cached value then counts as fresh until the next refetch (remount, invalidate, "Thử lại");
    // the pending-queue task (24) adds the reconnect trigger.
    const offline = error instanceof ApiError && (error.code === 'NETWORK' || error.code === 'TIMEOUT');
    const cached = offline ? await readCache<Me>(userId, 'me') : undefined;
    if (cached?.user?.id === userId) return cached;
    throw error;
  }
}

/** The signed-in user (`GET /me`), query key `['me']`. Idle while signed out. */
export function useMe() {
  const { status, userId } = useSession();
  return useQuery({
    queryKey: meKey,
    queryFn: status === 'signedIn' && userId ? ({ signal }) => fetchMe(userId, signal) : skipToken,
  });
}
