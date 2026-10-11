// The request pipeline over the real database: routing, the role switch of every request, the
// commit rule, errors, what is refused at the boundary, and what reaches the log.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { APP_CONN, TEST } from '../scripts/cluster.ts';
import { setTestClock } from '../test/helpers.ts';
import { newUser, startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import { createApp, loadRoutes } from './app.ts';
import type { Ctx, Route } from './app.ts';
import { AppError, errorResponse } from './errors.ts';
import { MAX_BODY_BYTES } from './http.ts';
import { hashToken, newToken } from './session.ts';

const STATE = `SELECT current_user::text AS role, app.current_user_id()::text AS uid,
                      pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation`;

/** What a handler sees: the database's view of the request, and the Ctx beside it. */
async function seen(ctx: Ctx) {
  const { rows } = await ctx.db.query(STATE);
  return {
    status: 200,
    body: {
      ...rows[0],
      userId: ctx.userId,
      tokenHash: ctx.tokenHash?.toString('hex') ?? null,
      actionId: ctx.actionId,
      params: ctx.params,
      query: Object.fromEntries(ctx.query),
      now: ctx.now.toISOString(),
      ip: ctx.ip,
      prepared: ctx.prepared,
      ctxKeys: Object.keys(ctx).sort(),
    },
  };
}

const hit = (ctx: Ctx, name: unknown) =>
  ctx.db.query('SELECT probe_hit($1)', [name]);
const bodyOf = (ctx: Ctx) => (ctx.body ?? {}) as Record<string, string>;

/** Set by the slow probe when its handler has started. */
let slowStarted: () => void = () => {};
const prepareSaw: { checkedOut: number; waiting: number }[] = [];
let handlerRuns = 0;

const probes: Route[] = [
  { method: 'GET', path: '/probe/anon', auth: 'anon', handler: seen },
  { method: 'GET', path: '/probe/session', auth: 'session', handler: seen },
  { method: 'GET', path: '/probe/user', auth: 'user', handler: seen },
  { method: 'GET', path: '/probe/items/special', auth: 'anon', handler: seen },
  { method: 'GET', path: '/probe/items/:id', auth: 'anon', handler: seen },
  {
    method: 'GET',
    path: '/probe/items/:id/parts/:part',
    auth: 'anon',
    handler: seen,
  },
  {
    method: 'POST',
    path: '/probe/echo',
    auth: 'anon',
    handler: async ctx => ({ status: 200, body: { got: ctx.body } }),
  },
  {
    method: 'POST',
    path: '/probe/no-content',
    auth: 'anon',
    handler: async () => ({ status: 204 }),
  },
  {
    // writes, then fails with an error of the database: 500
    method: 'POST',
    path: '/probe/crash',
    auth: 'session',
    handler: async ctx => {
      await hit(ctx, bodyOf(ctx).name);
      await ctx.db.query('SELECT 1 / 0');
      return { status: 200 };
    },
  },
  {
    method: 'POST',
    path: '/probe/write-return',
    auth: 'anon',
    handler: async ctx => {
      await hit(ctx, bodyOf(ctx).name);
      return errorResponse('DAY_CLOSED');
    },
  },
  {
    method: 'POST',
    path: '/probe/write-throw',
    auth: 'anon',
    handler: async ctx => {
      await hit(ctx, bodyOf(ctx).name);
      throw new AppError('DAY_CLOSED', { date: '2026-01-01' });
    },
  },
  {
    // a failed sign-in as the auth routes will do it: the function counts, the handler RETURNS
    method: 'POST',
    path: '/probe/login-return',
    auth: 'anon',
    handler: async ctx => {
      await ctx.db.query('SELECT auth_login($1, $2, $3)', [
        bodyOf(ctx).email,
        randomBytes(32),
        randomBytes(32),
      ]);
      return errorResponse('INVALID_CREDENTIALS');
    },
  },
  {
    method: 'POST',
    path: '/probe/login-throw',
    auth: 'anon',
    handler: async ctx => {
      await ctx.db.query('SELECT auth_login($1, $2, $3)', [
        bodyOf(ctx).email,
        randomBytes(32),
        randomBytes(32),
      ]);
      throw new AppError('INVALID_CREDENTIALS');
    },
  },
  {
    method: 'POST',
    path: '/probe/hm',
    auth: 'anon',
    handler: async ctx => {
      await ctx.db.query('SELECT probe_raise($1, $2)', [
        bodyOf(ctx).message,
        bodyOf(ctx).detail,
      ]);
      return { status: 200 };
    },
  },
  {
    // the value of the request ends up in the message of the database error
    method: 'POST',
    path: '/probe/leak',
    auth: 'session',
    handler: async ctx => {
      await ctx.db.query('SELECT $1::uuid', [bodyOf(ctx).email]);
      return { status: 200 };
    },
  },
  {
    // a statement outside a transaction runs as plain app_conn
    method: 'GET',
    path: '/probe/outside',
    auth: 'anon',
    prepare: async pre => {
      await pre.pool.query('SELECT app.now()');
    },
    handler: async () => ({ status: 200 }),
  },
  {
    // a handler reaching for a second pooled client
    method: 'GET',
    path: '/probe/handler-pool',
    auth: 'anon',
    handler: async ctx => {
      await ctx.pool.query('SELECT 1');
      return { status: 200 };
    },
  },
  {
    // writes, runs a statement that fails, swallows the error and reports success
    method: 'POST',
    path: '/probe/swallow',
    auth: 'anon',
    handler: async ctx => {
      await hit(ctx, bodyOf(ctx).name);
      await ctx.db.query('SELECT 1 / 0').catch(() => {});
      return { status: 200, body: { saved: true } };
    },
  },
  {
    // the same with a counted failure that is returned: the count would be lost in silence
    method: 'POST',
    path: '/probe/swallow-login',
    auth: 'anon',
    handler: async ctx => {
      await ctx.db.query('SELECT auth_login($1, $2, $3)', [
        bodyOf(ctx).email,
        randomBytes(32),
        randomBytes(32),
      ]);
      await ctx.db.query('SELECT 1 / 0').catch(() => {});
      return errorResponse('INVALID_CREDENTIALS');
    },
  },
  {
    // answers with whatever status the body names
    method: 'POST',
    path: '/probe/status',
    auth: 'anon',
    handler: async ctx => {
      const { name, status } = (ctx.body ?? {}) as {
        name: string;
        status: unknown;
      };
      await hit(ctx, name);
      return { status: status as number, body: {} };
    },
  },
  {
    // errors that are not database errors, with input of the request in their message
    method: 'POST',
    path: '/probe/throw',
    auth: 'session',
    handler: async ctx => {
      const { kind, email, secret } = bodyOf(ctx);
      if (kind === 'zone') {
        new Intl.DateTimeFormat('en', { timeZone: email }).format(0);
      } else if (kind === 'bigint') {
        BigInt(email);
      } else if (kind === 'mail') {
        await ctx.mailer({ to: email, subject: 's', text: 't' });
      } else {
        // a message of several lines, the later ones dressed up as stack frames
        const lf = String.fromCharCode(10);
        throw new Error(
          `first line${lf}    at ${secret} (${email}:1:1)${lf}    at ${email}`,
        );
      }
      return { status: 200 };
    },
  },
  {
    method: 'POST',
    path: '/probe/slow',
    auth: 'anon',
    handler: async ctx => {
      slowStarted();
      await ctx.db.query('SELECT pg_sleep(0.4)');
      handlerRuns++;
      return { status: 200, body: {} };
    },
  },
  {
    method: 'POST',
    path: '/probe/prepare',
    auth: 'anon',
    prepare: async pre => {
      const body = (pre.body ?? {}) as { refuse?: boolean };
      if (body.refuse) {
        throw new AppError('VALIDATION_FAILED', {
          fields: [{ field: 'refuse', rule: 'enum' }],
        });
      }
      await sleep(20); // the slow work
      prepareSaw.push({
        checkedOut: pre.pool.totalCount - pre.pool.idleCount,
        waiting: pre.pool.waitingCount,
      });
      return { fromPrepare: true, keys: Object.keys(pre).sort() };
    },
    handler: async ctx => {
      handlerRuns++;
      return seen(ctx);
    },
  },
];

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  await db.admin.query(`
    CREATE TABLE probe_hits (name text NOT NULL, user_id uuid);
    CREATE FUNCTION probe_hit(p_name text) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
    AS 'INSERT INTO probe_hits (name, user_id) VALUES (p_name, app.current_user_id())';
    CREATE FUNCTION probe_raise(p_message text, p_detail text) RETURNS void
    LANGUAGE plpgsql
    AS 'BEGIN RAISE EXCEPTION ''%'', p_message USING ERRCODE = ''HM000'', DETAIL = p_detail; END';
    GRANT EXECUTE ON FUNCTION probe_hit(text), probe_raise(text, text) TO app_anon, app_auth;
  `);
  app = await startTestApp(db, { routes: probes });
});
after(async () => {
  await app.close();
  await db.drop();
});

