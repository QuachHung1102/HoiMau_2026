// GET /leaderboard over HTTP, the leaderboard-refresh and weekly-rollover jobs run for a fixed
// clock (runJob), and the races of job_apply_guild_week against the guild functions as
// transactions of two pools of app_conn (the real role switch). Expected numbers are the domain
// functions' (scoreGuildWeek, rankGuilds) on the same inputs; logs, tickets and join dates are
// arranged through the owner connection.
//
// Every guild of the database is on every board: each test uses a week of its own, far enough
// from the others that no rollover window (28 days) of one test reaches the week of another, so
// the guilds of the other tests are unranked (no log) in it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { rankGuilds, scoreGuildWeek } from '../../../domain/guild.ts';
import type { MemberWeek } from '../../../domain/guild.ts';
import { addDays, weekStartOf } from '../../../domain/logicalDate.ts';
import { asJob, asUser, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, serverPool, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { runJob } from '../jobs/scheduler.ts';
import weeklyRollover, { settleWeek } from '../jobs/weeklyRollover.ts';
import { setBoard, weekInputs } from '../leaderboardCache.ts';
import { createLogger } from '../log.ts';

let db: TestDb;
let app: TestApp;
let second: Pool;
let story: { id: string; target_count: number }[];
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  second = serverPool(db);
  story = (
    await db.admin.query(
      "SELECT id, target_count FROM quests WHERE category = 'STORY' AND is_active AND 'SUPPORTER' = ANY (archetypes) ORDER BY code",
    )
  ).rows;
});
after(async () => {
  await setTestClock(db.admin, null);
  await second.end();
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;
type Day = { date: string; done: number; frozen?: boolean };
type Plan = { joined?: string; logs?: Day[] };

function ok(result: CallResult, status = 200): any {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
const post = (user: User, path: string, body?: unknown) =>
  app.call('POST', path, { token: user.token, key: randomUUID(), body });
const board = (user: { token: string }, week: string | null) =>
  app.call('GET', week === null ? '/leaderboard' : `/leaderboard?week=${week}`, { token: user.token });
const clock = (iso: string) => setTestClock(db.admin, iso);
const lines: string[] = [];
const log = createLogger(line => lines.push(line));
const rollover = (now: string, pool: Pool = db.app) => runJob('weekly-rollover', pool, new Date(now), log);

/** Days 0..n-1 of the week, each with `done` STORY quests. */
const days = (weekStart: string, n: number, done: number, from = 0): Day[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(weekStart, from + i), done }));

let ticketWeek = 0;
/** One log of `user` with `done` STORY quests completed, and a used ticket when frozen. */
async function logDay(user: User, { date, done, frozen }: Day): Promise<void> {
  const id = (
    await db.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2) RETURNING id', [user.userId, date])
  ).rows[0].id;
  for (const quest of story.slice(0, done)) {
    await db.admin.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
       VALUES ($1, $2, $3, $4, app.now())`,
      [user.userId, id, quest.id, quest.target_count],
    );
  }
  if (frozen) {
    // one ticket per grant week: weeks of 2020, never a week of the tests
    ticketWeek++;
    await db.admin.query(
      'INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date) VALUES ($1, $2, app.now(), $3)',
      [user.userId, addDays('2020-01-06', 7 * ticketWeek), date],
    );
  }
}

type Arranged = { id: string; name: string; createdAt: string; users: User[]; weeks: MemberWeek[] };

/**
 * A guild of one member per plan (the first leads), made over HTTP; each member joined at 12:00
 * Asia/Ho_Chi_Minh of `joined` (default: a week before `weekStart`) and has the logs of its plan.
 */
async function arrange(weekStart: string, plans: Plan[], overrides: Parameters<typeof newOnboardedUser>[1][] = []): Promise<Arranged> {
  const users: User[] = [];
  for (let i = 0; i < plans.length; i++) {
    users.push(await newOnboardedUser(db, overrides[i] ?? {}));
  }
  const made = ok(await post(users[0], '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` })).guild;
  for (const user of users.slice(1)) {
    ok(await post(user, '/guilds/join', { inviteCode: made.inviteCode }));
  }
  const weeks: MemberWeek[] = [];
  for (const [i, plan] of plans.entries()) {
    const joined = plan.joined ?? addDays(weekStart, -7);
    await db.admin.query('UPDATE guild_memberships SET joined_at = $2 WHERE user_id = $1', [users[i].userId, `${joined}T05:00:00Z`]);
    for (const day of plan.logs ?? []) {
      await logDay(users[i], day);
    }
    weeks.push({
      userId: users[i].userId,
      joinedDate: joined,
      days: (plan.logs ?? []).map(({ date, done, frozen }) => ({
        date,
        storyDone: done,
        storyTotal: story.length,
        frozen: frozen === true && done < story.length,
      })),
    });
  }
  const { rows } = await db.admin.query<{ created_at: Date }>('SELECT created_at FROM guilds WHERE id = $1', [made.id]);
  return { id: made.id, name: made.name, createdAt: rows[0].created_at.toISOString(), users, weeks };
}

