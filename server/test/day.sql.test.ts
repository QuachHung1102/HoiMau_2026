// 30-day.sql at the SQL level: the seeded quests, the logical date a write lands on, the
// internal helpers (called through the owner connection, as no request role can), the answer of
// a repeated tick, and the locks the three functions take: which, in what mode, in what order.
// The functions a client calls are called through app_conn with the real role switch.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { logicalDateOf } from '../../domain/logicalDate.ts';
import { QUESTS } from '../content/quests.ts';
import { SUPERUSER, TEST } from '../scripts/cluster.ts';
import { seed as seedQuests } from '../src/seed/quests.ts';
import { asUser, expectPgError, setTestClock } from './helpers.ts';
import { newOnboardedUser, newUser } from './http.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
/** The owner again, with room for a transaction that holds a lock and one that probes it. */
let wide: pg.Pool;
before(async () => {
  db = await createTestDb();
  wide = new pg.Pool({ host: '127.0.0.1', port: TEST.port, ...SUPERUSER, database: db.name, max: 4 });
});
after(async () => {
  await setTestClock(db.admin, null);
  await wide.end();
  await db.drop();
});

const HM = 'HM000';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const LOCKED = '55P03';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh
const clock = (at: string) => setTestClock(db.admin, at);
const iso = (ms: number) => new Date(ms).toISOString();

const tick = (userId: string, code: string, id: string = randomUUID(), occurredAt: string | null = null) =>
  asUser(db.app, userId, async c => {
    const { rows } = await c.query('SELECT quest_tick($1, $2, $3) AS result', [code, id, occurredAt]);
    return rows[0].result as Record<string, unknown>;
  });
const rowsOf = async (userId: string) =>
  (
    await db.admin.query(
      `SELECT (SELECT count(*)::int FROM daily_logs WHERE user_id = $1) AS logs,
              (SELECT count(*)::int FROM quest_ticks WHERE user_id = $1) AS ticks,
              (SELECT coalesce(sum(progress), 0)::int FROM quest_completions WHERE user_id = $1) AS progress,
              (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows,
              (SELECT count(*)::int FROM coin_ledger WHERE user_id = $1) AS coin_rows`,
      [userId],
    )
  ).rows[0];

// ---------------------------------------------------------------- content

test('the quests are those of the content file, in its order; the seeder rewrites no row and puts a drifted one back', async () => {
  const content = async () =>
    (await db.admin.query('SELECT xmin::text AS x, to_jsonb(q) AS row FROM quests q ORDER BY position')).rows;
  const seeded = await content();
  assert.deepEqual(
    seeded.map(({ row }) => ({
      code: row.code,
      titleKey: row.title_key,
      category: row.category,
      targetCount: row.target_count,
      xpReward: row.xp_reward,
      coinReward: row.coin_reward,
      archetypes: row.archetypes,
      isActive: row.is_active,
    })),
    QUESTS,
  );
  for (let run = 0; run < 2; run++) {
    await seedQuests(db.admin as unknown as pg.ClientBase);
    assert.deepEqual(await content(), seeded);
  }
  await db.admin.query("UPDATE quests SET xp_reward = 999, position = 9, archetypes = '{TANKER}' WHERE code = 'WATER_8'");
  await seedQuests(db.admin as unknown as pg.ClientBase);
  assert.deepEqual(
    (await content()).map(({ row }) => row),
    seeded.map(({ row }) => row),
  );
});

// ---------------------------------------------------------------- the day a write lands on

