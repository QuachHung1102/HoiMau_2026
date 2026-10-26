// npm run server:perf: NFR-01 measured, not assumed. A cloned database is loaded as the owner with
// 2 000 onboarded users, 300 guilds and 30 days of history per user; then six endpoints are called
// 200 times each over real HTTP (the real app, the app_conn pool) and p50 / p95 / max are printed.
// A p95 at or above 300 ms (500 ms for the leaderboard) fails the run. When it does, the cause is
// an index or a query in server/sql, never the limit. One day-close over all users and one
// weekly-rollover are timed and printed, with no limit.
//
// The load goes in through `admin` and bypasses the functions on purpose: it is a data set, not
// a flow (the flows have their own tests). ANALYZE follows it: a database that has been in use
// has its statistics, and autovacuum would have made them long before the first real user.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import { weekInputs } from '../src/leaderboardCache.ts';
import { createLogger } from '../src/log.ts';
import { runJob } from '../src/jobs/scheduler.ts';
import { setTestClock } from '../test/helpers.ts';
import { startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';

const USERS = 2000;
const GUILDS = 300;
const DAYS = 30;
const CALLS = 200;
/** Users 1 .. MEMBERS are in a guild (3 to 8 per guild, 5.5 on average); the rest are not. */
const MEMBERS = Array.from({ length: GUILDS }, (_, i) => 3 + ((i + 1) % 6)).reduce((a, b) => a + b);
/** The p95 limits of NFR-01, in milliseconds. */
const LIMIT_MS = 300;
const LEADERBOARD_LIMIT_MS = 500;

const tokenOf = (n: number) => createHash('sha256').update(`perf-token-${n}`).digest('base64url');

// The users of the load, all registered and onboarded DAYS days ago. n = 1 .. USERS. Archetype
// by n % 3; one user in ten lives in New York, one in ten in Paris, the rest in Ho Chi Minh City.
const LOAD: [string, string][] = [
  [
    'users',
    `CREATE TEMP TABLE pu AS
     SELECT s.n, gen_random_uuid() AS id, s.tz, (ARRAY['TANKER','ASSASSIN','SUPPORTER'])[s.n % 3 + 1] AS archetype,
            app.logical_date(app.now(), s.tz) AS today
       FROM (SELECT n, CASE n % 10 WHEN 0 THEN 'America/New_York' WHEN 1 THEN 'Europe/Paris'
                                   ELSE 'Asia/Ho_Chi_Minh' END AS tz
               FROM generate_series(1, ${USERS}) n) s;
     ALTER TABLE pu ADD PRIMARY KEY (n);
     INSERT INTO users (id, email, display_name, timezone, archetype, archetype_set_at, onboarded_at,
                        terms_accepted_at, created_at)
     SELECT id, 'perf' || n || '@example.com', 'Nguoi thu ' || n, tz, archetype,
            app.now() - interval '${DAYS} days', app.now() - interval '${DAYS} days',
            app.now() - interval '${DAYS + 1} days', app.now() - interval '${DAYS + 1} days'
       FROM pu;`,
  ],
  [
    'sessions',
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     SELECT id, sha256(convert_to(translate(encode(sha256(convert_to('perf-token-' || n, 'UTF8')), 'base64'), '+/=', '-_'), 'UTF8')),
            app.now() + interval '30 days'
       FROM pu`,
  ],
  [
    'profile',
    `INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level, recorded_at)
     SELECT id, 150 + n % 40, 50 + n % 40, 1980 + n % 25, CASE n % 2 WHEN 0 THEN 'FEMALE' ELSE 'MALE' END,
            'LIGHT', app.now() - interval '${DAYS} days' FROM pu;
     INSERT INTO prescriptions (user_id, bmr, tdee, calorie_target, protein_g, carbs_g, fat_g, water_ml,
                                safety_clamped, macro_adjusted, computed_at)
     SELECT id, 1500, 2100, 1800 + (n % 5) * 50, 90 + n % 30, 220, 60, 2000 + (n % 5) * 100,
            n % 12 = 0, n % 20 = 0, app.now() - interval '${DAYS} days' FROM pu;
     INSERT INTO user_settings (user_id) SELECT id FROM pu;
     INSERT INTO progression_state (user_id, streak_current, streak_best, last_outcome, last_closed_date, onboard_date)
     SELECT id, n % 13, n % 13 + n % 5, 'COMPLETED', today - 2, today - ${DAYS} FROM pu`,
  ],
  [
    'daily_logs',
    // k = 1 is yesterday; today has no log (a fresh day). Dates up to the day before yesterday are closed.
    `INSERT INTO daily_logs (user_id, logical_date, calories_in, water_ml, bedtime_marked_at, closed_at,
                             story_completed, created_at)
     SELECT pu.id, pu.today - k, 1500 + h % 800, 1500 + h % 2000,
            CASE WHEN h % 3 = 0 THEN app.now() - k * interval '1 day' END,
            CASE WHEN k >= 2 THEN app.now() - (k - 1) * interval '1 day' END,
            h % 100 < 70, app.now() - k * interval '1 day'
       FROM pu, generate_series(1, ${DAYS}) k, LATERAL (SELECT abs(hashtext(pu.n || ':' || k)) AS h) x`,
  ],
  [
    'quest_completions',
    `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at, created_at)
     SELECT d.user_id, d.id, q.id, x.progress,
            CASE WHEN x.progress = q.target_count THEN d.created_at + interval '12 hours' END, d.created_at
       FROM daily_logs d
       JOIN pu ON pu.id = d.user_id
       JOIN quests q ON q.is_active AND pu.archetype = ANY (q.archetypes)
       CROSS JOIN LATERAL (SELECT CASE WHEN h % 100 < 60 THEN q.target_count ELSE h % q.target_count END AS progress
                             FROM (SELECT abs(hashtext(d.id::text || q.code)) AS h) hh) x
      WHERE x.progress > 0`,
  ],
  [
    'quest_ticks',
    `INSERT INTO quest_ticks (id, user_id, daily_log_id, quest_id, occurred_at, created_at)
     SELECT gen_random_uuid(), c.user_id, c.daily_log_id, c.quest_id,
            c.created_at + i * interval '1 minute', c.created_at + i * interval '1 minute'
       FROM quest_completions c
       JOIN quests q ON q.id = c.quest_id AND q.category = 'DAILY'
       CROSS JOIN LATERAL generate_series(1, c.progress) i`,
  ],
  [
    'ledgers',
    `INSERT INTO xp_ledger (user_id, amount, reason, ref_id, created_at)
     SELECT c.user_id, q.xp_reward, 'QUEST', c.id::text, c.completed_at
       FROM quest_completions c JOIN quests q ON q.id = c.quest_id
      WHERE c.completed_at IS NOT NULL AND q.xp_reward > 0;
     INSERT INTO coin_ledger (user_id, amount, reason, ref_id, created_at)
     SELECT c.user_id, q.coin_reward, 'QUEST', c.id::text, c.completed_at
       FROM quest_completions c JOIN quests q ON q.id = c.quest_id
      WHERE c.completed_at IS NOT NULL AND q.coin_reward > 0;
     UPDATE progression_state s
        SET xp_high_water = coalesce((SELECT sum(amount) FROM xp_ledger l WHERE l.user_id = s.user_id), 0)`,
  ],
  [
    'nutrition_logs',
    `INSERT INTO nutrition_logs (id, user_id, daily_log_id, label, kcal, occurred_at, created_at)
     SELECT gen_random_uuid(), d.user_id, d.id, 'Bua ' || m, 300 + abs(hashtext(d.id::text || m)) % 400,
            d.created_at + m * interval '4 hours', d.created_at + m * interval '4 hours'
       FROM daily_logs d, generate_series(1, 3) m`,
  ],
  [
    'workout_sessions',
    `INSERT INTO workout_sessions (id, user_id, daily_log_id, exercise_item_id, modality, duration_sec,
                                   elapsed_sec, completed, xp_awarded, occurred_at, created_at)
     SELECT gen_random_uuid(), d.user_id, d.id, ei.id, ei.modality, ei.duration_sec, ei.duration_sec, true, 20,
            d.created_at + interval '6 hours', d.created_at + interval '6 hours'
       FROM daily_logs d
       JOIN pu ON pu.id = d.user_id
       JOIN (SELECT id, modality, duration_sec, row_number() OVER (ORDER BY code) - 1 AS rn, count(*) OVER () AS cnt
               FROM exercise_items) ei
         ON ei.rn = (pu.n + extract(day FROM d.logical_date)::int) % ei.cnt`,
  ],
  [
    'inbox',
    `INSERT INTO notifications (user_id, kind, payload, dedupe_key, read_at, created_at)
     SELECT pu.id, (ARRAY['NUDGE','STREAK_MILESTONE','PET_TIRED','GUILD_WEEKLY_RESULT','QUEST_REMINDER'])[i],
            CASE WHEN i = 2 THEN '{"days":7,"coins":30,"badgeCode":"BADGE_STREAK_7"}'::jsonb ELSE '{}'::jsonb END,
            'perf-' || i, CASE WHEN i <= 2 THEN app.now() END, app.now() - i * interval '1 hour'
       FROM pu, generate_series(1, 5) i;
     INSERT INTO freeze_tickets (user_id, grant_week)
     SELECT id, date_trunc('week', today)::date FROM pu`,
  ],
  [
    'guilds',
    `CREATE TEMP TABLE pgl AS
     SELECT g, 3 + g % 6 AS size, sum(3 + g % 6) OVER (ORDER BY g) - (3 + g % 6) AS base, gen_random_uuid() AS id
       FROM generate_series(1, ${GUILDS}) g;
     INSERT INTO guilds (id, name, invite_code) SELECT id, 'Team perf ' || g, upper(substr(md5(g::text), 1, 8)) FROM pgl;
     INSERT INTO guild_memberships (user_id, guild_id, role, joined_at)
     SELECT pu.id, pgl.id, CASE i WHEN 1 THEN 'LEADER' ELSE 'MEMBER' END, app.now() - interval '${DAYS} days'
       FROM pgl CROSS JOIN LATERAL generate_series(1, pgl.size) i JOIN pu ON pu.n = pgl.base + i`,
  ],
];

const TABLES = [
  'users', 'sessions', 'biometric_snapshots', 'prescriptions', 'progression_state', 'daily_logs',
  'quest_completions', 'quest_ticks', 'xp_ledger', 'coin_ledger', 'nutrition_logs', 'workout_sessions',
  'notifications', 'guilds', 'guild_memberships',
];

let db: TestDb;
let app: TestApp;
const report: string[] = [];
const say = (line = '') => {
  report.push(line);
};

// The whole run happens at one frozen instant, as in every other server test, so that no clock can
// cross 03:00 of a zone or Monday 00:00 in Ho Chi Minh City between the load and the last
// measurement. Wednesday 2027-03-10 10:00 UTC is 17:00 in Ho Chi Minh City, 11:00 in Paris and
// 05:00 in New York (standard time until 14 March): midday-ish everywhere, so every user's
// "today" is the 10th (the 9th is the last logical day with a log) and the closed weeks are the
// four Mondays 2027-02-08, 02-15, 02-22 and 03-01.
const NOW = '2027-03-10T10:00:00.000Z';

before(async () => {
  db = await createTestDb();
  await setTestClock(db.admin, NOW);
  app = await startTestApp(db);
});
after(async () => {
  await app.close();
  await db.drop();
  // one write at the end: the runner prints the output of a test file when it ends
  process.stdout.write(`${report.join('\n')}\n`);
});

const ms = (value: number) => value.toFixed(1).padStart(7);
function percentile(sorted: number[], p: number): number {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

async function machine(client: PoolClient): Promise<string> {
  const cpus = os.cpus();
  const { rows } = await client.query<{ server_version: string }>('SHOW server_version');
  const pkg = JSON.parse(
    await readFile(new URL('../node_modules/embedded-postgres/package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return (
    `${cpus[0]?.model.trim() ?? 'unknown CPU'} (${cpus.length} threads), ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB RAM, ` +
    `${os.type()} ${os.release()}, Node ${process.version}, PostgreSQL ${rows[0].server_version} (embedded-postgres ${pkg.version})`
  );
}

test('the data set is loaded', async () => {
  const client = await db.admin.connect();
  try {
    const count = async (table: string) =>
      Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    // the schema ships permanent decoy rows (the second gate's); the load is what is added to them
    const baseline = new Map<string, number>();
    for (const table of TABLES) {
      baseline.set(table, await count(table));
    }
    const started = performance.now();
    for (const [name, sql] of LOAD) {
      const at = performance.now();
      await client.query(sql);
      say(`  load ${name.padEnd(18)} ${((performance.now() - at) / 1000).toFixed(1).padStart(6)} s`);
    }
    await client.query('ANALYZE');
    say(`  load total ${((performance.now() - started) / 1000).toFixed(1)} s (with ANALYZE)`);
    say();
    say('Row counts measured after the load (added by the load / in the table):');
    const added = new Map<string, number>();
    for (const table of TABLES) {
      const total = await count(table);
      added.set(table, total - (baseline.get(table) as number));
      say(`  ${table.padEnd(22)} ${String(added.get(table)).padStart(9)} ${String(total).padStart(9)}`);
    }
    say();
    // the load is what the brief says it is
    assert.equal(added.get('users'), USERS);
    assert.equal(added.get('guilds'), GUILDS);
    assert.equal(added.get('guild_memberships'), MEMBERS);
    assert.equal(added.get('daily_logs'), USERS * DAYS);
    for (const table of ['quest_completions', 'quest_ticks', 'nutrition_logs', 'workout_sessions']) {
      assert.ok((added.get(table) as number) >= USERS * DAYS, `${table}: at least a row per user-day`);
    }
  } finally {
    client.release();
  }
});

type Row = { name: string; limit: number; times: number[]; warm: number };
const rows: Row[] = [];

async function measure(name: string, limit: number, call: (i: number) => ReturnType<TestApp['call']>) {
  const warmStart = performance.now();
  const first = await call(-1); // the warm-up: the first request of the endpoint in this process
  const warm = performance.now() - warmStart;
  assert.equal(first.status, 200, `${name} warm-up: ${JSON.stringify(first.body)}`);
  const times: number[] = [];
  for (let i = 0; i < CALLS; i++) {
    const started = performance.now();
    const result = await call(i);
    times.push(performance.now() - started);
    assert.equal(result.status, 200, `${name} #${i}: ${JSON.stringify(result.body)}`);
  }
  rows.push({ name, limit, times, warm });
}

