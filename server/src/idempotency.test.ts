// Idempotent writes through HTTP on the real database: one execution per (user, key), replay of
// the stored 2xx answer, and nobody but the owner of a key ever sees what is stored under it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  asAnon,
  asUser,
  expectPgError,
  setTestClock,
} from '../test/helpers.ts';
import { newUser, startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import type { Route } from './app.ts';
import { AppError, errorResponse } from './errors.ts';
import { idempotencyKey, requestHash } from './idempotency.ts';

/** How often the probe handler ran, per label. */
const runs = new Map<string, number>();
const ran = (label: string) => runs.get(label) ?? 0;
/** Labels whose next execution returns an error (commits), or throws (rolls back). */
const returnErrorOnce = new Set<string>();
const throwOnce = new Set<string>();

type ProbeBody = { label: string; value?: unknown };

const probes: Route[] = [
  {
    method: 'POST',
    path: '/probe/act/:slot',
    auth: 'session',
    idempotent: true,
    handler: async ctx => {
      const { label, value } = ctx.body as ProbeBody;
      runs.set(label, ran(label) + 1);
      await ctx.db.query('SELECT probe_hit($1)', [label]);
      await ctx.db.query('SELECT pg_sleep(0.03)'); // long enough for requests to overlap
      if (returnErrorOnce.delete(label)) {
        return errorResponse('DAY_CLOSED');
      }
      if (throwOnce.delete(label)) {
        throw new AppError('DAY_CLOSED');
      }
      return {
        status: 201,
        body: {
          run: ran(label),
          userId: ctx.userId,
          actionId: ctx.actionId,
          slot: ctx.params.slot,
          value,
          secret: `secret of ${ctx.userId}`,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/probe/silent',
    auth: 'session',
    idempotent: true,
    handler: async ctx => {
      const { label } = ctx.body as ProbeBody;
      runs.set(label, ran(label) + 1);
      return { status: 204 };
    },
  },
  {
    method: 'PATCH',
    path: '/probe/onboarded',
    auth: 'user',
    idempotent: true,
    handler: async () => ({ status: 200, body: {} }),
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
    GRANT EXECUTE ON FUNCTION probe_hit(text) TO app_auth;
  `);
  app = await startTestApp(db, { routes: probes });
});
after(async () => {
  await app.close();
  await db.drop();
});

const hits = async (label: string): Promise<number> =>
  (
    await db.admin.query(
      'SELECT count(*)::int AS n FROM probe_hits WHERE name = $1',
      [label],
    )
  ).rows[0].n;

const stored = async (key: string) =>
  (
    await db.admin.query(
      'SELECT user_id, status, response, created_at FROM idempotency_keys WHERE key = $1 ORDER BY created_at',
      [key],
    )
  ).rows;

const act = (
  token: string,
  key: string | undefined,
  body: ProbeBody,
  slot = 'a',
) => app.call('POST', `/probe/act/${slot}`, { token, key, body });

test('the same key and request twice: one execution, the second answer is the first', async () => {
  const { token, userId } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  const body = {
    label,
    value: { text: 'Hồi Máu', n: [1, 2.5, null], deep: { b: 1, a: 2 } },
  };

  const first = await act(token, key, body);
  assert.equal(first.status, 201);
  assert.equal(first.body.run, 1);
  assert.equal(first.body.actionId, key);
  assert.deepEqual(first.body.value, body.value);

  const second = await act(token, key, body);
  assert.equal(second.status, first.status);
  assert.deepEqual(second.body, first.body);
  // the same body spelled with its members in another order is the same request
  const reordered = await act(token, key, {
    value: { deep: { a: 2, b: 1 }, n: [1, 2.5, null], text: 'Hồi Máu' },
    label,
  });
  assert.deepEqual(reordered.body, first.body);

  assert.equal(ran(label), 1);
  assert.equal(await hits(label), 1);
  const rows = await stored(key);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, userId);
  assert.equal(rows[0].status, 201);
  assert.deepEqual(rows[0].response, first.body);
});

test('the key is the action id, in lower case however the client wrote it', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  const upper = await act(token, key.toUpperCase(), { label });
  assert.equal(upper.body.actionId, key);
  const lower = await act(token, key, { label });
  assert.deepEqual(lower.body, upper.body);
  assert.equal(ran(label), 1);
});

test('the same key with another body, path or query: 409 IDEMPOTENCY_KEY_REUSED, nothing runs', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  assert.equal((await act(token, key, { label, value: 1 })).status, 201);

  const others = [
    await act(token, key, { label, value: 2 }),
    await act(token, key, { label, value: '1' }),
    await act(token, key, { label, value: 1 }, 'b'),
    await app.call('POST', '/probe/act/a?x=1', {
      token,
      key,
      body: { label, value: 1 },
    }),
    await app.call('POST', '/probe/silent', {
      token,
      key,
      body: { label, value: 1 },
    }),
  ];
  for (const result of others) {
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  }
  assert.equal(ran(label), 1);
  // the original request still replays
  assert.equal((await act(token, key, { label, value: 1 })).body.run, 1);
});

test('no key, or a key that is not a UUID: 400 IDEMPOTENCY_KEY_REQUIRED, nothing runs', async () => {
  const { token } = await newUser(db);
  const label = randomUUID();
  for (const key of [
    undefined,
    '',
    'abc',
    `${randomUUID()}x`,
    randomUUID().replaceAll('-', ''),
    `{${randomUUID()}}`,
  ]) {
    const result = await act(token, key, { label });
    assert.equal(result.status, 400, String(key));
    assert.equal(result.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  assert.equal(ran(label), 0);
  assert.equal(idempotencyKey(['a', 'b']), null);
  // the session comes first: without one the key is not even looked at
  assert.equal((await act('garbage', undefined, { label })).status, 401);
});

test('an answer that is not 2xx is not stored: the retry runs again, and then it is stored', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();

  returnErrorOnce.add(label);
  const refused = await act(token, key, { label });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'DAY_CLOSED');
  assert.equal(ran(label), 1);
  assert.equal(await hits(label), 1); // returned, so committed
  assert.deepEqual(
    (await stored(key)).map(row => [row.status, row.response]),
    [[null, null]],
  );

  const retried = await act(token, key, { label });
  assert.equal(retried.status, 201);
  assert.equal(retried.body.run, 2);
  const replayed = await act(token, key, { label });
  assert.deepEqual(replayed.body, retried.body);
  assert.equal(ran(label), 2);
});

test('a request that throws leaves no key behind', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();

  throwOnce.add(label);
  assert.equal((await act(token, key, { label })).status, 409);
  assert.equal(await hits(label), 0); // rolled back, key row included
  assert.deepEqual(await stored(key), []);
  // so the same key may even carry a corrected request
  const corrected = await act(token, key, { label, value: 'fixed' });
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.value, 'fixed');
});

test('20 requests at once with one key: one execution, 20 identical answers', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => act(token, key, { label, value: 'x' })),
  );
  assert.equal(ran(label), 1);
  assert.equal(await hits(label), 1);
  for (const result of results) {
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, results[0].body);
  }
  assert.equal(results[0].body.run, 1);
});

test('retries at once of a request that was refused before: still one execution', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  returnErrorOnce.add(label);
  assert.equal((await act(token, key, { label })).status, 409);
  assert.equal(ran(label), 1);

  // the key row exists and holds no answer: only its lock makes the retries take turns
  const results = await Promise.all(
    Array.from({ length: 10 }, () => act(token, key, { label })),
  );
  assert.equal(ran(label), 2);
  assert.equal(await hits(label), 2);
  for (const result of results) {
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, results[0].body);
  }
});

test('a key belongs to its user: another user with the same key and request runs fresh', async () => {
  const alice = await newUser(db);
  const bob = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  const body = { label, value: 'same' };

  const hers = await act(alice.token, key, body);
  assert.equal(hers.body.userId, alice.userId);
  const his = await act(bob.token, key, body);
  assert.equal(his.status, 201);
  assert.equal(his.body.run, 2); // executed, not replayed
  assert.equal(his.body.userId, bob.userId);
  assert.ok(!JSON.stringify(his.body).includes(alice.userId));
  assert.equal(his.body.secret, `secret of ${bob.userId}`);
  assert.equal(ran(label), 2);

  // each replays the own answer
  assert.deepEqual((await act(alice.token, key, body)).body, hers.body);
  assert.deepEqual((await act(bob.token, key, body)).body, his.body);
  assert.deepEqual(
    (await stored(key)).map(row => row.user_id).sort(),
    [alice.userId, bob.userId].sort(),
  );
  // and a different request under her key is refused for him only under his own row
  assert.equal(
    (await act(bob.token, key, { label, value: 'other' })).status,
    409,
  );
});

test('an answer without a body is replayed without one', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const label = randomUUID();
  for (let i = 0; i < 2; i++) {
    const result = await app.call('POST', '/probe/silent', {
      token,
      key,
      body: { label },
    });
    assert.equal(result.status, 204);
    assert.equal(result.body, undefined);
  }
  assert.equal(ran(label), 1);
});

test('the checks of the route come before the key: no onboarding, no key row', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  const result = await app.call('PATCH', '/probe/onboarded', {
    token,
    key,
    body: {},
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'ONBOARDING_REQUIRED');
  assert.deepEqual(await stored(key), []);
});

test('rows carry the time of app.now()', async () => {
  const { token } = await newUser(db);
  const key = randomUUID();
  // within the life of the session
  const frozen = new Date(Date.now() + 3_600_000).toISOString();
  try {
    await setTestClock(db.admin, frozen);
    await act(token, key, { label: randomUUID() });
  } finally {
    await setTestClock(db.admin, null);
  }
  assert.equal((await stored(key))[0].created_at.toISOString(), frozen);
});

test('no request role reads the table; the functions are for app_auth and name the caller only', async () => {
  const alice = await newUser(db);
  const bob = await newUser(db);
  const key = randomUUID();
  const body = { label: randomUUID() };
  const hers = await act(alice.token, key, body);
  assert.equal((await stored(key)).length, 1); // there is something to find

  const table = {
    code: '42501',
    messagePrefix: 'permission denied for table idempotency_keys',
  };
  for (const sql of [
    'SELECT * FROM idempotency_keys',
    "UPDATE idempotency_keys SET response = '{}'",
    'DELETE FROM idempotency_keys',
  ]) {
    await expectPgError(
      asUser(db.app, alice.userId, c => c.query(sql)),
      table,
    );
    await expectPgError(
      asAnon(db.app, c => c.query(sql)),
      table,
    );
  }
  const hash = requestHash('POST', '/api/v1/probe/act/a', body);
  await expectPgError(
    asAnon(db.app, c =>
      c.query('SELECT * FROM idempotency_begin($1, $2)', [key, hash]),
    ),
    {
      code: '42501',
      messagePrefix: 'permission denied for function idempotency_begin',
    },
  );
  await expectPgError(
    asAnon(db.app, c =>
      c.query("SELECT idempotency_store($1, 200, '{}')", [key]),
    ),
    {
      code: '42501',
      messagePrefix: 'permission denied for function idempotency_store',
    },
  );

  // the control: with her own identity the function hands her stored answer back
  const own = await asUser(db.app, alice.userId, c =>
    c.query('SELECT * FROM idempotency_begin($1, $2)', [key, hash]),
  );
  assert.deepEqual(own.rows, [
    { same_request: true, status: 201, response: hers.body },
  ]);
  // Bob, calling the function directly with her key and her request, gets a row of his own
  // (rolled back here, so nothing of this test stays)
  await assert.rejects(
    asUser(db.app, bob.userId, async c => {
      const { rows } = await c.query(
        'SELECT * FROM idempotency_begin($1, $2)',
        [key, hash],
      );
      assert.deepEqual(rows, [
        { same_request: true, status: null, response: null },
      ]);
      // and he cannot write into hers: his own row is the one that takes the answer
      await c.query('SELECT idempotency_store($1, 200, $2::jsonb)', [
        key,
        '{"by":"bob"}',
      ]);
      throw new Error('roll back');
    }),
    /roll back/,
  );
  assert.deepEqual(
    (await stored(key)).map(row => row.response),
    [hers.body],
  );
  // without a user, and for an answer that is not 2xx, the functions refuse
  await expectPgError(
    asUser(db.app, alice.userId, async c => {
      await c.query("SELECT set_config('app.user_id', '', true)");
      await c.query('SELECT * FROM idempotency_begin($1, $2)', [key, hash]);
    }),
    { code: 'P0001', messagePrefix: 'idempotency_begin: needs a user' },
  );
  await expectPgError(
    asUser(db.app, alice.userId, c =>
      c.query("SELECT idempotency_store($1, 200, '{}')", [randomUUID()]),
    ),
    {
      code: 'P0001',
      messagePrefix: 'idempotency_store: the caller holds no open key',
    },
  );
});