/** What the domain makes of the arranged guilds: rankGuilds over scoreGuildWeek, by guild id. */
function expected(guilds: Arranged[], weekStart: string, through: string) {
  return new Map(
    rankGuilds(
      guilds.map(g => ({ id: g.id, name: g.name, createdAt: g.createdAt, ...scoreGuildWeek(g.weeks, weekStart, through) })),
    ).map(row => [row.id, row]),
  );
}

/** The stored rows of a week, of these guilds, as [avgCompletion, activeMembers, rank]. */
async function storedScores(weekStart: string, ids: string[]) {
  const { rows } = await db.admin.query(
    `SELECT guild_id, avg_completion::float8 AS avg, active_members, rank FROM guild_weekly_scores
      WHERE week_start = $1 AND guild_id = ANY ($2)`,
    [weekStart, ids],
  );
  return new Map(rows.map(r => [r.guild_id, [r.avg, r.active_members, r.rank]]));
}

const coinsOf = async (weekStart: string) =>
  new Map(
    (
      await db.admin.query("SELECT user_id, amount FROM coin_ledger WHERE reason = 'GUILD_WEEKLY' AND ref_id = $1", [weekStart])
    ).rows.map(r => [r.user_id, r.amount]),
  );

/** Counts of what a rollover writes, for "nothing twice". */
const counts = async () =>
  (
    await db.admin.query(
      `SELECT (SELECT count(*) FROM coin_ledger WHERE reason = 'GUILD_WEEKLY')::int AS ledger,
              (SELECT count(*) FROM xp_ledger WHERE reason = 'GUILD_WEEKLY')::int AS xp,
              (SELECT count(*) FROM inventory i JOIN shop_items s ON s.id = i.shop_item_id WHERE s.code = 'BADGE_GUILD_TOP1')::int AS badges,
              (SELECT count(*) FROM notifications WHERE kind = 'GUILD_WEEKLY_RESULT')::int AS notes,
              (SELECT count(*) FROM guild_weekly_scores)::int AS scores,
              (SELECT count(*) FROM job_runs WHERE job = 'guild-week')::int AS weeks`,
    )
  ).rows[0];

// ---------------------------------------------------------------------------------------------
// Privacy (R-P.1)

const ENTRY_KEYS = ['activeMembers', 'avgCompletion', 'guildName', 'isMine', 'rank'];
const MINE_KEYS = ['activeMembers', 'avgCompletion', 'rank', 'ranked'];
/** Exactly the keys of the contract, no id of a user or a guild, none of the sentinel values. */
function privacyScan(body: any, ids: string[]) {
  assert.deepEqual(Object.keys(body).sort(), ['entries', 'final', 'mine', 'updatedAt', 'weekStart']);
  for (const entry of body.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS);
  }
  if (body.mine !== null) {
    assert.deepEqual(Object.keys(body.mine).sort(), MINE_KEYS);
  }
  const text = JSON.stringify(body);
  for (const id of ids) {
    assert.ok(!text.includes(id), `${id} in ${text}`);
  }
  for (const sentinel of ['77.7', '177.7', '2777', '1979']) {
    assert.ok(!text.includes(sentinel), `${sentinel} in ${text}`);
  }
}
const SENTINEL = { heightCm: 177.7, weightKg: 77.7, birthYear: 1979 };

// ---------------------------------------------------------------------------------------------

test('previous before any rollover: empty entries, mine null, final true; an invalid week is 422; refusal order 401 → 409 → 422', async () => {
  await clock('2027-01-13T05:00:00.000Z'); // Wednesday 12:00 in Asia/Ho_Chi_Minh
  const user = await newOnboardedUser(db);
  assert.deepEqual(ok(await board(user, 'previous')), {
    weekStart: '2027-01-04',
    final: true,
    updatedAt: '2027-01-13T05:00:00.000Z',
    entries: [],
    mine: null,
  });
  for (const [week, rule] of [
    [null, 'required'],
    ['x', 'format'],
    ['CURRENT', 'format'],
    ['', 'format'],
  ] as const) {
    const result = await board(user, week);
    assert.deepEqual([result.status, result.body.error.code, result.body.error.details], [
      422,
      'VALIDATION_FAILED',
      { fields: [{ field: 'week', rule }] },
    ]);
  }
  // a bad week without a session is 401, from a user who is not onboarded 409
  const none = await app.call('GET', '/leaderboard?week=x');
  assert.deepEqual([none.status, none.body.error.code], [401, 'SESSION_INVALID']);
  const fresh = await board(await newUser(db), 'x');
  assert.deepEqual([fresh.status, fresh.body.error.code], [409, 'ONBOARDING_REQUIRED']);
});