// GET calls rotate over CALLS different guild members (7 and MEMBERS share no factor), so a
// request meets a user whose rows the previous one did not touch.
const member = (i: number) => 1 + ((Math.max(i, 0) * 7 + 3) % MEMBERS);
const get = (path: string) => (i: number) => app.call('GET', path, { token: tokenOf(member(i)) });

test('endpoints: 200 sequential calls each', async () => {
  await measure('GET /day', LIMIT_MS, get('/day'));
  // fresh users without a log of today (users MEMBERS+1 ... never in a guild): WATER_8 has 8 steps, one tick each
  const fresh = (i: number) => MEMBERS + 2 + i;
  await measure('POST /day/quests/WATER_8/progress', LIMIT_MS, i =>
    app.call('POST', '/day/quests/WATER_8/progress', {
      token: tokenOf(fresh(i)),
      key: randomUUID(),
      body: {},
    }),
  );
  await measure('GET /me', LIMIT_MS, get('/me'));
  await measure('GET /nutrition/plan', LIMIT_MS, get('/nutrition/plan'));
  await measure('GET /guilds/me', LIMIT_MS, get('/guilds/me'));
  // The leaderboard is served from the in-process cache: the warm-up computes the board
  // once and the 200 requests after it read it from memory. The limit alone would not show it:
  // computing the board takes a fraction of 500 ms at this size.
  let reads = 0;
  const read = weekInputs.read;
  weekInputs.read = (...args) => {
    reads++;
    return read.apply(weekInputs, args);
  };
  try {
    await measure('GET /leaderboard?week=current', LEADERBOARD_LIMIT_MS, get('/leaderboard?week=current'));
  } finally {
    weekInputs.read = read;
  }
  assert.equal(reads, 1, 'the board was computed once (the warm-up); the 200 requests came from the cache');
});

