// The housekeeping job (61-privacy.sql): the 30-day purge of deleted accounts with everything
// that cascades from them, guilds left without a leader or without members, the 7-day purge of
// idempotency keys, the purge of dead sessions, codes and throttle rows; never a decoy. Users
// and data are made over HTTP, ages are arranged through the owner connection, the clock is the
// test clock. 2027-03-10 is a Wednesday; Asia/Ho_Chi_Minh is UTC+7.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DECOY_1, DECOY_2, decoyRows, userDataTables } from '../../checks/attacks/base.ts';
import { asJob, setTestClock } from '../../test/helpers.ts';
import { ONBOARDING_INPUT, newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { createLogger } from '../log.ts';
import housekeeping from './housekeeping.ts';
import { runJob } from './scheduler.ts';

const NOON = '2027-03-10T05:00:00.000Z';
const PASSWORD = 'mật khẩu đủ dài 1';
const DAY_MS = 86_400_000;
const quiet = createLogger(() => {});

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await setTestClock(db.admin, NOON);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

function ok(result: CallResult, status = 200): any {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
const post = (who: { token: string }, path: string, body?: unknown) =>
  app.call('POST', path, { token: who.token, key: randomUUID(), body });
const at = (ms: number) => new Date(Date.parse(NOON) + ms);
const job = (fn: string, now: Date) =>
  asJob(db.app, c => c.query<{ n: number }>(`SELECT ${fn}($1) AS n`, [now])).then(r => r.rows[0].n);

/** Every public table with a column naming a user, and how many rows of `userId` each holds. */
async function referencing(userId: string): Promise<Record<string, number>> {
  const { rows: columns } = await db.admin.query<{ table: string; column: string }>(
    `SELECT c.table_name AS table, c.column_name AS column FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('user_id', 'sender_id', 'receiver_id')
      ORDER BY 1, 2`,
  );
  const out: Record<string, number> = {};
  for (const { table, column } of columns) {
    const { rows } = await db.admin.query(`SELECT count(*)::int AS n FROM public."${table}" WHERE "${column}" = $1`, [userId]);
    out[`${table}.${column}`] = rows[0].n;
  }
  for (const { name, ofUser } of await userDataTables(db.admin)) {
    const { rows } = await db.admin.query(`SELECT count(*)::int AS n FROM public."${name}" WHERE ${ofUser}`, [userId]);
    out[name] = rows[0].n;
  }
  return out;
}

test('every table holding user data cascades from users: every key to users, whatever its column is named, is ON DELETE CASCADE; every key into a table of user data cascades but the listed exceptions; each table of the key chain has one cascading path', async () => {
  const { rows: keys } = await db.admin.query<{ child: string; parent: string; columns: string; cascades: boolean }>(
    `SELECT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent,
            (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
              WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)) AS columns,
            k.confdeltype = 'c' AS cascades
       FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
      ORDER BY 1, 3`,
  );
  const toUsers = keys.filter(k => k.parent === 'users');
  assert.ok(toUsers.length > 10);
  assert.ok(toUsers.some(k => k.columns === 'sender_id') && toUsers.some(k => k.columns === 'receiver_id'));
  assert.deepEqual(toUsers.filter(k => !k.cascades).map(k => `${k.child}.${k.columns}`), [], 'a key to users that does not cascade');

  // a key into a table of user data that does not cascade blocks or outlives the purge, unless
  // both ends are rows of one user that the cascade from users removes in the same statement:
  // logged_action_id is same-user by construction (nutrition_log_slot, 40-nutrition.sql)
  const EXCEPTIONS = ['daily_meal_plans.logged_action_id'];
  const tables = (await userDataTables(db.admin)).map(t => t.name);
  assert.ok(tables.includes('nudge_events') && tables.includes('journal_entries'));
  const into = keys.filter(k => tables.includes(k.parent) && !k.cascades).map(k => `${k.child}.${k.columns}`);
  assert.deepEqual(into, EXCEPTIONS, 'a key into a table of user data that does not cascade');

  // the key chain of userDataTables: a table reached only through a key that does not cascade
  const cascades = (table: string, seen: string[] = []): boolean =>
    table === 'users' ||
    keys.some(k => k.cascades && k.child === table && !seen.includes(k.parent) && cascades(k.parent, [...seen, table]));
  assert.deepEqual(tables.filter(t => !cascades(t)), []);
});

test('every key the purge fires (its parent is not content) has an index that leads with its columns: the cascade and the NO ACTION checks never scan a whole table', async () => {
  const { rows } = await db.admin.query<{ key: string; indexed: boolean }>(
    `SELECT k.conrelid::regclass::text || '.' ||
              (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
                WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)) AS key,
            EXISTS (SELECT 1 FROM pg_index i
                     WHERE i.indrelid = k.conrelid AND i.indpred IS NULL
                       AND (SELECT array_agg(c ORDER BY c) FROM unnest((i.indkey::int2[])[0:cardinality(k.conkey) - 1]) c)
                         = (SELECT array_agg(c ORDER BY c) FROM unnest(k.conkey) c)) AS indexed
       FROM pg_constraint k
       JOIN meta.expected_tables t ON t.name = k.confrelid::regclass::text
      WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace AND t.class <> 'content'
      ORDER BY 1`,
  );
  assert.ok(rows.some(r => r.key === 'daily_meal_plans.logged_action_id'));
  assert.ok(rows.some(r => r.key === 'nudge_events.receiver_id'));
  assert.deepEqual(rows.filter(r => !r.indexed).map(r => r.key), [], 'a key without an index leading with its columns');
});

test('purge: +29 days 0, +30 days every due account with everything that leads to it, a second run 0, the decoys stay, the email is free again; guilds left by any path get a leader or go', async () => {
  const decoysBefore = await decoyRows(db.admin);
  // the account deleted through the route, with data in every feature it can reach alone
  const email = `h${randomUUID().slice(0, 12)}@example.com`;
  const me = ok(
    await app.call('POST', '/auth/register', {
      body: { email, password: PASSWORD, displayName: 'Sắp đi', acceptedTerms: true },
    }),
    201,
  );
  ok(await post(me, '/onboarding', ONBOARDING_INPUT));
  const mate = await newOnboardedUser(db);
  const made = ok(await post(mate, '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` }));
  ok(await post(me, '/guilds/join', { inviteCode: made.guild.inviteCode }));
  ok(await post(me, '/day/quests/WATER_8/progress', {}));
  const plan = ok(await app.call('GET', '/nutrition/plan', { token: me.token }));
  const slot = plan.slots.find((s: { meal: unknown }) => s.meal !== null).mealSlot;
  // a logged planned meal: daily_meal_plans.logged_action_id points at nutrition_logs (NO ACTION)
  ok(await post(me, '/nutrition/log', { mealSlot: slot }));
  ok(await post(me, '/journal', { body: 'trước khi đi' }));
  ok(await post(mate, '/guilds/nudge', { receiverId: me.userId, templateCode: 'MOVE_TOGETHER' }));
  ok(await post(me, '/guilds/nudge', { receiverId: mate.userId, templateCode: 'MOVE_TOGETHER' }));
  const logged = await db.admin.query('SELECT 1 FROM daily_meal_plans WHERE user_id = $1 AND logged_action_id IS NOT NULL', [me.userId]);
  assert.equal(logged.rowCount, 1);
  assert.equal((await post(me, '/me/delete', { password: PASSWORD })).status, 204);

  // a leader deleted by another path (deleted_at set by hand): still the LEADER of a guild of two
  const leader = await newOnboardedUser(db);
  const follower = await newOnboardedUser(db);
  const second = ok(await post(leader, '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` }));
  ok(await post(follower, '/guilds/join', { inviteCode: second.guild.inviteCode }));
  await db.admin.query(
    "UPDATE users SET deleted_at = $2, purge_after = $2::timestamptz + interval '30 days' WHERE id = $1",
    [leader.userId, NOON],
  );
  // users rows deleted by hand: a guild left without its leader, a guild left without anybody
  const gone = await newOnboardedUser(db);
  const stays = await newOnboardedUser(db);
  const third = ok(await post(gone, '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` }));
  ok(await post(stays, '/guilds/join', { inviteCode: third.guild.inviteCode }));
  const lone = await newOnboardedUser(db);
  const fourth = ok(await post(lone, '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` }));
  await db.admin.query('DELETE FROM users WHERE id = ANY($1)', [[gone.userId, lone.userId]]);

  assert.equal(await job('job_account_purge', at(29 * DAY_MS)), 0);
  assert.equal(await job('job_account_purge', at(30 * DAY_MS)), 2);
  for (const userId of [me.userId, leader.userId]) {
    const left = Object.entries(await referencing(userId)).filter(([, n]) => n > 0);
    assert.deepEqual(left, [], 'rows still lead to a purged user');
  }
  assert.ok(Object.keys(await referencing(me.userId)).includes('nudge_events.receiver_id'));
  const guilds = await db.admin.query(
    `SELECT g.id, ARRAY(SELECT m.user_id || ':' || m.role FROM guild_memberships m WHERE m.guild_id = g.id ORDER BY 1) AS members
       FROM guilds g WHERE g.id = ANY($1) ORDER BY g.id`,
    [[made.guild.id, second.guild.id, third.guild.id, fourth.guild.id]],
  );
  assert.deepEqual(
    Object.fromEntries(guilds.rows.map(r => [r.id, r.members])),
    {
      [made.guild.id]: [`${mate.userId}:LEADER`],
      [second.guild.id]: [`${follower.userId}:LEADER`],
      [third.guild.id]: [`${stays.userId}:LEADER`],
    },
  );
  assert.equal(await job('job_account_purge', at(30 * DAY_MS)), 0);
  assert.deepEqual(await decoyRows(db.admin), decoysBefore);
  await setTestClock(db.admin, at(30 * DAY_MS).toISOString());
  try {
    ok(
      await app.call('POST', '/auth/register', {
        body: { email, password: PASSWORD, displayName: 'Trở lại', acceptedTerms: true },
      }),
      201,
    );
  } finally {
    await setTestClock(db.admin, NOON);
  }
});

test('idempotency purge: a key 8 days old goes, one 6 days old stays, the decoy key stays', async () => {
  const user = await newOnboardedUser(db);
  const [old, young] = [randomUUID(), randomUUID()];
  for (const [key, days] of [[old, 8], [young, 6]] as const) {
    await db.admin.query(
      `INSERT INTO idempotency_keys (user_id, key, request_hash, status, response, created_at)
       VALUES ($1, $2, $3, 200, '{}', $4::timestamptz - make_interval(days => $5))`,
      [user.userId, key, randomBytes(32), NOON, days],
    );
  }
  await db.admin.query("UPDATE idempotency_keys SET created_at = '2000-01-01' WHERE user_id = $1", [DECOY_1]);
  const n = await job('job_purge_idempotency', new Date(NOON));
  const { rows } = await db.admin.query('SELECT key FROM idempotency_keys WHERE user_id = ANY($1) ORDER BY key', [[user.userId, DECOY_1]]);
  assert.deepEqual(rows.map(r => r.key).sort(), [young, '00000000-0000-4000-8000-0000000d1003'].sort());
  assert.ok(n >= 1);
  assert.equal(await job('job_purge_idempotency', new Date(NOON)), 0);
});

test('auth purge: expired or revoked sessions, expired codes, throttle rows of an hour go; live ones and the decoys stay', async () => {
  const user = await newOnboardedUser(db);
  const sessions = { live: randomUUID(), expired: randomUUID(), revoked: randomUUID() };
  await db.admin.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at) VALUES
       ($2, $1, $5, $8::timestamptz + interval '1 day', NULL),
       ($3, $1, $6, $8::timestamptz - interval '1 second', NULL),
       ($4, $1, $7, $8::timestamptz + interval '1 day', $8)`,
    [user.userId, sessions.live, sessions.expired, sessions.revoked, randomBytes(32), randomBytes(32), randomBytes(32), NOON],
  );
  const codes = { live: randomUUID(), expired: randomUUID() };
  await db.admin.query(
    `INSERT INTO reset_codes (id, user_id, code_hash, expires_at) VALUES
       ($2, $1, $4, $6::timestamptz + interval '5 minutes'), ($3, $1, $5, $6::timestamptz - interval '1 second')`,
    [user.userId, codes.live, codes.expired, randomBytes(32), randomBytes(32), NOON],
  );
  const tag = randomUUID().slice(0, 8);
  await db.admin.query(
    `INSERT INTO auth_throttle (key, window_start, count) VALUES
       ($1, $4::timestamptz - interval '61 minutes', 3), ($2, $4::timestamptz - interval '30 minutes', 3),
       ($3, '2000-01-01', 3)`,
    [`login:old-${tag}@example.com`, `login:new-${tag}@example.com`, 'login:decoy-1@decoy.invalid', NOON],
  );
  const decoysBefore = await decoyRows(db.admin);
  assert.ok((await job('job_purge_auth', new Date(NOON))) >= 4);
  const left = await db.admin.query(
    `SELECT (SELECT array_agg(id ORDER BY id) FROM sessions WHERE user_id = $1 AND id = ANY($2)) AS sessions,
            (SELECT array_agg(id ORDER BY id) FROM reset_codes WHERE user_id = $1) AS codes,
            (SELECT array_agg(key ORDER BY key) FROM auth_throttle WHERE key LIKE $3 OR key LIKE '%decoy%') AS throttle`,
    [user.userId, Object.values(sessions), `%${tag}%`],
  );
  assert.deepEqual(left.rows[0], {
    sessions: [sessions.live],
    codes: [codes.live],
    throttle: ['login:decoy-1@decoy.invalid', `login:new-${tag}@example.com`],
  });
  assert.deepEqual(await decoyRows(db.admin), decoysBefore);
});

test('the account purge takes at most 50 accounts per statement (the statement timeout); the job calls it until none is due', async () => {
  const tag = randomUUID().slice(0, 8);
  const { rows } = await db.admin.query<{ id: string }>(
    `INSERT INTO users (email, display_name, terms_accepted_at, deleted_at, purge_after)
     SELECT 'cap' || g || '-' || $2 || '@example.com', 'Đi', $1, $1, $1 FROM generate_series(1, 101) g RETURNING id`,
    [NOON, tag],
  );
  assert.equal(await job('job_account_purge', new Date(NOON)), 50);
  const result = await runJob('housekeeping', db.app, new Date(NOON), quiet);
  assert.equal(result.accounts, 51);
  const left = await db.admin.query('SELECT 1 FROM users WHERE id = ANY($1)', [rows.map(r => r.id)]);
  assert.equal(left.rowCount, 0);
});

test('the three purges run apart: one that fails leaves the other two to run and commit; the run is recorded failed', async () => {
  const user = await newOnboardedUser(db);
  const key = randomUUID();
  await db.admin.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash, status, response, created_at)
     VALUES ($1, $2, $3, 200, '{}', $4::timestamptz - interval '8 days')`,
    [user.userId, key, randomBytes(32), NOON],
  );
  const session = randomUUID();
  await db.admin.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at) VALUES ($2, $1, $3, $4::timestamptz + interval '1 day', $4)",
    [user.userId, session, randomBytes(32), NOON],
  );
  // one frozen clock: the runs of earlier tests share ran_at and created_at with this one
  await db.admin.query("DELETE FROM job_runs WHERE job = 'housekeeping'");
  // the first purge fails (its function is gone for the length of the run)
  await db.admin.query('ALTER FUNCTION job_account_purge(timestamptz) RENAME TO job_account_purge_off');
  try {
    await assert.rejects(runJob('housekeeping', db.app, new Date(NOON), quiet));
  } finally {
    await db.admin.query('ALTER FUNCTION job_account_purge_off(timestamptz) RENAME TO job_account_purge');
  }
  const { rows } = await db.admin.query(
    `SELECT (SELECT count(*)::int FROM idempotency_keys WHERE key = $1) AS keys,
            (SELECT count(*)::int FROM sessions WHERE id = $2) AS sessions,
            (SELECT ok FROM job_runs WHERE job = 'housekeeping' ORDER BY ran_at DESC, created_at DESC LIMIT 1) AS ok`,
    [key, session],
  );
  assert.deepEqual(rows[0], { keys: 0, sessions: 0, ok: false });
});

test('the job: due once a day from 04:00 Asia/Ho_Chi_Minh; a run reports its counts in job_runs', async () => {
  const four = Date.parse('2027-03-10T21:00:00.000Z'); // 2027-03-11 04:00 ICT
  assert.equal(housekeeping.due(new Date(four - 1), new Date(four - DAY_MS)), false);
  assert.equal(housekeeping.due(new Date(four), new Date(four - DAY_MS)), true);
  assert.equal(housekeeping.due(new Date(four + 3_600_000), new Date(four)), false);
  assert.equal(housekeeping.due(new Date(four), null), true);

  // one frozen clock: the runs of earlier tests share ran_at and created_at with this one
  await db.admin.query("DELETE FROM job_runs WHERE job = 'housekeeping'");
  const result = await runJob('housekeeping', db.app, new Date(NOON), quiet);
  assert.deepEqual(Object.keys(result).sort(), ['accounts', 'authRows', 'idempotencyKeys']);
  const { rows } = await db.admin.query(
    "SELECT ok, detail FROM job_runs WHERE job = 'housekeeping' ORDER BY ran_at DESC, created_at DESC LIMIT 1",
  );
  assert.deepEqual(rows, [{ ok: true, detail: result }]);
  // the decoys are there to be found
  const { rows: decoys } = await db.admin.query('SELECT count(*)::int AS n FROM users WHERE id = ANY($1)', [[DECOY_1, DECOY_2]]);
  assert.equal(decoys[0].n, 2);
});