const hits = async (name: string): Promise<number> =>
  (
    await db.admin.query(
      'SELECT count(*)::int AS n FROM probe_hits WHERE name = $1',
      [name],
    )
  ).rows[0].n;

const errorCode = (result: { body: { error?: { code?: string } } }) =>
  result.body?.error?.code;

/** Logged lines of requests, newest last. */
const requestLines = () => app.logs.filter(line => 'route' in line);

// ---------------------------------------------------------------------------------------------
// Routing

test('an unknown route answers 404 with the error body of the contract', async () => {
  for (const [method, path] of [
    ['GET', '/nowhere'],
    ['POST', '/healthz'], // the path exists, the method does not
    ['GET', '/probe/items'],
    ['GET', '/probe/items/1/2'],
    ['DELETE', '/probe/anon'],
  ]) {
    const result = await app.call(method, path);
    assert.equal(result.status, 404, `${method} ${path}`);
    assert.deepEqual(Object.keys(result.body), ['error']);
    assert.deepEqual(Object.keys(result.body.error), ['code', 'message']);
    assert.equal(result.body.error.code, 'NOT_FOUND');
    assert.equal(typeof result.body.error.message, 'string');
    assert.match(
      result.headers.get('content-type') ?? '',
      /^application\/json/,
    );
  }
  // outside the base path
  const response = await fetch(app.baseUrl.replace('/api/v1', '/healthz'));
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(await response.text()).error.code, 'NOT_FOUND');
});

test('path parameters are decoded, a literal path wins, a malformed one names nothing', async () => {
  const one = await app.call(
    'GET',
    '/probe/items/c%C3%A0%20ph%C3%AA?size=l%E1%BB%9Bn',
  );
  assert.deepEqual(one.body.params, { id: 'cà phê' });
  assert.deepEqual(one.body.query, { size: 'lớn' });
  const two = await app.call('GET', '/probe/items/a%2Fb/parts/7');
  assert.deepEqual(two.body.params, { id: 'a/b', part: '7' });
  const literal = await app.call('GET', '/probe/items/special');
  assert.deepEqual(literal.body.params, {});

  for (const path of [
    '/probe/items/%E0%A4%A', // not percent-encoding
    '/probe/items/%', // not percent-encoding
    '/probe/items/a%00b', // U+0000
    '/probe/items//parts/1', // empty parameter
  ]) {
    const result = await app.call('GET', path);
    assert.equal(result.status, 404, path);
    assert.equal(errorCode(result), 'NOT_FOUND');
  }
  const query = await app.call('GET', '/probe/anon?from=2026%00');
  assert.equal(query.status, 422);
  assert.deepEqual(query.body.error, {
    code: 'VALIDATION_FAILED',
    message: 'validation failed',
    details: { fields: [{ field: 'from', rule: 'format' }] },
  });
});

