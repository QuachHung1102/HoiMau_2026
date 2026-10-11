import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type { AuthSession, ForgotRequest, LoginRequest, Me, RegisterRequest, ResetRequest } from '../../../domain/contract/core.ts';
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

// The five auth routes are anonymous and not idempotent in the contract: no Idempotency-Key, and a 401 here is an
// ordinary ApiError (no bearer was sent), never a session expiry.
// The variables hold a password: gcTime 0 keeps the mutation out of the cache once nobody observes it, and the
// screens `reset()` it as soon as the request has settled.
type Call<Body> = { body: Body; signal: AbortSignal };
const authMutation = <Body, Result>(path: string) => ({
  gcTime: 0,
  mutationFn: ({ body, signal }: Call<Body>) => api.write<Result>('POST', path, body, { signal }),
});

export const useRegister = () => useMutation(authMutation<RegisterRequest, AuthSession>('/auth/register'));
export const useLogin = () => useMutation(authMutation<LoginRequest, AuthSession>('/auth/login'));
/** Always 202 with an empty object, whatever the email (S04). */
export const useForgotPassword = () => useMutation(authMutation<ForgotRequest, unknown>('/auth/password/forgot'));
export const useResetPassword = () => useMutation(authMutation<ResetRequest, unknown>('/auth/password/reset'));
