// The races of account_delete and job_account_purge (61-privacy.sql) against the user's own
// writes, the guild functions and a login, as transactions of two pools of app_conn with the
// real role switch. An order is forced by a lock the owner connection holds and releases once
// the racers wait (pg_stat_activity); the free rounds accept every serial outcome.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { asAnon, asJob, asUser, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, serverPool } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const NOON = '2027-03-10T05:00:00.000Z';

let db: TestDb;
let second: Pool;
before(async () => {
  db = await createTestDb();
  second = serverPool(db);
  await setTestClock(db.admin, NOON);
});
after(async () => {
  await setTestClock(db.admin, null);
  await second.end();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>> & { key: Buffer };

/** An onboarded user whose key is known. */
async function user(): Promise<User> {
  const made = await newOnboardedUser(db);
  const key = randomBytes(32);
  await db.admin.query('UPDATE credentials SET key = $2 WHERE user_id = $1', [made.userId, key]);
  return { ...made, key };
}

const waitForLockWaiters = async (n: number) => {
  for (let i = 0; i < 300; i++) {
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (rows[0].n >= n) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`fewer than ${n} wait for a lock`);
};

/** Runs `sql` in an owner transaction that stays open until the returned release() is awaited. */
async function hold(sql: string, params: unknown[]): Promise<() => Promise<void>> {
  const owner: PoolClient = await db.admin.connect();
  await owner.query('BEGIN');
  await owner.query(sql, params);
  return async () => {
    try {
      await owner.query('COMMIT');
    } finally {
      owner.release();
    }
  };
}

/** What a call settled to: 'ok', or the error message (for HM000 the error code). */
const outcome = (settled: PromiseSettledResult<unknown>) =>
  settled.status === 'fulfilled' ? 'ok' : (settled.reason as Error).message;

const del = (pool: Pool, who: User) =>
  asUser(pool, who.userId, c => c.query<{ ok: boolean }>('SELECT account_delete($1) AS ok', [who.key])).then(r => {
    assert.equal(r.rows[0].ok, true);
  });
const tick = (pool: Pool, who: User) =>
  asUser(pool, who.userId, c => c.query('SELECT quest_tick($1, $2, NULL)', ['WATER_8', randomUUID()]));
const deleted = async (who: User) =>
  (await db.admin.query('SELECT deleted_at IS NOT NULL AS d FROM users WHERE id = $1', [who.userId])).rows[0].d;
const ticks = async (who: User) =>
  (await db.admin.query('SELECT count(*)::int AS n FROM quest_ticks WHERE user_id = $1', [who.userId])).rows[0].n;

async function guild(leader: User, ...members: User[]): Promise<{ id: string; code: string }> {
  const { rows } = await asUser(db.app, leader.userId, c =>
    c.query<{ id: string }>('SELECT guild_create($1, $2) AS id', [`Tổ ${randomUUID().slice(0, 8)}`, '']),
  );
  const code = (await db.admin.query('SELECT invite_code FROM guilds WHERE id = $1', [rows[0].id])).rows[0].invite_code;
  for (const member of members) {
    await asUser(db.app, member.userId, c => c.query('SELECT guild_join($1)', [code]));
  }
  return { id: rows[0].id, code };
}
const members = async (guildId: string) =>
  (
    await db.admin.query(
      "SELECT coalesce(array_agg(user_id || ':' || role ORDER BY role, user_id), '{}') AS m FROM guild_memberships WHERE guild_id = $1",
      [guildId],
    )
  ).rows[0].m as string[];

test('race: delete vs a tick of the same user. Tick first (held on progression_state): both succeed. Delete first (held on the guild): the tick is ONBOARDING_REQUIRED. Free rounds: one of the two', async () => {
  {
    const me = await user();
    const release = await hold('SELECT 1 FROM progression_state WHERE user_id = $1 FOR UPDATE', [me.userId]);
    let done: PromiseSettledResult<unknown>[];
    try {
      const racing = [tick(db.app, me), del(second, me)];
      // the tick holds the users row and waits for progression_state; the delete waits for the users row
      await waitForLockWaiters(2);
      await release();
      done = await Promise.allSettled(racing);
    } catch (e) {
      await release().catch(() => {});
      throw e;
    }
    assert.deepEqual(done.map(outcome), ['ok', 'ok']);
    assert.deepEqual([await deleted(me), await ticks(me)], [true, 1]);
  }
  {
    const me = await user();
    const mate = await user();
    const g = await guild(mate, me);
    const release = await hold('SELECT 1 FROM guilds WHERE id = $1 FOR UPDATE', [g.id]);
    let done: PromiseSettledResult<unknown>[];
    try {
      const deleting = del(db.app, me);
      // the delete holds the users row and waits for the guild
      await waitForLockWaiters(1);
      const ticking = tick(second, me);
      await waitForLockWaiters(2);
      await release();
      done = await Promise.allSettled([deleting, ticking]);
    } catch (e) {
      await release().catch(() => {});
      throw e;
    }
    assert.deepEqual(done.map(outcome), ['ok', 'ONBOARDING_REQUIRED']);
    assert.deepEqual([await deleted(me), await ticks(me)], [true, 0]);
  }
  for (let round = 0; round < 6; round++) {
    const me = await user();
    const done = (await Promise.allSettled([tick(db.app, me), del(second, me)])).map(outcome);
    const valid = [
      ['ok', 'ok'],
      ['ONBOARDING_REQUIRED', 'ok'],
    ];
    assert.ok(valid.some(v => v.join() === done.join()), `round ${round}: ${done}`);
    assert.deepEqual([await deleted(me), await ticks(me)], [true, done[0] === 'ok' ? 1 : 0]);
  }
});

test('race: the deleted leader vs a member leaving and vs a newcomer joining, both orders forced on the guild row; never a deadlock, one leader or no guild', async () => {
  // leave: L, M1 (earliest), M2
  for (const deleteFirst of [true, false]) {
    const [l, m1, m2] = [await user(), await user(), await user()];
    const g = await guild(l, m1, m2);
    // one frozen clock: the join instants are equal, so M1 is made the earliest by hand
    await db.admin.query("UPDATE guild_memberships SET joined_at = joined_at - interval '1 hour' WHERE user_id = $1", [m1.userId]);
    const release = await hold('SELECT 1 FROM guilds WHERE id = $1 FOR UPDATE', [g.id]);
    let done: PromiseSettledResult<unknown>[];
    try {
      const firstCall = deleteFirst ? del(db.app, l) : asUser(db.app, m1.userId, c => c.query('SELECT guild_leave()'));
      await waitForLockWaiters(1);
      const secondCall = deleteFirst ? asUser(second, m1.userId, c => c.query('SELECT guild_leave()')) : del(second, l);
      await waitForLockWaiters(2);
      await release();
      done = await Promise.allSettled([firstCall, secondCall]);
    } catch (e) {
      await release().catch(() => {});
      throw e;
    }
    if (deleteFirst) {
      // M1 was made leader by the deletion, and a leader with a member must transfer first
      assert.deepEqual(done.map(outcome), ['ok', 'LEADER_MUST_TRANSFER']);
      assert.deepEqual(await members(g.id), [`${m1.userId}:LEADER`, `${m2.userId}:MEMBER`]);
    } else {
      assert.deepEqual(done.map(outcome), ['ok', 'ok']);
      assert.deepEqual(await members(g.id), [`${m2.userId}:LEADER`]);
    }
  }
  // join: L alone, J joins
  for (const deleteFirst of [true, false]) {
    const [l, j] = [await user(), await user()];
    const g = await guild(l);
    const release = await hold('SELECT 1 FROM guilds WHERE id = $1 FOR UPDATE', [g.id]);
    let done: PromiseSettledResult<unknown>[];
    try {
      const joining = (pool: Pool) => asUser(pool, j.userId, c => c.query('SELECT guild_join($1)', [g.code]));
      const firstCall = deleteFirst ? del(db.app, l) : joining(db.app);
      await waitForLockWaiters(1);
      const secondCall = deleteFirst ? joining(second) : del(second, l);
      await waitForLockWaiters(2);
      await release();
      done = await Promise.allSettled([firstCall, secondCall]);
    } catch (e) {
      await release().catch(() => {});
      throw e;
    }
    if (deleteFirst) {
      assert.deepEqual(done.map(outcome), ['ok', 'INVITE_CODE_INVALID']);
      assert.equal((await db.admin.query('SELECT 1 FROM guilds WHERE id = $1', [g.id])).rowCount, 0);
    } else {
      assert.deepEqual(done.map(outcome), ['ok', 'ok']);
      assert.deepEqual(await members(g.id), [`${j.userId}:LEADER`]);
    }
  }
});

test('race: the purge vs a login of the account: the login is null either way, the purge skips a user it cannot lock now and takes it on the next run, the email is free afterwards', async () => {
  const login = (pool: Pool, who: User) =>
    asAnon(pool, c =>
      c.query<{ id: string | null }>('SELECT auth_login($1, $2, $3) AS id', [who.email, who.key, randomBytes(32)]),
    ).then(r => r.rows[0].id);
  const purge = (pool: Pool) =>
    asJob(pool, c => c.query<{ n: number }>('SELECT job_account_purge($1) AS n', [NOON])).then(r => r.rows[0].n);
  const due = async (who: User) => {
    await asUser(db.app, who.userId, c => c.query('SELECT account_delete($1)', [who.key]));
    await db.admin.query('UPDATE users SET purge_after = $2 WHERE id = $1', [who.userId, NOON]);
  };

  // a login in flight (the auth lock of the email held): the purge does not wait for it
  {
    const me = await user();
    await due(me);
    const release = await hold('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth:${me.email}`]);
    let id: string | null;
    try {
      const logging = login(db.app, me);
      await waitForLockWaiters(1);
      assert.equal(await purge(second), 1);
      await release();
      id = await logging;
    } catch (e) {
      await release().catch(() => {});
      throw e;
    }
    assert.equal(id, null);
    assert.equal((await db.admin.query('SELECT 1 FROM sessions WHERE user_id = $1', [me.userId])).rowCount, 0);
  }
  // a transaction holding a key-share lock on the users row (a row being written that refers to
  // it): skipped now, purged by the next run
  {
    const me = await user();
    await due(me);
    const release = await hold('SELECT 1 FROM users WHERE id = $1 FOR KEY SHARE', [me.userId]);
    try {
      assert.equal(await purge(second), 0);
    } finally {
      await release();
    }
    assert.equal(await purge(second), 1);
  }
  // free rounds
  for (let round = 0; round < 6; round++) {
    const me = await user();
    await due(me);
    const [id, n] = await Promise.all([login(db.app, me), purge(second)]);
    assert.deepEqual([id, n], [null, 1], `round ${round}`);
    const again = await asAnon(db.app, c =>
      c.query<{ id: string }>('SELECT auth_register($1, $2, $3, $4, $5) AS id', [
        me.email,
        'Lại',
        randomBytes(16),
        randomBytes(32),
        randomBytes(32),
      ]),
    );
    assert.ok(again.rows[0].id);
  }
});