test('live board: ranks, avgCompletion and activeMembers are the domain functions\' output; 3 members outrank 8 with a lower average; 2 active members are unranked; privacy', async () => {
  await clock('2027-01-13T05:00:00.000Z');
  const ws = '2027-01-11';
  const today = '2027-01-13';
  setBoard(null);
  const full = days(ws, 3, story.length);
  const g3 = await arrange(ws, [{ logs: full }, { logs: full }, { logs: full }], [SENTINEL]);
  const g8 = await arrange(ws, Array.from({ length: 8 }, () => ({ logs: days(ws, 3, 1) })));
  const g4 = await arrange(ws, [{ logs: days(ws, 2, story.length) }, { logs: days(ws, 2, story.length) }, { logs: days(ws, 1, 1) }, {}]);
  const g2 = await arrange(ws, [{ logs: full }, { logs: full }, {}]);
  const want = expected([g3, g8, g4, g2], ws, today);
  assert.equal(want.get(g3.id)!.rank! < want.get(g8.id)!.rank!, true, 'the fixture: 3 members ahead of 8');
  assert.equal(want.get(g2.id)!.rank, null);

  const seen = ok(await board(g2.users[0], 'current'));
  const entries = [g3, g8, g4]
    .map(g => want.get(g.id)!)
    .sort((a, b) => a.rank! - b.rank!)
    .map(row => ({ rank: row.rank, guildName: row.name, avgCompletion: row.avgCompletion, activeMembers: row.activeMembers, isMine: false }));
  assert.deepEqual(seen, {
    weekStart: ws,
    final: false,
    updatedAt: '2027-01-13T05:00:00.000Z',
    entries,
    mine: { ranked: false, rank: null, avgCompletion: want.get(g2.id)!.avgCompletion, activeMembers: 2 },
  });
  const top = ok(await board(g3.users[1], 'current'));
  assert.deepEqual(top.entries.map((e: any) => e.isMine), entries.map(e => e.guildName === g3.name));
  assert.deepEqual(top.mine, { ranked: true, rank: want.get(g3.id)!.rank, avgCompletion: 1, activeMembers: 3 });
  // outside any guild: mine null
  assert.equal(ok(await board(await newOnboardedUser(db), 'current')).mine, null);
  const ids = [g3, g8, g4, g2].flatMap(g => [g.id, ...g.users.map(u => u.userId)]);
  privacyScan(seen, ids);
  privacyScan(top, ids);
});

test('cache: two current requests within 5 minutes read job_guild_week_inputs once; a refresh moves updatedAt; older than 10 minutes is read again; parallel requests read once', async () => {
  const user = await newOnboardedUser(db);
  const spy = mock.method(weekInputs, 'read');
  try {
    setBoard(null);
    await clock('2027-01-13T05:00:00.000Z');
    const first = ok(await board(user, 'current'));
    await clock('2027-01-13T05:04:59.000Z');
    const again = ok(await board(user, 'current'));
    assert.equal(spy.mock.callCount(), 1);
    assert.deepEqual(again, first);
    await clock('2027-01-13T05:05:00.000Z');
    await runJob('leaderboard-refresh', db.app, new Date('2027-01-13T05:05:00.000Z'), log);
    assert.equal(spy.mock.callCount(), 2);
    assert.equal(ok(await board(user, 'current')).updatedAt, '2027-01-13T05:05:00.000Z');
    await clock('2027-01-13T05:15:00.000Z'); // 10 minutes after the refresh: still served
    assert.equal(ok(await board(user, 'current')).updatedAt, '2027-01-13T05:05:00.000Z');
    assert.equal(spy.mock.callCount(), 2);
    await clock('2027-01-13T05:15:01.000Z');
    assert.equal(ok(await board(user, 'current')).updatedAt, '2027-01-13T05:15:01.000Z');
    assert.equal(spy.mock.callCount(), 3);
    setBoard(null);
    const both = await Promise.all([board(user, 'current'), board(user, 'current')]);
    assert.deepEqual(both.map(r => r.status), [200, 200]);
    assert.equal(spy.mock.callCount(), 4);
  } finally {
    spy.mock.restore();
    setBoard(null);
  }
});

