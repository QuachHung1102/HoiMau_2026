import { freshStandUp, isDue, msLeft, readStandUp, standUpTimer, STAND_UP_INTERVAL_MS, STAND_UP_PAUSE_AFTER_MS, type StandUpEvent, type StandUpState } from './standUpTimer';

const MIN = 60_000;
const T0 = 1_000_000;

/** A countdown that has been running in the foreground since T0. */
const running = (): StandUpState => standUpTimer(freshStandUp(T0), 'FOREGROUND', T0);
const run = (state: StandUpState, ...steps: [StandUpEvent, number][]) => steps.reduce((now, [event, at]) => standUpTimer(now, event, at), state);

describe('the stand-up countdown', () => {
  test('a device that has never had one starts a full hour, not running until the app is in the foreground', () => {
    const state = freshStandUp(T0);
    expect(state).toEqual({ remainingMs: 60 * MIN, at: T0, running: false });
    expect(isDue(state, T0 + 10 * 60 * MIN)).toBe(false);
    expect(msLeft(state, T0 + 10 * 60 * MIN)).toBe(60 * MIN);
  });

  test('it is due after 60 foreground minutes: not at 59:59.999, due at 60:00', () => {
    const state = running();
    expect(msLeft(state, T0 + 42 * MIN)).toBe(18 * MIN);
    expect(isDue(state, T0 + 60 * MIN - 1)).toBe(false);
    expect(isDue(state, T0 + 60 * MIN)).toBe(true);
    expect(msLeft(state, T0 + 3 * 60 * MIN)).toBe(0);
  });

  test('a 5-minute stay in the background does not pause it: the time keeps counting', () => {
    const state = run(running(), ['BACKGROUND', T0 + 20 * MIN], ['FOREGROUND', T0 + 25 * MIN]);
    expect(state.running).toBe(true);
    // 20 minutes of foreground + 5 away = 25 gone
    expect(msLeft(state, T0 + 25 * MIN)).toBe(35 * MIN);
    expect(isDue(state, T0 + 60 * MIN)).toBe(true);
  });

  test('a stay of exactly 10 minutes still counts; one millisecond more pauses', () => {
    const left = (away: number) => msLeft(run(running(), ['BACKGROUND', T0 + 20 * MIN], ['FOREGROUND', T0 + 20 * MIN + away]), T0 + 20 * MIN + away);
    expect(left(STAND_UP_PAUSE_AFTER_MS)).toBe(30 * MIN);
    expect(left(STAND_UP_PAUSE_AFTER_MS + 1)).toBe(40 * MIN);
  });

  test('an 11-minute stay pauses it: on return the remaining time is what it was when the app left', () => {
    const state = run(running(), ['BACKGROUND', T0 + 20 * MIN], ['FOREGROUND', T0 + 31 * MIN]);
    expect(state).toEqual({ remainingMs: 40 * MIN, at: T0 + 31 * MIN, running: true });
    // and it runs again from there
    expect(isDue(state, T0 + 70 * MIN)).toBe(false);
    expect(isDue(state, T0 + 71 * MIN)).toBe(true);
  });

  test('a night in the background is not counted either', () => {
    const state = run(running(), ['BACKGROUND', T0 + 50 * MIN], ['FOREGROUND', T0 + 12 * 60 * MIN]);
    expect(msLeft(state, T0 + 12 * 60 * MIN)).toBe(10 * MIN);
  });

  test('while the app is away nothing is ever due, and the remaining time does not move', () => {
    const away = run(running(), ['BACKGROUND', T0 + 20 * MIN]);
    expect(away.running).toBe(false);
    expect(isDue(away, T0 + 20 * MIN + 5 * 60 * MIN)).toBe(false);
    expect(msLeft(away, T0 + 20 * MIN + 5 * 60 * MIN)).toBe(40 * MIN);
  });

  test('a short stay that outlasts what was left is due the moment the app returns', () => {
    const state = run(running(), ['BACKGROUND', T0 + 55 * MIN], ['FOREGROUND', T0 + 62 * MIN]);
    expect(isDue(state, T0 + 62 * MIN)).toBe(true);
  });

  test('restart begins a full hour from now, in the state the app is in', () => {
    const due = run(running(), ['RESTART', T0 + 60 * MIN]);
    expect(due).toEqual({ remainingMs: STAND_UP_INTERVAL_MS, at: T0 + 60 * MIN, running: true });
    expect(isDue(due, T0 + 60 * MIN)).toBe(false);
    expect(isDue(due, T0 + 120 * MIN)).toBe(true);
    const away = run(freshStandUp(T0), ['RESTART', T0 + 5 * MIN]);
    expect(away).toEqual({ remainingMs: STAND_UP_INTERVAL_MS, at: T0 + 5 * MIN, running: false });
  });

  test('repeated events change nothing: a second FOREGROUND while running, a second BACKGROUND while away', () => {
    const state = running();
    expect(standUpTimer(state, 'FOREGROUND', T0 + 30 * MIN)).toBe(state);
    const away = standUpTimer(state, 'BACKGROUND', T0 + 30 * MIN);
    expect(standUpTimer(away, 'BACKGROUND', T0 + 90 * MIN)).toBe(away);
  });

  test('a clock that went back counts as no time passed', () => {
    const state = running();
    expect(msLeft(state, T0 - 5 * MIN)).toBe(60 * MIN);
    const back = run(state, ['BACKGROUND', T0 - 5 * MIN]);
    expect(back.remainingMs).toBe(60 * MIN);
    expect(standUpTimer(back, 'FOREGROUND', T0 - 10 * MIN).remainingMs).toBe(60 * MIN);
  });

  test('it is a pure function of its arguments: no clock is read, the input is not changed', () => {
    const now = jest.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the reducer read the clock');
    });
    const state = running();
    const frozen = JSON.stringify(state);
    run(state, ['BACKGROUND', T0 + 20 * MIN], ['FOREGROUND', T0 + 31 * MIN], ['RESTART', T0 + 32 * MIN]);
    isDue(state, T0 + 61 * MIN);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

describe('what was saved', () => {
  test('a sane state reads back, anything else is not used', () => {
    const state = running();
    expect(readStandUp(JSON.parse(JSON.stringify(state)))).toEqual(state);
    for (const bad of [undefined, null, 5, 'x', {}, { ...state, remainingMs: -1 }, { ...state, remainingMs: STAND_UP_INTERVAL_MS + 1 }, { ...state, at: NaN }, { ...state, running: 'yes' }, { remainingMs: 1, at: 1 }]) {
      expect(readStandUp(bad)).toBeUndefined();
    }
  });
});
