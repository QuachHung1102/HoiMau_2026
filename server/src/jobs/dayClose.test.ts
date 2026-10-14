// The day-close job end to end: history arranged through HTTP with the test clock (or, where a
// test says so, through the owner), the job run through runJob with an explicit instant, the
// outcome read back through HTTP and as the owner. Expected dates come from logicalDateOf of the
// domain in the zones where the two zone databases agree, and from SQL where they do not.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { STREAK_MILESTONES } from '../../../domain/economy.ts';
import { addDays, logicalDateOf } from '../../../domain/logicalDate.ts';
import { decoyRows } from '../../checks/attacks/base.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { createLogger } from '../log.ts';
import { runJob } from './scheduler.ts';

let db: TestDb;
let app: TestApp;
let desk: { id: string; duration: number };
const lines: string[] = [];
const log = createLogger(line => lines.push(line));
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  const { rows } = await db.admin.query(
    "SELECT id, duration_sec AS duration FROM exercise_items WHERE code = 'DESK_STRETCH'",
  );
  desk = rows[0];
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const clock = (at: string) => setTestClock(db.admin, at);
const plus = (from: string, ms: number) => new Date(Date.parse(from) + ms).toISOString();
const close = (at: string) => runJob('day-close', db.app, new Date(at), log);
const get = (user: User, path: string) => app.call('GET', path, { token: user.token });
const post = (user: User, path: string, body: unknown) =>
  app.call('POST', path, { token: user.token, key: randomUUID(), body });

function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

// Asia/Ho_Chi_Minh, UTC+7: 03:00 on 11 March 2027 is 20:00 UTC on the 10th.
const ONBOARD = '2027-03-10T05:00:00.000Z'; // 12:00 on the 10th
/** 03:01 local at the end of the logical day `n` days after the 10th. */
const closeOf = (n: number) => plus('2027-03-10T20:01:00.000Z', n * DAY);