test('mine is filled for a guild outside the top 50: 51 ranked guilds, the caller\'s is 51st', async () => {
  await clock('2027-01-13T05:00:00.000Z');
  const ws = '2027-01-11';
  const own = await arrange(ws, [{}, {}, {}]);
  const member = (n: number) => ({
    userId: randomUUID(),
    joinedDate: addDays(ws, -7),
    days: [{ date: ws, storyDone: n, storyTotal: 100, frozen: false }],
  });
  const fake = Array.from({ length: 51 }, (_, i) => ({
    guild_id: i === 50 ? own.id : randomUUID(),
    name: i === 50 ? own.name : `Giả ${i}`,
    created_at: new Date('2026-12-01T00:00:00Z'),
    members: [member(100 - i), member(100 - i), member(100 - i)],
  }));
  const ownMembers = fake[50].members;
  // a copy: the reader sorts what it is given
  const spy = mock.method(weekInputs, 'read', async () => [...fake]);
  try {
    setBoard(null);
    const seen = ok(await board(own.users[2], 'current'));
    assert.equal(seen.entries.length, 50);
    assert.ok(seen.entries.every((e: any) => e.isMine === false));
    assert.deepEqual(seen.entries.map((e: any) => e.rank), Array.from({ length: 50 }, (_, i) => i + 1));
    assert.deepEqual(seen.mine, { ranked: true, rank: 51, avgCompletion: scoreGuildWeek(ownMembers, ws, '2027-01-13').avgCompletion, activeMembers: 3 });
  } finally {
    spy.mock.restore();
    setBoard(null);
  }
});

test('rollover: ranks and numbers equal the domain; rewards 150 + BADGE_GUILD_TOP1, 100, 60, 20; an inactive member and an unranked guild get nothing; previous serves it; a second run pays nothing twice', async () => {
  const ws = '2027-03-01';
  const at = '2027-03-07T20:30:00.000Z'; // Monday 2027-03-08 03:30 in Asia/Ho_Chi_Minh
  await clock('2027-03-03T05:00:00.000Z');
  const all = days(ws, 7, story.length);
  const g3 = await arrange(ws, [{ logs: all }, { logs: all }, { logs: all }], [SENTINEL]);
  const g8 = await arrange(ws, Array.from({ length: 8 }, () => ({ logs: days(ws, 7, 1) })));
  const gx = await arrange(ws, [{ logs: days(ws, 5, story.length) }, { logs: days(ws, 5, story.length) }, { logs: days(ws, 5, story.length) }, {}]);
  const gy = await arrange(ws, [{ logs: days(ws, 3, 1) }, { logs: days(ws, 3, 1) }, { logs: days(ws, 3, 1) }]);
  const g2 = await arrange(ws, [{ logs: all }, { logs: all }, {}]);
  const guilds = [g3, g8, gx, gy, g2];
  const want = expected(guilds, ws, addDays(ws, 6));
  assert.deepEqual([g3, gx, g8, gy, g2].map(g => want.get(g.id)!.rank), [1, 2, 3, 4, null], 'the fixture');

  await clock(at);
  lines.length = 0;
  const result = await rollover(at);
  assert.ok((result.applied as string[]).includes(ws));
  assert.deepEqual(
    await storedScores(ws, guilds.map(g => g.id)),
    new Map(guilds.map(g => [g.id, [want.get(g.id)!.avgCompletion, want.get(g.id)!.activeMembers, want.get(g.id)!.rank]])),
  );

  const coins = await coinsOf(ws);
  const paid = new Map<string, number>();
  for (const [g, amount] of [[g3, 150], [gx, 100], [g8, 60], [gy, 20]] as const) {
    for (const user of g === gx ? g.users.slice(0, 3) : g.users) {
      paid.set(user.userId, amount);
    }
  }
  assert.deepEqual(coins, paid);
  assert.equal(coins.has(gx.users[3].userId), false, 'the inactive member of a ranked guild');
  assert.ok(g2.users.every(u => !coins.has(u.userId)), 'the unranked guild');
  const badges = (
    await db.admin.query(
      "SELECT i.user_id FROM inventory i JOIN shop_items s ON s.id = i.shop_item_id WHERE s.code = 'BADGE_GUILD_TOP1' ORDER BY i.user_id",
    )
  ).rows.map(r => r.user_id);
  assert.deepEqual(badges, g3.users.map(u => u.userId).sort());
  const notes = (
    await db.admin.query("SELECT user_id, payload, dedupe_key FROM notifications WHERE kind = 'GUILD_WEEKLY_RESULT' AND dedupe_key = $1", [ws])
  ).rows;
  assert.deepEqual(
    new Map(notes.map(n => [n.user_id, n.payload])),
    new Map([...paid].map(([id, amount]) => [id, { rank: { 150: 1, 100: 2, 60: 3, 20: 4 }[amount], coins: amount, weekStart: ws }])),
  );
  // one log.ledger line per ledger row
  const ledger = lines.map(line => JSON.parse(line)).filter(line => line.evt === 'ledger');
  assert.deepEqual(
    new Map(ledger.map(l => [l.userId, [l.kind, l.amount, l.reason, l.refId]])),
    new Map([...paid].map(([id, amount]) => [id, ['coin', amount, 'GUILD_WEEKLY', ws]])),
  );

  // the previous week as a member of the unranked guild, then of the first
  await clock('2027-03-10T05:00:00.000Z');
  const ranAt = (await db.admin.query("SELECT ran_at FROM job_runs WHERE job = 'guild-week' AND detail ->> 'weekStart' = $1", [ws])).rows[0].ran_at;
  const entries = [g3, gx, g8, gy].map(g => ({
    rank: want.get(g.id)!.rank,
    guildName: g.name,
    avgCompletion: want.get(g.id)!.avgCompletion,
    activeMembers: want.get(g.id)!.activeMembers,
    isMine: false,
  }));
  const seen = ok(await board(g2.users[1], 'previous'));
  assert.deepEqual(seen, {
    weekStart: ws,
    final: true,
    updatedAt: ranAt.toISOString(),
    entries,
    mine: { ranked: false, rank: null, avgCompletion: want.get(g2.id)!.avgCompletion, activeMembers: 2 },
  });
  const top = ok(await board(g3.users[0], 'previous'));
  assert.deepEqual(top.entries.map((e: any) => e.isMine), [true, false, false, false]);
  assert.deepEqual(top.mine, { ranked: true, rank: 1, avgCompletion: 1, activeMembers: 3 });
  const ids = guilds.flatMap(g => [g.id, ...g.users.map(u => u.userId)]);
  privacyScan(seen, ids);
  privacyScan(top, ids);

  // a second run: nothing twice
  const before = await counts();
  assert.deepEqual((await rollover(at)).applied, []);
  assert.deepEqual(await counts(), before);
});