test('a route table that cannot be served as declared is refused at startup', async () => {
  const deps = {
    pool: db.app,
    mailer: async () => {},
    journalKey: Buffer.alloc(32),
  };
  const route = (over: Partial<Route>): Route =>
    ({
      method: 'POST',
      path: '/x',
      auth: 'session',
      handler: seen,
      ...over,
    } as Route);
  assert.throws(
    () => createApp({ ...deps, routes: [route({}), route({})] }),
    /^Error: duplicate route POST \/x$/,
  );
  assert.throws(
    () =>
      createApp({
        ...deps,
        routes: [route({ path: '/a/:x/b' }), route({ path: '/a/:y/b' })],
      }),
    /^Error: duplicate route POST \/a\/:y\/b$/,
  );
  // the same path under two methods is two routes
  createApp({ ...deps, routes: [route({}), route({ method: 'PATCH' })] });
  assert.throws(
    () =>
      createApp({
        ...deps,
        routes: [route({ auth: 'anon', idempotent: true })],
      }),
    /only a write with a session can be idempotent/,
  );
  assert.throws(
    () =>
      createApp({
        ...deps,
        routes: [route({ method: 'GET', idempotent: true })],
      }),
    /only a write with a session can be idempotent/,
  );
  assert.throws(
    () =>
      createApp({
        ...deps,
        routes: [
          {
            method: 'GET',
            path: '/x',
            auth: 'session',
            direct: async () => ({ status: 200 }),
          },
        ],
      }),
    /a route without a transaction must be anon/,
  );
  // prepare runs before the session is known: only an anon route may have one
  for (const auth of ['session', 'user'] as const) {
    assert.throws(
      () =>
        createApp({
          ...deps,
          routes: [route({ auth, prepare: async () => {} })],
        }),
      /^Error: POST \/x: prepare is for anon routes only$/,
    );
  }
  createApp({
    ...deps,
    routes: [route({ auth: 'anon', prepare: async () => {} })],
  });
  // handler and direct exclude each other; tsc says so too, a cast gets past it
  const direct = async () => ({ status: 200 });
  const anonymous = { method: 'GET', path: '/x', auth: 'anon' };
  assert.throws(
    () =>
      createApp({
        ...deps,
        routes: [{ ...anonymous, direct, handler: seen } as unknown as Route],
      }),
    /^Error: GET \/x: a route has either a handler or direct$/,
  );
  assert.throws(
    () => createApp({ ...deps, routes: [anonymous as unknown as Route] }),
    /^Error: GET \/x: a route has either a handler or direct$/,
  );
  assert.throws(
    () =>
      createApp({
        ...deps,
        routes: [
          { ...anonymous, direct, prepare: async () => {} } as unknown as Route,
        ],
      }),
    /^Error: GET \/x: prepare belongs to a handler, not to direct$/,
  );
});

test('loadRoutes takes the default export of every file that is not a test', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hm-routes-'));
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const dir = join(root, 'routes');
    await mkdir(dir);
    const file = (path: string) =>
      `export default [{ method: 'GET', path: '${path}', auth: 'anon', handler: async () => ({ status: 200 }) }];`;
    await writeFile(join(dir, 'b.ts'), file('/b'));
    await writeFile(join(dir, 'a.ts'), file('/a'));
    await writeFile(
      join(dir, 'a.test.ts'),
      'throw new Error("a test was loaded");',
    );
    await writeFile(join(dir, 'notes.md'), 'not a module');
    assert.deepEqual(
      (await loadRoutes(dir)).map(route => route.path),
      ['/a', '/b'],
    );
    await writeFile(join(dir, 'c.ts'), 'export const routes = [];');
    await assert.rejects(
      loadRoutes(dir),
      /^Error: routes\/c\.ts must default-export a Route\[\]$/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// The role of a request

test('an anon route runs as app_anon with no user, whatever Authorization says', async () => {
  const { token } = await newUser(db);
  for (const options of [
    {},
    { token }, // a live session changes nothing: auth_* functions are open to app_anon only
    { token: 'garbage' },
    { headers: { authorization: 'Basic dXNlcjpwYXNz' } },
  ]) {
    const result = await app.call('GET', '/probe/anon', options);
    assert.equal(result.status, 200);
    assert.equal(result.body.role, 'app_anon');
    assert.equal(result.body.uid, null);
    assert.equal(result.body.userId, null);
    assert.equal(result.body.tokenHash, null);
    assert.equal(result.body.actionId, null);
  }
});

test('a session route runs as app_auth as the user of the session, at READ COMMITTED', async () => {
  const { userId, token } = await newUser(db);
  const result = await app.call('GET', '/probe/session', { token });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, 'app_auth');
  assert.equal(result.body.uid, userId);
  assert.equal(result.body.userId, userId);
  assert.equal(result.body.isolation, 'read committed');
  // the handler gets the hash, and the token itself is nowhere in what it gets
  assert.equal(result.body.tokenHash, hashToken(token).toString('hex'));
  assert.ok(!JSON.stringify(result.body).includes(token));
  assert.equal(result.body.ip, '127.0.0.1');
  assert.deepEqual(result.body.ctxKeys, [
    'actionId',
    'body',
    'db',
    'ip',
    'journalKey',
    'log',
    'mailer',
    'now',
    'params',
    'pool',
    'prepared',
    'query',
    'tokenHash',
    'userId',
  ]);
  assert.equal(
    (await app.call('GET', '/probe/anon')).body.isolation,
    'read committed',
  );
});

test('ctx.now is app.now()', async () => {
  const frozen = '2027-03-01T20:15:00.000Z';
  try {
    await setTestClock(db.admin, frozen);
    assert.equal((await app.call('GET', '/probe/anon')).body.now, frozen);
  } finally {
    await setTestClock(db.admin, null);
  }
});

test('no token, a malformed header, an unknown, revoked or expired session: 401 SESSION_INVALID', async () => {
  const { token, userId } = await newUser(db);
  const refused = async (
    options: Parameters<TestApp['call']>[2],
    why: string,
  ) => {
    for (const path of ['/probe/session', '/probe/user']) {
      const result = await app.call('GET', path, options);
      assert.equal(result.status, 401, why);
      assert.equal(errorCode(result), 'SESSION_INVALID', why);
    }
  };
  // the control: this very token works, so each refusal below is about its own difference
  assert.equal(
    (await app.call('GET', '/probe/session', { token })).status,
    200,
  );

  await refused({}, 'no header');
  await refused({ token: 'garbage' }, 'not a token');
  await refused({ token: newToken() }, 'a token nobody was given');
  await refused({ token: `${token}x` }, 'a longer token');
  await refused({ token: token.slice(1) }, 'a shorter token');
  for (const [authorization, why] of [
    [`bearer ${token}`, 'scheme in lower case'],
    [`Bearer  ${token}`, 'two spaces'],
    [`Bearer ${token}, Bearer ${token}`, 'two values'],
    [`Basic ${token}`, 'another scheme'],
    [token, 'no scheme'],
    ['Bearer', 'no token'],
  ]) {
    await refused({ headers: { authorization } }, why);
  }

  try {
    await setTestClock(
      db.admin,
      new Date(Date.now() + 31 * 86_400_000).toISOString(),
    );
    await refused({ token }, 'expired');
  } finally {
    await setTestClock(db.admin, null);
  }
  assert.equal(
    (await app.call('GET', '/probe/session', { token })).status,
    200,
  );
  await db.admin.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1',
    [userId],
  );
  await refused({ token }, 'revoked');
});

