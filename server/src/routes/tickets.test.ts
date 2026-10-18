// GET /freeze-tickets and POST /freeze-tickets/use over HTTP on the real database, with the
// day-close job: protecting today, rescuing a closed yesterday until 15:00, every refusal and each
// adjacent pair of their order, the previews against ticketPreview, the screen against the
// function, and the races (two uses of one ticket; a use against the close of the very day it
// names, in both lock orders). Streak states and tickets are arranged through the owner
// connection; the clock is the test clock. 2027-03-10 is a Wednesday; Asia/Ho_Chi_Minh (UTC+7).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import { rescueWithTicket, ticketPreview } from '../../../domain/streak.ts';
import type { StreakState } from '../../../domain/streak.ts';
import { asUser, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { runJob } from '../jobs/scheduler.ts';
import { createLogger } from '../log.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;
const TODAY = '2027-03-10';
const YESTERDAY = '2027-03-09';
const quiet = createLogger(() => {});

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();
const clock = (date: string, hhmm: string) => setTestClock(db.admin, at(date, hhmm));
const spend = (user: { token: string }, date: unknown, key: string = randomUUID()) =>
  app.call('POST', '/freeze-tickets/use', { token: user.token, key, body: { date } });
const tickets = async (user: User) => ok(await app.call('GET', '/freeze-tickets', { token: user.token }));
function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
const code = (result: CallResult) => (result.status === 200 ? 'ok' : result.body?.error?.code);

type Fixture = {
  streakCurrent: number;
  streakBest?: number;
  streakBeforeBreak?: number | null;
  breakDate?: string | null;
  missedRun?: number;
  lastOutcome?: string | null;
  lastClosed: string | null;
};

/** A user whose first day is 2027-03-01, with this streak state and `tickets` unused tickets. */
async function userWith(f: Fixture, ticketCount = 1): Promise<User> {
  const user = await newOnboardedUser(db);
  await db.admin.query(
    `UPDATE progression_state SET onboard_date = '2027-03-01', last_closed_date = $2, streak_current = $3,
            streak_best = $4, streak_before_break = $5, break_date = $6, missed_run = $7, last_outcome = $8
      WHERE user_id = $1`,
    [
      user.userId,
      f.lastClosed,
      f.streakCurrent,
      f.streakBest ?? Math.max(f.streakCurrent, f.streakBeforeBreak ?? 0),
      f.streakBeforeBreak ?? null,
      f.breakDate ?? null,
      f.missedRun ?? 0,
      f.lastOutcome ?? null,
    ],
  );
  for (let i = 0; i < ticketCount; i++) {
    await giveTicket(user, i);
  }
  return user;
}
/** One unused ticket, granted for the Monday `weeksBack` weeks before 2027-03-08. */
const giveTicket = (user: User, weeksBack = 0) =>
  db.admin.query("INSERT INTO freeze_tickets (user_id, grant_week) VALUES ($1, date '2027-03-08' - 7 * $2::int)", [
    user.userId,
    weeksBack,
  ]);
const stateOf = async (user: User): Promise<StreakState & { lastClosed: string | null }> =>
  (
    await db.admin.query(
      `SELECT streak_current AS "streakCurrent", streak_best AS "streakBest", streak_before_break AS "streakBeforeBreak",
              to_char(break_date, 'YYYY-MM-DD') AS "breakDate", missed_run AS "missedRun", last_outcome AS "lastOutcome",
              to_char(last_closed_date, 'YYYY-MM-DD') AS "lastClosed"
         FROM progression_state WHERE user_id = $1`,
      [user.userId],
    )
  ).rows[0];
const ticketRows = async (user: User) =>
  (
    await db.admin.query(
      `SELECT to_char(grant_week, 'YYYY-MM-DD') AS week, to_char(used_for_date, 'YYYY-MM-DD') AS used_for
         FROM freeze_tickets WHERE user_id = $1 ORDER BY granted_at, grant_week`,
      [user.userId],
    )
  ).rows;
const outcomeOf = async (user: User, date: string) =>
  ok(await app.call('GET', `/day/history?from=${date}&to=${date}`, { token: user.token })).days[0].outcome;

/** Both STORY quests of today done through the real routes: a meal inside the band, a full workout. */
async function completeStory(user: User) {
  const day = ok(await app.call('GET', '/day', { token: user.token }));
  ok(
    await app.call('POST', '/nutrition/log', {
      token: user.token,
      key: randomUUID(),
      body: { kcal: Math.round((day.calorieWindow.min + day.calorieWindow.max) / 2) },
    }),
  );
  const { items } = ok(await app.call('GET', '/workout/catalog', { token: user.token }));
  const workout = [...items].sort((a, b) => a.durationSec - b.durationSec)[0];
  ok(
    await app.call('POST', '/workout/complete', {
      token: user.token,
      key: randomUUID(),
      body: { exerciseItemId: workout.id, elapsedSec: workout.durationSec },
    }),
  );
  const done = ok(await app.call('GET', '/day', { token: user.token }));
  assert.equal(done.story.done, done.story.total);
}

/** Whether ticket_use(date) would succeed now, in a transaction that is rolled back. */
async function wouldUse(user: User, date: string): Promise<string> {
  const rollback = new Error('rollback');
  try {
    await asUser(db.app, user.userId, async c => {
      await c.query('SELECT ticket_use($1, $2)', [date, randomUUID()]);
      throw rollback;
    });
  } catch (e) {
    if (e === rollback) return 'ok';
    return (e as Error).message;
  }
  throw new Error('unreachable');
}

test('today, streak 4, STORY not done: the ticket is used, and the next day-close keeps 4 with the day FROZEN', async () => {
  await clock(TODAY, '12:00');
  const user = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY, lastOutcome: 'COMPLETED' });
  const answer = ok(await spend(user, TODAY));
  assert.equal(answer.available, 0);
  assert.deepEqual(
    answer.eligible.map((e: { target: string; alreadyUsed: boolean }) => [e.target, e.alreadyUsed]),
    [
      ['TODAY', true],
      ['YESTERDAY', false],
    ],
  );
  assert.deepEqual(await ticketRows(user), [{ week: '2027-03-08', used_for: TODAY }]);
  await clock('2027-03-11', '04:00');
  await runJob('day-close', db.app, new Date(at('2027-03-11', '04:00')), quiet);
  const state = await stateOf(user);
  assert.deepEqual([state.streakCurrent, state.lastOutcome, state.lastClosed], [4, 'FROZEN', TODAY]);
  assert.equal(await outcomeOf(user, TODAY), 'FROZEN');
});

