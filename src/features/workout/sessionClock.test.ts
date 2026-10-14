import type { WorkoutDetail } from '../../../domain/contract/content.ts';
import { activeMs, buildSchedule, elapsedSec, pauseClock, positionAt, resumeClock, startClock } from './sessionClock';
import fixture from './workoutFixture.json';

// "Toàn thân vừa sức" of the real content: 1 warm-up, 4 main moves x 3 sets, 1 cool-down, 900 s.
const detail = fixture.detail as unknown as WorkoutDetail;
const S = 1000;
const T0 = 1_760_000_000_000;

describe('the clock: active time only', () => {
  test('start, 60 s, pause, 300 s, resume, 30 s: 90 s of training', () => {
    let clock = startClock(T0);
    expect(elapsedSec(clock, T0 + 60 * S)).toBe(60);
    clock = pauseClock(clock, T0 + 60 * S);
    // while paused the clock stands still, whatever the time is
    expect(elapsedSec(clock, T0 + 200 * S)).toBe(60);
    expect(elapsedSec(clock, T0 + 360 * S)).toBe(60);
    clock = resumeClock(clock, T0 + 360 * S);
    expect(elapsedSec(clock, T0 + 360 * S)).toBe(60);
    expect(elapsedSec(clock, T0 + 390 * S)).toBe(90);
    expect(clock).toEqual({ startedAtMs: T0, pausedAtMs: null, pausedTotalMs: 300 * S });
  });

  test('a second pause and a second resume change nothing', () => {
    const running = startClock(T0);
    expect(resumeClock(running, T0 + 5 * S)).toBe(running);
    const paused = pauseClock(running, T0 + 10 * S);
    // the later moment of a second pause is not taken: the 20 s in between stay paused time
    expect(pauseClock(paused, T0 + 30 * S)).toBe(paused);
    const resumed = resumeClock(paused, T0 + 40 * S);
    expect(resumeClock(resumed, T0 + 70 * S)).toBe(resumed);
    expect(elapsedSec(resumed, T0 + 70 * S)).toBe(40);
  });

  test('whole seconds are counted down, parts of a second are kept for the ring', () => {
    const clock = startClock(T0);
    expect(elapsedSec(clock, T0 + 999)).toBe(0);
    expect(elapsedSec(clock, T0 + 1000)).toBe(1);
    expect(activeMs(clock, T0 + 1250)).toBe(1250);
  });

  test('a device clock that was set back never gives negative time', () => {
    const clock = startClock(T0);
    expect(elapsedSec(clock, T0 - 60 * S)).toBe(0);
    // resumed "before" the pause by the device clock: no paused time is taken away from the session
    const resumed = resumeClock(pauseClock(clock, T0 + 30 * S), T0 + 10 * S);
    expect(resumed.pausedTotalMs).toBe(0);
  });

  test('nothing in the module reads a clock: it works with Date.now taken away', () => {
    const now = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the session clock must be given the time');
    });
    try {
      const clock = resumeClock(pauseClock(startClock(T0), T0 + S), T0 + 2 * S);
      expect(elapsedSec(clock, T0 + 5 * S)).toBe(4);
      expect(positionAt(buildSchedule(detail), 4).segmentIndex).toBe(0);
    } finally {
      now.mockRestore();
    }
  });
});

describe('the schedule: warm-up once, the main moves once per set, cool-down once', () => {
  const schedule = buildSchedule(detail);

  test('1 warm-up, 4 main x 3 sets, 1 cool-down: 14 segments whose seconds are the duration', () => {
    expect(schedule).toHaveLength(14);
    expect(schedule.reduce((sum, segment) => sum + segment.seconds, 0)).toBe(detail.durationSec);
    expect(schedule.map(segment => segment.stepPosition)).toEqual([1, 2, 3, 4, 5, 2, 3, 4, 5, 2, 3, 4, 5, 6]);
    // the warm-up belongs to the first set, the cool-down to the last
    expect(schedule.map(segment => segment.setIndex)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect(schedule.every(segment => segment.setCount === 3)).toBe(true);
    expect(schedule[0]).toEqual({ stepPosition: 1, setIndex: 1, setCount: 3, seconds: 30 });
  });

  test('the steps are taken in the order of their position, whatever order they arrive in', () => {
    const shuffled = { ...detail, steps: [...detail.steps].reverse() };
    expect(buildSchedule(shuffled)).toEqual(schedule);
  });

  test('a workout of one set, and one without a main part', () => {
    expect(buildSchedule({ ...detail, sets: 1 })).toHaveLength(6);
    expect(buildSchedule({ ...detail, steps: detail.steps.filter(step => step.phase !== 'MAIN') })).toHaveLength(2);
  });
});

describe('where the session is after so many seconds', () => {
  const schedule = buildSchedule(detail);

  test('at 0: the first segment, all of it and all of the session left', () => {
    expect(positionAt(schedule, 0)).toEqual({ segmentIndex: 0, remainingInSegment: 30, remainingTotal: 900, finished: false });
  });

  test('at a boundary the next segment has begun', () => {
    expect(positionAt(schedule, 29)).toEqual({ segmentIndex: 0, remainingInSegment: 1, remainingTotal: 871, finished: false });
    expect(positionAt(schedule, 30)).toEqual({ segmentIndex: 1, remainingInSegment: 90, remainingTotal: 870, finished: false });
    // 30 + (90 + 80 + 90 + 20) = 310: the second set begins
    expect(positionAt(schedule, 310)).toEqual({ segmentIndex: 5, remainingInSegment: 90, remainingTotal: 590, finished: false });
  });

  test('at the end, and beyond it: finished, on the last segment, nothing left', () => {
    const end = { segmentIndex: 13, remainingInSegment: 0, remainingTotal: 0, finished: true };
    expect(positionAt(schedule, 899)).toEqual({ segmentIndex: 13, remainingInSegment: 1, remainingTotal: 1, finished: false });
    expect(positionAt(schedule, 900)).toEqual(end);
    expect(positionAt(schedule, 5000)).toEqual(end);
  });

  test('before the start, and with no schedule at all', () => {
    expect(positionAt(schedule, -5)).toEqual(positionAt(schedule, 0));
    expect(positionAt([], 0)).toEqual({ segmentIndex: 0, remainingInSegment: 0, remainingTotal: 0, finished: true });
  });
});
