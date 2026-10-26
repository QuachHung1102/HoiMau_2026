// The stand-up reminder's clock. Pure: time comes in only through `nowMs`, nothing here reads a clock,
// a timer or the app state. `useStandUp` owns those and feeds the reducer.
//
// The countdown is 60 minutes of foreground time. A short stay in the background (up to 10 minutes) is a glance at
// another app: the time keeps counting. A longer one means the person left: the countdown is frozen where it was
// and the time away is not counted. Nothing runs while the app is away (no notification).

export const STAND_UP_INTERVAL_MS = 60 * 60 * 1000;
export const STAND_UP_PAUSE_AFTER_MS = 10 * 60 * 1000;

export type StandUpState = {
  /** Foreground time still to run, as of `at`. */
  remainingMs: number;
  /** When `remainingMs` was true: the moment the countdown started or left the foreground. */
  at: number;
  /** True while the app is in the foreground and the countdown runs from `at`. */
  running: boolean;
};

export type StandUpEvent = 'FOREGROUND' | 'BACKGROUND' | 'RESTART';

/** A full interval, not running: the state of a device that has never had one. */
export const freshStandUp = (nowMs: number): StandUpState => ({ remainingMs: STAND_UP_INTERVAL_MS, at: nowMs, running: false });

/** Milliseconds until the prompt is due (frozen while the app is away). A clock that went back counts as no time passed. */
export const msLeft = (state: StandUpState, nowMs: number): number =>
  state.running ? Math.max(0, state.remainingMs - Math.max(0, nowMs - state.at)) : state.remainingMs;

/** Due now: the app is in the foreground and the time has run out. */
export const isDue = (state: StandUpState, nowMs: number): boolean => state.running && msLeft(state, nowMs) === 0;

export function standUpTimer(state: StandUpState, event: StandUpEvent, nowMs: number): StandUpState {
  switch (event) {
    case 'RESTART':
      return { remainingMs: STAND_UP_INTERVAL_MS, at: nowMs, running: state.running };
    case 'BACKGROUND':
      return state.running ? { remainingMs: msLeft(state, nowMs), at: nowMs, running: false } : state;
    case 'FOREGROUND': {
      if (state.running) return state;
      const away = Math.max(0, nowMs - state.at);
      return { remainingMs: away > STAND_UP_PAUSE_AFTER_MS ? state.remainingMs : Math.max(0, state.remainingMs - away), at: nowMs, running: true };
    }
  }
}

/** What was saved reads as a state again only if every member is a sane number; anything else is not used. */
export function readStandUp(value: unknown): StandUpState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { remainingMs, at, running } = value as Record<string, unknown>;
  const sane = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!sane(remainingMs) || !sane(at) || typeof running !== 'boolean') return undefined;
  if (remainingMs < 0 || remainingMs > STAND_UP_INTERVAL_MS) return undefined;
  return { remainingMs, at, running };
}