test('TICKET_NOT_NEEDED: today with streak 0; today with the STORY done', async () => {
  await clock(TODAY, '12:00');
  const zero = await userWith({ streakCurrent: 0, lastClosed: YESTERDAY });
  assert.equal(code(await spend(zero, TODAY)), 'TICKET_NOT_NEEDED');
  const done = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY });
  await completeStory(done);
  assert.equal(code(await spend(done, TODAY)), 'TICKET_NOT_NEEDED');
  assert.deepEqual(await ticketRows(done), [{ week: '2027-03-08', used_for: null }]);
});

test('rescue at 09:00 of yesterday that broke a streak of 5: streak 5 again, missed_run one lower, FROZEN, best untouched, exactly rescueWithTicket', async () => {
  await clock(TODAY, '09:00');
  const user = await userWith({
    streakCurrent: 0,
    streakBest: 7,
    streakBeforeBreak: 5,
    breakDate: YESTERDAY,
    missedRun: 1,
    lastOutcome: 'MISSED',
    lastClosed: YESTERDAY,
  });
  const { lastClosed: closedBefore, ...was } = await stateOf(user);
  const answer = ok(await spend(user, YESTERDAY));
  const { lastClosed, ...now } = await stateOf(user);
  assert.deepEqual(now, rescueWithTicket(was, YESTERDAY));
  assert.deepEqual([now.streakCurrent, now.streakBest, now.missedRun, now.lastOutcome], [5, 7, 0, 'FROZEN']);
  assert.deepEqual([closedBefore, lastClosed], [YESTERDAY, YESTERDAY]);
  assert.equal(answer.progression.streakCurrent, 5);
  assert.equal(answer.progression.breakNotice, null);
  assert.equal(await outcomeOf(user, YESTERDAY), 'FROZEN');
});