test('two rollovers at once on two pools: one applies, the other finds the week taken; the rewards are paid once', async () => {
  const ws = '2027-10-04';
  const at = '2027-10-10T20:30:00.000Z';
  await clock('2027-10-06T05:00:00.000Z');
  const g = await arrange(ws, [{ logs: days(ws, 2, story.length) }, { logs: days(ws, 2, 1) }, { logs: days(ws, 1, 1) }]);
  await clock(at);
  const before = await counts();
  const [a, b] = await Promise.all([rollover(at, db.app), rollover(at, second)]);
  assert.deepEqual(
    [a.applied, b.applied].map(applied => (applied as string[]).includes(ws)).sort(),
    [false, true],
  );
  const coins = await coinsOf(ws);
  assert.deepEqual([...coins.values()], [150, 150, 150]);
  const after = await counts();
  assert.equal(after.ledger - before.ledger, 3);
  assert.equal(after.notes - before.notes, 3);
  assert.equal(after.badges - before.badges, 3);
  assert.equal((await db.admin.query("SELECT count(*)::int AS n FROM job_runs WHERE job = 'guild-week' AND detail ->> 'weekStart' = $1", [ws])).rows[0].n, 1);
  assert.equal(g.users.length, 3);
});

test('a member who joined mid-week is averaged from the join date, one who left before the rollover is excluded, a frozen day and a day without a log count 0; guild_overview and job_guild_week_inputs read the same days', async () => {
  const ws = '2027-04-12';
  const at = '2027-04-18T20:30:00.000Z';
  await clock('2027-04-18T05:00:00.000Z'); // Sunday 12:00 of that week in Asia/Ho_Chi_Minh
  const total = story.length;
  const g = await arrange(ws, [
    { logs: days(ws, 7, total) }, // a: every day
    { joined: addDays(ws, 3), logs: days(ws, 6, total, 1) }, // b: joined Thursday; Tuesday and Wednesday are before
    // c: two full days, a frozen day with one quest done, a half day, three days without a log
    { logs: [...days(ws, 2, total), { date: addDays(ws, 2), done: 1, frozen: true }, { date: addDays(ws, 4), done: 1 }] },
    { logs: days(ws, 7, total) }, // d: leaves before the rollover
  ]);
  const [a, b, c, d] = g.users;

  // the two readers of a member's days agree, day for day, on this fixture (one rule, app._member_days)
  const overview = await asUser(db.app, a.userId, async x => (await x.query('SELECT guild_overview() AS o')).rows[0].o.guild);
  const inputs = await asJob(db.app, async x =>
    (await x.query('SELECT * FROM job_guild_week_inputs($1, $2) WHERE guild_id = $3', [ws, addDays(ws, 6), g.id])).rows,
  );
  assert.equal(inputs.length, 1);
  assert.deepEqual(Object.keys(inputs[0]).sort(), ['created_at', 'guild_id', 'members', 'name']);
  assert.deepEqual(
    inputs[0].members.map((m: any) => [m.userId, m.days]),
    [...overview.members].sort((x: any, y: any) => (x.userId < y.userId ? -1 : 1)).map((m: any) => [m.userId, m.days]),
  );
  for (const m of inputs[0].members) {
    assert.deepEqual(Object.keys(m).sort(), ['days', 'joinedDate', 'userId']);
    for (const day of m.days) {
      assert.deepEqual(Object.keys(day).sort(), ['date', 'frozen', 'storyDone', 'storyTotal']);
    }
  }
  const cDays = inputs[0].members.find((m: any) => m.userId === c.userId).days;
  assert.deepEqual(cDays.find((day: any) => day.date === addDays(ws, 2)), { date: addDays(ws, 2), storyDone: 1, storyTotal: total, frozen: true });

  await clock(at);
  ok(await post(d, '/guilds/me/leave'), 204);
  await rollover(at);
  const stayed = g.weeks.slice(0, 3);
  const want = scoreGuildWeek(stayed, ws, addDays(ws, 6));
  const [avg, active] = (await storedScores(ws, [g.id])).get(g.id)!;
  assert.deepEqual([avg, active], [want.avgCompletion, 3]);
  // each rule changes the number: d counted, b from Monday, c's frozen day counted as a half
  assert.notEqual(avg, scoreGuildWeek(g.weeks, ws, addDays(ws, 6)).avgCompletion);
  assert.notEqual(avg, scoreGuildWeek([g.weeks[0], { ...g.weeks[1], joinedDate: ws }, g.weeks[2]], ws, addDays(ws, 6)).avgCompletion);
  const unfrozen = { ...g.weeks[2], days: g.weeks[2].days.map(day => ({ ...day, frozen: false })) };
  assert.notEqual(avg, scoreGuildWeek([g.weeks[0], g.weeks[1], unfrozen], ws, addDays(ws, 6)).avgCompletion);
  const coins = await coinsOf(ws);
  assert.deepEqual([...coins.keys()].sort(), [a.userId, b.userId, c.userId].sort());
  assert.equal(coins.has(d.userId), false);
});

