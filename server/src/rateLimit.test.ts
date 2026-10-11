// The in-process limiter on its own, then through HTTP: AR-21 limits per account and per client
// address, the limits of a route, and that the test app runs without them unless asked.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { newUser, startTestApp } from '../test/http.ts';
import type { CallResult, TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import { createApp } from './app.ts';
import type { Route } from './app.ts';
import { createLogger } from './log.ts';
import { HOUR_MS, MINUTE_MS, createRateLimiter } from './rateLimit.ts';

test('fixed window: the limit holds until the window that began at the first hit is over', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter(() => now);
  assert.deepEqual(
    [1, 2, 3].map(() => limiter.hit('a', 3, MINUTE_MS)),
    [0, 0, 0],
  );
  assert.equal(limiter.hit('a', 3, MINUTE_MS), 60);
  now += 59_001;
  assert.equal(limiter.hit('a', 3, MINUTE_MS), 1); // 999 ms left: never "retry after 0"
  assert.equal(limiter.hit('b', 3, MINUTE_MS), 0); // another key has its own window
  assert.equal(limiter.hit('a', 3, HOUR_MS), 0); // and so has another window length
  now += 999;
  assert.equal(limiter.hit('a', 3, MINUTE_MS), 0); // the next window starts at 1 again
  assert.equal(limiter.hit('a', 3, MINUTE_MS), 0);
  assert.equal(limiter.hit('a', 3, MINUTE_MS), 0);
  assert.equal(limiter.hit('a', 3, MINUTE_MS), 60);
});

test('windows that are over are swept: the map does not grow with clients that never return', () => {
  let now = 0;
  const limiter = createRateLimiter(() => now);
  for (let i = 0; i < 1000; i++) {
    limiter.hit(`ip ${i}`, 300, MINUTE_MS);
  }
  limiter.hit('export', 5, HOUR_MS);
  assert.equal(limiter.size(), 1001);
  now = MINUTE_MS - 1;
  limiter.sweep();
  assert.equal(limiter.size(), 1001);
  now = MINUTE_MS;
  limiter.sweep();
  assert.equal(limiter.size(), 1); // the hour window is still running
  now = HOUR_MS;
  limiter.sweep();
  assert.equal(limiter.size(), 0);
});

let prepared = 0;
const ok = async () => ({ status: 204 });
const probes: Route[] = [
  { method: 'POST', path: '/probe/write', auth: 'session', handler: ok },
  { method: 'PATCH', path: '/probe/write', auth: 'session', handler: ok },
  { method: 'GET', path: '/probe/read', auth: 'session', handler: ok },
  { method: 'POST', path: '/probe/open', auth: 'anon', handler: ok },
  { method: 'GET', path: '/probe/open', auth: 'anon', handler: ok },
  {
    method: 'POST',
    path: '/probe/auth-like',
    auth: 'anon',
    rateLimit: { perMinute: 3 },
    prepare: async () => {
      prepared++;
    },
    handler: ok,
  },
  {
    method: 'GET',
    path: '/probe/export-like',
    auth: 'session',
    rateLimit: { perHour: 2 },
    handler: ok,
  },
];

let db: TestDb;
const apps: TestApp[] = [];
const limitedApp = async (): Promise<TestApp> => {
  // a new app is a new limiter: every test counts from zero
  const app = await startTestApp(db, { routes: probes, rateLimits: true });
  apps.push(app);
  return app;
};
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await Promise.all(apps.map(app => app.close()));
  await db.drop();
});

function assertLimited(result: CallResult, maxSeconds: number): void {
  assert.equal(result.status, 429);
  assert.equal(result.body.error.code, 'RATE_LIMITED');
  const retryAfter = result.headers.get('retry-after') ?? '';
  assert.match(retryAfter, /^[1-9][0-9]*$/);
  assert.ok(Number(retryAfter) <= maxSeconds, retryAfter);
}

const statuses = async (calls: number, call: () => Promise<CallResult>) => {
  const seen = new Map<number, number>();
  for (let i = 0; i < calls; i++) {
    const { status } = await call();
    seen.set(status, (seen.get(status) ?? 0) + 1);
  }
  return Object.fromEntries(seen);
};

