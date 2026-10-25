// The dev scenarios against a test app: each is run as the CLI runs it (makeCtx over HTTP, the
// real jobs, the test clock) and its outcome is read back through the API. Dates are
// Asia/Ho_Chi_Minh (UTC+7): the scenarios start at 2027-03-01 09:00 local.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';
import { setTestClock } from '../test/helpers.ts';
import { newOnboardedUser, startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import { assertDevDatabase, assertNoRealUsers, loadScenarios, makeCtx } from './scenario.ts';
import { logicalDateOf } from '../../domain/logicalDate.ts';
import { PASSWORD, START, closeDay, completeStory, getDay, goTo, startFor } from './scenarioKit.ts';
import type { ScenarioCtx } from './scenarioKit.ts';

let db: TestDb;
let app: TestApp;
let ctx: ScenarioCtx;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  ctx = makeCtx({ baseUrl: app.baseUrl, admin: db.admin, app: db.app });
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

/** Runs the scenario and signs in with the account it printed: the credentials must work. */
async function run(name: string) {
  const scenario = (await loadScenarios()).find(found => found.name === name);
  assert.ok(scenario, `no scenario ${name}`);
  const done = await scenario.run(ctx);
  assert.equal(done.email, `demo-${name}@hoimau.test`);
  assert.equal(done.password, PASSWORD);
  const login = await app.call('POST', '/auth/login', {
    body: { email: done.email, password: done.password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { token: login.body.token as string, onboarded: login.body.onboarded as boolean };
}

const get = async (token: string, path: string) => {
  const response = await app.call('GET', path, { token });
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.body)}`);
  return response.body;
};
const clock = async () =>
  (await db.admin.query<{ now: Date }>('SELECT app.now() AS now')).rows[0].now.toISOString();
/** What a decoy owns, as one value: scenarios must leave it exactly as it is. */
const decoys = async () =>
  (
    await db.admin.query(`
      SELECT jsonb_build_object(
        'users', (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u WHERE email LIKE '%@decoy.invalid'),
        'progression', (SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM progression_state p JOIN users u ON u.id = p.user_id WHERE u.email LIKE '%@decoy.invalid'),
        'logs', (SELECT count(*) FROM daily_logs l JOIN users u ON u.id = l.user_id WHERE u.email LIKE '%@decoy.invalid'),
        'notifications', (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email LIKE '%@decoy.invalid'),
        'tickets', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM freeze_tickets t JOIN users u ON u.id = t.user_id WHERE u.email LIKE '%@decoy.invalid')
      ) AS snapshot`)
  ).rows[0].snapshot;

test('every file of scripts/scenarios is found: the six of Task 23, rich of Task 37, guild4 of Task 39, ticket of Task 44 and e2e-full of Task 53', async () => {
  assert.deepEqual(
    (await loadScenarios()).map(scenario => scenario.name),
    ['broken', 'day1', 'e2e-full', 'fresh', 'guild4', 'missed3', 'rich', 'streak2', 'streak6', 'ticket'],
  );
});

test('fresh: registered, not onboarded', async () => {
  const { token, onboarded } = await run('fresh');
  assert.equal(onboarded, false);
  assert.equal((await app.call('GET', '/day', { token })).body.error.code, 'ONBOARDING_REQUIRED');
  assert.equal(await clock(), START);
});

test('day1: onboarded, streak 0, level 1, nothing recorded, 09:00 local', async () => {
  const { token, onboarded } = await run('day1');
  assert.equal(onboarded, true);
  const progression = await get(token, '/progression');
  assert.equal(progression.streakCurrent, 0);
  assert.equal(progression.level, 1);
  const day = await get(token, '/day');
  assert.equal(day.logicalDate, '2027-03-01');
  assert.equal(day.caloriesIn, 0);
  assert.deepEqual(day.story, { done: 0, total: 2 });
  assert.equal(Date.parse(day.closesAt) - Date.parse(day.serverTime), 18 * 3_600_000); // 09:00 -> 03:00
  assert.equal(await clock(), START);
});

test('streak2: streak 2, today open at 20:00 local with nothing recorded', async () => {
  const { token } = await run('streak2');
  assert.equal((await get(token, '/progression')).streakCurrent, 2);
  const day = await get(token, '/day');
  assert.equal(day.streak.current, 2);
  assert.equal(day.logicalDate, '2027-03-03');
  assert.equal(day.caloriesIn, 0);
  assert.deepEqual(day.story, { done: 0, total: 2 });
  assert.equal(Date.parse(day.closesAt) - Date.parse(day.serverTime), 7 * 3_600_000); // 20:00 -> 03:00
  assert.equal(await clock(), '2027-03-03T13:00:00.000Z');
});

test('streak6: streak 6; completing today and closing it makes 7 with a milestone', async () => {
  const { token } = await run('streak6');
  assert.equal((await get(token, '/progression')).streakCurrent, 6);
  const day = await get(token, '/day');
  assert.equal(day.streak.current, 6);
  assert.deepEqual(day.celebrations, []);
  assert.equal(await clock(), '2027-03-07T13:00:00.000Z');

  await completeStory(ctx, token);
  await closeDay(ctx, token);
  assert.equal((await get(token, '/progression')).streakCurrent, 7);
  const next = await getDay(ctx, token);
  assert.equal(next.streak.current, 7);
  assert.equal(next.celebrations.length, 1);
  assert.equal(next.celebrations[0].kind, 'STREAK_MILESTONE');
  assert.equal(next.celebrations[0].payload.days, 7);
});

test('missed3: three closed missed days, the pet is TIRED', async () => {
  const { token } = await run('missed3');
  assert.equal((await get(token, '/pet')).mood, 'TIRED');
  assert.equal((await get(token, '/progression')).streakCurrent, 0);
  assert.equal(await clock(), '2027-03-04T02:00:00.000Z');
});

test('broken: streak 5 broke yesterday, the notice names 5, 09:00 local', async () => {
  const { token } = await run('broken');
  const progression = await get(token, '/progression');
  assert.equal(progression.streakCurrent, 0);
  assert.equal(progression.streakBest, 5);
  assert.equal(progression.breakNotice.previous, 5);
  assert.equal(progression.breakNotice.date, '2027-03-06');
  const day = await get(token, '/day');
  assert.equal(day.logicalDate, '2027-03-07');
  assert.equal(Date.parse(day.closesAt) - Date.parse(day.serverTime), 18 * 3_600_000);
  assert.equal(await clock(), '2027-03-07T02:00:00.000Z');
});

test('ticket: broken plus one unused ticket; the rescue of yesterday restores 5', async () => {
  const { token } = await run('ticket');
  const tickets = await get(token, '/freeze-tickets');
  assert.equal(tickets.available, 1);
  assert.deepEqual(
    tickets.eligible.map((e: { date: string; target: string; needed: boolean; withTicket: number }) => [e.date, e.target, e.needed, e.withTicket]),
    [
      ['2027-03-07', 'TODAY', false, 0],
      ['2027-03-06', 'YESTERDAY', true, 5],
    ],
  );
  assert.equal(await clock(), '2027-03-07T02:00:00.000Z');
  const used = await app.call('POST', '/freeze-tickets/use', { token, key: randomUUID(), body: { date: '2027-03-06' } });
  assert.equal(used.status, 200, JSON.stringify(used.body));
  assert.deepEqual([used.body.available, used.body.progression.streakCurrent], [0, 5]);
});

test('rich: level 8, 500 coins, 3 perk points, TICKET_CAP_PLUS and THEME_FOREST unlocked', async () => {
  const { token } = await run('rich');
  const progression = await get(token, '/progression');
  assert.deepEqual([progression.level, progression.coin, progression.perkPointsAvailable], [8, 500, 3]);
  const perks = await get(token, '/perks');
  assert.equal(perks.pointsAvailable, 3);
  assert.deepEqual(
    perks.perks.map((p: { code: string; unlocked: boolean }) => [p.code, p.unlocked]),
    [['MEAL_SWAP_PLUS', false], ['TICKET_CAP_PLUS', true], ['THEME_UNLOCK', true]],
  );
  assert.ok((await get(token, '/inventory')).items.some((i: { code: string }) => i.code === 'THEME_FOREST'));
  assert.equal((await get(token, '/shop')).coin, 500);
  assert.equal(await clock(), START);
});

test('guild4: four in one guild, three active this week with different completion, the fourth muted; a second run replaces the guild', async () => {
  const outcome = async () => {
    const { token } = await run('guild4');
    const { guild } = await get(token, '/guilds/me');
    const dung = await app.call('POST', '/auth/login', { body: { email: 'demo-guild4d@hoimau.test', password: PASSWORD } });
    assert.equal(dung.status, 200, JSON.stringify(dung.body));
    return {
      name: guild.name,
      myRole: guild.myRole,
      // the four joined at one frozen instant: same joined_at, so the order after the leader is by user id
      members: guild.members
        .map((m: any) => [m.displayName, m.role, m.daysCompletedThisWeek, m.storyDoneToday])
        .sort((a: any, b: any) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === 'LEADER' ? -1 : 1)),
      weekCompletion: guild.weekCompletion,
      dungNudges: (await get(dung.body.token, '/settings')).nudgesEnabled,
      guilds: (await db.admin.query("SELECT count(*)::int AS n FROM guilds WHERE name = 'Tổ Bốn Mùa'")).rows[0].n,
      day: (await get(token, '/day')).logicalDate,
    };
  };
  const first = await outcome();
  assert.deepEqual(first.members, [
    ['An', 'LEADER', 2, true],
    ['Bình', 'MEMBER', 1, false],
    ['Chi', 'MEMBER', 0, false],
    ['Dũng', 'MEMBER', 0, false],
  ]);
  assert.deepEqual([first.myRole, first.dungNudges, first.guilds, first.day], ['LEADER', false, 1, '2027-03-02']);
  assert.ok(first.weekCompletion > 0 && first.weekCompletion < 1);
  assert.deepEqual(await outcome(), first);
});

test('guild4 recovers the guild a hard-deleted leader left, leaderless or empty, and refuses loudly when a non-demo account is in it', async () => {
  const guilds = async () =>
    (await db.admin.query("SELECT count(*)::int AS n FROM guilds WHERE name = 'Tổ Bốn Mùa'")).rows[0].n;
  const members = async () =>
    (await get((await run('guild4')).token, '/guilds/me')).guild.members.length;
  assert.equal(await members(), 4);
  await ctx.reset('demo-guild4@hoimau.test'); // leaderless, three members
  assert.equal(await members(), 4);
  for (const name of ['guild4', 'guild4b', 'guild4c', 'guild4d']) {
    await ctx.reset(`demo-${name}@hoimau.test`); // empty
  }
  assert.equal(await guilds(), 1);
  assert.equal(await members(), 4);
  assert.equal(await guilds(), 1);

  // someone who is not a demo account in a guild of that name: refused, nothing deleted
  await ctx.removeGuild('Tổ Bốn Mùa');
  const real = await newOnboardedUser(db);
  try {
    const made = await app.call('POST', '/guilds', { token: real.token, key: randomUUID(), body: { name: 'tổ bốn mùa' } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const guild4 = (await loadScenarios()).find(scenario => scenario.name === 'guild4')!;
    await assert.rejects(guild4.run(ctx), /^Error: removeGuild refuses "Tổ Bốn Mùa": it has a member who is not a demo/);
    assert.equal((await db.admin.query('SELECT count(*)::int AS n FROM guild_memberships WHERE user_id = $1', [real.userId])).rows[0].n, 1);
  } finally {
    await db.admin.query('DELETE FROM users WHERE id = $1', [real.userId]);
    await ctx.removeGuild('Tổ Bốn Mùa');
  }
  assert.equal(await guilds(), 0);
});

test('e2e-full: streak 3, 120 coins, leader of a guild whose member Bình takes nudges and has today open; 13:00 local; twice in a row', async () => {
  const scenario = (await loadScenarios()).find(found => found.name === 'e2e-full')!;
  const login = async (email: string) =>
    (await app.call('POST', '/auth/login', { body: { email, password: PASSWORD } })).body.token as string;
  for (const round of [1, 2]) {
    const done = await scenario.run(ctx);
    assert.equal(done.email, 'demo-e2efull@hoimau.test');
    const token = await login(done.email);
    const progression = await get(token, '/progression');
    assert.deepEqual([progression.streakCurrent, progression.coin], [3, 120], `run ${round}`);
    const { guild } = await get(token, '/guilds/me');
    assert.deepEqual(
      guild.members.map((m: any) => [m.displayName, m.role, m.storyDoneToday]),
      [['An', 'LEADER', false], ['Bình', 'MEMBER', false]],
      `run ${round}`,
    );
    assert.equal((await get(await login('demo-e2efullb@hoimau.test'), '/settings')).nudgesEnabled, true);
    assert.equal(await clock(), '2027-03-04T06:00:00.000Z');
  }
});

test('a scenario twice in a row gives the same outcome, for one account', async () => {
  const outcome = async () => {
    const { token } = await run('streak2');
    const [progression, day, pet] = await Promise.all([
      get(token, '/progression'),
      get(token, '/day'),
      get(token, '/pet'),
    ]);
    return {
      progression,
      pet,
      day: { ...day, serverTime: undefined, quests: day.quests.map((q: any) => ({ ...q, lastTick: null })) },
      clock: await clock(),
      users: (await db.admin.query("SELECT count(*)::int AS n FROM users WHERE email = 'demo-streak2@hoimau.test'")).rows[0].n,
    };
  };
  const first = await outcome();
  assert.equal(first.users, 1);
  assert.deepEqual(await outcome(), first);
});

test('scenarios leave the decoys alone', async () => {
  const snapshot = await decoys();
  assert.ok(snapshot.users.length === 2, 'the template carries both decoys');
  for (const name of ['broken', 'streak6', 'ticket']) {
    await run(name);
  }
  assert.deepEqual(await decoys(), snapshot);
});

test('reset and grant touch demo users only', async () => {
  for (const email of [
    'decoy-1@decoy.invalid',
    'demo-x@decoy.invalid',
    'demo-x@hoimau.test.evil',
    'demo-@hoimau.test',
    "demo-x'@hoimau.test",
    'a@example.com',
    'DEMO-X@hoimau.test',
    'demo-X@hoimau.test',
    'demo-%@hoimau.test',
    'demo-_@hoimau.test',
    '%@hoimau.test',
    'demo-x@hoimau.test' + String.fromCharCode(10),
    'demo-x@hoimau.test ',
  ]) {
    await assert.rejects(ctx.reset(email), /reset refuses/, email);
    await assert.rejects(ctx.grant(email, 0, 1), /grant refuses/, email);
  }
  await ctx.reset('demo-nobody@hoimau.test'); // nothing to delete is not an error
});

test('admin is one SELECT in a read-only transaction that is rolled back', async () => {
  assert.equal((await ctx.admin.query('SELECT $1::int AS one', [1])).rows[0].one, 1);
  const users = () => db.admin.query('SELECT count(*)::int AS n FROM users').then(r => r.rows[0].n);
  const usersBefore = await users();
  const clockRows = () => db.admin.query('SELECT count(*)::int AS n FROM meta.test_clock').then(r => r.rows[0].n);
  const clockBefore = await clockRows();
  await assert.rejects(async () => ctx.admin.query("DELETE FROM users WHERE email LIKE 'demo-%'"), /read-only/);
  await assert.rejects(async () => ctx.admin.query('INSERT INTO daily_logs (user_id) VALUES (gen_random_uuid())'), /read-only/);
  // two statements in one text
  await assert.rejects(async () => ctx.admin.query('SELECT 1; DELETE FROM users'), /no ";"/);
  assert.equal(await users(), usersBefore);
  // a function that writes
  await db.admin.query(`CREATE FUNCTION scenario_writes() RETURNS int LANGUAGE sql AS
    $$ INSERT INTO meta.test_clock (now) VALUES ('2030-01-01T00:00:00Z') RETURNING 1 $$`);
  await assert.rejects(ctx.admin.query('SELECT scenario_writes()'), /read-only transaction/);
  assert.equal(await clockRows(), clockBefore);
  // SELECT ... INTO makes a table
  await assert.rejects(ctx.admin.query('SELECT 1 AS one INTO scenario_leak'), /read-only transaction/);
  assert.equal((await db.admin.query("SELECT to_regclass('scenario_leak') AS t")).rows[0].t, null);
  // a session setting does not outlive the query, whichever pooled client carries it
  const timeout = () => ctx.admin.query("SELECT current_setting('statement_timeout') AS v").then(r => r.rows[0].v);
  const normal = await timeout();
  await ctx.admin.query("SELECT set_config('statement_timeout', '1ms', false)");
  await ctx.admin.query("SELECT set_config('statement_timeout', '1ms', false)");
  assert.equal(await timeout(), normal);
  assert.equal(await timeout(), normal);
  assert.throws(() => ctx.admin.connect(), /read-only/);
  assert.throws(() => ctx.admin.end(), /read-only/);
});

test('call checks the status before it reads the body: an error page that is not JSON', async () => {
  const stub = createServer((_, res) => {
    res.writeHead(502, { 'content-type': 'text/html' });
    res.end('<html>Bad Gateway</html>');
  });
  await new Promise<void>(resolve => stub.listen(0, '127.0.0.1', resolve));
  try {
    const behind = makeCtx({
      baseUrl: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
      admin: db.admin,
      app: db.app,
    });
    await assert.rejects(behind.call('GET', '/x'), (e: Error) => {
      assert.equal(e.name, 'Error');
      assert.equal(e.message, 'GET /x answered 502 <html>Bad Gateway</html>');
      return true;
    });
  } finally {
    stub.closeAllConnections();
    await new Promise(resolve => stub.close(resolve));
  }
  await assert.rejects(ctx.call('GET', '/day'), /^Error: GET .day answered 401 SESSION_INVALID$/);
});

test('the kit fails loudly: a skipped user, a day that is not closed, a clock that did not move', async () => {
  // run() starts the account over, so each case signs in again
  await assert.rejects(closeDay({ ...ctx, runJob: async () => ({ failed: 0, skipped: 1 }) }, (await run('day1')).token), /1 skipped/);
  await assert.rejects(closeDay({ ...ctx, runJob: async () => ({ failed: 0, skipped: 0 }) }, (await run('day1')).token), /2027-03-01 is not closed/);
  await assert.rejects(goTo({ ...ctx, setClock: async () => {} }, (await run('day1')).token, 28), /the server says 2027-03-01, not 2027-03-02/);
  await assert.rejects(goTo(ctx, (await run('day1')).token, 29), /outside 3 to 28/);
});

test('the clock does not move while a non-demo onboarded user is there, unless told so', async () => {
  const real = await newOnboardedUser(db);
  const own = { baseUrl: app.baseUrl, admin: db.admin, app: db.app };
  const clockRows = () => db.admin.query('SELECT count(*)::int AS n FROM meta.test_clock').then(r => r.rows[0].n);
  const warning = mock.method(console, 'error', () => {});
  try {
    await setTestClock(db.admin, null);
    const strict = makeCtx(own);
    await assert.rejects(strict.setClock(START), /refusing to move the clock: 1 onboarded user.s. here are not demo/);
    const day1 = (await loadScenarios()).find(scenario => scenario.name === 'day1')!;
    await assert.rejects(day1.run(strict), /refusing to move the clock/);
    assert.equal(await clockRows(), 0);

    const told = makeCtx({ ...own, includeRealUsers: true });
    await told.setClock(START);
    assert.equal(await clock(), START);
    assert.match(String(warning.mock.calls[0].arguments[0]), /^warning: 1 onboarded user.s..*--include-real-users given/);
    await assert.doesNotReject(assertNoRealUsers(db.admin, true));

    await strict.setClock(null); // turning the clock off is never refused
    assert.equal(await clockRows(), 0);
  } finally {
    warning.mock.restore();
    await db.admin.query('DELETE FROM users WHERE id = $1', [real.userId]);
    await setTestClock(db.admin, null);
  }
  await assert.doesNotReject(assertNoRealUsers(db.admin, false)); // demo accounts and decoys do not count
});

test('the database guard answers from the connection: the test database is refused', async () => {
  await assert.rejects(assertDevDatabase(db.admin), /refusing to run: connected to database t_[0-9a-f]+ on port 54329, not hoimau on port 54330/);
});

test('with a "today" every scenario ends on that day, so a phone with the real date agrees with the server', async () => {
  const today = '2026-10-22';
  const anchored = makeCtx({ baseUrl: app.baseUrl, admin: db.admin, app: db.app, today });
  for (const scenario of await loadScenarios()) {
    const done = await scenario.run(anchored);
    const { rows } = await db.admin.query<{ now: Date }>('SELECT app.now() AS now');
    assert.equal(logicalDateOf(rows[0].now.getTime(), 'Asia/Ho_Chi_Minh'), today, `${scenario.name} ended on another day`);
    if (scenario.name !== 'fresh') {
      const login = await app.call('POST', '/auth/login', { body: { email: done.email, password: done.password } });
      assert.equal((await get(login.body.token, '/day')).logicalDate, today, scenario.name);
    }
  }
  assert.equal(startFor('2026-10-22', 6), '2026-10-16T02:00:00.000Z');
});