test('eligible dates: yesterday until 14:59 local, not at 15:00 nor before 03:00; the day before yesterday and tomorrow never', async () => {
  const broken = () =>
    userWith({ streakCurrent: 0, streakBeforeBreak: 5, breakDate: YESTERDAY, missedRun: 1, lastOutcome: 'MISSED', lastClosed: YESTERDAY });
  await clock(TODAY, '09:00');
  const early = await broken();
  const late = await broken();
  await clock(TODAY, '14:59');
  assert.equal(code(await spend(early, YESTERDAY)), 'ok');
  await clock(TODAY, '15:00');
  assert.equal(code(await spend(late, YESTERDAY)), 'TICKET_DATE_NOT_ELIGIBLE');
  // 02:59 on the 11th is still the logical 10th: its yesterday is the 9th, and the hour is before 03:00
  await clock('2027-03-11', '02:59');
  assert.equal(code(await spend(late, YESTERDAY)), 'TICKET_DATE_NOT_ELIGIBLE');
  await clock(TODAY, '09:00');
  const old = await userWith({
    streakCurrent: 0,
    streakBeforeBreak: 5,
    breakDate: '2027-03-08',
    missedRun: 2,
    lastOutcome: 'MISSED',
    lastClosed: YESTERDAY,
  });
  assert.equal(code(await spend(old, '2027-03-08')), 'TICKET_DATE_NOT_ELIGIBLE');
  const live = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY });
  assert.equal(code(await spend(live, '2027-03-11')), 'TICKET_DATE_NOT_ELIGIBLE');
  assert.deepEqual(await ticketRows(late), [{ week: '2027-03-08', used_for: null }]);
});

test('one ticket per date; NO_TICKET without one; a replay of the same key consumes one ticket', async () => {
  await clock(TODAY, '12:00');
  const user = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY }, 2);
  const key = randomUUID();
  const first = ok(await spend(user, TODAY, key));
  assert.deepEqual(ok(await spend(user, TODAY, key)), first);
  assert.equal(first.available, 1);
  assert.equal(code(await spend(user, TODAY)), 'TICKET_ALREADY_USED_FOR_DATE');
  // the oldest ticket goes first
  assert.deepEqual(await ticketRows(user), [
    { week: '2027-03-01', used_for: TODAY },
    { week: '2027-03-08', used_for: null },
  ]);
  const none = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY }, 0);
  assert.equal(code(await spend(none, TODAY)), 'NO_TICKET');
});

test('the refusal order, each adjacent pair: DATE_NOT_ELIGIBLE > ALREADY_USED_FOR_DATE > NO_TICKET > NOT_NEEDED; and before them 401, 400 key, 409 onboarding, 422 date', async () => {
  await clock(TODAY, '09:00');
  // not eligible, and a ticket already used for that date
  const a = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY }, 0);
  await db.admin.query(
    "INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date) VALUES ($1, '2027-03-01', app.now(), '2027-03-08')",
    [a.userId],
  );
  assert.equal(code(await spend(a, '2027-03-08')), 'TICKET_DATE_NOT_ELIGIBLE');
  // already used for today, and no unused ticket left
  const b = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY }, 0);
  await db.admin.query(
    "INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date) VALUES ($1, '2027-03-01', app.now(), $2)",
    [b.userId, TODAY],
  );
  assert.equal(code(await spend(b, TODAY)), 'TICKET_ALREADY_USED_FOR_DATE');
  // no ticket, and nothing to protect
  const c = await userWith({ streakCurrent: 0, lastClosed: YESTERDAY }, 0);
  assert.equal(code(await spend(c, TODAY)), 'NO_TICKET');
  // a ticket, nothing to protect
  const d = await userWith({ streakCurrent: 0, lastClosed: YESTERDAY }, 1);
  assert.equal(code(await spend(d, TODAY)), 'TICKET_NOT_NEEDED');

  // the route: no session, no key, not onboarded, then the date, all before the function
  assert.equal((await app.call('POST', '/freeze-tickets/use', { key: randomUUID(), body: {} })).status, 401);
  assert.equal(code(await app.call('POST', '/freeze-tickets/use', { token: c.token, body: {} })), 'IDEMPOTENCY_KEY_REQUIRED');
  const fresh = await newUser(db);
  assert.equal(code(await spend(fresh, 'x')), 'ONBOARDING_REQUIRED');
  for (const [date, rule] of [
    [undefined, 'required'],
    ['', 'required'],
    [20270310, 'format'],
    ['2027-02-30', 'format'],
    ['10/03/2027', 'format'],
  ] as const) {
    const result = await spend(c, date);
    assert.deepEqual([result.status, result.body.error.details?.fields], [422, [{ field: 'date', rule }]], String(date));
  }
  // in the function: a caller who is not onboarded is ONBOARDING_REQUIRED before any date rule
  await assert.rejects(
    asUser(db.app, fresh.userId, cl => cl.query("SELECT ticket_use('1999-01-01', $1)", [randomUUID()])),
    { message: 'ONBOARDING_REQUIRED' },
  );
});