test('a user route needs completed onboarding: 409 ONBOARDING_REQUIRED until then', async () => {
  const { token, userId } = await newUser(db);
  const early = await app.call('GET', '/probe/user', { token });
  assert.equal(early.status, 409);
  assert.equal(errorCode(early), 'ONBOARDING_REQUIRED');
  // a session route does not ask
  assert.equal(
    (await app.call('GET', '/probe/session', { token })).status,
    200,
  );

  await db.admin.query('UPDATE users SET onboarded_at = now() WHERE id = $1', [
    userId,
  ]);
  const later = await app.call('GET', '/probe/user', { token });
  assert.equal(later.status, 200);
  assert.equal(later.body.uid, userId);
  // somebody else's onboarding is not mine
  const other = await newUser(db);
  assert.equal(
    (await app.call('GET', '/probe/user', { token: other.token })).status,
    409,
  );
});

test('after a request that threw, its connection carries no role and no user', async () => {
  // one connection: every request, and the look at the session afterwards, share it
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: TEST.port,
    ...APP_CONN,
    database: db.name,
    max: 1,
  });
  const single = await startTestApp({ ...db, app: pool }, { routes: probes });
  try {
    const { token, userId } = await newUser(db);
    const session =
      "SELECT current_user::text AS role, current_setting('app.user_id', true) AS uid, pg_backend_pid() AS pid";
    const name = randomUUID();

    const ok = await single.call('GET', '/probe/session', { token });
    assert.equal(ok.body.uid, userId);
    assert.deepEqual((await pool.query(session)).rows[0], {
      role: 'app_conn',
      uid: '',
      pid: ok.body.pid,
    });

    const crash = await single.call('POST', '/probe/crash', {
      token,
      body: { name },
    });
    assert.equal(crash.status, 500);
    assert.deepEqual((await pool.query(session)).rows[0], {
      role: 'app_conn',
      uid: '',
      pid: ok.body.pid, // the very connection the failed request ran on
    });
    assert.equal(await hits(name), 0);

    // and the next request on it is nobody
    const next = await single.call('GET', '/probe/anon');
    assert.equal(next.body.pid, ok.body.pid);
    assert.equal(next.body.role, 'app_anon');
    assert.equal(next.body.uid, null);
  } finally {
    await single.close();
    await pool.end();
  }
});

test('a user id left on the connection never becomes the identity of a request', async () => {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: TEST.port,
    ...APP_CONN,
    database: db.name,
    max: 1,
  });
  const single = await startTestApp({ ...db, app: pool }, { routes: probes });
  try {
    const stale = await newUser(db);
    const { token, userId } = await newUser(db);
    // set for the session, as a bug or a careless script would: it outlives every transaction
    await pool.query("SELECT set_config('app.user_id', $1, false)", [
      stale.userId,
    ]);
    const { rows } = await pool.query(
      "SELECT current_setting('app.user_id', true) AS uid",
    );
    assert.equal(rows[0].uid, stale.userId); // the stale value really is on the connection

    const anonymous = await single.call('GET', '/probe/anon');
    assert.equal(anonymous.body.role, 'app_anon');
    assert.equal(anonymous.body.uid, null);
    const own = await single.call('GET', '/probe/session', { token });
    assert.equal(own.body.uid, userId);
    // and a connection found with a user id on it does not go back to the pool: the second
    // request ran on a new one, which is clean
    assert.notEqual(own.body.pid, anonymous.body.pid);
    const { rows: now } = await pool.query(
      "SELECT coalesce(current_setting('app.user_id', true), '') AS uid, pg_backend_pid() AS pid",
    );
    assert.deepEqual(now[0], { uid: '', pid: own.body.pid });
  } finally {
    await single.close();
    await pool.end();
  }
});