test('week membership is by label: a Sunday log of a user in America/New_York written on Monday in Asia/Ho_Chi_Minh counts for that week, a Monday log does not', async () => {
  const ws = '2027-05-24';
  await clock('2027-05-27T05:00:00.000Z');
  const g = await arrange(ws, [{}, {}, {}], [{}, {}, { timezone: 'America/New_York' }]);
  const ny = g.users[2];
  const target = Number((await db.admin.query('SELECT calorie_target FROM prescriptions WHERE user_id = $1', [ny.userId])).rows[0].calorie_target);
  await clock('2027-05-31T00:00:00.000Z'); // Sunday 20:00 in New York, Monday 07:00 in Asia/Ho_Chi_Minh
  ok(await post(ny, '/nutrition/log', { kcal: target }));
  await clock('2027-06-01T00:00:00.000Z'); // Monday 20:00 in New York
  ok(await post(ny, '/nutrition/log', { kcal: target }));
  const logs = (
    await db.admin.query(
      `SELECT logical_date::text AS date, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS ict
         FROM daily_logs WHERE user_id = $1 ORDER BY logical_date`,
      [ny.userId],
    )
  ).rows;
  assert.deepEqual(logs, [
    { date: '2027-05-30', ict: '2027-05-31' },
    { date: '2027-05-31', ict: '2027-06-01' },
  ]);
  const at = '2027-06-01T01:00:00.000Z';
  await clock(at);
  const inputs: MemberWeek[] = await asJob(db.app, async x =>
    (await x.query('SELECT members FROM job_guild_week_inputs($1, $2) WHERE guild_id = $3', [ws, addDays(ws, 6), g.id])).rows[0].members,
  );
  const mine = inputs.find(m => m.userId === ny.userId)!;
  assert.deepEqual(mine.days, [{ date: '2027-05-30', storyDone: 1, storyTotal: story.length, frozen: false }]);
  assert.ok(((await rollover(at)).applied as string[]).includes(ws));
  const [avg, active] = (await storedScores(ws, [g.id])).get(g.id)!;
  assert.deepEqual([avg, active], [scoreGuildWeek(inputs, ws, addDays(ws, 6)).avgCompletion, 1]);
  assert.ok(avg > 0);
});

