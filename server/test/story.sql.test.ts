// 31-story.sql at the SQL level: the seeded exercise library, the band of the nutrition latch
// against calorieWindow for every target, the answer of a repeated action id, the constraints,
// and the locks the two functions take: which, in what mode, in what order. The functions a
// client calls are called through app_conn with the real role switch.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { calorieWindow } from '../../domain/energy.ts';
import { MOVES, WORKOUTS } from '../content/exercises.ts';
import { SUPERUSER, TEST } from '../scripts/cluster.ts';
import { seed as seedExercises } from '../src/seed/exercises.ts';
import { asUser, expectPgError, setTestClock } from './helpers.ts';
import { newOnboardedUser } from './http.ts';
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
const CHECK = '23514';
const FOREIGN_KEY = '23503';
const LOCKED = '55P03';
const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh
const clock = (at: string) => setTestClock(db.admin, at);

const itemId = async (code: string) =>
  (await db.admin.query('SELECT id FROM exercise_items WHERE code = $1', [code])).rows[0].id as string;
const meal = (userId: string, kcal: number, id: string = randomUUID(), label: string | null = null) =>
  asUser(db.app, userId, async c =>
    (await c.query('SELECT nutrition_log_manual($1, $2, $3, NULL) AS result', [id, kcal, label])).rows[0]
      .result as Record<string, unknown>,
  );
const session = async (userId: string, code: string, elapsed: number, id: string = randomUUID()) => {
  const item = await itemId(code);
  return asUser(db.app, userId, async c =>
    (await c.query('SELECT workout_complete($1, $2, $3, NULL) AS result', [id, item, elapsed])).rows[0]
      .result as Record<string, unknown>,
  );
};

// ---------------------------------------------------------------- content

test('the exercise library is the content file: one row per move, workout and step; the seeder rewrites no row and puts a drifted one back', async () => {
  const counts = async () =>
    (
      await db.admin.query(
        `SELECT (SELECT count(*)::int FROM exercise_moves) AS moves,
                (SELECT count(*)::int FROM exercise_items) AS workouts,
                (SELECT count(*)::int FROM exercise_item_steps) AS steps`,
      )
    ).rows[0];
  const expected = {
    moves: MOVES.length,
    workouts: WORKOUTS.length,
    steps: WORKOUTS.reduce((sum, workout) => sum + workout.steps.length, 0),
  };
  assert.deepEqual(await counts(), expected);

  const library = async () =>
    (
      await db.admin.query(
        `SELECT (SELECT jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'demoCode', m.demo_code,
                                                     'steps', m.steps, 'caution', m.caution) ORDER BY m.code COLLATE "C")
                   FROM exercise_moves m) AS moves,
                (SELECT jsonb_agg(jsonb_build_object(
                          'code', i.code, 'name', i.name, 'modality', i.modality, 'durationSec', i.duration_sec,
                          'spaceNeeded', i.space_needed, 'equipment', i.equipment, 'metValue', i.met_value,
                          'sets', i.sets, 'archetypes', i.archetypes,
                          'steps', (SELECT jsonb_agg(jsonb_build_object('moveCode', s.move_code, 'phase', s.phase,
                                                                        'seconds', s.seconds, 'repsText', s.reps_text)
                                                     ORDER BY s.position)
                                      FROM exercise_item_steps s WHERE s.item_id = i.id)) ORDER BY i.code COLLATE "C")
                   FROM exercise_items i) AS workouts,
                (SELECT array_agg(xmin::text ORDER BY xmin::text) FROM (
                   SELECT xmin FROM exercise_moves UNION ALL SELECT xmin FROM exercise_items
                   UNION ALL SELECT xmin FROM exercise_item_steps) x) AS versions,
                (SELECT jsonb_object_agg(code, id) FROM exercise_items) AS ids`,
      )
    ).rows[0];
  const byCode = <T extends { code: string }>(rows: T[]) => [...rows].sort((a, b) => (a.code < b.code ? -1 : 1));
  const seeded = await library();
  assert.deepEqual(seeded.moves, byCode(MOVES).map(move => ({ ...move, demoCode: move.demoCode ?? null })));
  assert.deepEqual(seeded.workouts, byCode(WORKOUTS));
  for (let run = 0; run < 2; run++) {
    await seedExercises(db.admin as unknown as pg.ClientBase);
    assert.deepEqual(await library(), seeded);
  }

  // drift: a move, a workout, a step changed, a step too many; the ids stay
  await db.admin.query("UPDATE exercise_moves SET caution = 'x' WHERE code = 'XOAY_VAI'");
  await db.admin.query("UPDATE exercise_items SET sets = 9, equipment = '{tham}' WHERE code = 'FULL_BODY_EASY'");
  await db.admin.query(
    `UPDATE exercise_item_steps SET seconds = 1 FROM exercise_items i
      WHERE i.id = item_id AND i.code = 'DESK_STRETCH' AND position = 1`,
  );
  await db.admin.query(
    `INSERT INTO exercise_item_steps (item_id, position, move_code, phase, seconds, reps_text)
     SELECT id, 99, 'XOAY_VAI', 'MAIN', 30, 'x' FROM exercise_items WHERE code = 'BREATHE_RELAX'`,
  );
  await seedExercises(db.admin as unknown as pg.ClientBase);
  const repaired = await library();
  assert.deepEqual([repaired.moves, repaired.workouts, repaired.ids], [seeded.moves, seeded.workouts, seeded.ids]);
  assert.deepEqual(await counts(), expected);
});