test('the 121st write of an account in a minute is 429 with Retry-After; another account is not affected', async () => {
  const app = await limitedApp();
  const alice = await newUser(db);
  const bob = await newUser(db);
  const write = (token: string, method = 'POST') =>
    app.call(method, '/probe/write', { token });

  // POST and PATCH count on the same window
  assert.deepEqual(await statuses(60, () => write(alice.token)), { 204: 60 });
  assert.deepEqual(await statuses(60, () => write(alice.token, 'PATCH')), {
    204: 60,
  });
  assertLimited(await write(alice.token), 60);
  assertLimited(await write(alice.token, 'PATCH'), 60);

  assert.equal((await write(bob.token)).status, 204);
  // reads are not writes
  assert.equal(
    (await app.call('GET', '/probe/read', { token: alice.token })).status,
    204,
  );
  // the refused request is logged with its user like any other
  const line = app.logs.findLast(entry => entry.status === 429);
  assert.equal(line?.userId, alice.userId);
});

test('the default test app has no limits: the same 121 writes all pass', async () => {
  const app = await startTestApp(db, { routes: probes });
  apps.push(app);
  const { token } = await newUser(db);
  assert.deepEqual(
    await statuses(121, () => app.call('POST', '/probe/write', { token })),
    { 204: 121 },
  );
  assert.deepEqual(
    await statuses(5, () => app.call('POST', '/probe/auth-like')),
    { 204: 5 },
  );
});

test('the 301st write from one address in a minute is 429, whoever sends it and whatever X-Forwarded-For says', async () => {
  const app = await limitedApp();
  const users = await Promise.all([newUser(db), newUser(db), newUser(db)]);
  // 3 accounts x 80 writes: no account is over its own 120, the address reaches 240
  for (const { token } of users) {
    assert.deepEqual(
      await statuses(80, () => app.call('POST', '/probe/write', { token })),
      { 204: 80 },
    );
  }
  let n = 0;
  const anonymous = () =>
    app.call('POST', '/probe/open', {
      headers: { 'x-forwarded-for': `203.0.113.${n++ % 250}` },
    });
  assert.deepEqual(await statuses(60, anonymous), { 204: 60 });
  assertLimited(await anonymous(), 60);
  assertLimited(
    await app.call('POST', '/probe/write', { token: users[0].token }),
    60,
  );
  // reads from that address still pass
  assert.equal((await app.call('GET', '/probe/open')).status, 204);
});

test('the limit of a route: per address on an anon route, checked before prepare runs', async () => {
  const app = await limitedApp();
  prepared = 0;
  const call = () => app.call('POST', '/probe/auth-like');
  assert.deepEqual(await statuses(3, call), { 204: 3 });
  assertLimited(await call(), 60);
  assert.equal(prepared, 3); // the refused request cost no work
  // other routes are not touched by it
  assert.equal((await app.call('POST', '/probe/open')).status, 204);
});

test('the limit of a route: per account on a session route, also on a GET, also per hour', async () => {
  const app = await limitedApp();
  const alice = await newUser(db);
  const bob = await newUser(db);
  const call = (token: string) =>
    app.call('GET', '/probe/export-like', { token });
  assert.deepEqual(await statuses(2, () => call(alice.token)), { 204: 2 });
  assertLimited(await call(alice.token), 3600);
  assert.equal((await call(bob.token)).status, 204);
  // a request without a session is refused as such, and counts on nobody
  assert.equal((await app.call('GET', '/probe/export-like')).status, 401);
});

test('createApp limits unless told otherwise: the switch is for tests, the default is on', async () => {
  const server = createApp({
    pool: db.app,
    mailer: async () => {},
    journalKey: Buffer.alloc(32),
    routes: probes,
    log: createLogger(() => {}),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/probe/auth-like`,
        { method: 'POST' },
      );
      await response.arrayBuffer();
      seen.push(response.status);
    }
    assert.deepEqual(seen, [204, 204, 204, 429]);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
