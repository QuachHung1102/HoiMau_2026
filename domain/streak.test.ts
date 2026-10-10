import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays } from './logicalDate.ts';
import type { CloseEvent, DayInput, StreakState } from './streak.ts';
import {
  INITIAL_STREAK_STATE,
  closeDays,
  rescueWithTicket,
  ticketPreview,
} from './streak.ts';
import type { DateLabel, DayOutcome } from './types.ts';

/** Day 1 is 2026-09-01. */
const date = (day: number): DateLabel => addDays('2026-09-01', day - 1);

/** One letter per day: C = all STORY done, F = ticket only, M = neither, B = done and ticketed. */
const days = (letters: string): DayInput[] =>
  letters.split('').map((letter, index) => ({
    date: date(index + 1),
    storyCompleted: letter === 'C' || letter === 'B',
    ticketApplied: letter === 'F' || letter === 'B',
  }));

const st = (
  streakCurrent: number,
  streakBest: number,
  streakBeforeBreak: number | null,
  breakDate: DateLabel | null,
  missedRun: number,
  lastOutcome: DayOutcome | null,
): StreakState => ({
  streakCurrent,
  streakBest,
  streakBeforeBreak,
  breakDate,
  missedRun,
  lastOutcome,
});

/** Closes one day at a time; also checks that closing them in one call gives the same result. */
function run(letters: string) {
  const states: StreakState[] = [];
  const events: CloseEvent[][] = [];
  let state = INITIAL_STREAK_STATE;
  for (const day of days(letters)) {
    const closed = closeDays(state, [day]);
    state = closed.state;
    states.push(closed.state);
    events.push(closed.events);
  }
  assert.deepEqual(closeDays(INITIAL_STREAK_STATE, days(letters)), {
    state,
    events: events.flat(),
  });
  return { states, events };
}

// Expected states and events: output of an independent throwaway script that derives each row
// from the whole history instead of the previous state.

test('INITIAL_STREAK_STATE is all zero / null', () => {
  assert.deepEqual(INITIAL_STREAK_STATE, st(0, 0, null, null, 0, null));
});

test('closeDays with no days returns an equal state and no events', () => {
  const state = st(4, 9, null, null, 0, 'COMPLETED');
  assert.deepEqual(closeDays(state, []), { state, events: [] });
});

test('seven completed days from zero: the milestone fires on day 7, not before', () => {
  const { states, events } = run('CCCCCCC');
  assert.deepEqual(
    states,
    [1, 2, 3, 4, 5, 6, 7].map(n => st(n, n, null, null, 0, 'COMPLETED')),
  );
  assert.deepEqual(events, [
    [],
    [],
    [],
    [],
    [],
    [],
    [{ type: 'STREAK_MILESTONE', date: date(7), days: 7 }],
  ]);
});

test('milestones fire exactly at 7, 30 and 100', () => {
  const { events } = closeDays(INITIAL_STREAK_STATE, days('C'.repeat(101)));
  assert.deepEqual(events, [
    { type: 'STREAK_MILESTONE', date: date(7), days: 7 },
    { type: 'STREAK_MILESTONE', date: date(30), days: 30 },
    { type: 'STREAK_MILESTONE', date: date(100), days: 100 },
  ]);
});

test('completed ×5 then missed: streak 0, pre-break value kept, best stays 5', () => {
  const { states, events } = run('CCCCCM');
  assert.deepEqual(states[4], st(5, 5, null, null, 0, 'COMPLETED'));
  assert.deepEqual(states[5], st(0, 5, 5, date(6), 1, 'MISSED'));
  assert.deepEqual(events[5], [
    { type: 'STREAK_BROKEN', date: date(6), previous: 5 },
  ]);
});

test('missed ×3 from streak 0: PET_TIRED exactly on the third, no STREAK_BROKEN', () => {
  const { states, events } = run('MMM');
  assert.deepEqual(states, [
    st(0, 0, null, null, 1, 'MISSED'),
    st(0, 0, null, null, 2, 'MISSED'),
    st(0, 0, null, null, 3, 'MISSED'),
  ]);
  assert.deepEqual(events, [[], [], [{ type: 'PET_TIRED', date: date(3) }]]);
});

