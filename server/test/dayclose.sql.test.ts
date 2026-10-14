// 32-dayclose.sql and 33-inbox.sql at the SQL level: who the close job picks and what it is
// given, the compare-and-set of job_apply_day_close and its check that the days it was given are
// still the truth, the money and the badge of a milestone (once ever), app._notify, and the locks
// the apply takes: which, in what mode, in what order. Job functions are called as app_job
// through app_conn with the real role switch; app._notify through the owner, as no role can.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { closeDays } from '../../domain/streak.ts';
import type { DayInput, StreakState } from '../../domain/streak.ts';
import { SUPERUSER, TEST } from '../scripts/cluster.ts';
import { asJob, asUser, expectPgError, setTestClock } from './helpers.ts';
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

const DECOY_1 = '00000000-0000-4000-8000-0000000000d1';
const LOCKED = '55P03';
const NOON_10 = '2027-03-10T05:00:00.000Z'; // 12:00 on 10 March in Asia/Ho_Chi_Minh
const AFTER_03_13 = '2027-03-12T20:01:00.000Z'; // 03:01 on 13 March there: yesterday is the 12th
const BEFORE_03_13 = '2027-03-12T19:59:00.000Z'; // 02:59: still the 12th, yesterday the 11th
const clock = (at: string) => setTestClock(db.admin, at);

type Candidate = { user_id: string; last_closed: string | null; state: StreakState; days: DayInput[] };

const candidates = async (now: string, limit = 10_000, afterId: string | null = null) =>
  (
    await asJob(db.app, c =>
      c.query<Candidate>(
        'SELECT user_id, last_closed::text AS last_closed, state, days FROM job_day_close_candidates($1, $2, $3)',
        [now, limit, afterId],
      ),
    )
  ).rows;
const candidateOf = async (userId: string, now: string) =>
  (await candidates(now)).find(row => row.user_id === userId);

const apply = async (
  userId: string,
  expected: string | null,
  through: string,
  days: unknown,
  state: unknown,
  events: unknown[] = [],
) =>
  (
    await asJob(db.app, c =>
      c.query('SELECT job_apply_day_close($1, $2, $3, $4, $5, $6) AS result', [
        userId,
        expected,
        through,
        JSON.stringify(days),
        JSON.stringify(state),
        JSON.stringify(events),
      ]),
    )
  ).rows[0].result as { applied: boolean; grants: Record<string, unknown>[] };

/** Closes what the candidates query offers for this user at `now`, the way the runner does. */
async function closeAt(userId: string, now: string, events: unknown[] | null = null) {
  const row = await candidateOf(userId, now);
  assert.ok(row, 'not a candidate');
  const closed = closeDays(row.state, row.days);
  const through = row.days[row.days.length - 1].date;
  return apply(userId, row.last_closed, through, row.days, closed.state, events ?? []);
}

/** Everything of the user that the close may change, read as the owner. */
const stateOf = async (userId: string) =>
  (
    await db.admin.query(
      `SELECT to_jsonb(s) - 'created_at' - 'xp_high_water' AS progression,
              (SELECT jsonb_agg(jsonb_build_object('date', d.logical_date, 'closed', d.closed_at IS NOT NULL)
                                ORDER BY d.logical_date) FROM daily_logs d WHERE d.user_id = $1) AS logs,
              (SELECT count(*)::int FROM coin_ledger WHERE user_id = $1) AS coin_rows,
              (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coins,
              (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows,
              (SELECT count(*)::int FROM inventory WHERE user_id = $1) AS items,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'key', n.dedupe_key, 'payload', n.payload)
                                         ORDER BY n.created_at), '[]') FROM notifications n WHERE n.user_id = $1) AS inbox
         FROM progression_state s WHERE s.user_id = $1`,
      [userId],
    )
  ).rows[0];

