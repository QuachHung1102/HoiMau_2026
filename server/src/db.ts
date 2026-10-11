// The only file of the server that writes transaction control or a role switch (a test scans the
// rest of src for it): everything else runs inside `withRole`.
import pg from 'pg';
import type { Pool, PoolClient, QueryResult } from 'pg';

export type Role = 'app_anon' | 'app_auth' | 'app_job';

// SET ROLE takes an identifier, which cannot be a parameter: the statements are written out here
// and nothing else in the server builds one.
const SET_ROLE: Record<Role, string> = {
  app_anon: 'SET LOCAL ROLE app_anon',
  app_auth: 'SET LOCAL ROLE app_auth',
  app_job: 'SET LOCAL ROLE app_job',
};

// Ends the transaction and, in the same round trip, looks at what is left on the session: a
// connection that goes back to the pool is plain app_conn with no user id.
const LEFT_CLEAN =
  "SELECT current_user = session_user AND coalesce(current_setting('app.user_id', true), '') = '' AS clean";
const END = {
  COMMIT: `COMMIT; ${LEFT_CLEAN}`,
  ROLLBACK: `ROLLBACK; ${LEFT_CLEAN}`,
};

async function end(
  client: PoolClient,
  how: keyof typeof END,
): Promise<{ command: string; clean: boolean }> {
  // two statements in one simple query: pg answers with one result per statement
  const [ended, left] = (await client.query(END[how])) as unknown as [
    QueryResult,
    QueryResult<{ clean: boolean }>,
  ];
  return { command: ended.command, clean: left.rows[0].clean };
}

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
 * It throws, and nothing is committed, when
 *   - a statement of `work` failed and `work` returned all the same: PostgreSQL answers the
 *     COMMIT of a failed transaction with ROLLBACK, and reporting success would be a lie;
 *   - the connection is lost while `work` runs (the server ends a session that sits idle in a
 *     transaction): `work` is not waited for any longer.
 * The client is destroyed instead of going back to the pool when it cannot be rolled back, when
 * it was lost, or when it is left with a role or a user id (somebody ended the transaction
 * inside `work` and set them for the session).
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
  let destroy = false;
  // The pool listens for errors of idle clients only: without a listener here, a session ended
  // by the server while it is checked out would be an uncaught 'error' event.
  let lose: (e: Error) => void = () => {};
  const lost = new Promise<never>((_, reject) => {
    lose = reject;
  });
  lost.catch(() => {});
  const onError = (e: Error) => {
    destroy = true;
    lose(e);
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    await setRole(client, role, userId);
    const running = work(client);
    running.catch(() => {}); // when the connection is lost first, nobody reads its rejection
    const result = await Promise.race([running, lost]);
    const { command, clean } = await end(client, 'COMMIT');
    destroy = !clean;
    if (command !== 'COMMIT') {
      throw new Error(`the transaction had failed: COMMIT answered ${command}`);
    }
    return result;
  } catch (e) {
    if (!destroy) {
      destroy = await end(client, 'ROLLBACK').then(
        ({ clean }) => !clean,
        () => true,
      );
    }
    throw e;
  } finally {
    client.off('error', onError);
    client.release(destroy);
  }
}

export type PoolOptions = {
  max: number;
  /** Waiting for a free pooled client, or for a new connection. */
  connectMs: number;
  /** One statement. A job that needs longer says so inside its transaction: SET LOCAL statement_timeout. */
  statementMs: number;
  /** Waiting for a lock: a row another request holds, the idempotency key of a request in flight. */
  lockMs: number;
  /** A transaction that sends nothing: the server ends the session. */
  idleInTransactionMs: number;
};

export const POOL_DEFAULTS: PoolOptions = {
  max: 10,
  connectMs: 5_000,
  statementMs: 10_000,
  lockMs: 5_000,
  idleInTransactionMs: 15_000,
};

/**
 * The pool of the server process: `databaseUrl` names the role app_conn, never the owner. The
 * three server-side timeouts are sent with the start-up packet, so they hold for every
 * connection of the pool from its first statement.
 */
export function createPool(
  databaseUrl: string,
  onIdleError: (e: Error) => void,
  options: PoolOptions = POOL_DEFAULTS,
): Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max,
    connectionTimeoutMillis: options.connectMs,
    statement_timeout: options.statementMs,
    lock_timeout: options.lockMs,
    idle_in_transaction_session_timeout: options.idleInTransactionMs,
  });
  // without a listener the error of an idle client (the database restarted) ends the process
  pool.on('error', onIdleError);
  return pool;
}
