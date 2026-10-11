import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';

type Work<T> = (client: PoolClient) => Promise<T>;

/** The request transaction: role and user id are transaction-local, so nothing leaks to the pool. */
async function asRole<T>(
  pool: Pool,
  role: 'app_anon' | 'app_auth' | 'app_job',
  userId: string | null,
  work: Work<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    // SET ROLE takes an identifier, not a parameter: `role` is one of three literals, never data.
    await client.query(`SET LOCAL ROLE ${role}`);
    // Always set, also to "no user": a value left on the session by anything else must not
    // become the identity of this request.
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      userId ?? '',
    ]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw e;
  } finally {
    client.release(broken);
  }
}

export const asUser = <T>(pool: Pool, userId: string, work: Work<T>) =>
  asRole(pool, 'app_auth', userId, work);
export const asAnon = <T>(pool: Pool, work: Work<T>) =>
  asRole(pool, 'app_anon', null, work);
export const asJob = <T>(pool: Pool, work: Work<T>) =>
  asRole(pool, 'app_job', null, work);

/** Freeze `app.now()` at `iso` in this database, or pass null to return to real time. */
export async function setTestClock(
  admin: Pool,
  iso: string | null,
): Promise<void> {
  if (iso === null) {
    await admin.query('DELETE FROM meta.test_clock');
  } else {
    await admin.query(
      'INSERT INTO meta.test_clock (now) VALUES ($1) ON CONFLICT (one) DO UPDATE SET now = EXCLUDED.now',
      [iso],
    );
  }
}

/**
 * Passes only when the promise rejects with exactly this SQLSTATE and a message starting with
 * the prefix. "It threw something" proves nothing: 42501 alone covers both a missing GRANT and
 * a policy refusal, and an unrelated error (not found, null violation) must fail the test.
 */
export async function expectPgError(
  promise: Promise<unknown>,
  expected: { code: string; messagePrefix: string },
): Promise<void> {
  await assert.rejects(promise, (e: unknown) => {
    const { code, message } = e as { code?: string; message?: string };
    assert.equal(code, expected.code, `SQLSTATE of "${message}"`);
    assert.ok(
      message?.startsWith(expected.messagePrefix),
      `"${message}" does not start with "${expected.messagePrefix}"`,
    );
    return true;
  });
}