test('app._open_log labels the row with the date logicalDateOf gives the instant, in every zone of the grid', async () => {
  await clock('2025-01-01T00:00:00.000Z');
  const { userId } = await newOnboardedUser(db);
  const every = (from: string, hours: number, stepMs = 30 * MINUTE) =>
    Array.from({ length: (hours * HOUR) / stepMs }, (_, i) => iso(Date.parse(from) + i * stepMs));
  const grid: [string, string[]][] = [
    ['Asia/Ho_Chi_Minh', every('2026-06-01T00:00:00.000Z', 26)],
    // both DST changes of 2026, a day either side
    ['America/New_York', every('2026-03-07T12:00:00.000Z', 48)],
    ['America/New_York', every('2026-10-31T12:00:00.000Z', 48)],
    // the two ends of the date line
    ['Pacific/Kiritimati', every('2026-06-01T00:00:00.000Z', 26)],
    ['Pacific/Pago_Pago', every('2026-06-01T00:00:00.000Z', 26)],
    // 03:00 local comes twice (25 October) and not at all (29 March)
    ['Europe/Athens', every('2026-10-24T12:00:00.000Z', 36)],
    ['Europe/Athens', every('2026-03-28T12:00:00.000Z', 36)],
    ['UTC', every('2026-06-01T00:00:00.000Z', 26)],
  ];
  const mismatches: string[] = [];
  let compared = 0;
  for (const [zone, instants] of grid) {
    await db.admin.query('UPDATE users SET timezone = $2 WHERE id = $1', [userId, zone]);
    for (const [i, at] of instants.entries()) {
      // the instant as "now", and as the occurredAt of a write that arrives up to 47 hours later
      const late = i % 3 === 0 ? 0 : (i % 47) * HOUR;
      await clock(iso(Date.parse(at) + late));
      const { rows } = await db.admin.query(
        'SELECT (app._open_log($1, $2)).logical_date::text AS label',
        [userId, late === 0 ? null : at],
      );
      compared++;
      const expected = logicalDateOf(Date.parse(at), zone);
      if (rows[0].label !== expected) {
        mismatches.push(`${zone} ${at}: sql ${rows[0].label}, domain ${expected}`);
      }
    }
  }
  assert.equal(compared, grid.reduce((sum, [, instants]) => sum + instants.length, 0));
  assert.deepEqual(mismatches.slice(0, 5), []);
  // one row per date, however many writes landed on it
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS logs, count(DISTINCT logical_date)::int AS dates FROM daily_logs WHERE user_id = $1',
    [userId],
  );
  assert.equal(rows[0].logs, rows[0].dates);
  assert.ok(rows[0].dates > 10);
});

test('app._open_log and the three functions refuse a caller who is not an onboarded user', async () => {
  await clock(NOON);
  const fresh = await newUser(db);
  await expectPgError(db.admin.query('SELECT app._open_log($1, NULL)', [fresh.userId]), {
    code: HM,
    messagePrefix: 'ONBOARDING_REQUIRED',
  });
  await expectPgError(db.admin.query('SELECT app._open_log($1, NULL)', [randomUUID()]), {
    code: HM,
    messagePrefix: 'ONBOARDING_REQUIRED',
  });
  for (const [sql, params] of [
    ['SELECT quest_tick($1, $2, NULL)', ['WATER_8', randomUUID()]],
    ['SELECT quest_undo($1, $2)', ['WATER_8', randomUUID()]],
    ['SELECT day_bedtime($1, NULL)', [randomUUID()]],
  ] as const) {
    await expectPgError(
      asUser(db.app, fresh.userId, c => c.query(sql, [...params])),
      { code: HM, messagePrefix: 'ONBOARDING_REQUIRED' },
    );
  }
  assert.deepEqual(await rowsOf(fresh.userId), { logs: 0, ticks: 0, progress: 0, xp_rows: 0, coin_rows: 0 });
});

// ---------------------------------------------------------------- quest_tick