test('PET_TIRED is not repeated on the fourth missed day', () => {
  const { states, events } = run('CMMMM');
  assert.deepEqual(events, [
    [],
    [{ type: 'STREAK_BROKEN', date: date(2), previous: 1 }],
    [],
    [{ type: 'PET_TIRED', date: date(4) }],
    [],
  ]);
  assert.deepEqual(states[4], st(0, 1, null, null, 4, 'MISSED'));
});

test('completed ×4, frozen, completed: the frozen day neither raises nor breaks the streak', () => {
  const { states, events } = run('CCCCFC');
  assert.deepEqual(states[3], st(4, 4, null, null, 0, 'COMPLETED'));
  assert.deepEqual(states[4], st(4, 4, null, null, 0, 'FROZEN'));
  assert.deepEqual(states[5], st(5, 5, null, null, 0, 'COMPLETED'));
  assert.deepEqual(events, [[], [], [], [], [], []]);
});

test('a frozen day leaves missedRun unchanged and does not count as missed', () => {
  const { states, events } = run('MMFM');
  assert.deepEqual(states[2], st(0, 0, null, null, 2, 'FROZEN'));
  assert.deepEqual(states[3], st(0, 0, null, null, 3, 'MISSED'));
  assert.deepEqual(events, [
    [],
    [],
    [],
    [{ type: 'PET_TIRED', date: date(4) }],
  ]);
});

test('missed, missed: the second miss clears streakBeforeBreak', () => {
  const { states, events } = run('CMM');
  assert.deepEqual(states[1], st(0, 1, 1, date(2), 1, 'MISSED'));
  assert.deepEqual(states[2], st(0, 1, null, null, 2, 'MISSED'));
  assert.deepEqual(events, [
    [],
    [{ type: 'STREAK_BROKEN', date: date(2), previous: 1 }],
    [],
  ]);
});

test('a frozen or completed day after a break clears the break fields', () => {
  assert.deepEqual(run('CMF').states[2], st(0, 1, null, null, 1, 'FROZEN'));
  assert.deepEqual(run('CMC').states[2], st(1, 1, null, null, 0, 'COMPLETED'));
});

test('a day both completed and ticketed counts as completed (AR-10)', () => {
  const { states, events } = run('CCB');
  assert.deepEqual(states[2], st(3, 3, null, null, 0, 'COMPLETED'));
  assert.deepEqual(events, [[], [], []]);
});

test('closeDays processes the days in the order given', () => {
  const given = [...days('CCM')].reverse(); // missed first, then two completed
  assert.deepEqual(closeDays(INITIAL_STREAK_STATE, given), {
    state: st(2, 2, null, null, 0, 'COMPLETED'),
    events: [],
  });
});

test('closeDays does not mutate its input', () => {
  const state = Object.freeze(st(6, 6, null, null, 0, 'COMPLETED'));
  const input = Object.freeze(days('CMMM').map(day => Object.freeze(day)));
  const closed = closeDays(state, input as DayInput[]);
  assert.deepEqual(closed.state, st(0, 7, null, null, 3, 'MISSED'));
  assert.deepEqual(state, st(6, 6, null, null, 0, 'COMPLETED'));
  assert.deepEqual(input, days('CMMM'));
});

test('streakBest never decreases over a long seeded sequence', () => {
  // Park–Miller generator with a fixed seed: the same 5000 days on every run.
  let seed = 20261011;
  const next = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  let state = INITIAL_STREAK_STATE;
  let highestStreak = 0;
  const seen = new Set<DayOutcome | null>();
  for (let day = 1; day <= 5000; day++) {
    const roll = next();
    const input: DayInput = {
      date: date(day),
      storyCompleted: roll < 0.8,
      ticketApplied: next() < 0.3,
    };
    const closed = closeDays(state, [input]);
    const after = closed.state;
    assert.ok(after.streakBest >= state.streakBest, `day ${day}`);
    assert.ok(after.streakBest >= after.streakCurrent, `day ${day}`);
    assert.ok(after.streakCurrent === 0 || after.missedRun === 0, `day ${day}`);
    assert.equal(after.breakDate === null, after.streakBeforeBreak === null);
    highestStreak = Math.max(highestStreak, after.streakCurrent);
    seen.add(after.lastOutcome);
    state = after;
  }
  assert.equal(state.streakBest, highestStreak);
  assert.ok(highestStreak >= 7, 'the sequence reaches a real streak');
  assert.deepEqual([...seen].sort(), ['COMPLETED', 'FROZEN', 'MISSED']);
});

