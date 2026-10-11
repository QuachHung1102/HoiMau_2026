// Nothing waits for ever: the time-outs of the server's pool, what a request gets when one of
// them strikes, and what happens to a pooled client that cannot be trusted any more. The pools
// here are made by `createPool`, as the server makes its own, with shorter times where a test
// would otherwise wait for seconds.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Pool } from 'pg';
import { APP_CONN, TEST } from '../scripts/cluster.ts';
import { newUser, serverPool, startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import type { Ctx, Route } from './app.ts';
import { POOL_DEFAULTS, createPool } from './db.ts';
import type { PoolOptions } from './db.ts';

/** Resolved by a probe when its handler has started; reports the backend it runs on. */
let started: (pid: number) => void = () => {};
const nextStart = () =>
  new Promise<number>(resolve => {
    started = resolve;
  });
let runs = 0;

const begin = async (ctx: Ctx): Promise<number> => {
  const { name } = (ctx.body ?? {}) as { name?: string };
  await ctx.db.query('SELECT probe_hit($1)', [name ?? 'unnamed']);
  const { rows } = await ctx.db.query('SELECT pg_backend_pid() AS pid');
  runs++;
  started(rows[0].pid);
  return rows[0].pid;
};

const probes: Route[] = [
  {
    method: 'GET',
    path: '/probe/pid',
    auth: 'anon',
    handler: async ctx => {
      const { rows } = await ctx.db.query(
        'SELECT pg_backend_pid() AS pid, current_user::text AS role',
      );
      return { status: 200, body: rows[0] };
    },
  },
  {
    // one statement that takes `seconds`
    method: 'POST',
    path: '/probe/statement',
    auth: 'anon',
    handler: async ctx => {
      await begin(ctx);
      const { seconds } = ctx.body as { seconds: number };
      await ctx.db.query('SELECT pg_sleep($1)', [seconds]);
      return { status: 200, body: {} };
    },
  },
  {
    // waits for a row somebody else has locked
    method: 'POST',
    path: '/probe/locked-row',
    auth: 'anon',
    handler: async ctx => {
      await begin(ctx);
      await ctx.db.query('SELECT probe_touch()');
      return { status: 200, body: {} };
    },
  },
  {
    // holds its transaction open and sends nothing for `ms`; ms 0 = never comes back
    method: 'POST',
    path: '/probe/idle',
    auth: 'anon',
    handler: async ctx => {
      await begin(ctx);
      const { ms } = ctx.body as { ms: number };
      // unref'd: a probe that is still "working" must not keep the test process alive
      await (ms === 0
        ? new Promise(() => {})
        : sleep(ms, undefined, { ref: false }));
      return { status: 200, body: {} };
    },
  },
  {
    method: 'POST',
    path: '/probe/slow-action',
    auth: 'session',
    idempotent: true,
    handler: async ctx => {
      const pid = await begin(ctx);
      await ctx.db.query('SELECT pg_sleep(1.2)');
      return { status: 201, body: { pid, run: runs } };
    },
  },
  {
    // what no route may do: end the transaction itself and leave a role and a user behind
    method: 'POST',
    path: '/probe/hostile',
    auth: 'session',
    handler: async ctx => {
      const pid = await begin(ctx);
      await ctx.db.query('COMMIT');
      await ctx.db.query('SET ROLE app_auth');
      await ctx.db.query("SELECT set_config('app.user_id', $1, false)", [
        ctx.userId,
      ]);
      return { status: 200, body: { pid } };
    },
  },
];

let db: TestDb;
const closers: (() => Promise<unknown>)[] = [];
before(async () => {
  db = await createTestDb();
  await db.admin.query(`
    CREATE TABLE probe_hits (name text NOT NULL, user_id uuid);
    CREATE TABLE probe_row (id int PRIMARY KEY, n int NOT NULL);
    INSERT INTO probe_row VALUES (1, 0);
    CREATE FUNCTION probe_hit(p_name text) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
    AS 'INSERT INTO probe_hits (name, user_id) VALUES (p_name, app.current_user_id())';
    CREATE FUNCTION probe_touch() RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
    AS 'UPDATE probe_row SET n = n + 1 WHERE id = 1';
    GRANT EXECUTE ON FUNCTION probe_hit(text), probe_touch() TO app_anon, app_auth;
  `);
});
after(async () => {
  for (const close of closers.reverse()) {
    await close();
  }
  await db.drop();
});

/** An app over a pool of its own; both are closed after the file. */
async function appWith(
  options: Partial<PoolOptions>,
): Promise<{ app: TestApp; pool: Pool }> {
  const pool = serverPool(db, options);
  const app = await startTestApp({ ...db, app: pool }, { routes: probes });
  closers.push(
    () => pool.end(),
    () => app.close(),
  );
  return { app, pool };
}

const hits = async (name: string): Promise<number> =>
  (
    await db.admin.query(
      'SELECT count(*)::int AS n FROM probe_hits WHERE name = $1',
      [name],
    )
  ).rows[0].n;

const checkedOut = (pool: Pool) => pool.totalCount - pool.idleCount;

async function settled(pool: Pool): Promise<void> {
  for (let i = 0; checkedOut(pool) > 0 && i < 100; i++) {
    await sleep(20);
  }
}

/** A refusal that tells the client nothing: no SQL text, no time-out, no number. */
function assertOpaque500(result: { status: number; body: unknown }): void {
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: { code: 'INTERNAL', message: 'internal' },
  });
}