/** A user onboarded on 10 March with a log of every day 10-12; 10 March has its story done. */
async function userWithThreeDays() {
  await clock(NOON_10);
  const { userId } = await newOnboardedUser(db);
  await db.admin.query(
    `INSERT INTO daily_logs (user_id, logical_date, story_completed)
     SELECT $1, d::date, d::date = '2027-03-10' FROM generate_series('2027-03-10'::date, '2027-03-12', '1 day') d`,
    [userId],
  );
  return userId;
}

// ---------------------------------------------------------------- candidates

test('candidates: one element per date from the day after the last close through yesterday; the decoy, a user not onboarded and a deleted user are never offered', async () => {
  const userId = await userWithThreeDays();
  // a ticket on the 11th (Task 44 writes these; the owner stands in)
  await db.admin.query(
    `INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date)
     VALUES ($1, '2027-03-08', '2027-03-11T10:00:00Z', '2027-03-11')`,
    [userId],
  );
  const notOnboarded = (await newUser(db)).userId;
  const deleted = (await newOnboardedUser(db)).userId;
  await db.admin.query("UPDATE users SET deleted_at = '2027-03-11T00:00:00Z' WHERE id = $1", [deleted]);
  // the decoy has a day, a progression row and an onboard date: only onboarded_at keeps it out
  assert.equal((await db.admin.query('SELECT 1 FROM progression_state WHERE user_id = $1', [DECOY_1])).rowCount, 1);

  const offered = await candidates(AFTER_03_13);
  const ids = offered.map(row => row.user_id);
  for (const outside of [DECOY_1, notOnboarded, deleted]) {
    assert.ok(!ids.includes(outside), outside);
  }
  assert.deepEqual(
    offered.find(row => row.user_id === userId),
    {
      user_id: userId,
      last_closed: null,
      state: {
        streakCurrent: 0,
        streakBest: 0,
        streakBeforeBreak: null,
        breakDate: null,
        missedRun: 0,
        lastOutcome: null,
      },
      days: [
        { date: '2027-03-10', storyCompleted: true, ticketApplied: false },
        { date: '2027-03-11', storyCompleted: false, ticketApplied: true },
        { date: '2027-03-12', storyCompleted: false, ticketApplied: false },
      ],
    },
  );
  // one minute before 03:00 the 12th is today: through the 11th
  assert.deepEqual(
    (await candidateOf(userId, BEFORE_03_13))?.days.map(day => day.date),
    ['2027-03-10', '2027-03-11'],
  );
  // before the first day ends there is nothing to close
  assert.equal(await candidateOf(userId, '2027-03-10T19:59:00.000Z'), undefined);
});

test('candidates: at most p_limit, in id order, after p_after', async () => {
  await userWithThreeDays();
  await userWithThreeDays();
  const all = (await candidates(AFTER_03_13)).map(row => row.user_id);
  assert.ok(all.length >= 2);
  assert.deepEqual([...all].sort(), all);
  assert.deepEqual((await candidates(AFTER_03_13, 1)).map(row => row.user_id), [all[0]]);
  assert.deepEqual((await candidates(AFTER_03_13, 1, all[0])).map(row => row.user_id), [all[1]]);
  assert.deepEqual(await candidates(AFTER_03_13, 10_000, all[all.length - 1]), []);
});

// ---------------------------------------------------------------- apply

test('apply: writes the state, last_closed_date and closed_at of the logs through the date; the same call again applies nothing (compare-and-set)', async () => {
  const userId = await userWithThreeDays();
  const row = (await candidateOf(userId, AFTER_03_13))!;
  const closed = closeDays(row.state, row.days);
  const first = await apply(userId, null, '2027-03-12', row.days, closed.state);
  assert.deepEqual(first, { applied: true, grants: [] });
  const closedOnce = await stateOf(userId);
  assert.deepEqual(
    {
      streak: closedOnce.progression.streak_current,
      best: closedOnce.progression.streak_best,
      before: closedOnce.progression.streak_before_break,
      breakDate: closedOnce.progression.break_date,
      missed: closedOnce.progression.missed_run,
      outcome: closedOnce.progression.last_outcome,
      closed: closedOnce.progression.last_closed_date,
    },
    {
      streak: closed.state.streakCurrent,
      best: closed.state.streakBest,
      before: closed.state.streakBeforeBreak,
      breakDate: closed.state.breakDate,
      missed: closed.state.missedRun,
      outcome: closed.state.lastOutcome,
      closed: '2027-03-12',
    },
  );
  assert.deepEqual(closedOnce.logs, [
    { date: '2027-03-10', closed: true },
    { date: '2027-03-11', closed: true },
    { date: '2027-03-12', closed: true },
  ]);
  // a second runner that read the same candidates row: nothing happens
  const second = await apply(userId, null, '2027-03-12', row.days, { ...closed.state, streakCurrent: 9, streakBest: 9 });
  assert.deepEqual(second, { applied: false, grants: [] });
  assert.deepEqual(await stateOf(userId), closedOnce);
  // and the user is no candidate any more at that instant
  assert.equal(await candidateOf(userId, AFTER_03_13), undefined);
});

