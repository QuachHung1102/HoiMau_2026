import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { boundUserId, onRequestOutcome } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { flushPending, onFlushed, usePendingActions, useWaitingCount } from '../../shared/storage/pendingActions';

const FLUSH_EVERY_MS = 30_000;
const SYNCED_SHOWN_MS = 4_000;
// What a delivered record changes on the server.
const REFRESHED = [['day'], ['me'], ['progression'], ['mealPlan']] as const;

/**
 * Keeps the signed-in user's pending queue moving. Mount it once (`PendingBanner` does). It flushes when the
 * session is ready, when the app returns to the foreground, after any request that got through, every 30 s while
 * something is queued, and on `retry`; after a flush that delivered or refused something it refreshes the day,
 * the profile and the progression.
 */
export function usePendingSync() {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;
  const queryClient = useQueryClient();
  const queued = usePendingActions(userId).length > 0;
  const waiting = useWaitingCount(userId);
  /** How the last request ended: there is no other connectivity signal. */
  const [offline, setOffline] = useState(false);
  const [syncedFor, setSyncedFor] = useState<string | null>(null);

  const flush = useCallback(() => {
    if (userId) flushPending(userId);
  }, [userId]);

  // The session is ready (app start with a stored session, or a sign-in).
  useEffect(flush, [flush]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') flush();
    });
    return () => subscription.remove();
  }, [flush]);

  useEffect(
    () =>
      onRequestOutcome(outcome => {
        setOffline(outcome === 'NETWORK');
        if (outcome === 'ok') flush();
      }),
    [flush],
  );

  useEffect(() => {
    if (!queued) return;
    const timer = setInterval(flush, FLUSH_EVERY_MS);
    return () => clearInterval(timer);
  }, [queued, flush]);

  useEffect(
    () =>
      onFlushed((flushedFor, report, caughtUp) => {
        // A flush that ends after its user has left (or another has arrived) must not touch what the cache holds now.
        if (flushedFor !== userId || boundUserId() !== userId) return;
        // Delivered or refused, what the screens show (an optimistic value included) is no longer the server's state.
        if (report.sent.length || report.rejected.length) for (const queryKey of REFRESHED) queryClient.invalidateQueries({ queryKey });
        if (caughtUp) setSyncedFor(userId);
      }),
    [userId, queryClient],
  );

  const synced = userId !== null && syncedFor === userId;
  useEffect(() => {
    if (!synced) return;
    const timer = setTimeout(() => setSyncedFor(null), SYNCED_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [synced]);

  /** "Thử lại" of the banner: send the queue now. Settles when that flush has ended. */
  const retry = useCallback(async () => {
    if (userId) await flushPending(userId);
  }, [userId]);

  return { userId, waiting, offline, synced, retry };
}
