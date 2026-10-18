import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult } from '../../../domain/contract/common.ts';
import { UNDO_WINDOW_UI_MS } from '../../../domain/economy.ts';
import { ApiError, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/quests';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { meKey } from '../auth/api';
import { applyPending } from '../dashboard/applyPending';
import { pushCelebrations } from '../progression/celebrations';
import { useQueuedWrite } from '../sync/useQueuedWrite';
import { acceptDay, dayKey, tickPath, undoTick, useDay } from './api';

/** The server accepts an undo for 10 s; with a screen reader on, the action stays this long instead of 5 s. */
const SCREEN_READER_UNDO_MS = 9000;

export type TickState = {
  target: number;
  /** Ticks the server has. */
  done: number;
  /** Kept on this device, waiting for the network ("Đang chờ gửi"). */
  queued: number;
  /** Sent, no answer yet ("đang lưu"). */
  saving: number;
  /** No further tick today: every part is recorded or on its way. */
  full: boolean;
  /** The server's reward for the latest confirmed tick, while its undo window is open; `n` grows with each one. */
  reward: { n: number; xp: number } | null;
  /** The code the latest tick was refused with (it is not kept anywhere), until the next tick. */
  failed: string | null;
};

type Local = { inFlight: number; expected: number };
const IDLE: Local = { inFlight: 0, expected: 0 };

/**
 * One tickable quest of the day, recorded through the offline queue. Use ONE instance per quest on a screen.
 *
 * What is shown = the server's count (`['day']`) + this device's unsent ticks (`applyPending`). Nothing optimistic
 * outlives a refetch of the day. The only local numbers bridge the two moments the queue cannot show: a tap that is
 * not on disk yet, and an answer that has left the queue but is not in the day yet (`expected`: how many unsent
 * ticks the screen should show while a `send` is out).
 * - confirmed: the day, the reward text and the celebrations all come from the server's `ActionResult`.
 * - queued: the cell stays, marked as waiting; no reward (it arrives later through the refreshed day).
 * - failed: the cell empties and `state.failed` holds the reason; `tick()` again is the retry (a new action).
 */
export function useTick(questCode: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const { send } = useQueuedWrite<ActionResult>();
  const day = useDay().data;
  const pending = usePendingActions(userId);

  const quest = day?.quests.find(item => item.code === questCode);
  const target = quest?.targetCount ?? 0;
  const done = Math.min(quest?.progress ?? 0, target);
  const open = quest !== undefined && !quest.completed;
  const waiting = useMemo(() => (day ? applyPending(day, pending).pending.ticks[questCode] ?? 0 : 0), [day, pending, questCode]);

  // The ref is what two taps inside one frame read; the state is what is drawn.
  const counts = useRef(IDLE);
  const [local, setLocal] = useState(IDLE);
  const move = useCallback((next: Local) => {
    counts.current = next.inFlight ? next : IDLE;
    setLocal(counts.current);
  }, []);
  const unsent = (now: Local) => Math.min(target - done, now.inFlight ? Math.max(waiting, now.expected) : waiting);

  const [failed, setFailed] = useState<string | null>(null);
  const [reward, setReward] = useState<TickState['reward']>(null);
  const rewards = useRef(0);
  const rewardTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(rewardTimer.current), []);
  const hideReward = useCallback(() => {
    clearTimeout(rewardTimer.current);
    setReward(null);
  }, []);
  const showReward = useCallback((xp: number) => {
    clearTimeout(rewardTimer.current);
    rewards.current += 1;
    setReward({ n: rewards.current, xp });
    rewardTimer.current = setTimeout(() => setReward(null), UNDO_WINDOW_UI_MS);
  }, []);

  /** Takes a confirmed tick back. `since`: when its 5 s window opened (a retry is offered only inside it). */
  const undo = useCallback(
    (tickId: string, since: number = Date.now()) => {
      // One undo, one key: a retry after a lost answer is replayed by the server, not applied twice.
      const key = newActionId();
      const attempt = async (): Promise<void> => {
        try {
          const result = await undoTick(questCode, tickId, key);
          if (!userId || boundUserId() !== userId) return;
          acceptDay(queryClient, userId, result.day);
          // XP, coins and stats are read again from the server, never subtracted here.
          queryClient.invalidateQueries({ queryKey: meKey });
          queryClient.invalidateQueries({ queryKey: ['progression'] });
          snackbar.show({ message: vi.undone });
        } catch (error) {
          if (!userId || boundUserId() !== userId) return;
          const offline = error instanceof ApiError && (error.code === 'NETWORK' || error.code === 'TIMEOUT');
          const left = since + UNDO_WINDOW_UI_MS - Date.now();
          // A refusal means our picture of the day is old (another tick came after, the window closed).
          if (!offline) queryClient.invalidateQueries({ queryKey: dayKey });
          snackbar.show(
            offline && left > 0
              ? { message: vi.undoOffline, action: { label: common.retry, onPress: attempt }, durationMs: left, countdown: true }
              : { message: error instanceof ApiError && error.code === 'UNDO_COINS_SPENT' ? vi.undoCoinsSpent : vi.undoUnavailable },
          );
        }
      };
      hideReward();
      return attempt();
    },
    [questCode, userId, queryClient, snackbar, hideReward],
  );

  const tick = async () => {
    const now = counts.current;
    const shown = unsent(now);
    if (!userId || !open || done + shown >= target) return;
    move({ inFlight: now.inFlight + 1, expected: shown + 1 });
    setFailed(null);
    const outcome = await send({ path: tickPath(questCode), body: {} });
    if (outcome.state === 'confirmed' && boundUserId() === userId) {
      const { actionId, day: next, delta } = outcome.result;
      // Before the local count goes down, in the same render: the cell never empties in between.
      acceptDay(queryClient, userId, next);
      pushCelebrations(delta.events, actionId);
      const at = Date.now();
      showReward(delta.xp);
      snackbar.show({
        message: vi.recorded(delta.xp),
        action: { label: vi.undo, onPress: () => undo(actionId, at) },
        durationMs: UNDO_WINDOW_UI_MS,
        screenReaderDurationMs: SCREEN_READER_UNDO_MS,
        countdown: true,
      });
    }
    const after = counts.current;
    // A queued tick is still counted through the pending list; a confirmed one is in the day, a refused one nowhere.
    move({ inFlight: after.inFlight - 1, expected: outcome.state === 'queued' ? after.expected : after.expected - 1 });
    if (outcome.state === 'failed') setFailed(outcome.code);
  };

  const shown = unsent(local);
  const saving = Math.min(local.inFlight, shown);
  const state: TickState = { target, done, queued: shown - saving, saving, full: !open || done + shown >= target, reward, failed };
  return { tick, undo, state };
}