test('apply: days that changed since they were read (a late write, a ticket) apply nothing; the user is offered again with the new truth', async () => {
  const userId = await userWithThreeDays();
  const row = (await candidateOf(userId, AFTER_03_13))!;
  const read = await stateOf(userId);
  // the story of the 12th got done in between (a late write lands on an open day)
  await db.admin.query(
    "UPDATE daily_logs SET story_completed = true WHERE user_id = $1 AND logical_date = '2027-03-12'",
    [userId],
  );
  const result = await apply(userId, null, '2027-03-12', row.days, closeDays(row.state, row.days).state);
  assert.deepEqual(result, { applied: false, grants: [] });
  assert.deepEqual((await stateOf(userId)).progression, read.progression);
  assert.equal((await candidateOf(userId, AFTER_03_13))?.days[2].storyCompleted, true);
  // a date range that does not start the day after the last close is stale too
  const fresh = (await candidateOf(userId, AFTER_03_13))!;
  assert.deepEqual(
    await apply(userId, null, '2027-03-12', fresh.days.slice(1), closeDays(fresh.state, fresh.days).state),
    { applied: false, grants: [] },
  );
});

test('apply: streak_best is never written lower than it is', async () => {
  const userId = await userWithThreeDays();
  await db.admin.query('UPDATE progression_state SET streak_best = 10 WHERE user_id = $1', [userId]);
  const row = (await candidateOf(userId, AFTER_03_13))!;
  assert.equal(row.state.streakBest, 10);
  const state = { ...closeDays(row.state, row.days).state, streakBest: 2 };
  assert.equal((await apply(userId, null, '2027-03-12', row.days, state)).applied, true);
  assert.equal((await stateOf(userId)).progression.streak_best, 10);
});

