import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/quests';
import { loadStandUp, saveStandUp } from '../../shared/storage/standUp';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { useTick } from './useTick';
import { freshStandUp, isDue, msLeft, readStandUp, standUpTimer, type StandUpState } from './standUpTimer';

/** The stand-up quest of the day (STAND_UP, 6 parts). */
export const STAND_UP = 'STAND_UP';

// A prompt is a request, not an alarm: it stays long enough to be answered, longer for a screen reader.
const PROMPT_MS = 15_000;
const PROMPT_SCREEN_READER_MS = 30_000;
const MINUTE_MS = 60_000;

// The countdown that is running, for whoever shows it (the board's "Lần nhắc tới sau M phút"). Null while no host runs.
let running: StandUpState | null = null;
const listeners = new Set<() => void>();
const publish = (next: StandUpState | null) => {
  running = next;
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Minutes until the next prompt (at least 1), or null when no countdown is running. Follows the clock while shown. */
export function useStandUpMinutes(): number | null {
  const state = useSyncExternalStore(subscribe, () => running);
  const [, redraw] = useState(0);
  const shown = state !== null;
  useEffect(() => {
    if (!shown) return;
    const timer = setInterval(() => redraw(n => n + 1), MINUTE_MS / 2);
    return () => clearInterval(timer);
  }, [shown]);
  return state?.running ? Math.max(1, Math.ceil(msLeft(state, Date.now()) / MINUTE_MS)) : null;
}

// The focus flow must not be interrupted: while one of its screens is mounted no prompt is shown, and one that is
// already on screen is taken away. When the last of them leaves, a new hour begins (the person has just been moving).
let holds = 0;
let onHold: (() => void) | null = null;
let onHoldEnd: (() => void) | null = null;

/** Call it in a screen over which the stand-up prompt must not appear (the focus session and its result). */
export function useStandUpHold(): void {
  useEffect(() => {
    holds += 1;
    if (holds === 1) onHold?.();
    return () => {
      holds -= 1;
      if (holds === 0) onHoldEnd?.();
    };
  }, []);
}

/** Mounts the reminder for exactly as long as the signed-in, onboarded shell lives (navigation.tsx); draws nothing. */
export function StandUpHost() {
  useStandUp();
  return null;
}

/**
 * The stand-up reminder. Mount it ONCE: StandUpHost does, inside the main (onboarded) group, whichever tab or screen is on top.
 * - A 60-minute countdown (`standUpTimer`) that runs only while the app is in the foreground; the hook feeds it
 *   `AppState` changes and the clock, and owns the one timer, which is cleared on unmount and on sign-out.
 * - When it runs out and the quest still has parts left: a snackbar "Đến lúc đứng dậy vươn vai một chút" with
 *   "Mình vừa đứng dậy" (one STAND_UP tick, with its own S11 snackbar and Undo), and a new hour begins. Never an OS
 *   notification (AR-23).
 * - A part recorded from anywhere (the prompt, the board) also begins a new hour.
 * - While a focus-flow screen holds it (`useStandUpHold`) no prompt is shown; when the hold ends a new hour begins.
 * - The countdown is kept under `standup:v1:<userId>` (timing only) so that a restart of the app does not give a
 *   free hour; sign-out removes it.
 */
export function useStandUp(): void {
  const { status, userId } = useSession();
  const snackbar = useSnackbar();
  const { tick, state } = useTick(STAND_UP);
  const latest = useRef({ tick, snackbar, full: state.full });
  useEffect(() => {
    latest.current = { tick, snackbar, full: state.full };
  });
  const restart = useRef<() => void>(() => undefined);

  // A part recorded, whoever recorded it, begins a new hour. Not while the day is still loading (target 0).
  const parts = state.done + state.queued + state.saving;
  const known = state.target > 0;
  const before = useRef<number | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = known ? parts : null;
    if (was !== null && parts > was) restart.current();
  }, [parts, known]);

  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    let alive = true;
    let countdown: StandUpState | undefined; // undefined until what was kept has been read
    let foreground = AppState.currentState === 'active';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let promptUntil = 0; // while the prompt of this hook may still be on screen

    const arm = () => {
      clearTimeout(timer);
      if (countdown?.running) timer = setTimeout(due, msLeft(countdown, Date.now()));
    };
    const commit = (next: StandUpState) => {
      countdown = next;
      publish(next);
      // Nothing is written for a person whose sign-out has begun (it would outlive the wipe).
      if (boundUserId() === userId) saveStandUp(userId, next);
      arm();
    };
    const apply = (event: Parameters<typeof standUpTimer>[1]) => {
      if (countdown) commit(standUpTimer(countdown, event, Date.now()));
    };
    function due() {
      // Held by the focus flow: nothing is asked for now; the end of the hold begins a new hour.
      if (!countdown || holds > 0) return;
      const now = Date.now();
      if (!isDue(countdown, now)) return arm(); // fired early: wait for the rest
      commit(standUpTimer(countdown, 'RESTART', now));
      const { full, tick: record, snackbar: bar } = latest.current;
      if (full) return; // the quest is complete (or every part is on its way): nothing to ask for
      promptUntil = now + PROMPT_SCREEN_READER_MS;
      bar.show({
        message: vi.standUpPrompt,
        action: { label: vi.standUpAction, onPress: record },
        durationMs: PROMPT_MS,
        screenReaderDurationMs: PROMPT_SCREEN_READER_MS,
      });
    }

    restart.current = () => apply('RESTART');
    onHold = () => {
      if (Date.now() < promptUntil) latest.current.snackbar.dismiss();
      promptUntil = 0;
    };
    onHoldEnd = () => apply('RESTART');
    const subscription = AppState.addEventListener('change', next => {
      foreground = next === 'active';
      apply(foreground ? 'FOREGROUND' : 'BACKGROUND');
    });
    loadStandUp(userId).then(saved => {
      if (!alive || boundUserId() !== userId) return;
      const kept = readStandUp(saved);
      // One saved as running was last known at `at`; the app was gone after that, which counts as away from then on.
      countdown = kept ? (kept.running ? standUpTimer(kept, 'BACKGROUND', kept.at) : kept) : freshStandUp(Date.now());
      publish(countdown);
      if (foreground) apply('FOREGROUND');
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      subscription.remove();
      restart.current = () => undefined;
      onHold = null;
      onHoldEnd = null;
      publish(null);
    };
  }, [status, userId]);
}