type Eligible = { date: string; target: string; deadline: string; needed: boolean; withoutTicket: number; withTicket: number; alreadyUsed: boolean };

test('GET /freeze-tickets: previews equal ticketPreview, deadlines are 15:00 local, needed agrees with ticket_use on every fixture, and turns false once the STORY is done', async () => {
  const fixtures: [string, string, Fixture][] = [
    ['streak 4, STORY open, noon', '12:00', { streakCurrent: 4, lastClosed: YESTERDAY, lastOutcome: 'COMPLETED' }],
    ['streak 0, noon', '12:00', { streakCurrent: 0, lastClosed: YESTERDAY, lastOutcome: 'MISSED' }],
    ['broke 5 yesterday, 09:00', '09:00', { streakCurrent: 0, streakBeforeBreak: 5, breakDate: YESTERDAY, missedRun: 1, lastOutcome: 'MISSED', lastClosed: YESTERDAY }],
    ['broke 5 the day before, 09:00', '09:00', { streakCurrent: 0, streakBeforeBreak: 5, breakDate: '2027-03-08', missedRun: 2, lastOutcome: 'MISSED', lastClosed: YESTERDAY }],
    ['yesterday still open (03:10), streak 3', '03:10', { streakCurrent: 3, lastClosed: '2027-03-08', lastOutcome: 'COMPLETED' }],
    ['yesterday still open (03:10), streak 0', '03:10', { streakCurrent: 0, lastClosed: '2027-03-08' }],
  ];
  for (const [name, hhmm, fixture] of fixtures) {
    await clock(TODAY, hhmm);
    const user = await userWith(fixture);
    const answer = await tickets(user);
    const { lastClosed, ...state } = await stateOf(user);
    assert.equal(answer.serverTime, at(TODAY, hhmm), name);
    assert.deepEqual([answer.available, answer.cap], [1, 2], name);
    const expected = [
      { date: TODAY, target: 'TODAY', deadline: at('2027-03-11', '15:00') },
      ...(hhmm < '15:00' ? [{ date: YESTERDAY, target: 'YESTERDAY', deadline: at(TODAY, '15:00') }] : []),
    ];
    assert.deepEqual(
      answer.eligible.map((e: Eligible) => ({ date: e.date, target: e.target, deadline: e.deadline })),
      expected,
      name,
    );
    for (const e of answer.eligible as Eligible[]) {
      const open = e.date > (lastClosed ?? '');
      const preview = ticketPreview(state, open ? 'TODAY' : 'YESTERDAY');
      assert.deepEqual([e.withoutTicket, e.withTicket], [preview.withoutTicket, preview.withTicket], `${name} ${e.date}`);
      // the brief's rule, computed here independently: the preview's needed, and for an open day its STORY not done
      const rule = preview.needed && (open || state.breakDate === e.date);
      assert.equal(e.needed, rule, `${name} ${e.date}`);
      assert.equal(e.alreadyUsed, false);
      // the screen and the function: needed exactly when a use would go through
      assert.equal(await wouldUse(user, e.date), e.needed ? 'ok' : 'TICKET_NOT_NEEDED', `${name} ${e.date}`);
    }
  }

  await clock(TODAY, '12:00');
  const user = await userWith({ streakCurrent: 4, lastClosed: YESTERDAY, lastOutcome: 'COMPLETED' });
  assert.equal((await tickets(user)).eligible[0].needed, true);
  await completeStory(user);
  const later = await tickets(user);
  assert.deepEqual(
    later.eligible.map((e: Eligible) => [e.target, e.needed]),
    [
      ['TODAY', false],
      ['YESTERDAY', false],
    ],
  );
  assert.equal(code(await spend(user, TODAY)), 'TICKET_NOT_NEEDED');
});

test('a ticket applied to yesterday between 03:00 and the day-close run is honoured by the run: FROZEN, streak kept', async () => {
  await clock(TODAY, '03:05');
  const user = await userWith({ streakCurrent: 3, lastClosed: '2027-03-08', lastOutcome: 'COMPLETED' });
  const answer = ok(await spend(user, YESTERDAY));
  assert.deepEqual(
    answer.eligible.map((e: Eligible) => [e.target, e.alreadyUsed, e.needed]),
    [
      ['TODAY', false, true],
      ['YESTERDAY', true, true],
    ],
  );
  await runJob('day-close', db.app, new Date(at(TODAY, '03:20')), quiet);
  const state = await stateOf(user);
  assert.deepEqual([state.streakCurrent, state.lastOutcome, state.lastClosed], [3, 'FROZEN', YESTERDAY]);
  assert.equal(await outcomeOf(user, YESTERDAY), 'FROZEN');
});