test('rescueWithTicket on the break date restores the streak and lowers missedRun by one', () => {
  const broken = closeDays(INITIAL_STREAK_STATE, days('CCCCCM')).state;
  assert.deepEqual(broken, st(0, 5, 5, date(6), 1, 'MISSED'));
  assert.deepEqual(
    rescueWithTicket(broken, date(6)),
    st(5, 5, null, null, 0, 'FROZEN'),
  );
  assert.deepEqual(broken, st(0, 5, 5, date(6), 1, 'MISSED')); // input untouched
  // the same state as if the ticket had been on that day when it closed
  assert.deepEqual(
    rescueWithTicket(broken, date(6)),
    closeDays(INITIAL_STREAK_STATE, days('CCCCCF')).state,
  );
  // by one, not to zero — and never below zero
  assert.equal(
    rescueWithTicket(st(0, 5, 5, date(6), 3, 'MISSED'), date(6)).missedRun,
    2,
  );
  assert.equal(
    rescueWithTicket(st(0, 5, 5, date(6), 0, 'MISSED'), date(6)).missedRun,
    0,
  );
});

test('a rescued streak continues from the restored value', () => {
  const broken = closeDays(INITIAL_STREAK_STATE, days('CCCCCCM')).state;
  const rescued = rescueWithTicket(broken, date(7));
  assert.deepEqual(closeDays(rescued, [days('CCCCCCMC')[7]]), {
    state: st(7, 7, null, null, 0, 'COMPLETED'),
    events: [{ type: 'STREAK_MILESTONE', date: date(8), days: 7 }],
  });
});

test('rescueWithTicket throws when the date is not the break date', () => {
  const broken = closeDays(INITIAL_STREAK_STATE, days('CCCCCM')).state;
  assert.throws(() => rescueWithTicket(broken, date(5)), RangeError);
  assert.throws(() => rescueWithTicket(broken, date(7)), RangeError);
  // nothing to rescue: no break at all, or the break was already overwritten by a second miss
  assert.throws(
    () => rescueWithTicket(INITIAL_STREAK_STATE, date(1)),
    RangeError,
  );
  const twice = closeDays(INITIAL_STREAK_STATE, days('CMM')).state;
  assert.throws(() => rescueWithTicket(twice, date(2)), RangeError);
  // an inconsistent state (break date without a value) is refused, not restored to null
  assert.throws(
    () => rescueWithTicket(st(0, 5, null, date(6), 1, 'MISSED'), date(6)),
    RangeError,
  );
});

test('ticketPreview TODAY: needed only when there is a streak to protect', () => {
  assert.deepEqual(ticketPreview(INITIAL_STREAK_STATE, 'TODAY'), {
    needed: false,
    withoutTicket: 0,
    withTicket: 0,
  });
  assert.deepEqual(
    ticketPreview(st(4, 6, null, null, 0, 'COMPLETED'), 'TODAY'),
    { needed: true, withoutTicket: 0, withTicket: 4 },
  );
});

test('ticketPreview YESTERDAY: needed only when yesterday broke a streak', () => {
  assert.deepEqual(
    ticketPreview(st(0, 5, 5, date(6), 1, 'MISSED'), 'YESTERDAY'),
    { needed: true, withoutTicket: 0, withTicket: 5 },
  );
  assert.deepEqual(
    ticketPreview(st(4, 6, null, null, 0, 'COMPLETED'), 'YESTERDAY'),
    { needed: false, withoutTicket: 4, withTicket: 4 },
  );
});
