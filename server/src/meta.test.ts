// The routes of src/routes as a set (parity with the contract) and the two of routes/meta.ts.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { OPERATIONS } from '../../domain/contract/operations.ts';
import { APP_CONN, TEST } from '../scripts/cluster.ts';
import { newUser, startTestApp } from '../test/http.ts';
import type { TestApp } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import { routes } from './app.ts';

/** A name PostgreSQL would list and JavaScript does not know: the list must leave it out. */
const UNKNOWN_TO_INTL = 'Mars/Olympus_Mons';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  // before the first request: the list is read once per process
  await db.admin.query('INSERT INTO timezones (name) VALUES ($1)', [
    UNKNOWN_TO_INTL,
  ]);
  app = await startTestApp(db);
});
after(async () => {
  await app.close();
  await db.drop();
});

test('every route of src/routes is an operation of the contract, with its auth and idempotency', () => {
  assert.ok(routes.length >= 2);
  for (const route of routes) {
    const operation = OPERATIONS.find(
      ({ method, path }) => method === route.method && path === route.path,
    );
    assert.ok(operation, `${route.method} ${route.path} is not in OPERATIONS`);
    assert.deepEqual(
      { auth: route.auth, idempotent: route.idempotent ?? false },
      { auth: operation.auth, idempotent: operation.idempotent },
      `${route.method} ${route.path}`,
    );
  }
  for (const path of ['/healthz', '/meta/timezones']) {
    assert.ok(
      routes.some(route => route.method === 'GET' && route.path === path),
      path,
    );
  }
});

test('GET /healthz: 200, ok and db true, no job yet', async () => {
  const result = await app.call('GET', '/healthz');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, db: true, jobs: [] });
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('GET /healthz with the database out of reach: still 200, ok and db false', async () => {
  const gone = new pg.Pool({
    host: '127.0.0.1',
    port: TEST.port,
    ...APP_CONN,
    database: db.name,
  });
  await gone.end(); // every connect on it fails from now on
  const down = await startTestApp({ ...db, app: gone });
  try {
    const result = await down.call('GET', '/healthz');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: false, db: false, jobs: [] });
    // the reason is in the log, the request itself is not an error
    assert.deepEqual(
      down.logs.map(line => [line.level, line.evt ?? line.route, line.status]),
      [
        ['error', 'health', undefined],
        ['info', '/healthz', 200],
      ],
    );
  } finally {
    await down.close();
  }
});

test('GET /meta/timezones: the names the database accepts and JavaScript reads the same way', async () => {
  const { token } = await newUser(db);
  const result = await app.call('GET', '/meta/timezones');
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body), ['zones']);
  const zones: string[] = result.body.zones;

  assert.ok(zones.includes('Asia/Ho_Chi_Minh'));
  assert.ok(zones.includes('UTC'));
  assert.ok(zones.length > 300, String(zones.length));
  assert.deepEqual(
    zones.filter(zone => !zone.includes('/')),
    ['UTC'],
  );
  for (const zone of zones) {
    // throws for a name JavaScript does not know
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
  }
  assert.deepEqual(zones, [...zones].sort());
  assert.equal(new Set(zones).size, zones.length);

  // exactly: the rows of the table, minus what Intl refuses (the planted name is one of those)
  const { rows } = await db.admin.query<{ name: string }>(
    'SELECT name FROM timezones',
  );
  const table = rows.map(row => row.name);
  assert.ok(table.includes(UNKNOWN_TO_INTL));
  assert.ok(!zones.includes(UNKNOWN_TO_INTL));
  const refused = table.filter(name => !zones.includes(name));
  for (const name of refused) {
    assert.throws(
      () => new Intl.DateTimeFormat('en', { timeZone: name }),
      RangeError,
      name,
    );
  }
  assert.equal(zones.length + refused.length, table.length);
  // and every one of them the users table takes
  const { rows: accepted } = await db.admin.query(
    'SELECT count(*)::int AS n FROM timezones WHERE name = ANY ($1)',
    [zones],
  );
  assert.equal(accepted[0].n, zones.length);

  // anonymous, and the same for a signed-in client
  assert.deepEqual(
    (await app.call('GET', '/meta/timezones', { token })).body,
    result.body,
  );
});