const timed = async <T>(
  work: Promise<T>,
): Promise<{ result: T; ms: number }> => {
  const from = performance.now();
  const result = await work;
  return { result, ms: performance.now() - from };
};

test('every connection of the server pool carries the time-outs: 10 s statement, 5 s lock, 15 s idle in transaction, 5 s to connect', async () => {
  // no options: what main.ts gets
  const pool = createPool(
    `postgres://${APP_CONN.user}:${APP_CONN.password}@127.0.0.1:${TEST.port}/${db.name}`,
    () => {},
  );
  try {
    assert.deepEqual(POOL_DEFAULTS, {
      max: 10,
      connectMs: 5000,
      statementMs: 10_000,
      lockMs: 5000,
      idleInTransactionMs: 15_000,
    });
    assert.equal(pool.options.max, 10);
    assert.equal(pool.options.connectionTimeoutMillis, 5000);
    // three connections at once, so three different sessions
    const clients = await Promise.all([
      pool.connect(),
      pool.connect(),
      pool.connect(),
    ]);
    try {
      const seen = await Promise.all(
        clients.map(async client => {
          const settings = [];
          for (const name of [
            'statement_timeout',
            'lock_timeout',
            'idle_in_transaction_session_timeout',
          ]) {
            settings.push((await client.query(`SHOW ${name}`)).rows[0][name]);
          }
          const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
          return { pid: rows[0].pid, settings };
        }),
      );
      assert.equal(new Set(seen.map(({ pid }) => pid)).size, 3);
      for (const { settings } of seen) {
        assert.deepEqual(settings, ['10s', '5s', '15s']);
      }
    } finally {
      clients.forEach(client => client.release());
    }
  } finally {
    await pool.end();
  }
});

test('a statement over the limit: 500 INTERNAL, rolled back, the client back in the pool, one log line', async () => {
  const { app, pool } = await appWith({ statementMs: 300 });
  const name = randomUUID();
  const { result, ms } = await timed(
    app.call('POST', '/probe/statement', { body: { name, seconds: 3 } }),
  );
  assertOpaque500(result);
  assert.ok(ms < 2000, `answered after ${ms} ms`);
  assert.equal(await hits(name), 0);
  const lines = app.logs.filter(line => line.route === '/probe/statement');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'error');
  assert.equal(lines[0].code, '57014'); // query_canceled
  assert.equal(lines[0].message, undefined);
  await settled(pool);
  assert.equal(checkedOut(pool), 0);
  // the same connection serves the next request
  assert.equal(pool.totalCount, 1);
  assert.equal((await app.call('GET', '/probe/pid')).status, 200);
});

