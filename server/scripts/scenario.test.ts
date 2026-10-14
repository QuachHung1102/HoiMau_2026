// The dev scenarios against a test app: each is run as the CLI runs it (makeCtx over HTTP, the
// real jobs, the test clock) and its outcome is read back through the API. Dates are
// Asia/Ho_Chi_Minh (UTC+7): the scenarios start at 2027-03-01 09:00 local.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTestClock } from '../test/helpers.ts';
import { startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import { assertDevDatabase, loadScenarios, makeCtx } from './scenario.ts';
import { PASSWORD, START, closeDay, completeStory, getDay } from './scenarioKit.ts';
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

test('every file of scripts/scenarios is found: the six of Task 23', async () => {
  assert.deepEqual(
    (await loadScenarios()).map(scenario => scenario.name),
    ['broken', 'day1', 'fresh', 'missed3', 'streak2', 'streak6'],
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
  for (const name of ['broken', 'streak6']) {
    await run(name);
  }
  assert.deepEqual(await decoys(), snapshot);
});

test('reset deletes demo users only', async () => {
  for (const email of [
    'decoy-1@decoy.invalid',
    'demo-x@decoy.invalid',
    'demo-x@hoimau.test.evil',
    'demo-@hoimau.test',
    "demo-x'@hoimau.test",
    'a@example.com',
  ]) {
    await assert.rejects(ctx.reset(email), /reset refuses/, email);
  }
  await ctx.reset('demo-nobody@hoimau.test'); // nothing to delete is not an error
});

test('a scenario can read through admin but cannot write business rows with it', async () => {
  assert.equal((await ctx.admin.query('SELECT 1 AS one')).rows[0].one, 1);
  await assert.rejects(
    async () => ctx.admin.query("DELETE FROM users WHERE email LIKE 'demo-%'"),
    /read-only/,
  );
  await assert.rejects(
    async () => ctx.admin.query('INSERT INTO daily_logs (user_id) VALUES (gen_random_uuid())'),
    /read-only/,
  );
  assert.throws(() => ctx.admin.connect(), /read-only/);
  assert.throws(() => ctx.admin.end(), /read-only/);
});

test('the database guard answers from the connection: the test database is refused', async () => {
  await assert.rejects(assertDevDatabase(db.admin), /refusing to run: connected to database t_[0-9a-f]+ on port 54329, not hoimau on port 54330/);
});