// ---------------------------------------------------------------- the band of the latch

test('band parity: for every integer target from 1200 to 4000 the band of the latch is calorieWindow', async () => {
  const { rows } = await db.admin.query<{ target: number; min: string; max: string; lower_inc: boolean; upper_inc: boolean }>(
    `SELECT t AS target, lower(b) AS min, upper(b) AS max, lower_inc(b), upper_inc(b)
       FROM generate_series(1200, 4000) t, app._calorie_band(t) b ORDER BY t`,
  );
  for (const row of rows) {
    const { min, max } = calorieWindow(row.target);
    assert.deepEqual(
      [Number(row.min), Number(row.max), row.lower_inc, row.upper_inc],
      [min, max, true, true],
      `target ${row.target}`,
    );
  }
  console.log(`band parity: ${rows.length} targets compared`);
  assert.equal(rows.length, 2801);
});

// ---------------------------------------------------------------- repeated action ids

test('a repeated action id: the caller’s own is a no-op that earns nothing, somebody else’s is IDEMPOTENCY_KEY_REUSED', async () => {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  const totals = async (user: string) =>
    (
      await db.admin.query(
        `SELECT (SELECT coalesce(sum(calories_in), 0)::float8 FROM daily_logs WHERE user_id = $1) AS calories,
                (SELECT count(*)::int FROM nutrition_logs WHERE user_id = $1) AS meals,
                (SELECT count(*)::int FROM workout_sessions WHERE user_id = $1) AS sessions,
                (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows`,
        [user],
      )
    ).rows[0];

  const mealId = randomUUID();
  const first = await meal(userId, 300, mealId);
  assert.deepEqual(first, {
    xpBefore: 0, xpAfter: 0, coinBefore: 0, coinAfter: 0, highWaterBefore: 0, highWaterAfter: 0, applied: false,
    reason: 'QUEST_COMPLETE', ref: 'NUTRITION_TARGET:2027-03-10', logicalDate: '2027-03-10',
    completed: false, storyAllDone: false,
  });
  // whatever the repeat says: the log is there, nothing is judged or added
  assert.deepEqual(await meal(userId, 0, mealId), first);
  await expectPgError(meal(other.userId, 300, mealId), { code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED' });

  const sessionId = randomUUID();
  const done = await session(userId, 'FULL_BODY_EASY', 600, sessionId);
  assert.deepEqual(
    [done.completed, done.questCompleted, done.xpAwarded, done.coinAwarded, done.reason, done.ref],
    [true, true, 50, 20, 'QUEST_COMPLETE', 'WORKOUT_MAIN:2027-03-10'],
  );
  const again = await session(userId, 'DESK_STRETCH', 1, sessionId);
  assert.deepEqual(again, {
    xpBefore: 50, xpAfter: 50, coinBefore: 20, coinAfter: 20, highWaterBefore: 50, highWaterAfter: 50,
    applied: false, reason: 'WORKOUT_PARTIAL', ref: sessionId, logicalDate: '2027-03-10',
    completed: true, questCompleted: false, storyAllDone: false,
    xpAwarded: 50, coinAwarded: 20, elapsedSec: 600, durationSec: 900,
  });
  await expectPgError(session(other.userId, 'FULL_BODY_EASY', 600, sessionId), {
    code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED',
  });
  assert.deepEqual(await totals(userId), { calories: 300, meals: 1, sessions: 1, xp_rows: 1 });
  assert.deepEqual(await totals(other.userId), { calories: 0, meals: 0, sessions: 0, xp_rows: 0 });
});

test('refusals in their order, and a refused call leaves nothing', async () => {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  const fields = (field: string, rule: string) => ({ fields: [{ field, rule }] });
  const detail = async (promise: Promise<unknown>, code: string) => {
    try {
      await promise;
    } catch (thrown) {
      const { code: state, message, detail: given } = thrown as { code: string; message: string; detail: string };
      assert.deepEqual([state, message], [HM, code]);
      return JSON.parse(given);
    }
    assert.fail(`no ${code}`);
  };
  assert.deepEqual(await detail(meal(userId, 0), 'VALIDATION_FAILED'), fields('kcal', 'min'));
  assert.deepEqual(await detail(meal(userId, 5000.01), 'VALIDATION_FAILED'), fields('kcal', 'max'));
  assert.deepEqual(await detail(meal(userId, Number.NaN), 'VALIDATION_FAILED'), fields('kcal', 'max'));
  assert.deepEqual(
    await detail(meal(userId, 0, randomUUID(), 'x'.repeat(61)), 'VALIDATION_FAILED'),
    { fields: [{ field: 'kcal', rule: 'min' }, { field: 'label', rule: 'max' }] },
  );
  // an id of another kind (a quest) names no workout
  const quest = (await db.admin.query("SELECT id FROM quests WHERE code = 'WORKOUT_MAIN'")).rows[0].id;
  await expectPgError(
    asUser(db.app, userId, c => c.query('SELECT workout_complete($1, $2, 99999, NULL)', [randomUUID(), quest])),
    { code: HM, messagePrefix: 'NOT_FOUND' },
  );
  assert.deepEqual(await detail(session(userId, 'DESK_STRETCH', 0), 'VALIDATION_FAILED'), fields('elapsedSec', 'min'));
  assert.deepEqual(await detail(session(userId, 'DESK_STRETCH', 601), 'VALIDATION_FAILED'), fields('elapsedSec', 'max'));
  // the instant is judged after the fields
  const ahead = new Date(Date.parse(NOON) + 3600_000).toISOString();
  await expectPgError(
    asUser(db.app, userId, c => c.query('SELECT nutrition_log_manual($1, 10, NULL, $2)', [randomUUID(), ahead])),
    { code: HM, messagePrefix: 'OCCURRED_AT_INVALID' },
  );
  await db.admin.query("UPDATE progression_state SET last_closed_date = '2027-03-10' WHERE user_id = $1", [userId]);
  await expectPgError(meal(userId, 10), { code: HM, messagePrefix: 'DAY_CLOSED' });
  await expectPgError(session(userId, 'DESK_STRETCH', 10), { code: HM, messagePrefix: 'DAY_CLOSED' });
  const left = await db.admin.query(
    `SELECT (SELECT count(*) FROM daily_logs WHERE user_id = $1)::int + (SELECT count(*) FROM nutrition_logs WHERE user_id = $1)::int
            + (SELECT count(*) FROM workout_sessions WHERE user_id = $1)::int AS n`,
    [userId],
  );
  assert.equal(left.rows[0].n, 0);
});

// ---------------------------------------------------------------- constraints

test('constraints: kcal and label of a log, the bounds and the meaning of a session, a child row cannot name another user than its log', async () => {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  await meal(userId, 100);
  const log = (await db.admin.query('SELECT id FROM daily_logs WHERE user_id = $1', [userId])).rows[0].id;
  const item = await itemId('FULL_BODY_EASY');
  const insertMeal = (user: string, kcal: number, label: string | null, slot: string | null = null) =>
    db.admin.query(
      `INSERT INTO nutrition_logs (id, user_id, daily_log_id, meal_slot, label, kcal, occurred_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, app.now())`,
      [user, log, slot, label, kcal],
    );
  const insertSession = (user: string, elapsed: number, completed: boolean) =>
    db.admin.query(
      `INSERT INTO workout_sessions (id, user_id, daily_log_id, exercise_item_id, modality, duration_sec,
                                     elapsed_sec, completed, xp_awarded, occurred_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'RESISTANCE', 900, $4, $5, 0, app.now())`,
      [user, log, item, elapsed, completed],
    );
  await expectPgError(insertMeal(userId, 0.5, null), { code: CHECK, messagePrefix: 'new row for relation "nutrition_logs" violates check constraint "nutrition_logs_kcal_check"' });
  await expectPgError(insertMeal(userId, 5001, null), { code: CHECK, messagePrefix: 'new row for relation "nutrition_logs" violates check constraint "nutrition_logs_kcal_check"' });
  await expectPgError(insertMeal(userId, 10, ''), { code: CHECK, messagePrefix: 'new row for relation "nutrition_logs" violates check constraint "nutrition_logs_label_check"' });
  await expectPgError(insertMeal(userId, 10, 'x'.repeat(61)), { code: CHECK, messagePrefix: 'new row for relation "nutrition_logs" violates check constraint "nutrition_logs_label_check"' });
  await expectPgError(insertMeal(userId, 10, null, 'LUNCH'), { code: CHECK, messagePrefix: 'new row for relation "nutrition_logs" violates check constraint "nutrition_logs_slot_meal_check"' });
  await expectPgError(insertMeal(other.userId, 10, null), { code: FOREIGN_KEY, messagePrefix: 'insert or update on table "nutrition_logs" violates foreign key constraint "nutrition_logs_log_user_fkey"' });
  await expectPgError(insertSession(userId, 1801, true), { code: CHECK, messagePrefix: 'new row for relation "workout_sessions" violates check constraint "workout_sessions_elapsed_max_check"' });
  await expectPgError(insertSession(userId, 449, true), { code: CHECK, messagePrefix: 'new row for relation "workout_sessions" violates check constraint "workout_sessions_completed_check"' });
  await expectPgError(insertSession(userId, 450, false), { code: CHECK, messagePrefix: 'new row for relation "workout_sessions" violates check constraint "workout_sessions_completed_check"' });
  await expectPgError(insertSession(other.userId, 450, true), { code: FOREIGN_KEY, messagePrefix: 'insert or update on table "workout_sessions" violates foreign key constraint "workout_sessions_log_user_fkey"' });
  await insertSession(userId, 1800, true);
});

// ---------------------------------------------------------------- locks
//
// Each function takes the caller's users row, then the daily log, then the progress row, then
// progression_state, the first three FOR NO KEY UPDATE; the log or session row is inserted
// after them. The proof that needs no luck, as for the day (server/test/day.sql.test.ts).

type Probe = { table: string; where: string };
const PROBES: Probe[] = [
  { table: 'users', where: 'id = $1' },
  { table: 'daily_logs', where: 'user_id = $1' },
  { table: 'quest_completions', where: 'user_id = $1' },
  { table: 'progression_state', where: 'user_id = $1' },
];

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

/** A user with a committed day that has both progress rows, and the two calls of this file. */
async function playerWithDay() {
  await clock(NOON);
  const { userId } = await newOnboardedUser(db);
  await meal(userId, 10);
  await session(userId, 'DESK_STRETCH', 10);
  const item = await itemId('DESK_STRETCH');
  const calls: [name: string, sql: string, params: unknown[]][] = [
    ['nutrition_log_manual', 'SELECT nutrition_log_manual($1, 20, NULL, NULL)', [randomUUID()]],
    ['workout_complete', 'SELECT workout_complete($1, $2, 20, NULL)', [randomUUID(), item]],
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
        const waiting = asUser(db.app, userId, async c => {
          await c.query(sql, params);
          throw new Error('rolled back on purpose');
        }).catch((thrown: Error) => {
          settled = true;
          assert.equal(thrown.message, 'rolled back on purpose', label);
        });
        try {
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
            assert.equal(await probe(prober, later, userId, 'NO KEY UPDATE'), 'free', `${label}: it already holds ${later.table}`);
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