const MILESTONE_7 = { type: 'STREAK_MILESTONE', days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' };

test('apply: a milestone pays its coins once ever (ledger key "7"), gives the badge once and one notification; the ledger rows come back for log.ledger', async () => {
  const userId = await userWithThreeDays();
  const result = await closeAt(userId, BEFORE_03_13, [MILESTONE_7]);
  assert.equal(result.applied, true);
  assert.equal(result.grants.length, 1);
  const [grant] = result.grants;
  assert.deepEqual(
    [grant.reason, grant.ref, grant.applied, Number(grant.coinAfter) - Number(grant.coinBefore), grant.xpAfter, grant.xpBefore],
    ['STREAK_MILESTONE', '7', true, 50, grant.xpBefore, grant.xpBefore],
  );
  const once = await stateOf(userId);
  assert.deepEqual([once.coin_rows, once.coins, once.xp_rows, once.items], [1, 50, 0, 1]);
  assert.deepEqual(
    (await db.admin.query(
      "SELECT s.code FROM inventory i JOIN shop_items s ON s.id = i.shop_item_id WHERE i.user_id = $1",
      [userId],
    )).rows,
    [{ code: 'BADGE_STREAK_7' }],
  );
  assert.deepEqual(once.inbox, [
    { kind: 'STREAK_MILESTONE', key: '7', payload: { days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' } },
  ]);
  // the streak broke and reached 7 again: the next close carries the event again, nothing new comes of it
  const again = await closeAt(userId, AFTER_03_13, [MILESTONE_7]);
  assert.deepEqual(again, { applied: true, grants: [] });
  const twice = await stateOf(userId);
  assert.deepEqual([twice.coin_rows, twice.coins, twice.items, twice.inbox], [1, 50, 1, once.inbox]);
});

test('apply: PET_TIRED is one notification per date with an empty payload; a broken streak, an unknown event or a milestone outside 7/30/100 is no notification', async () => {
  const userId = await userWithThreeDays();
  await expectPgError(closeAt(userId, AFTER_03_13, [{ type: 'STREAK_BROKEN', date: '2027-03-12', previous: 3 }]), {
    code: 'P0001',
    messagePrefix: 'job_apply_day_close: unknown event',
  });
  await expectPgError(closeAt(userId, AFTER_03_13, [{ ...MILESTONE_7, days: 8 }]), {
    code: 'P0001',
    messagePrefix: 'job_apply_day_close: not a milestone',
  });
  await expectPgError(closeAt(userId, AFTER_03_13, [{ ...MILESTONE_7, badgeCode: 'THEME_FOREST' }]), {
    code: 'P0001',
    messagePrefix: 'job_apply_day_close: not a milestone',
  });
  assert.equal((await stateOf(userId)).progression.last_closed_date, null, 'a refused apply leaves nothing');
  assert.equal((await closeAt(userId, AFTER_03_13, [{ type: 'PET_TIRED', date: '2027-03-12' }])).applied, true);
  assert.deepEqual((await stateOf(userId)).inbox, [{ kind: 'PET_TIRED', key: '2027-03-12', payload: {} }]);
});

// ---------------------------------------------------------------- app._notify

test('app._notify takes the five kinds of the contract and nothing else, once per dedupe key, and created_at rises strictly per user under a frozen clock', async () => {
  await clock(NOON_10);
  const { userId } = await newOnboardedUser(db);
  const notify = (kind: string, payload: unknown, key: string | null) =>
    db.admin.query('SELECT app._notify($1, $2, $3, $4) AS created', [userId, kind, JSON.stringify(payload), key]);
  for (const kind of ['NUDGE', 'STREAK_MILESTONE', 'PET_TIRED', 'GUILD_WEEKLY_RESULT', 'QUEST_REMINDER']) {
    assert.equal((await notify(kind, {}, 'k')).rows[0].created, true, kind);
    assert.equal((await notify(kind, {}, 'k')).rows[0].created, false, `${kind} again`);
  }
  // no dedupe key: no dedupe
  assert.equal((await notify('NUDGE', {}, null)).rows[0].created, true);
  assert.equal((await notify('NUDGE', {}, null)).rows[0].created, true);
  await expectPgError(notify('STREAK_BROKEN', {}, 'k'), {
    code: '23514',
    messagePrefix: 'new row for relation "notifications" violates check constraint "notifications_kind_check"',
  });
  await expectPgError(notify('PET_TIRED', [], 'x'), {
    code: '23514',
    messagePrefix: 'new row for relation "notifications" violates check constraint "notifications_payload_check"',
  });
  const micros = await db.admin.query(
    `SELECT count(DISTINCT created_at)::int AS n, min(created_at) = $2::timestamptz AS from_clock
       FROM notifications WHERE user_id = $1`,
    [userId, NOON_10],
  );
  assert.deepEqual(micros.rows[0], { n: 7, from_clock: true });
});

// ---------------------------------------------------------------- fences

test('the job functions are for app_job: app_auth and app_anon are refused at EXECUTE', async () => {
  await clock(NOON_10);
  const { userId } = await newOnboardedUser(db);
  for (const [sql, params] of [
    ['SELECT job_day_close_candidates($1, $2, $3)', [AFTER_03_13, 1, null]],
    ['SELECT job_apply_day_close($1, $2, $3, $4, $5, $6)', [userId, null, '2027-03-12', '[]', '{}', '[]']],
    ['SELECT job_record_run($1, $2, $3, $4)', ['day-close', 'x', true, '{}']],
  ] as const) {
    const name = sql.slice(7, sql.indexOf('('));
    await expectPgError(
      asUser(db.app, userId, c => c.query(sql, [...params])),
      { code: '42501', messagePrefix: `permission denied for function ${name}` },
    );
  }
  // job_record_run upserts one row per job and run key
  await asJob(db.app, c => c.query('SELECT job_record_run($1, $2, $3, $4)', ['day-close', 'k1', false, '{"failed":1}']));
  await asJob(db.app, c => c.query('SELECT job_record_run($1, $2, $3, $4)', ['day-close', 'k1', true, '{"failed":0}']));
  assert.deepEqual(
    (await db.admin.query("SELECT ok, detail FROM job_runs WHERE job = 'day-close' AND run_key = 'k1'")).rows,
    [{ ok: true, detail: { failed: 0 } }],
  );
});

// ---------------------------------------------------------------- locks
//
// The apply takes the user's users row first (FOR NO KEY UPDATE: the mutex of the user's day,
// the one every day write takes), then the daily logs it closes, then progression_state. The two
// tests below decide that without a race, like those of day.sql.test.ts.

type Probe = { table: string; where: string };
const PROBES: Probe[] = [
  { table: 'users', where: 'id = $1' },
  { table: 'daily_logs', where: 'user_id = $1' },
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

/** The SQL text and parameters of an apply that will close the user's three days. */
async function applyCall(userId: string) {
  const row = (await candidateOf(userId, AFTER_03_13))!;
  return {
    sql: 'SELECT job_apply_day_close($1, $2, $3, $4, $5, $6)',
    params: [
      userId,
      null,
      '2027-03-12',
      JSON.stringify(row.days),
      JSON.stringify(closeDays(row.state, row.days).state),
      '[]',
    ],
  };
}

test('while an apply is in flight its rows stay open to a key-share lock, and shut to another writer', async () => {
  const userId = await userWithThreeDays();
  const { sql, params } = await applyCall(userId);
  const prober = await wide.connect();
  try {
    await asJob(db.app, async c => {
      await c.query(sql, params);
      const seen: Record<string, string[]> = {};
      for (const target of PROBES) {
        seen[target.table] = [
          await probe(prober, target, userId, 'KEY SHARE'),
          await probe(prober, target, userId, 'NO KEY UPDATE'),
        ];
      }
      assert.deepEqual(seen, {
        users: ['free', 'held'],
        daily_logs: ['free', 'held'],
        progression_state: ['free', 'held'],
      });
      throw new Error('rolled back on purpose');
    }).catch((thrown: Error) => assert.equal(thrown.message, 'rolled back on purpose'));
  } finally {
    prober.release();
  }
});

test('the lock order of the apply is users, daily logs, progression state: an apply that waits for one holds none of the later ones', async () => {
  const userId = await userWithThreeDays();
  const { sql, params } = await applyCall(userId);
  const holder = await wide.connect();
  const prober = await wide.connect();
  try {
    for (let stage = 0; stage < PROBES.length - 1; stage++) {
      const label = `apply behind ${PROBES[stage].table}`;
      await holder.query('BEGIN');
      const held = await holder.query(
        `SELECT 1 FROM ${PROBES[stage].table} WHERE ${PROBES[stage].where} FOR NO KEY UPDATE`,
        [userId],
      );
      assert.ok((held.rowCount ?? 0) > 0, label);
      let settled = false;
      const waiting = asJob(db.app, async c => {
        const { rows } = await c.query(`${sql} AS result`, params);
        assert.equal(rows[0].result.applied, true, label);
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
            [`${sql} AS result`],
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
  } finally {
    holder.release();
    prober.release();
  }
});

test('a user id that is not a live onboarded user applies nothing', async () => {
  for (const userId of [DECOY_1, randomUUID()]) {
    assert.deepEqual(await apply(userId, null, '2026-01-02', [], {}), { applied: false, grants: [] });
  }
});