test('quest_tick answers the grant, its ledger key and the progress; a repeat of the same id is a no-op that answers the state', async () => {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  const id = randomUUID();
  const first = await tick(userId, 'WATER_8', id);
  assert.deepEqual(first, {
    xpBefore: 0, xpAfter: 10, coinBefore: 0, coinAfter: 5, highWaterBefore: 0, highWaterAfter: 10, applied: true,
    reason: 'QUEST_TICK', ref: id, logicalDate: '2027-03-10', progress: 1, completed: false,
  });
  const once = { logs: 1, ticks: 1, progress: 1, xp_rows: 1, coin_rows: 1 };
  assert.deepEqual(await rowsOf(userId), once);

  const noop = { ...first, xpBefore: 10, coinBefore: 5, highWaterBefore: 10, applied: false };
  assert.deepEqual(await tick(userId, 'WATER_8', id), noop);
  // whatever the repeat says about the quest or the instant: the tick is there, nothing is judged
  assert.deepEqual(await tick(userId, 'STAND_UP', id), noop);
  assert.deepEqual(await tick(userId, 'NO_SUCH_QUEST', id, '2000-01-01T00:00:00Z'), noop);
  assert.deepEqual(await rowsOf(userId), once);

  await expectPgError(tick(other.userId, 'WATER_8', id), { code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED' });
  assert.deepEqual(await rowsOf(other.userId), { logs: 0, ticks: 0, progress: 0, xp_rows: 0, coin_rows: 0 });
  assert.deepEqual(await rowsOf(userId), once);

  // the repeat of the tick that completed the quest is no QUEST_ALREADY_COMPLETE, on a day that
  // has been closed since no DAY_CLOSED
  let last = '';
  for (let i = 2; i <= 8; i++) {
    last = randomUUID();
    await tick(userId, 'WATER_8', last);
  }
  await db.admin.query("UPDATE progression_state SET last_closed_date = '2027-03-10' WHERE user_id = $1", [userId]);
  const repeated = await tick(userId, 'WATER_8', last);
  assert.deepEqual(
    [repeated.applied, repeated.progress, repeated.completed, repeated.logicalDate],
    [false, 8, true, '2027-03-10'],
  );
  await expectPgError(tick(userId, 'WATER_8'), { code: HM, messagePrefix: 'DAY_CLOSED' });
});

// ---------------------------------------------------------------- app._story_check

test('app._story_check sets story_completed when the last STORY quest is done, and says so once', async () => {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  await tick(userId, 'WATER_8');
  const log = (await db.admin.query('SELECT id FROM daily_logs WHERE user_id = $1', [userId])).rows[0].id;
  const check = async (id: string) =>
    (await db.admin.query('SELECT app._story_check($1) AS done', [id])).rows[0].done;
  const complete = (code: string) =>
    db.admin.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
       SELECT $1, $2, q.id, 1, app.now() FROM quests q WHERE q.code = $3`,
      [userId, log, code],
    );
  const flag = async () =>
    (await db.admin.query('SELECT story_completed FROM daily_logs WHERE id = $1', [log])).rows[0].story_completed;

  assert.equal(await check(log), false);
  await complete('WORKOUT_MAIN');
  assert.equal(await check(log), false);
  assert.equal(await flag(), false);
  await complete('NUTRITION_TARGET');
  assert.equal(await check(log), true);
  assert.equal(await flag(), true);
  assert.equal(await check(log), false);
  assert.equal(await check(randomUUID()), false);

  // a quest that is not of the user's archetype does not count, and no STORY quest at all is not "all done"
  const second = await newOnboardedUser(db);
  await tick(second.userId, 'WATER_8');
  const other = (await db.admin.query('SELECT id FROM daily_logs WHERE user_id = $1', [second.userId])).rows[0].id;
  const holder = await wide.connect();
  try {
    await holder.query('BEGIN');
    await holder.query("UPDATE quests SET archetypes = '{TANKER}' WHERE category = 'STORY'");
    assert.equal((await holder.query('SELECT app._story_check($1) AS done', [other])).rows[0].done, false);
    await holder.query("UPDATE quests SET archetypes = '{TANKER,SUPPORTER}' WHERE code = 'WORKOUT_MAIN'");
    await holder.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
       SELECT $1, $2, q.id, 1, app.now() FROM quests q WHERE q.code = 'WORKOUT_MAIN'`,
      [second.userId, other],
    );
    assert.equal((await holder.query('SELECT app._story_check($1) AS done', [other])).rows[0].done, true);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
});

// ---------------------------------------------------------------- constraints

test('one log per user and date, one progress row per log and quest, and a child row cannot name another user than its log', async () => {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  await tick(userId, 'WATER_8');
  const log = (await db.admin.query('SELECT id FROM daily_logs WHERE user_id = $1', [userId])).rows[0].id;
  await expectPgError(
    db.admin.query("INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, '2027-03-10')", [userId]),
    { code: UNIQUE, messagePrefix: 'duplicate key value violates unique constraint "daily_logs_user_date_key"' },
  );
  await expectPgError(
    db.admin.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id)
       SELECT $1, $2, id FROM quests WHERE code = 'WATER_8'`,
      [userId, log],
    ),
    { code: UNIQUE, messagePrefix: 'duplicate key value violates unique constraint "quest_completions_log_quest_key"' },
  );
  await expectPgError(
    db.admin.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id)
       SELECT $1, $2, id FROM quests WHERE code = 'STAND_UP'`,
      [other.userId, log],
    ),
    { code: FOREIGN_KEY, messagePrefix: 'insert or update on table "quest_completions" violates foreign key constraint "quest_completions_log_user_fkey"' },
  );
  await expectPgError(
    db.admin.query(
      `INSERT INTO quest_ticks (id, user_id, daily_log_id, quest_id, occurred_at)
       SELECT gen_random_uuid(), $1, $2, id, app.now() FROM quests WHERE code = 'STAND_UP'`,
      [other.userId, log],
    ),
    { code: FOREIGN_KEY, messagePrefix: 'insert or update on table "quest_ticks" violates foreign key constraint "quest_ticks_log_user_fkey"' },
  );
});

// ---------------------------------------------------------------- locks
//
// Each of the three functions takes the caller's users row, then the daily log, then the
// progress row, then progression_state, and the first three FOR NO KEY UPDATE: a mode that
// leaves room for the key-share lock of a foreign key (every idempotent request holds one on
// its users row). The two tests below are the proof that needs no luck: no race decides them.