test('a statement outside a transaction runs as plain app_conn and is refused', async () => {
  const result = await app.call('GET', '/probe/outside');
  assert.equal(result.status, 500);
  const line = requestLines().at(-1);
  assert.equal(line?.route, '/probe/outside');
  assert.equal(line?.code, '42501');
});

test('a handler cannot take a second pooled client: ctx.pool throws there', async () => {
  const checkedOut = () => db.app.totalCount - db.app.idleCount;
  const result = await app.call('GET', '/probe/handler-pool');
  assert.equal(result.status, 500);
  const line = requestLines().at(-1);
  assert.equal(line?.route, '/probe/handler-pool');
  assert.equal(line?.error, 'Error');
  assert.equal(line?.code, undefined); // not an answer of the database: the guard itself
  assert.equal(checkedOut(), 0);
});

// ---------------------------------------------------------------------------------------------
// Commit rule and errors

test('a handler that returns an error commits; one that throws rolls back', async () => {
  const kept = randomUUID();
  const returned = await app.call('POST', '/probe/write-return', {
    body: { name: kept },
  });
  assert.equal(returned.status, 409);
  assert.equal(errorCode(returned), 'DAY_CLOSED');
  assert.equal(await hits(kept), 1);

  const lost = randomUUID();
  const thrown = await app.call('POST', '/probe/write-throw', {
    body: { name: lost },
  });
  assert.equal(thrown.status, 409);
  assert.deepEqual(thrown.body.error, {
    code: 'DAY_CLOSED',
    message: 'day closed',
    details: { date: '2026-01-01' },
  });
  assert.equal(await hits(lost), 0);
});

test('a failed sign-in that is returned stays counted; thrown, the count is lost', async () => {
  const attempts = async (email: string): Promise<number | undefined> =>
    (
      await db.admin.query('SELECT count FROM auth_throttle WHERE key = $1', [
        `login:${email}`,
      ])
    ).rows[0]?.count;

  const email = `${randomUUID()}@example.com`;
  for (const expected of [1, 2]) {
    const result = await app.call('POST', '/probe/login-return', {
      body: { email },
    });
    assert.equal(result.status, 401);
    assert.equal(errorCode(result), 'INVALID_CREDENTIALS');
    // read on another connection: the count is committed
    assert.equal(await attempts(email), expected);
  }

  const other = `${randomUUID()}@example.com`;
  const thrown = await app.call('POST', '/probe/login-throw', {
    body: { email: other },
  });
  assert.equal(thrown.status, 401);
  assert.equal(await attempts(other), undefined);
});

test('SQLSTATE HM000 becomes the error its message names, with the details of its DETAIL', async () => {
  const closed = await app.call('POST', '/probe/hm', {
    body: { message: 'DAY_CLOSED', detail: '{}' },
  });
  assert.equal(closed.status, 409);
  assert.deepEqual(closed.body, {
    error: { code: 'DAY_CLOSED', message: 'day closed' },
  });

  const invalid = await app.call('POST', '/probe/hm', {
    body: {
      message: 'VALIDATION_FAILED',
      detail: '{"fields":[{"field":"email","rule":"format"}]}',
    },
  });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.error.details, {
    fields: [{ field: 'email', rule: 'format' }],
  });

  // DETAIL that is not a JSON object is dropped, the code stands
  for (const detail of ['not json', '[1]', '']) {
    const result = await app.call('POST', '/probe/hm', {
      body: { message: 'NOT_LEADER', detail },
    });
    assert.equal(result.status, 403);
    assert.deepEqual(Object.keys(result.body.error), ['code', 'message']);
  }
  // a message that is no error code is a bug, not an answer
  const unknown = await app.call('POST', '/probe/hm', {
    body: { message: 'SOMETHING_ELSE', detail: '{}' },
  });
  assert.equal(unknown.status, 500);
});

test('any other failure is 500 INTERNAL with nothing of it in the response', async () => {
  const { token } = await newUser(db);
  const result = await app.call('POST', '/probe/crash', {
    token,
    body: { name: 'x' },
  });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: { code: 'INTERNAL', message: 'internal' },
  });
  const line = requestLines().at(-1);
  assert.equal(line?.level, 'error');
  assert.equal(line?.error, 'DatabaseError');
  assert.equal(line?.code, '22012');
  assert.ok(String(line?.stack).includes('app.test.ts')); // the stack stays on the server
});

test('a handler that swallows a database error and returns is not answered as a success', async () => {
  // PostgreSQL answers the COMMIT of a failed transaction with ROLLBACK
  const name = randomUUID();
  const swallowed = await app.call('POST', '/probe/swallow', {
    body: { name },
  });
  assert.equal(swallowed.status, 500);
  assert.equal(errorCode(swallowed), 'INTERNAL');
  assert.equal(await hits(name), 0);
  const line = requestLines().at(-1);
  assert.equal(line?.level, 'error');
  assert.equal(line?.route, '/probe/swallow');

  // a returned error that counts on being committed: the count is gone, and the answer says so
  const email = `${randomUUID()}@example.com`;
  const counted = await app.call('POST', '/probe/swallow-login', {
    body: { email },
  });
  assert.equal(counted.status, 500);
  assert.equal(errorCode(counted), 'INTERNAL');
  const { rows } = await db.admin.query(
    'SELECT count FROM auth_throttle WHERE key = $1',
    [`login:${email}`],
  );
  assert.deepEqual(rows, []);
  // the connections are fine afterwards
  assert.equal((await app.call('GET', '/probe/anon')).status, 200);
  assert.equal(db.app.totalCount - db.app.idleCount, 0);
});