test('a lock that does not come free: 500 INTERNAL after the lock time-out, rolled back, logged', async () => {
  const { app, pool } = await appWith({ lockMs: 300 });
  const name = randomUUID();
  const holder = await db.admin.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('UPDATE probe_row SET n = n + 1 WHERE id = 1');
    const { result, ms } = await timed(
      app.call('POST', '/probe/locked-row', { body: { name } }),
    );
    assertOpaque500(result);
    assert.ok(ms < 2000, `answered after ${ms} ms`);
    const line = app.logs.at(-1);
    assert.equal(line?.code, '55P03'); // lock_not_available
    assert.equal(await hits(name), 0);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }
  await settled(pool);
  assert.equal(checkedOut(pool), 0);
  // with the lock gone the same request goes through
  assert.equal(
    (await app.call('POST', '/probe/locked-row', { body: { name } })).status,
    200,
  );
});

test('a transaction that sits idle is ended by the server: 500, the dead client leaves the pool, the process lives', async () => {
  const { app, pool } = await appWith({ idleInTransactionMs: 300 });
  for (const ms of [5000, 0]) {
    // 5000: a handler busy elsewhere for 5 s; 0: a handler that never returns at all
    const name = randomUUID();
    const begun = nextStart();
    const call = timed(app.call('POST', '/probe/idle', { body: { name, ms } }));
    const pid = await begun;
    const { result, ms: took } = await call;
    assertOpaque500(result);
    assert.ok(took < 2500, `answered after ${took} ms`);
    assert.equal(await hits(name), 0);
    const line = app.logs.at(-1);
    assert.equal(line?.route, '/probe/idle');
    assert.equal(line?.level, 'error');
    // 25P03 idle_in_transaction_session_timeout, or the connection found closed
    assert.ok(
      line?.code === '25P03' || line?.error === 'Error',
      JSON.stringify(line),
    );
    await settled(pool);
    assert.equal(pool.totalCount, 0); // destroyed, not returned
    const next = await app.call('GET', '/probe/pid');
    assert.equal(next.status, 200);
    assert.notEqual(next.body.pid, pid);
  }
});

test('no free pooled client: the request gives up after the connect time-out, 500, logged', async () => {
  const { app } = await appWith({ max: 1, connectMs: 300 });
  const begun = nextStart();
  const first = app.call('POST', '/probe/statement', {
    body: { name: randomUUID(), seconds: 3 },
  });
  await begun; // the only client is out, for 3 s
  const { result, ms } = await timed(app.call('GET', '/probe/pid'));
  assertOpaque500(result);
  assert.ok(ms >= 250 && ms < 2500, `answered after ${ms} ms`);
  const line = app.logs.at(-1);
  assert.equal(line?.route, '/probe/pid');
  assert.equal(line?.level, 'error');
  assert.equal((await first).status, 200);
  assert.equal((await app.call('GET', '/probe/pid')).status, 200);
});