/** How many backends of this database wait for a lock. */
const waiting = async () =>
  (
    await db.admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    )
  ).rows[0].n;
async function until(n: number) {
  for (let i = 0; i < 500 && (await waiting()) < n; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await waiting(), n, 'the transactions did not line up behind the lock');
}
/** The owner holds one row lock until the returned function is called. */
async function hold(sql: string, userId: string): Promise<() => Promise<void>> {
  const client: PoolClient = await db.admin.connect();
  await client.query('BEGIN');
  await client.query(sql, [userId]);
  return async () => {
    await client.query('COMMIT');
    client.release();
  };
}
const HOLD_USER = 'SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE';
const HOLD_STATE = 'SELECT 1 FROM progression_state WHERE user_id = $1 FOR UPDATE';

test('two uses with one ticket at the same moment: one goes through (same date: the other ALREADY_USED_FOR_DATE; another date: NO_TICKET)', async () => {
  await clock(TODAY, '09:00');
  for (const [dates, loser] of [
    [[TODAY, TODAY], 'TICKET_ALREADY_USED_FOR_DATE'],
    [[TODAY, YESTERDAY], 'NO_TICKET'],
  ] as const) {
    // streak 2 today and a break of 5 yesterday: both dates need a ticket
    const user = await userWith({ streakCurrent: 2, streakBeforeBreak: 5, breakDate: YESTERDAY, missedRun: 1, lastOutcome: 'MISSED', lastClosed: YESTERDAY });
    const release = await hold(HOLD_USER, user.userId);
    const both = Promise.all(dates.map(date => spend(user, date)));
    try {
      await until(2);
    } finally {
      await release();
    }
    assert.deepEqual((await both).map(code).sort(), ['ok', loser].sort());
    const rows = await ticketRows(user);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].used_for !== null);
  }
});

test('a use of yesterday against the day-close of yesterday, both lock orders and free rounds: the day ends FROZEN with the streak kept, the use answers 200', async () => {
  const round = async (setup: (user: User) => Promise<[Promise<CallResult>, Promise<unknown>]>, retried?: number) => {
    await clock(TODAY, '03:10');
    const user = await userWith({ streakCurrent: 3, lastClosed: '2027-03-08', lastOutcome: 'COMPLETED' });
    const [used, closed] = await setup(user);
    assert.equal(code(await used), 'ok');
    const counts = (await closed) as { retried: number };
    // the use first: the close finds the day changed under it and reads it again; the close first: no retry
    if (retried !== undefined) assert.equal(counts.retried, retried);
    // a run that found the user changed under it leaves the day for the next run
    await runJob('day-close', db.app, new Date(at(TODAY, '03:30')), quiet);
    const state = await stateOf(user);
    assert.deepEqual(
      [state.streakCurrent, state.lastOutcome, state.lastClosed, state.streakBeforeBreak, state.breakDate],
      [3, 'FROZEN', YESTERDAY, null, null],
    );
    assert.deepEqual(await ticketRows(user), [{ week: '2027-03-08', used_for: YESTERDAY }]);
  };
  const job = () => runJob('day-close', db.app, new Date(at(TODAY, '03:20')), quiet);
  // the use first in line, the close behind it
  await round(async user => {
    const release = await hold(HOLD_STATE, user.userId);
    const used = spend(user, YESTERDAY);
    let closed: Promise<unknown> = Promise.resolve();
    try {
      await until(1);
      closed = job();
      await until(2);
    } finally {
      await release();
    }
    return [used, closed];
  }, 1);
  // the close first in line, the use behind it (then a rescue of the day the close broke). The
  // owner holds progression_state in both orders: the first to start takes the users row and waits
  // there, the second waits for the users row (an HTTP request already holding a key-share lock on
  // the users row would not queue behind a waiter on that row itself)
  await round(async user => {
    const release = await hold(HOLD_STATE, user.userId);
    const closed = job();
    let used: Promise<CallResult> = Promise.resolve({ status: 0, body: undefined, headers: new Headers() });
    try {
      await until(1);
      used = spend(user, YESTERDAY);
      await until(2);
    } finally {
      await release();
    }
    return [used, closed];
  }, 0);
  for (let i = 0; i < 5; i++) {
    await round(async user => [spend(user, YESTERDAY), job()]);
  }
});