test('a status that is no HTTP status is a bug of the route: rolled back, 500, logged', async () => {
  for (const status of [99, 199, 600, 200.5, '200', null, -1]) {
    const name = randomUUID();
    const result = await app.call('POST', '/probe/status', {
      body: { name, status },
    });
    assert.equal(result.status, 500, String(status));
    assert.equal(errorCode(result), 'INTERNAL');
    assert.equal(await hits(name), 0, String(status));
    const line = requestLines().at(-1);
    assert.equal(line?.level, 'error');
    assert.equal(line?.status, 500);
  }
  // the control: the probe does commit with a real status
  const name = randomUUID();
  const fine = await app.call('POST', '/probe/status', {
    body: { name, status: 418 },
  });
  assert.equal(fine.status, 418);
  assert.equal(await hits(name), 1);
});

// ---------------------------------------------------------------------------------------------
// The boundary

/** Escapes are written by code point: no backslash sequence in this file for a tool to rewrite. */
const BACKSLASH = String.fromCharCode(92);
const NUL_ESCAPE = `${BACKSLASH}u0000`;

test('a body must be declared JSON and be JSON: otherwise 400 BAD_JSON', async () => {
  const json = { 'content-type': 'application/json' };
  const bad: [string, Parameters<TestApp['call']>[2]][] = [
    ['not JSON', { rawBody: '{"a":', headers: json }],
    ['a bare word', { rawBody: 'hello', headers: json }],
    [
      'no content type',
      { rawBody: '{"a":1}', headers: { 'content-type': '' } },
    ],
    [
      'text/plain',
      { rawBody: '{"a":1}', headers: { 'content-type': 'text/plain' } },
    ],
    [
      'a form',
      {
        rawBody: 'a=1',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    ],
    [
      'U+0000 in a value',
      { rawBody: `{"a":"x${NUL_ESCAPE}y"}`, headers: json },
    ],
    [
      'U+0000 in a nested value',
      { rawBody: `{"a":[{"b":["${NUL_ESCAPE}"]}]}`, headers: json },
    ],
    [
      'U+0000 in a member name',
      { rawBody: `{"a${NUL_ESCAPE}":1}`, headers: json },
    ],
    // half of a surrogate pair: JSON may spell it, jsonb cannot store it
    [
      'a lone high surrogate',
      { rawBody: `{"a":"x${BACKSLASH}ud83dy"}`, headers: json },
    ],
    [
      'a lone low surrogate, nested',
      { rawBody: `[[{"a":"${BACKSLASH}ude00"}]]`, headers: json },
    ],
    [
      'a lone surrogate in a member name',
      { rawBody: `{"${BACKSLASH}ud800":1}`, headers: json },
    ],
    [
      'nested 33 deep',
      { rawBody: `${'['.repeat(33)}${']'.repeat(33)}`, headers: json },
    ],
  ];
  for (const [why, options] of bad) {
    const result = await app.call('POST', '/probe/echo', options);
    assert.equal(result.status, 400, why);
    assert.equal(errorCode(result), 'BAD_JSON', why);
  }
  const invalidUtf8 = await fetch(`${app.baseUrl}/probe/echo`, {
    method: 'POST',
    headers: json,
    body: Buffer.from([0x22, 0xc3, 0x28, 0x22]),
  });
  assert.equal(invalidUtf8.status, 400);

  // accepted: Vietnamese, a charset parameter, a backslash followed by "u0000" as plain text,
  // 32 levels, no body at all
  const text = `Hồi Máu ${BACKSLASH}${NUL_ESCAPE}`;
  const ok = await app.call('POST', '/probe/echo', {
    rawBody: JSON.stringify({ text }),
    headers: { 'content-type': 'Application/JSON; charset=utf-8' },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { got: { text } });
  assert.equal(
    (
      await app.call('POST', '/probe/echo', {
        rawBody: `${'['.repeat(32)}${']'.repeat(32)}`,
        headers: json,
      })
    ).status,
    200,
  );
  assert.deepEqual((await app.call('POST', '/probe/echo')).body, {});
  const empty = await app.call('POST', '/probe/no-content');
  assert.equal(empty.status, 204);
  assert.equal(empty.body, undefined);
});

test('a body over 64 KiB is 413 PAYLOAD_TOO_LARGE, with or without a Content-Length', async () => {
  const sized = (bytes: number) => JSON.stringify({ a: 'x'.repeat(bytes - 8) });
  assert.equal(Buffer.byteLength(sized(MAX_BODY_BYTES)), MAX_BODY_BYTES);
  const fits = await app.call('POST', '/probe/echo', {
    rawBody: sized(MAX_BODY_BYTES),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(fits.status, 200);

  const over = await app.call('POST', '/probe/echo', {
    rawBody: sized(MAX_BODY_BYTES + 1),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(over.status, 413);
  assert.equal(errorCode(over), 'PAYLOAD_TOO_LARGE');

  // chunked: nothing announces the size, the limit is met while reading
  const chunked = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const { port } = app.server.address() as AddressInfo;
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/api/v1/probe/echo', method: 'POST' },
        res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.setHeader('content-type', 'application/json');
      req.write('"');
      for (let i = 0; i < 9; i++) {
        req.write('x'.repeat(8 * 1024));
      }
      req.end('"');
    },
  );
  assert.equal(chunked.status, 413);
  assert.equal(JSON.parse(chunked.body).error.code, 'PAYLOAD_TOO_LARGE');
  // the server is still there
  assert.equal((await app.call('GET', '/healthz')).status, 200);
});

test('a request Node cannot parse gets the error body too: header block over its limit, broken syntax', async () => {
  const { port } = app.server.address() as AddressInfo;
  const crlf = String.fromCharCode(13, 10);
  const raw = (lines: string[]) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let received = '';
      socket.on('data', chunk => (received += chunk));
      socket.on('close', () => resolve(received));
      socket.on('error', reject);
      socket.write(lines.join(crlf));
    });
  const errorOf = (answer: string) =>
    JSON.parse(answer.slice(answer.indexOf('{'))).error;

  // the URL is part of the header block: 16 KiB for both together
  const long = await raw([
    `GET /api/v1/healthz?${'a'.repeat(20_000)} HTTP/1.1`,
    'host: x',
    '',
    '',
  ]);
  assert.ok(long.startsWith('HTTP/1.1 431 '), long.slice(0, 40));
  assert.equal(errorOf(long).code, 'PAYLOAD_TOO_LARGE');
  const manyHeaders = await raw([
    'GET /api/v1/healthz HTTP/1.1',
    'host: x',
    `x-filler: ${'a'.repeat(20_000)}`,
    '',
    '',
  ]);
  assert.ok(manyHeaders.startsWith('HTTP/1.1 431 '), manyHeaders.slice(0, 40));

  const broken = await raw(['this is not http', '', '']);
  assert.ok(broken.startsWith('HTTP/1.1 400 '), broken.slice(0, 40));
  assert.deepEqual(Object.keys(errorOf(broken)), ['code', 'message']);
  assert.equal((await app.call('GET', '/healthz')).status, 200);
});

test('a client that goes away while its request runs gets its pooled client released', async () => {
  await app.call('GET', '/probe/anon'); // the pool holds a connection now
  const idle = db.app.idleCount;
  const total = db.app.totalCount;
  const runs = handlerRuns;

  const started = new Promise<void>(resolve => {
    slowStarted = resolve;
  });
  const abort = new AbortController();
  const call = app.call('POST', '/probe/slow', {
    body: {},
    signal: abort.signal,
  });
  await started;
  // the control: while the handler runs, one client is out
  assert.equal(db.app.totalCount - db.app.idleCount, 1);
  abort.abort();
  await assert.rejects(call, { name: 'AbortError' });

  for (let i = 0; db.app.idleCount !== idle && i < 100; i++) {
    await sleep(20);
  }
  assert.equal(db.app.idleCount, idle);
  assert.equal(db.app.totalCount, total);
  assert.equal(handlerRuns, runs + 1); // the work itself was not cut short, and it committed
  assert.equal((await app.call('GET', '/probe/anon')).status, 200);
});

test('a client that goes away while sending its body takes no pooled client and is logged as 499', async () => {
  const { port } = app.server.address() as AddressInfo;
  const lines = requestLines().length;
  await new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.on('error', reject);
    socket.on('close', () => resolve());
    const crlf = String.fromCharCode(13, 10);
    socket.write(
      [
        'POST /api/v1/probe/echo HTTP/1.1',
        'host: x',
        'content-type: application/json',
        'content-length: 100',
        '',
        '{"a":',
      ].join(crlf),
      () => setTimeout(() => socket.destroy(), 50),
    );
  });
  for (let i = 0; requestLines().length === lines && i < 100; i++) {
    await sleep(20);
  }
  const line = requestLines().at(-1);
  assert.equal(line?.route, '/probe/echo');
  assert.equal(line?.status, 499);
  assert.equal(db.app.totalCount - db.app.idleCount, 0);
});