test('/healthz answers within 2 s whatever the pool does: no free client, a port nobody listens on', async () => {
  // the only client is held, and the pool would wait 30 s for it
  const { app, pool } = await appWith({ max: 1, connectMs: 30_000 });
  const held = await pool.connect();
  try {
    const { result, ms } = await timed(app.call('GET', '/healthz'));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: false, db: false, jobs: [] });
    assert.ok(ms >= 1900 && ms < 2600, `answered after ${ms} ms`);
    assert.deepEqual(
      app.logs.map(line => [line.level, line.evt ?? line.route, line.error]),
      [
        ['error', 'health', 'HealthTimeout'],
        ['info', '/healthz', undefined],
      ],
    );
  } finally {
    // the abandoned check was still queued for this client: let it take it, then end
    held.release();
  }
  assert.deepEqual((await app.call('GET', '/healthz')).body, {
    ok: true,
    db: true,
    jobs: [],
  });

  // port 9 (discard) on this machine: nothing listens there
  const nowhere = createPool(
    'postgres://app_conn:app_conn_dev@127.0.0.1:9/nothing',
    () => {},
  );
  const unreachable = await startTestApp({ ...db, app: nowhere });
  closers.push(
    () => nowhere.end(),
    () => unreachable.close(),
  );
  const { result, ms } = await timed(unreachable.call('GET', '/healthz'));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: false, db: false, jobs: [] });
  assert.ok(ms < 2600, `answered after ${ms} ms`);
});

test('a second request with a key that is still in use waits no longer than the lock time-out: 429 with Retry-After, then the stored answer', async () => {
  const { app, pool } = await appWith({ lockMs: 300 });
  const { token } = await newUser(db);
  const key = randomUUID();
  const body = { name: randomUUID() };
  const send = () =>
    app.call('POST', '/probe/slow-action', { token, key, body });
  const ranBefore = runs;

  const begun = nextStart();
  const first = send();
  await begun;
  const { result: second, ms } = await timed(send());
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'RATE_LIMITED');
  assert.equal(second.headers.get('retry-after'), '1');
  assert.ok(ms >= 250 && ms < 1000, `answered after ${ms} ms`);
  // it gave its pooled client back at once: only the first request holds one
  assert.equal(checkedOut(pool), 1);
  const line = app.logs.at(-1);
  assert.deepEqual(
    [line?.level, line?.status, line?.note],
    ['info', 429, 'idempotency key in use'],
  );

  const original = await first;
  assert.equal(original.status, 201);
  // what the client does after Retry-After: the same request again
  const retried = await send();
  assert.equal(retried.status, 201);
  assert.deepEqual(retried.body, original.body);
  assert.equal(runs, ranBefore + 1);
  assert.equal(await hits(body.name), 1);
});

test('a client whose connection died is destroyed, not handed to the next request', async () => {
  const { app, pool } = await appWith({});
  const name = randomUUID();
  const begun = nextStart();
  const call = app.call('POST', '/probe/idle', { body: { name, ms: 1500 } });
  const pid = await begun;
  // the control: this is the backend of the request, and it is in its transaction
  const { rows } = await db.admin.query(
    'SELECT state, pg_terminate_backend(pid) AS ended FROM pg_stat_activity WHERE pid = $1',
    [pid],
  );
  assert.deepEqual(rows, [{ state: 'idle in transaction', ended: true }]);

  assertOpaque500(await call);
  assert.equal(await hits(name), 0);
  await settled(pool);
  assert.equal(pool.totalCount, 0);
  for (let i = 0; i < 3; i++) {
    const next = await app.call('GET', '/probe/pid');
    assert.equal(next.status, 200);
    assert.notEqual(next.body.pid, pid);
  }
});

test('a connection left with a role and a user id by a handler does not go back to the pool', async () => {
  const { app, pool } = await appWith({});
  const { token, userId } = await newUser(db);
  const hostile = await app.call('POST', '/probe/hostile', {
    token,
    body: { name: randomUUID() },
  });
  assert.equal(hostile.status, 200);
  await settled(pool);
  assert.equal(pool.totalCount, 0);
  // whatever runs next on the pool, also outside the pipeline, is plain app_conn and nobody
  const { rows } = await pool.query(
    "SELECT current_user::text AS role, coalesce(current_setting('app.user_id', true), '') AS uid, pg_backend_pid() AS pid",
  );
  assert.equal(rows[0].role, 'app_conn');
  assert.equal(rows[0].uid, '');
  assert.notEqual(rows[0].pid, hostile.body.pid);
  assert.notEqual(rows[0].uid, userId);
});
