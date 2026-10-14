import type { WorkoutDetail } from '../../../domain/contract/content.ts';

// The time of a focus session, as plain arithmetic. Nothing here reads a clock or starts a timer: every function is
// given the moment (`nowMs`), so the screen decides when to look at `Date.now()` and a test decides what time it is.
// The time trained is what lies between the start and now, less every paused span: it never depends on how often,
// or whether, a timer callback ran.

/** One stretch of the session: a step of the workout, in one of its sets. */
export type Segment = { stepPosition: number; setIndex: number; setCount: number; seconds: number };

/**
 * The session in order: the warm-up steps once, the main steps once per set, the cool-down steps once. The warm-up
 * counts as part of the first set and the cool-down as part of the last, so "Hiệp a / b" never goes backwards.
 */
export function buildSchedule(detail: WorkoutDetail): Segment[] {
  const steps = [...detail.steps].sort((a, b) => a.position - b.position);
  const setCount = Math.max(1, detail.sets);
  const of = (phase: WorkoutDetail['steps'][number]['phase'], setIndex: number): Segment[] =>
    steps.filter(step => step.phase === phase).map(step => ({ stepPosition: step.position, setIndex, setCount, seconds: step.seconds }));
  return [...of('WARMUP', 1), ...Array.from({ length: setCount }, (_, set) => of('MAIN', set + 1)).flat(), ...of('COOLDOWN', setCount)];
}

/** `pausedAtMs`: when the running pause began (null while running). `pausedTotalMs`: every pause that has ended. */
export type ClockState = { startedAtMs: number; pausedAtMs: number | null; pausedTotalMs: number };

export function startClock(nowMs: number): ClockState {
  return { startedAtMs: nowMs, pausedAtMs: null, pausedTotalMs: 0 };
}

/** Pausing a paused clock changes nothing: the pause began when it began. */
export function pauseClock(s: ClockState, nowMs: number): ClockState {
  return s.pausedAtMs === null ? { ...s, pausedAtMs: nowMs } : s;
}

/** Resuming a running clock changes nothing. */
export function resumeClock(s: ClockState, nowMs: number): ClockState {
  return s.pausedAtMs === null ? s : { ...s, pausedAtMs: null, pausedTotalMs: s.pausedTotalMs + Math.max(0, nowMs - s.pausedAtMs) };
}

/** Milliseconds trained so far (for a ring that moves inside a second). Never negative, also when the device clock was set back. */
export function activeMs(s: ClockState, nowMs: number): number {
  return Math.max(0, (s.pausedAtMs ?? nowMs) - s.startedAtMs - s.pausedTotalMs);
}

/** Whole seconds trained so far: active time only. */
export function elapsedSec(s: ClockState, nowMs: number): number {
  return Math.floor(activeMs(s, nowMs) / 1000);
}

/** Where the session is after `elapsed` active seconds. At a boundary the next segment has begun. */
export function positionAt(schedule: Segment[], elapsed: number): { segmentIndex: number; remainingInSegment: number; remainingTotal: number; finished: boolean } {
  const total = schedule.reduce((sum, segment) => sum + segment.seconds, 0);
  const done = Math.max(0, elapsed);
  if (done >= total) return { segmentIndex: Math.max(0, schedule.length - 1), remainingInSegment: 0, remainingTotal: 0, finished: true };
  let end = 0;
  const segmentIndex = schedule.findIndex(segment => (end += segment.seconds) > done);
  return { segmentIndex, remainingInSegment: end - done, remainingTotal: total - done, finished: false };
}