// ---------------------------------------------------------------------------------------------
// prepare: work before the transaction

test('prepare runs before the transaction, with no pooled client held, and hands its result on', async () => {
  await app.call('GET', '/probe/anon'); // the pool is not empty, so "nothing out" is not vacuous
  assert.ok(db.app.totalCount > 0);
  prepareSaw.length = 0;

  const result = await app.call('POST', '/probe/prepare', { body: {} });
  assert.equal(result.status, 200);
  assert.deepEqual(prepareSaw, [{ checkedOut: 0, waiting: 0 }]);
  assert.deepEqual(result.body.prepared, {
    fromPrepare: true,
    // no client, no user, no clock yet
    keys: [
      'actionId',
      'body',
      'ip',
      'journalKey',
      'log',
      'mailer',
      'params',
      'pool',
      'query',
      'tokenHash',
    ],
  });
  assert.equal(result.body.role, 'app_anon');

  // a refusal thrown by prepare is answered without the handler, and without a transaction
  const runs = handlerRuns;
  const refused = await app.call('POST', '/probe/prepare', {
    body: { refuse: true },
  });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body.error.details, {
    fields: [{ field: 'refuse', rule: 'enum' }],
  });
  assert.equal(handlerRuns, runs);
});

// ---------------------------------------------------------------------------------------------
// The log

test('one JSON line per request: route pattern, status, user; never a value of the request', async () => {
  const { token, userId } = await newUser(db);
  const already = app.logs.length;
  await app.call('POST', '/probe/echo?weight=65.5', {
    body: { weightKg: '65.5', note: 'secret-in-body' },
  });
  await app.call('GET', '/probe/items/secret-in-path?q=secret-in-query', {
    token,
  });
  await app.call('GET', '/probe/session', { token });
  await app.call('GET', '/secret-in-unknown-path');

  const lines = app.logs.slice(already);
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.deepEqual(Object.keys(line), [
      'ts',
      'level',
      'method',
      'route',
      'status',
      'ms',
      'userId',
    ]);
    assert.ok(!Number.isNaN(Date.parse(String(line.ts))));
    assert.equal(line.level, 'info');
    assert.equal(typeof line.ms, 'number');
  }
  assert.deepEqual(
    lines.map(({ method, route, status, userId: user }) => [
      method,
      route,
      status,
      user,
    ]),
    [
      ['POST', '/probe/echo', 200, null],
      ['GET', '/probe/items/:id', 200, null], // an anon route does not look at the token
      ['GET', '/probe/session', 200, userId],
      ['GET', null, 404, null],
    ],
  );
  const text = app.logText();
  for (const value of [
    '65.5',
    'secret-in-body',
    'secret-in-path',
    'secret-in-query',
    'secret-in-unknown-path',
  ]) {
    assert.ok(!text.includes(value), value);
  }
});