test('jobs: one day-close over every user, one weekly-rollover', async () => {
  const lines: string[] = [];
  const log = createLogger(line => lines.push(line));
  const now = new Date(NOW);
  const ledgerRows = async () =>
    Number((await db.admin.query('SELECT (SELECT count(*) FROM xp_ledger) + (SELECT count(*) FROM coin_ledger) AS n')).rows[0].n);
  const rowsBefore = await ledgerRows();
  let at = performance.now();
  const dayClose = await runJob('day-close', db.app, now, log);
  const dayCloseMs = performance.now() - at;
  at = performance.now();
  const rollover = await runJob('weekly-rollover', db.app, now, log);
  const rolloverMs = performance.now() - at;

  say('Jobs (no limit; reported):');
  say(`  day-close         ${(dayCloseMs / 1000).toFixed(2).padStart(7)} s  ${JSON.stringify(dayClose)}`);
  say(`  weekly-rollover   ${(rolloverMs / 1000).toFixed(2).padStart(7)} s  ${JSON.stringify(rollover)}`);
  const ledgerLines = lines.filter(l => l.includes('"evt":"ledger"')).length;
  const created = (await ledgerRows()) - rowsBefore;
  say(`  ledger rows created by the two runs: ${created}; ledger log lines: ${ledgerLines}`);
  say();
  assert.equal(dayClose.users, USERS, 'every user had a day to close');
  assert.equal(dayClose.failed, 0);
  assert.equal(dayClose.applied, USERS);
  assert.equal(ledgerLines, created, 'one ledger line per ledger row the jobs wrote');
  // the clock is frozen, so the weeks are known: the four Mondays before the open week of 8 March
  assert.deepEqual(rollover.applied, ['2027-02-08', '2027-02-15', '2027-02-22', '2027-03-01']);
  assert.equal(rollover.grants, 4 * MEMBERS, 'every member of a ranked guild was paid for each of the four weeks');
});