type Probe = { table: string; where: string };
const PROBES: Probe[] = [
  { table: 'users', where: 'id = $1' },
  { table: 'daily_logs', where: 'user_id = $1' },
  { table: 'quest_completions', where: 'user_id = $1' },
  { table: 'progression_state', where: 'user_id = $1' },
];

/** Tries to lock the user's rows of a table in `mode` without waiting: 'free', or 'held'. */
async function probe(client: pg.PoolClient, { table, where }: Probe, userId: string, mode: string) {
  await client.query('BEGIN');
  try {
    const found = await client.query(`SELECT 1 FROM ${table} WHERE ${where} FOR ${mode} NOWAIT`, [userId]);
    assert.ok((found.rowCount ?? 0) > 0, `no row of ${table} to lock`);
    return 'free';
  } catch (thrown) {
    assert.equal((thrown as { code?: string }).code, LOCKED, String(thrown));
    return 'held';
  } finally {
    await client.query('ROLLBACK');
  }
}

/** A user with a committed day: a log, a progress row of WATER_8 and of the hidden quest, a live tick. */
async function playerWithDay() {
  await clock('2027-03-10T13:00:00.000Z'); // 20:00 local: bedtime is accepted and rewarded
  const { userId } = await newOnboardedUser(db);
  const live = randomUUID();
  await tick(userId, 'WATER_8', live);
  await asUser(db.app, userId, c => c.query('SELECT day_bedtime($1, NULL)', [randomUUID()]));
  // the undo first: where the calls are committed, a tick after it would make `live` not the latest
  const calls: [name: string, sql: string, params: unknown[]][] = [
    ['quest_undo', 'SELECT quest_undo($1, $2)', ['WATER_8', live]],
    ['quest_tick', 'SELECT quest_tick($1, $2, NULL)', ['WATER_8', randomUUID()]],
    ['day_bedtime', 'SELECT day_bedtime($1, NULL)', [randomUUID()]],
  ];
  return { userId, calls };
}

test('while a write is in flight its rows stay open to a key-share lock, and shut to another writer', async () => {
  const { userId, calls } = await playerWithDay();
  const prober = await wide.connect();
  try {
    for (const [name, sql, params] of calls) {
      await asUser(db.app, userId, async c => {
        await c.query(sql, params);
        const seen: Record<string, string[]> = {};
        for (const target of PROBES) {
          seen[target.table] = [
            await probe(prober, target, userId, 'KEY SHARE'),
            await probe(prober, target, userId, 'NO KEY UPDATE'),
          ];
        }
        assert.deepEqual(
          seen,
          {
            users: ['free', 'held'],
            daily_logs: ['free', 'held'],
            quest_completions: ['free', 'held'],
            // nothing references this table, so app._grant may take it FOR UPDATE
            progression_state: ['held', 'held'],
          },
          name,
        );
      });
    }
  } finally {
    prober.release();
  }
});

test('the lock order is users, daily log, progress row, progression state: a write that waits for one holds none of the later ones', async () => {
  const { userId, calls } = await playerWithDay();
  const holder = await wide.connect();
  const prober = await wide.connect();
  try {
    for (const [name, sql, params] of calls) {
      for (let stage = 0; stage < PROBES.length - 1; stage++) {
        const label = `${name} behind ${PROBES[stage].table}`;
        await holder.query('BEGIN');
        const held = await holder.query(
          `SELECT 1 FROM ${PROBES[stage].table} WHERE ${PROBES[stage].where} FOR NO KEY UPDATE`,
          [userId],
        );
        assert.ok((held.rowCount ?? 0) > 0, label);
        let settled = false;
        // rolled back when it is through, so that every stage starts from the same day
        const waiting = asUser(db.app, userId, async c => {
          await c.query(sql, params);
          throw new Error('rolled back on purpose');
        }).catch((thrown: Error) => {
          settled = true;
          assert.equal(thrown.message, 'rolled back on purpose', label);
        });
        try {
          // it is waiting for the lock, not finished and not somewhere else
          for (let tries = 0; ; tries++) {
            const { rows } = await prober.query(
              `SELECT count(*)::int AS waiting FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock' AND query = $1`,
              [sql],
            );
            if (rows[0].waiting === 1) {
              break;
            }
            assert.ok(!settled && tries < 500, `${label}: the call did not wait`);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          for (const later of PROBES.slice(stage + 1)) {
            assert.equal(
              await probe(prober, later, userId, 'NO KEY UPDATE'),
              'free',
              `${label}: it already holds ${later.table}`,
            );
          }
        } finally {
          await holder.query('ROLLBACK');
          await waiting;
        }
      }
    }
  } finally {
    holder.release();
    prober.release();
  }
});