/** The progression row of the user and what the close may have written for it (milestone coins only), as the owner. */
async function stored(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT s.streak_current AS streak, s.streak_best AS best, s.streak_before_break AS "beforeBreak",
            to_char(s.break_date, 'YYYY-MM-DD') AS "breakDate", s.missed_run AS missed,
            s.last_outcome AS outcome, to_char(s.last_closed_date, 'YYYY-MM-DD') AS closed,
            (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = s.user_id AND reason = 'STREAK_MILESTONE') AS coins,
            (SELECT count(*)::int FROM coin_ledger WHERE user_id = s.user_id AND reason = 'STREAK_MILESTONE') AS "coinRows",
            (SELECT count(*)::int FROM inventory WHERE user_id = s.user_id) AS items,
            (SELECT coalesce(jsonb_agg(n.kind || ':' || n.dedupe_key ORDER BY n.created_at), '[]')
               FROM notifications n WHERE n.user_id = s.user_id) AS inbox
       FROM progression_state s WHERE s.user_id = $1`,
    [userId],
  );
  return rows[0];
}

/** Arranged through the owner: where the streak stands before the run under test. */
const setStreak = (userId: string, fields: Record<string, unknown>) =>
  db.admin.query(
    `UPDATE progression_state SET ${Object.keys(fields)
      .map((name, i) => `${name} = $${i + 2}`)
      .join(', ')} WHERE user_id = $1`,
    [userId, ...Object.values(fields)],
  );

/**
 * Both STORY quests of the logical day `n` days after the 10th, through HTTP: the meal at 23:50
 * local, the workout at 00:30 local of the next calendar day (still the same logical day).
 */
async function storyDone(user: User, n: number) {
  await clock(plus('2027-03-10T16:50:00.000Z', n * DAY));
  const target = ok(await get(user, '/day')).calorieWindow.target;
  ok(await post(user, '/nutrition/log', { kcal: target }));
  await clock(plus('2027-03-10T17:30:00.000Z', n * DAY));
  const result = ok(await post(user, '/workout/complete', { exerciseItemId: desk.id, elapsedSec: desk.duration }));
  assert.deepEqual(
    result.delta.events.map((event: { type: string }) => event.type).filter((type: string) => type === 'STORY_ALL_DONE'),
    ['STORY_ALL_DONE'],
  );
}

async function onboarded(overrides = {}) {
  await clock(ONBOARD);
  return newOnboardedUser(db, overrides);
}

test('launch criterion: both STORY quests done on three logical days, at 23:50 and 00:30; a close just after each 03:00 gives streak 1, 2, 3', async () => {
  const user = await onboarded();
  for (const n of [0, 1, 2]) {
    await storyDone(user, n);
    await close(closeOf(n));
    assert.equal((await stored(user.userId)).streak, n + 1, `after day ${n + 1}`);
  }
  await clock(plus(closeOf(2), HOUR));
  const progression = ok(await get(user, '/progression'));
  assert.deepEqual([progression.streakCurrent, progression.streakBest, progression.lastOutcome], [3, 3, 'COMPLETED']);
  assert.deepEqual(
    ok(await get(user, '/day/history?from=2027-03-10&to=2027-03-13')).days.map((day: { outcome: string }) => day.outcome),
    ['COMPLETED', 'COMPLETED', 'COMPLETED', 'OPEN'],
  );
});

test('idempotent: the same instant twice applies nothing the second time; two runs at once apply each user once', async () => {
  const users = [await onboarded(), await onboarded(), await onboarded()];
  await storyDone(users[0], 0);
  const at = closeOf(2); // closes the 10th, 11th, 12th
  const first = await close(at);
  const closedOnce = await Promise.all(users.map(user => stored(user.userId)));
  assert.ok((first.applied as number) >= 3);
  const second = await close(at);
  assert.deepEqual([second.users, second.applied], [0, 0]);
  assert.deepEqual(await Promise.all(users.map(user => stored(user.userId))), closedOnce);
  assert.deepEqual(
    closedOnce.map(state => [state.streak, state.missed, state.closed]),
    [
      [0, 2, '2027-03-12'],
      [0, 3, '2027-03-12'],
      [0, 3, '2027-03-12'],
    ],
  );

  // two runs at once, one day later: every candidate is applied by exactly one of them
  await Promise.all(Array.from({ length: 10 }, () => db.app.query('SELECT 1')));
  const later = closeOf(3);
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS n FROM job_day_close_candidates($1, 10000, NULL)',
    [later],
  );
  assert.ok(rows[0].n >= 3);
  const [a, b] = await Promise.all([close(later), close(later)]);
  assert.equal((a.applied as number) + (b.applied as number), rows[0].n);
  assert.equal((a.failed as number) + (b.failed as number), 0);
  assert.deepEqual(
    (await Promise.all(users.map(user => stored(user.userId)))).map(state => [state.missed, state.closed]),
    [
      [3, '2027-03-13'],
      [4, '2027-03-13'],
      [4, '2027-03-13'],
    ],
  );
});

test('the boundary in each zone: a run one minute before the user\'s 03:00 closes nothing, one minute after closes exactly yesterday', async () => {
  const cases: [zone: string, date: string][] = [
    ['Asia/Ho_Chi_Minh', '2027-03-11'],
    ['America/New_York', '2026-03-08'],
    ['America/New_York', '2026-11-01'],
    ['Europe/Berlin', '2026-03-29'],
    ['Europe/Berlin', '2026-10-25'],
    ['Australia/Lord_Howe', '2026-04-05'],
    ['Australia/Lord_Howe', '2026-10-04'],
    ['Pacific/Apia', '2026-06-01'],
    // the two zone databases differ here today (Node puts British Columbia on UTC-8 from
    // 1 November 2026, PostgreSQL keeps UTC-7): the expected date comes from SQL
    ['America/Vancouver', '2026-11-10'],
  ];
  for (const [zone, date] of cases) {
    // 03:00 on `date` on the zone's wall clock: the instant the logical date changes, as SQL finds it
    const { rows } = await db.admin.query(
      `SELECT app.logical_day_end((($1::date + time '03:00') AT TIME ZONE $2) - interval '2 hours', $2) AS at`,
      [date, zone],
    );
    const boundary: string = rows[0].at.toISOString();
    const early = plus(boundary, -60_000);
    const late = plus(boundary, 60_000);
    let yesterday: string;
    if (zone === 'America/Vancouver') {
      const sql = await db.admin.query(
        "SELECT to_char(app.logical_date($1, $2), 'YYYY-MM-DD') AS before, to_char(app.logical_date($3, $2) - 1, 'YYYY-MM-DD') AS yesterday",
        [early, zone, late],
      );
      assert.equal(sql.rows[0].before, sql.rows[0].yesterday, zone);
      // the reason this zone is here: Node's date differs from SQL's at that instant
      assert.notEqual(logicalDateOf(Date.parse(late), zone), addDays(sql.rows[0].yesterday, 1), zone);
      yesterday = sql.rows[0].yesterday;
    } else {
      yesterday = logicalDateOf(Date.parse(early), zone);
      assert.equal(addDays(logicalDateOf(Date.parse(late), zone), -1), yesterday, `${zone} ${date}`);
    }
    // onboarded three hours before the boundary: the first day is the one that ends there
    await clock(plus(boundary, -3 * HOUR));
    const user = await newOnboardedUser(db, { timezone: zone });
    await close(early);
    assert.equal((await stored(user.userId)).closed, null, `${zone} ${date}: closed before 03:00`);
    await close(late);
    assert.equal((await stored(user.userId)).closed, yesterday, `${zone} ${date}`);
  }
});

test('idle for five days: one run processes five dates; streak 0, missed_run 5, one PET_TIRED, streak_best kept', async () => {
  const user = await onboarded();
  await setStreak(user.userId, { streak_current: 2, streak_best: 4, last_outcome: 'COMPLETED' });
  const result = await close(closeOf(4));
  assert.ok((result.dates as number) >= 5);
  assert.deepEqual(await stored(user.userId), {
    streak: 0,
    best: 4,
    beforeBreak: null,
    breakDate: null,
    missed: 5,
    outcome: 'MISSED',
    closed: '2027-03-14',
    coins: 0,
    coinRows: 0,
    items: 0,
    inbox: ['PET_TIRED:2027-03-12'],
  });
  // a broken streak wrote no notification, and the pet's notification is in the inbox
  await clock(plus(closeOf(4), HOUR));
  const inbox = ok(await get(user, '/inbox'));
  assert.deepEqual(
    [inbox.unreadCount, inbox.items.map((item: { kind: string; payload: unknown }) => [item.kind, item.payload])],
    [1, [['PET_TIRED', {}]]],
  );
});

test('a missed day after a streak of 5 keeps 5 for a rescue and names the date; the next missed day clears both', async () => {
  const user = await onboarded();
  await setStreak(user.userId, { streak_current: 5, streak_best: 5, last_outcome: 'COMPLETED' });
  await close(closeOf(0));
  assert.deepEqual(
    Object.values(await stored(user.userId)).slice(0, 6),
    [0, 5, 5, '2027-03-10', 1, 'MISSED'],
  );
  await close(closeOf(1));
  assert.deepEqual(
    Object.values(await stored(user.userId)).slice(0, 6),
    [0, 5, null, null, 2, 'MISSED'],
  );
});

test('a ticket on the date: the streak stays and history shows FROZEN; a ticket and both quests done: COMPLETED, streak + 1 (AR-10)', async () => {
  const frozen = await onboarded();
  const both = await onboarded();
  for (const user of [frozen, both]) {
    await setStreak(user.userId, { streak_current: 4, streak_best: 4, last_outcome: 'COMPLETED' });
    // Task 44 writes tickets; the owner stands in
    await db.admin.query(
      `INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date)
       VALUES ($1, '2027-03-08', '2027-03-10T06:00:00Z', '2027-03-10')`,
      [user.userId],
    );
  }
  await storyDone(both, 0);
  await close(closeOf(0));
  assert.deepEqual([(await stored(frozen.userId)).streak, (await stored(frozen.userId)).outcome], [4, 'FROZEN']);
  assert.deepEqual([(await stored(both.userId)).streak, (await stored(both.userId)).outcome], [5, 'COMPLETED']);
  await clock(plus(closeOf(0), HOUR));
  for (const [user, outcome] of [[frozen, 'FROZEN'], [both, 'COMPLETED']] as const) {
    assert.deepEqual(
      ok(await get(user, '/day/history?from=2027-03-10&to=2027-03-11')).days.map((day: { outcome: string }) => day.outcome),
      [outcome, 'OPEN'],
    );
  }
});

test('reaching 7: +50 coins once, BADGE_STREAK_7 owned, one notification listed in celebrations until read; breaking and reaching 7 again brings nothing new', async () => {
  const seven = STREAK_MILESTONES.find(milestone => milestone.days === 7)!;
  const user = await onboarded();
  await setStreak(user.userId, { streak_current: 6, streak_best: 6, last_outcome: 'COMPLETED' });
  await storyDone(user, 0);
  lines.length = 0;
  await close(closeOf(0));
  const reached = await stored(user.userId);
  assert.deepEqual(
    [reached.streak, reached.coins, reached.coinRows, reached.items, reached.inbox],
    [7, seven.coins, 1, 1, ['STREAK_MILESTONE:7']],
  );
  // the ledger row went to log.ledger
  assert.deepEqual(
    lines
      .map(line => JSON.parse(line))
      .filter(line => line.evt === 'ledger')
      .map(({ ts: _ts, ...line }) => line),
    [{ evt: 'ledger', kind: 'coin', userId: user.userId, amount: seven.coins, reason: 'STREAK_MILESTONE', refId: '7' }],
  );
  await clock(plus(closeOf(0), HOUR));
  const progression = ok(await get(user, '/progression'));
  assert.deepEqual(progression.milestones[0], { days: 7, achieved: true });
  const day = ok(await get(user, '/day'));
  assert.equal(day.unreadCount, 1);
  assert.deepEqual(
    day.celebrations.map((item: { kind: string; payload: unknown; readAt: unknown }) => [item.kind, item.payload, item.readAt]),
    [['STREAK_MILESTONE', { days: 7, coins: seven.coins, badgeCode: seven.badgeCode }, null]],
  );
  // still there on the next read, gone once read
  assert.equal(ok(await get(user, '/day')).celebrations.length, 1);
  ok(await post(user, '/inbox/read', { ids: [day.celebrations[0].id] }));
  const read = ok(await get(user, '/day'));
  assert.deepEqual([read.unreadCount, read.celebrations], [0, []]);

  // broken, then 7 again
  await close(closeOf(1));
  assert.equal((await stored(user.userId)).streak, 0);
  await setStreak(user.userId, { streak_current: 6, last_outcome: 'COMPLETED' });
  await storyDone(user, 2);
  await close(closeOf(2));
  const again = await stored(user.userId);
  assert.deepEqual(
    [again.streak, again.coins, again.coinRows, again.items, again.inbox],
    [7, seven.coins, 1, 1, ['STREAK_MILESTONE:7']],
  );
  await clock(plus(closeOf(2), HOUR));
  assert.deepEqual(ok(await get(user, '/day')).celebrations, []);
});

test('a change of time zone between two runs reopens no date and skips none', async () => {
  const user = await onboarded();
  const patchZone = (timezone: string) =>
    app.call('PATCH', '/me', { token: user.token, key: randomUUID(), body: { timezone } });
  await close(closeOf(0)); // closes the 10th in Ho Chi Minh
  // New York: at that instant it is 15:01 on the 10th there, a closed day
  await clock(closeOf(0));
  ok(await patchZone('America/New_York'));
  await close(closeOf(0));
  assert.deepEqual([(await stored(user.userId)).closed, (await stored(user.userId)).missed], ['2027-03-10', 1]);
  const tick = await post(user, '/day/quests/WATER_8/progress', {});
  assert.deepEqual([tick.status, tick.body.error.code], [409, 'DAY_CLOSED']);
  // 03:01 on the 11th in New York: yesterday is the 10th, closed already
  await close('2027-03-11T08:01:00.000Z');
  assert.deepEqual([(await stored(user.userId)).closed, (await stored(user.userId)).missed], ['2027-03-10', 1]);
  // 03:01 on the 12th: the 11th, once
  await close('2027-03-12T08:01:00.000Z');
  assert.deepEqual([(await stored(user.userId)).closed, (await stored(user.userId)).missed], ['2027-03-11', 2]);
  // to Kiritimati (UTC+14), then 03:01 on the 14th there: the 12th and 13th, none skipped
  await clock('2027-03-12T08:01:00.000Z');
  ok(await patchZone('Pacific/Kiritimati'));
  await close('2027-03-13T13:01:00.000Z');
  assert.deepEqual([(await stored(user.userId)).closed, (await stored(user.userId)).missed], ['2027-03-13', 4]);
});

test('a closed day takes no write: a tick with an occurredAt inside it is 409 DAY_CLOSED', async () => {
  const user = await onboarded();
  const inside = '2027-03-10T16:00:00.000Z'; // 23:00 on the 10th
  await clock(plus(closeOf(0), 60_000));
  const tick = () => post(user, '/day/quests/WATER_8/progress', { occurredAt: inside });
  // the day is over on the clock, and open until the job closes it
  ok(await tick());
  await close(closeOf(0));
  const refused = await tick();
  assert.deepEqual([refused.status, refused.body.error.code], [409, 'DAY_CLOSED']);
});

test('a user whose apply fails does not stop the others; the run is recorded with the failure count', async () => {
  const broken = await onboarded();
  const fine = await onboarded();
  // a constraint that the close of this one user violates (the owner arranges the failure)
  await db.admin.query(
    `ALTER TABLE progression_state ADD CONSTRAINT t22_fail
       CHECK (user_id <> '${broken.userId}'::uuid OR last_closed_date IS NULL) NOT VALID`,
  );
  try {
    lines.length = 0;
    const at = closeOf(0);
    const result = await close(at);
    assert.equal(result.failed, 1);
    assert.equal((await stored(broken.userId)).closed, null);
    assert.equal((await stored(fine.userId)).closed, '2027-03-10');
    const { rows } = await db.admin.query("SELECT ok, detail FROM job_runs WHERE job = 'day-close' AND run_key = $1", [
      at,
    ]);
    assert.deepEqual(rows, [{ ok: true, detail: result }]);
    const failures = lines.map(line => JSON.parse(line)).filter(line => line.evt === 'job_user_failed');
    assert.deepEqual(
      failures.map(({ level, job, userId, code, constraint }) => ({ level, job, userId, code, constraint })),
      [{ level: 'error', job: 'day-close', userId: broken.userId, code: '23514', constraint: 't22_fail' }],
    );
    assert.ok(!lines.join('\n').includes('violates'), 'no error message in the log');
  } finally {
    await db.admin.query('ALTER TABLE progression_state DROP CONSTRAINT t22_fail');
  }
  await close(closeOf(0));
  assert.equal((await stored(broken.userId)).closed, '2027-03-10');
});

test('the job lines carry counts, never an email or a message', async () => {
  const user = await onboarded();
  lines.length = 0;
  await close(closeOf(1));
  const job = lines.map(line => JSON.parse(line)).find(line => line.evt === 'job');
  assert.deepEqual(Object.keys(job).sort(), ['detail', 'evt', 'job', 'level', 'ms', 'ok', 'ts']);
  assert.deepEqual(Object.keys(job.detail).sort(), ['applied', 'dates', 'failed', 'skipped', 'users']);
  assert.ok(!lines.join('\n').includes(user.email));
});

// last: it closes every user of this database far into the future
test('a run leaves every row of the decoy as it was (the decoy is never a candidate)', async () => {
  const rowsBefore = await decoyRows(db.admin);
  const result = await close('2031-01-01T00:00:00.000Z');
  assert.ok((result.applied as number) > 0, 'the run closed somebody');
  assert.deepEqual(await decoyRows(db.admin), rowsBefore);
});
