import { STREAK_MILESTONES } from './economy.ts';
import type { DateLabel, DayOutcome } from './types.ts';

export type StreakState = {
  streakCurrent: number;
  streakBest: number;
  /** Set only by the most recent close, when that day broke a streak (D-04 rescue window). */
  streakBeforeBreak: number | null;
  breakDate: DateLabel | null;
  /** Consecutive missed days; a frozen day neither adds to it nor resets it. */
  missedRun: number;
  lastOutcome: DayOutcome | null;
};

export type DayInput = {
  date: DateLabel;
  storyCompleted: boolean;
  ticketApplied: boolean;
};

export type CloseEvent =
  | { type: 'STREAK_MILESTONE'; date: DateLabel; days: 7 | 30 | 100 }
  | { type: 'STREAK_BROKEN'; date: DateLabel; previous: number }
  | { type: 'PET_TIRED'; date: DateLabel };

export const INITIAL_STREAK_STATE: StreakState = Object.freeze({
  streakCurrent: 0,
  streakBest: 0,
  streakBeforeBreak: null,
  breakDate: null,
  missedRun: 0,
  lastOutcome: null,
});

function closeDay(
  state: StreakState,
  day: DayInput,
  events: CloseEvent[],
): StreakState {
  const { date } = day;
  // Completed wins over a ticket applied to the same date.
  if (day.storyCompleted) {
    const streakCurrent = state.streakCurrent + 1;
    const milestone = STREAK_MILESTONES.find(m => m.days === streakCurrent);
    if (milestone) {
      events.push({ type: 'STREAK_MILESTONE', date, days: milestone.days });
    }
    return {
      streakCurrent,
      streakBest: Math.max(state.streakBest, streakCurrent),
      streakBeforeBreak: null,
      breakDate: null,
      missedRun: 0,
      lastOutcome: 'COMPLETED',
    };
  }
  if (day.ticketApplied) {
    return {
      ...state,
      streakBeforeBreak: null,
      breakDate: null,
      lastOutcome: 'FROZEN',
    };
  }
  const broken = state.streakCurrent > 0;
  if (broken) {
    events.push({
      type: 'STREAK_BROKEN',
      date,
      previous: state.streakCurrent,
    });
  }
  const missedRun = state.missedRun + 1;
  if (missedRun === 3) {
    events.push({ type: 'PET_TIRED', date });
  }
  return {
    streakCurrent: 0,
    streakBest: state.streakBest,
    streakBeforeBreak: broken ? state.streakCurrent : null,
    breakDate: broken ? date : null,
    missedRun,
    lastOutcome: 'MISSED',
  };
}

/** Closes the days in the order given (the caller sorts them ascending). Does not mutate its input. */
export function closeDays(
  state: StreakState,
  days: DayInput[],
): { state: StreakState; events: CloseEvent[] } {
  const events: CloseEvent[] = [];
  let next = { ...state };
  for (const day of days) {
    next = closeDay(next, day, events);
  }
  return { state: next, events };
}

/**
 * A ticket applied to the day that just broke the streak (D-04): that day becomes frozen.
 * Throws RangeError when `date` is not the break date.
 */
export function rescueWithTicket(
  state: StreakState,
  date: DateLabel,
): StreakState {
  if (date !== state.breakDate || state.streakBeforeBreak === null) {
    throw new RangeError(`no streak break to rescue on ${date}`);
  }
  return {
    ...state,
    streakCurrent: state.streakBeforeBreak,
    streakBeforeBreak: null,
    breakDate: null,
    missedRun: Math.max(0, state.missedRun - 1),
    lastOutcome: 'FROZEN',
  };
}

/** The streak a ticket would protect: for the open day, or for the day that just closed. */
export function ticketPreview(
  state: StreakState,
  target: 'TODAY' | 'YESTERDAY',
): { needed: boolean; withoutTicket: number; withTicket: number } {
  if (target === 'TODAY') {
    return {
      needed: state.streakCurrent > 0,
      withoutTicket: 0,
      withTicket: state.streakCurrent,
    };
  }
  return {
    needed: state.streakBeforeBreak !== null,
    withoutTicket: state.streakCurrent,
    withTicket: state.streakBeforeBreak ?? state.streakCurrent,
  };
}