test('timing: Monday 03:29 Asia/Ho_Chi_Minh is not due and leaves the week open; 03:30 is due and settles it', async () => {
  const ws = '2027-07-05';
  const job = weeklyRollover.due;
  const lastMonday = new Date('2027-07-04T20:30:00.000Z'); // the run of Monday 2027-07-05 03:30
  assert.equal(job(new Date('2027-07-11T20:29:00.000Z'), lastMonday), false);
  assert.equal(job(new Date('2027-07-11T20:30:00.000Z'), lastMonday), true);
  assert.equal(job(new Date('2027-07-11T20:29:00.000Z'), null), true, 'a fresh process looks at once');
  await clock('2027-07-07T05:00:00.000Z');
  const g = await arrange(ws, [{ logs: days(ws, 1, story.length) }, { logs: days(ws, 1, story.length) }, { logs: days(ws, 1, story.length) }]);
  await clock('2027-07-11T20:29:00.000Z');
  assert.equal(((await rollover('2027-07-11T20:29:00.000Z')).applied as string[]).includes(ws), false);
  assert.equal((await storedScores(ws, [g.id])).size, 0);
  await clock('2027-07-11T20:30:00.000Z');
  assert.ok(((await rollover('2027-07-11T20:30:00.000Z')).applied as string[]).includes(ws));
  assert.equal((await storedScores(ws, [g.id])).get(g.id)![2], 1);
});

test('catch-up: down for two Mondays, one run settles both weeks, oldest first', async () => {
  const [w1, w2] = ['2027-08-16', '2027-08-23'];
  await clock('2027-08-18T05:00:00.000Z');
  const g = await arrange(w1, [
    { logs: [...days(w1, 7, story.length), ...days(w2, 2, 1)] },
    { logs: [...days(w1, 3, 1), ...days(w2, 7, story.length)] },
    { logs: [...days(w1, 1, 1), ...days(w2, 1, 1)] },
  ]);
  const at = '2027-08-29T20:30:00.000Z'; // Monday 2027-08-30 03:30
  await clock(at);
  const result = await rollover(at);
  assert.deepEqual(result.applied, ['2027-08-02', '2027-08-09', w1, w2]);
  for (const ws of [w1, w2]) {
    const want = scoreGuildWeek(g.weeks, ws, addDays(ws, 6));
    assert.deepEqual((await storedScores(ws, [g.id])).get(g.id), [want.avgCompletion, 3, 1]);
    assert.deepEqual([...(await coinsOf(ws)).values()], [150, 150, 150]);
  }
});

// ---------------------------------------------------------------------------------------------
// Races: job_apply_guild_week against the guild functions, two pools, no deadlock