test('no token, token hash or email reaches the log, on a 500 and on a 401 either', async () => {
  const { token, email } = await newUser(db);
  const stranger = newToken();
  // the control: the database error really carries the value
  await assert.rejects(db.admin.query('SELECT $1::uuid', [email]), (e: Error) =>
    e.message.includes(email),
  );

  const crash = await app.call('POST', '/probe/leak', {
    token,
    body: { email },
  });
  assert.equal(crash.status, 500);
  assert.ok(!JSON.stringify(crash.body).includes(email));
  const line = requestLines().at(-1);
  assert.equal(line?.level, 'error');
  assert.equal(line?.code, '22P02');
  assert.equal(line?.message, undefined);

  await app.call('GET', '/probe/session', { token: stranger });
  await app.call('POST', '/probe/login-return', { token, body: { email } });
  await app.call('POST', '/probe/echo', {
    token,
    rawBody: email,
    headers: { 'content-type': 'application/json' },
  });

  const text = app.logText();
  for (const [what, value] of [
    ['token', token],
    ['unknown token', stranger],
    ['token hash, hex', hashToken(token).toString('hex')],
    ['token hash, base64', hashToken(token).toString('base64')],
    ['email', email],
    ['Bearer', 'Bearer'],
  ]) {
    assert.ok(!text.includes(value), what);
  }
});

test('the message of an error that is not a database error is not logged either', async () => {
  const { token, email } = await newUser(db);
  const secret = newToken();
  // a mail server answers with the address it refused
  const rejecting = await startTestApp(db, {
    routes: probes,
    mailer: async message => {
      throw new Error(`550 5.1.1 <${message.to}>: Recipient address rejected`);
    },
  });
  try {
    // the control: each of these errors really carries the address in its message
    assert.throws(
      () => new Intl.DateTimeFormat('en', { timeZone: email }),
      (e: Error) => e instanceof RangeError && e.message.includes(email),
    );
    assert.throws(
      () => BigInt(email),
      (e: Error) => e instanceof SyntaxError && e.message.includes(email),
    );

    const expected: Record<string, string> = {
      zone: 'RangeError',
      bigint: 'SyntaxError',
      mail: 'Error',
      lines: 'Error',
    };
    for (const [kind, error] of Object.entries(expected)) {
      const result = await rejecting.call('POST', '/probe/throw', {
        token,
        body: { kind, email, secret },
      });
      assert.equal(result.status, 500, kind);
      assert.ok(!JSON.stringify(result.body).includes(email), kind);
      const line = rejecting.logs.at(-1);
      assert.equal(line?.level, 'error', kind);
      assert.equal(line?.error, error, kind);
      assert.equal(line?.message, undefined, kind);
      // what is kept of the stack: where it was thrown, every row a frame
      const rows = String(line?.stack).split(String.fromCharCode(10));
      assert.ok(
        rows.some(row => row.includes('app.test.ts')),
        kind,
      );
      assert.ok(
        rows.every(row => row.startsWith('    at ')),
        kind,
      );
    }
    const text = rejecting.logText();
    assert.ok(!text.includes(email));
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('Recipient'));
    assert.ok(!text.includes('first line'));
  } finally {
    await rejecting.close();
  }
});

test('a body the server does not read is not swallowed: the answer closes the connection', async () => {
  const { port } = app.server.address() as AddressInfo;
  const { token } = await newUser(db);
  const crlf = String.fromCharCode(13, 10);
  const megabyte = Buffer.alloc(1024 * 1024, 'x');
  const announced = 20 * megabyte.length;

  for (const [why, requestLine, extra, status] of [
    ['an unknown route', 'POST /api/v1/nowhere HTTP/1.1', [], 404],
    ['no session', 'POST /api/v1/probe/crash HTTP/1.1', [], 401],
    [
      'a GET, which has no body to read',
      'GET /api/v1/probe/session HTTP/1.1',
      [`authorization: Bearer ${token}`],
      200,
    ],
    ['over the limit', 'POST /api/v1/probe/echo HTTP/1.1', [], 413],
  ] as const) {
    // the server's end of the next connection
    const accepted = new Promise<Socket>(resolve =>
      app.server.once('connection', resolve),
    );
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let received = '';
      let sent = 0;
      const more = () => {
        // keep sending for as long as the server takes it, up to what was announced
        while (sent < announced) {
          sent += megabyte.length;
          if (!socket.write(megabyte)) {
            break;
          }
        }
      };
      socket.on('drain', more);
      socket.on('data', chunk => {
        received += chunk;
        more();
      });
      socket.on('error', () => {}); // a reset is one way the server may say "enough"
      socket.on('close', () => resolve(received));
      setTimeout(() => reject(new Error(`${why}: still open`)), 5000).unref();
      socket.write(
        [
          requestLine,
          'host: x',
          'content-type: application/json',
          `content-length: ${announced}`,
          ...extra,
          '',
          '',
        ].join(crlf),
      );
    });
    const server = await accepted;
    assert.ok(answer.startsWith(`HTTP/1.1 ${status} `), `${why}: ${answer}`);
    assert.ok(answer.toLowerCase().includes('connection: close'), why);
    assert.ok(server.destroyed, why);
    // 20 MB were announced and on offer; the server took a small part of them
    assert.ok(
      server.bytesRead < 4 * megabyte.length,
      `${why}: read ${server.bytesRead} bytes`,
    );
  }
  // a request whose body was read, or that has none, keeps its connection
  const kept = await fetch(`${app.baseUrl}/probe/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.notEqual(kept.headers.get('connection'), 'close');
  await kept.arrayBuffer();
  const bodyless = await fetch(`${app.baseUrl}/nowhere`);
  assert.equal(bodyless.status, 404);
  assert.notEqual(bodyless.headers.get('connection'), 'close');
  await bodyless.arrayBuffer();
});
