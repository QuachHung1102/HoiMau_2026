import { useCallback, useMemo } from 'react';
import { boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import { QueueError, deliver, enqueueAction } from '../../shared/storage/pendingActions';

export type QueuedWriteResult<T> =
  | { state: 'confirmed'; id: string; result: T }
  | { state: 'queued'; id: string }
  | { state: 'failed'; id: string; code: string; details?: Record<string, unknown> };

/**
 * The one way a screen records something on a queueable path (`isQueueable`): the record gets its action id, is
 * written to this device, and only then sent.
 * - `confirmed`: the server has it; `result` is its answer. Rewards and "đã lưu" belong here only.
 * - `queued`: it is on this device ("Đang chờ gửi") and goes out later with the same id.
 * - `failed`: it is not kept anywhere. `code` is the server's refusal, or `QUEUE_FULL` / `STORAGE_FAILED` when this
 *   device could not keep it, or `SESSION_INVALID` when nobody is signed in any more. Show it next to the control
 *   (`failureText` in vi/sync.ts) and roll the optimistic value back: the app-wide notice does not repeat it.
 */
export function useQueuedWrite<T>(): { send(input: { path: string; body: Record<string, unknown> }): Promise<QueuedWriteResult<T>> } {
  const { userId } = useSession();
  const send = useCallback(
    async ({ path, body }: { path: string; body: Record<string, unknown> }): Promise<QueuedWriteResult<T>> => {
      const id = newActionId();
      // A screen can outlive its session by a moment: nothing is filed for someone who is no longer signed in.
      if (!userId || boundUserId() !== userId) return { state: 'failed', id, code: 'SESSION_INVALID' };
      try {
        await enqueueAction({ id, userId, method: 'POST', path, body, createdAt: new Date().toISOString() });
      } catch (failure) {
        return { state: 'failed', id, code: failure instanceof QueueError ? failure.code : 'STORAGE_FAILED' };
      }
      const outcome = await deliver(userId, id);
      return outcome.state === 'confirmed' ? { state: 'confirmed', id, result: outcome.result as T } : { ...outcome, id };
    },
    [userId],
  );
  return useMemo(() => ({ send }), [send]);
}