const waitForLockWaiter = async () => {
  for (let i = 0; i < 200; i++) {
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (rows[0].n > 0) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('nobody waits for a lock');
};

/** A transaction that ran `first` and stays open until release() is called. */
function held(run: (work: (x: PoolClient) => Promise<void>) => Promise<void>, first: (x: PoolClient) => Promise<unknown>) {
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const started = new Promise<void>(resolve => (ready = resolve));
  const done = run(async x => {
    await first(x);
    ready();
    await gate;
  });
  return { started, release, done };
}

let raceWeek = 0;
/** A ranked guild in a week of its own (2029, no test clock gets there): A leads, X and Y active, I inactive. */
async function raceGuild() {
  const ws = addDays('2029-01-01', 7 * raceWeek++);
  const full = days(ws, 1, story.length);
  const g = await arrange(ws, [{ logs: full }, { logs: full }, { logs: full }, {}]);
  const [a, x, y, i] = g.users;
  return { ws, g, a, x, y, i };
}

test('race: X, an active member, leaves while the rollover applies: leave first → X is not paid; apply first → X is paid; never a deadlock', async () => {
  await clock('2027-11-03T05:00:00.000Z');
  {
    const { ws, a, x, y } = await raceGuild();
    const leave = held(work => asUser(second, x.userId, work), c => c.query('SELECT guild_leave()'));
    await leave.started;
    const settle = asJob(db.app, c => settleWeek(c, ws));
    await waitForLockWaiter();
    leave.release();
    await leave.done;
    assert.equal((await settle).applied, true);
    assert.deepEqual([...(await coinsOf(ws)).keys()].sort(), [a.userId, y.userId].sort());
  }
  {
    const { ws, a, x, y } = await raceGuild();
    const settle = held(work => asJob(db.app, work), c => settleWeek(c, ws));
    await settle.started;
    const leave = asUser(second, x.userId, c => c.query('SELECT guild_leave()'));
    await waitForLockWaiter();
    settle.release();
    await settle.done;
    await leave;
    assert.deepEqual([...(await coinsOf(ws)).keys()].sort(), [a.userId, x.userId, y.userId].sort());
    assert.equal((await db.admin.query('SELECT 1 FROM guild_memberships WHERE user_id = $1', [x.userId])).rowCount, 0);
  }
});

test('race: the lock order of guild_join / guild_leave (users row, then the guild FOR UPDATE), paused between its two locks, against the apply: no deadlock', async () => {
  await clock('2027-11-03T05:00:00.000Z');
  const { ws, g, a, x, y } = await raceGuild();
  const owner = await db.admin.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [x.userId]);
    const settle = asJob(db.app, c => settleWeek(c, ws));
    await waitForLockWaiter();
    // the guild functions' second lock: it must not wait for the apply, which holds no guild yet
    await owner.query("SET LOCAL lock_timeout = '3s'");
    await owner.query('SELECT 1 FROM guilds WHERE id = $1 FOR UPDATE', [g.id]);
    await owner.query('COMMIT');
    assert.equal((await settle).applied, true);
  } catch (e) {
    await owner.query('ROLLBACK');
    throw e;
  } finally {
    owner.release();
  }
  assert.deepEqual([...(await coinsOf(ws)).keys()].sort(), [a.userId, x.userId, y.userId].sort());
});

test('race: an inactive member leaves and a newcomer joins while the apply holds the guild: both wait and succeed, neither is paid; 10 rounds of a leave of X at the same moment: no failure', async () => {
  await clock('2027-11-03T05:00:00.000Z');
  {
    const { ws, g, a, x, y, i } = await raceGuild();
    const z = await newOnboardedUser(db);
    const code = (await db.admin.query('SELECT invite_code FROM guilds WHERE id = $1', [g.id])).rows[0].invite_code;
    const settle = held(work => asJob(db.app, work), c => settleWeek(c, ws));
    await settle.started;
    const leave = asUser(second, i.userId, c => c.query('SELECT guild_leave()'));
    const joining = asUser(second, z.userId, c => c.query('SELECT guild_join($1)', [code]));
    await waitForLockWaiter();
    settle.release();
    await Promise.all([settle.done, leave, joining]);
    assert.deepEqual([...(await coinsOf(ws)).keys()].sort(), [a.userId, x.userId, y.userId].sort());
  }
  for (let round = 0; round < 10; round++) {
    const { ws, a, x, y } = await raceGuild();
    const results = await Promise.allSettled([
      asJob(round % 2 === 0 ? db.app : second, c => settleWeek(c, ws)),
      asUser(round % 2 === 0 ? second : db.app, x.userId, c => c.query('SELECT guild_leave()')),
    ]);
    assert.deepEqual(results.map(r => (r.status === 'fulfilled' ? 'ok' : (r.reason as Error).message)), ['ok', 'ok']);
    const paid = [...(await coinsOf(ws)).keys()];
    assert.ok(paid.includes(a.userId) && paid.includes(y.userId), `round ${round}`);
  }
});

test('the SQL reads no private table or column, and weekStartOf matches app.week_start', async () => {
  const { rows } = await db.admin.query(
    `SELECT p.oid::regprocedure::text AS name, p.prosrc FROM pg_proc p
      WHERE p.oid IN ('job_guild_week_inputs(date, date)'::regprocedure, 'job_apply_guild_week(date, jsonb)'::regprocedure,
                      'leaderboard_final(date)'::regprocedure, 'app._member_days(uuid, date, date)'::regprocedure,
                      'app._guild_week_rows(jsonb)'::regprocedure)`,
  );
  assert.equal(rows.length, 5);
  for (const { name, prosrc } of rows) {
    for (const word of ['biometric_snapshots', 'prescriptions', 'nutrition_logs', 'journal_entries', 'calories_in', 'water_ml', 'email', 'display_name']) {
      assert.ok(!prosrc.includes(word), `${name} reads ${word}`);
    }
  }
  const week = (await db.admin.query("SELECT app.week_start('2027-05-30')::text AS w")).rows[0].w;
  assert.equal(week, weekStartOf('2027-05-30'));
});