test('table and verdict', async () => {
  const client = await db.admin.connect();
  let where: string;
  try {
    where = await machine(client);
  } finally {
    client.release();
  }
  say(`Machine: ${where}`);
  say(
    `Data: ${USERS} users, ${GUILDS} guilds (${MEMBERS} members), ${DAYS} days of history per user; ` +
      `${CALLS} sequential calls per endpoint after one warm-up call; GET calls rotate over ${CALLS} different guild members, ` +
      'POST calls use 200 different users without a log of today.',
  );
  say();
  say(`${'endpoint'.padEnd(36)} ${'p50 ms'.padStart(7)} ${'p95 ms'.padStart(7)} ${'max ms'.padStart(7)} ${'warm-up'.padStart(7)}  limit (p95)  verdict`);
  const failures: string[] = [];
  for (const { name, limit, times, warm } of rows) {
    const sorted = [...times].sort((a, b) => a - b);
    const [p50, p95, max] = [percentile(sorted, 0.5), percentile(sorted, 0.95), sorted[sorted.length - 1]];
    const ok = p95 < limit;
    if (!ok) {
      failures.push(`${name}: p95 ${p95.toFixed(1)} ms is not under ${limit} ms`);
    }
    say(`${name.padEnd(36)} ${ms(p50)} ${ms(p95)} ${ms(max)} ${ms(warm)}  < ${limit} ms`.padEnd(83) + (ok ? '  ok' : '  FAIL'));
  }
  say();
  assert.equal(rows.length, 6, 'all six endpoints were measured');
  assert.deepEqual(failures, []);
});
