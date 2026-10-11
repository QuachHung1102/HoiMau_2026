import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export type Role = 'app_anon' | 'app_auth' | 'app_job';

// SET ROLE takes an identifier, which cannot be a parameter: the statements are written out here
// and nothing else in the server builds one.
const SET_ROLE: Record<Role, string> = {
  app_anon: 'SET LOCAL ROLE app_anon',
  app_auth: 'SET LOCAL ROLE app_auth',
  app_job: 'SET LOCAL ROLE app_job',
};

/**
 * Switches the open transaction to `role`. The user id is always written, '' for "nobody": a
 * value left on the pooled connection by anything else must never become the identity here.
 */
export async function setRole(
  client: PoolClient,
  role: Role,
  userId: string | null,
): Promise<void> {
  await client.query(SET_ROLE[role]);
  await client.query("SELECT set_config('app.user_id', $1, true)", [
    userId ?? '',
  ]);
}

/**
 * One transaction on one pooled client, as `role`: COMMIT when `work` returns, ROLLBACK when it
 * throws. Role and user id are transaction-local, so nothing is left on the connection.
 * READ COMMITTED, the default, on purpose: under REPEATABLE READ concurrent writers of one row
 * fail with 40001 instead of waiting (measured on auth_login: nine of ten parallel logins failed
 * and the attempt counter under-counted).
 *
 * Outside such a transaction a statement runs as plain app_conn, which may not even use the
 * schemas: it fails with 42501, 42P01 or 42883. That is the fence; never answer it with a grant.
 */
export async function withRole<T>(
  pool: Pool,
  role: Role,
  userId: string | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await setRole(client, role, userId);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    // a connection that cannot roll back may still carry the role: it does not go back to the pool
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw e;
  } finally {
    client.release(broken);
  }
}

/** The pool of the server process: `databaseUrl` names the role app_conn, never the owner. */
export function createPool(
  databaseUrl: string,
  onIdleError: (e: Error) => void,
): Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // without a listener the error of an idle client (the database restarted) ends the process
  pool.on('error', onIdleError);
  return pool;
}
