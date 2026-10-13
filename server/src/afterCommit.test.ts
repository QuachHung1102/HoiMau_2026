// ctx.afterCommit: runs after the COMMIT and after the answer, never for a rolled-back request.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import type { Ctx, Route } from './app.ts';
import { AppError, errorResponse } from './errors.ts';

const SECRET = 'someone-private@example.com';

let db: TestDb;
let app: TestApp;
const ran: string[] = [];
let release: () => void = () => {};
let committedWhenRun: number | null = null;

/** Writes one row: auth_reset_request counts the request, for any address, in auth_throttle. */
const write = (ctx: Ctx, key: string) =>
  ctx.db.query('SELECT auth_reset_request($1, $2)', [key, Buffer.alloc(32)]);

const probes: Route[] = [
  {
    // the answer must not wait for the queued work; the work sees the committed row
    method: 'POST',
    path: '/_t/ok',
    auth: 'anon',
    handler: async ctx => {
      await write(ctx, 'ok@example.com');
      ctx.afterCommit(async () => {
        const { rows } = await db.admin.query<{ count: number }>(
          "SELECT count FROM auth_throttle WHERE key = 'reset:ok@example.com'",
        );
        committedWhenRun = rows[0]?.count ?? 0;
        ran.push('ok');
        // never finishes until the test says so: an answer that waited for it would hang
        await new Promise<void>(resolve => (release = resolve));
        ran.push('ok finished');
      });
      return { status: 200, body: { a: 1 } };
    },
  },
  {
    method: 'POST',
    path: '/_t/thrown',
    auth: 'anon',
    handler: async ctx => {
      await write(ctx, 'thrown@example.com');
      ctx.afterCommit(async () => {
        ran.push('thrown');
      });
      throw new AppError('VALIDATION_FAILED');
    },
  },
  {
    method: 'POST',
    path: '/_t/swallowed',
    auth: 'anon',
    handler: async ctx => {
      ctx.afterCommit(async () => {
        ran.push('swallowed');
      });
      await ctx.db.query('SELECT 1/0').catch(() => {});
      return { status: 200 };
    },
  },
  {
    method: 'POST',
    path: '/_t/returned',
    auth: 'anon',
    handler: async ctx => {
      ctx.afterCommit(async () => {
        ran.push('returned 1');
      });
      ctx.afterCommit(async () => {
        ran.push('returned 2');
      });
      return errorResponse('INVALID_CREDENTIALS');
    },
  },
  {
    method: 'POST',
    path: '/_t/failing',
    auth: 'anon',
    handler: async ctx => {
      ctx.afterCommit(() => Promise.reject(new Error(`550 refused ${SECRET}`)));
      ctx.afterCommit(() => {
        throw new RangeError(`bad address ${SECRET}`);
      });
      ctx.afterCommit(async () => {
        ran.push('failing: third');
      });
      return { status: 202, body: {} };
    },
  },
];

before(async () => {
  db = await createTestDb();
  app = await startTestApp(db, { routes: probes });
});
after(async () => {
  await app.close();
  await db.drop();
});

const until = async (done: () => boolean, ms = 3000) => {
  for (let waited = 0; !done() && waited < ms; waited += 10) {
    await sleep(10);
  }
};

test('the answer does not wait for the queued work, which runs after the COMMIT', async () => {
  const res = await app.call('POST', '/_t/ok', { body: {} });
  assert.deepEqual([res.status, res.body], [200, { a: 1 }]);
  await until(() => ran.includes('ok'));
  assert.equal(committedWhenRun, 1, 'the row of the request is committed by then');
  assert.ok(!ran.includes('ok finished'), 'the work is still hanging, the answer is out');
  release();
  await until(() => ran.includes('ok finished'));
});

test('a request that ends in a thrown error, or in a lost transaction, queues nothing', async () => {
  const thrown = await app.call('POST', '/_t/thrown', { body: {} });
  assert.equal(thrown.status, 422);
  const swallowed = await app.call('POST', '/_t/swallowed', { body: {} });
  assert.equal(swallowed.status, 500);
  // the row of the thrown request was rolled back too
  const { rowCount } = await db.admin.query(
    "SELECT 1 FROM auth_throttle WHERE key = 'reset:thrown@example.com'",
  );
  assert.equal(rowCount, 0);
  await sleep(150);
  assert.ok(!ran.includes('thrown') && !ran.includes('swallowed'), ran.join());
});

test('a returned error response commits, so its queued work runs: all of it, in order', async () => {
  const res = await app.call('POST', '/_t/returned', { body: {} });
  assert.equal(res.status, 401);
  await until(() => ran.includes('returned 2'));
  assert.deepEqual(
    ran.filter(entry => entry.startsWith('returned')),
    ['returned 1', 'returned 2'],
  );
});

test('queued work that fails changes nothing of the answer, stops nothing after it, and is logged without its message', async () => {
  const res = await app.call('POST', '/_t/failing', { body: {} });
  assert.deepEqual([res.status, res.body], [202, {}]);
  const logged = () => app.logs.filter(line => line.evt === 'after_commit');
  await until(() => ran.includes('failing: third') && logged().length === 2);
  assert.ok(ran.includes('failing: third'), 'the third one ran after two failed');
  assert.deepEqual(
    logged()
      .map(line => [line.level, line.route, line.error])
      .sort(),
    [
      ['error', '/_t/failing', 'Error'],
      ['error', '/_t/failing', 'RangeError'],
    ],
  );
  assert.ok(!app.logText().includes(SECRET), 'the message of a failure is not logged');
});
