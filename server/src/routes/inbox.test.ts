// The inbox routes over HTTP: pages newest first with the `before` cursor, the limit, marking
// read with ids and without, the caller's items only, and every odd input a 422, never a 500.
// Notifications are arranged through app._notify as the owner (no role may call it).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await setTestClock(db.admin, NOW);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

const NOW = '2027-03-10T05:00:00.000Z';
const DECOY_ITEM = '00000000-0000-4000-8000-0000000d100f';
type User = Awaited<ReturnType<typeof newOnboardedUser>>;

const get = (user: User, path: string) => app.call('GET', path, { token: user.token });
const read = (user: User, body?: unknown, rawBody?: string) =>
  app.call('POST', '/inbox/read', {
    token: user.token,
    key: randomUUID(),
    body,
    rawBody,
    headers: rawBody === undefined ? {} : { 'content-type': 'application/json' },
  });

function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
function refused(result: CallResult, field: string, rule: string) {
  assert.deepEqual(
    [result.status, result.body?.error?.code, result.body?.error?.details],
    [422, 'VALIDATION_FAILED', { fields: [{ field, rule }] }],
    JSON.stringify(result.body),
  );
}

/** `n` notifications for the user, oldest first: PET_TIRED items keyed 1…n, all at the frozen clock. */
async function notify(user: User, n: number) {
  for (let i = 1; i <= n; i++) {
    await db.admin.query("SELECT app._notify($1, 'PET_TIRED', '{}', $2)", [user.userId, String(i)]);
  }
  const { rows } = await db.admin.query(
    'SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
    [user.userId],
  );
  return rows.map(row => row.id as string); // newest first
}

test('GET /inbox: newest first, 20 by default, and `before` = nextBefore gives the rest, none twice, none lost, even at one instant of the clock', async () => {
  const user = await newOnboardedUser(db);
  const ids = await notify(user, 25);
  const first = ok(await get(user, '/inbox'));
  assert.equal(first.items.length, 20);
  assert.equal(first.unreadCount, 25);
  assert.deepEqual(first.items.map((item: { id: string }) => item.id), ids.slice(0, 20));
  assert.equal(typeof first.nextBefore, 'string');
  const second = ok(await get(user, `/inbox?before=${encodeURIComponent(first.nextBefore)}`));
  assert.deepEqual(second.items.map((item: { id: string }) => item.id), ids.slice(20));
  assert.equal(second.nextBefore, null);
  assert.deepEqual(first.items[0], {
    id: ids[0],
    kind: 'PET_TIRED',
    payload: {},
    createdAt: first.items[0].createdAt,
    readAt: null,
  });
  assert.equal(new Date(first.items[0].createdAt).toISOString(), first.items[0].createdAt);
  // pages of 7: 7, 7, 7, 4
  const pages: number[] = [];
  let cursor: string | null = null;
  do {
    const page: any = ok(
      await get(user, `/inbox?limit=7${cursor === null ? '' : `&before=${encodeURIComponent(cursor)}`}`),
    );
    pages.push(page.items.length);
    cursor = page.nextBefore;
  } while (cursor !== null);
  assert.deepEqual(pages, [7, 7, 7, 4]);
  // exactly a page: no next one
  assert.equal(ok(await get(user, '/inbox?limit=25')).nextBefore, null);
  // before 1970 nothing exists
  assert.deepEqual(ok(await get(user, '/inbox?before=1969-12-31T00:00:00Z')).items, []);
});

test('GET /inbox: limit is 1 to 50, before an instant that exists; anything else is 422, never 500', async () => {
  const user = await newOnboardedUser(db);
  assert.equal(ok(await get(user, '/inbox?limit=50')).items.length, 0);
  assert.equal(ok(await get(user, '/inbox?limit=1')).nextBefore, null);
  refused(await get(user, '/inbox?limit=51'), 'limit', 'max');
  refused(await get(user, '/inbox?limit=0'), 'limit', 'min');
  refused(await get(user, '/inbox?limit=99999999999999999999'), 'limit', 'max');
  for (const limit of ['', 'x', '1.5', '-1', '1e1', ' 5']) {
    refused(await get(user, `/inbox?limit=${encodeURIComponent(limit)}`), 'limit', 'format');
  }
  for (const value of [
    '',
    'yesterday',
    '2027-02-30T00:00:00Z',
    '2027-03-10T24:00:00Z',
    '2027-03-10T05:00:00',
    '9999-12-31T23:59:59-23:59',
    '0000-01-01T00:00:00Z',
  ]) {
    const result = await get(user, `/inbox?before=${encodeURIComponent(value)}`);
    if (value === '0000-01-01T00:00:00Z') {
      // an instant, and before 1970: nothing is that old
      assert.deepEqual(ok(result).items, []);
    } else {
      refused(result, 'before', 'format');
    }
  }
});

test('POST /inbox/read: with ids marks those, without marks every unread item; the answer is the unread count; GET /day counts the caller\'s unread items', async () => {
  const user = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  const ids = await notify(user, 4);
  await notify(other, 2);
  assert.equal(ok(await get(user, '/day')).unreadCount, 4);
  assert.deepEqual(ok(await read(user, { ids: [ids[0], ids[1].toUpperCase()] })), { unreadCount: 2 });
  const page = ok(await get(user, '/inbox'));
  assert.deepEqual(
    page.items.map((item: { readAt: string | null }) => item.readAt),
    [NOW, NOW, null, null],
  );
  // already read: read_at stays the first instant
  await setTestClock(db.admin, '2027-03-10T06:00:00.000Z');
  try {
    assert.deepEqual(ok(await read(user, { ids: [ids[0]] })), { unreadCount: 2 });
    assert.equal(ok(await get(user, '/inbox')).items[0].readAt, NOW);
    assert.deepEqual(ok(await read(user, {})), { unreadCount: 0 });
    assert.deepEqual(ok(await get(user, '/day')).unreadCount, 0);
    // the other user's items are untouched, and are none of this user's business
    assert.equal(ok(await get(other, '/day')).unreadCount, 2);
    assert.equal(ok(await get(user, '/inbox')).items.length, 4);
    assert.deepEqual(ok(await read(user, { ids: [] })), { unreadCount: 0 });
  } finally {
    await setTestClock(db.admin, NOW);
  }
});

test('POST /inbox/read with the id of somebody else\'s item (the decoy\'s) updates nothing and says nothing about it', async () => {
  const user = await newOnboardedUser(db);
  await notify(user, 1);
  const decoy = async () =>
    (await db.admin.query('SELECT read_at FROM notifications WHERE id = $1', [DECOY_ITEM])).rows;
  assert.deepEqual(await decoy(), [{ read_at: null }]);
  const unknown = ok(await read(user, { ids: [randomUUID()] }));
  const foreign = ok(await read(user, { ids: [DECOY_ITEM] }));
  assert.deepEqual([unknown, foreign], [{ unreadCount: 1 }, { unreadCount: 1 }]);
  assert.deepEqual(await decoy(), [{ read_at: null }]);
});

test('POST /inbox/read: the body is a JSON object, ids an array of UUIDs; otherwise 422; a key is required', async () => {
  const user = await newOnboardedUser(db);
  await notify(user, 1);
  refused(await read(user), 'body', 'required');
  for (const body of [null, [], 'x', 5, true]) {
    refused(await read(user, body), 'body', 'format');
  }
  for (const ids of [null, 'x', {}, [5], ['not-a-uuid'], [null], [`${randomUUID()} `]]) {
    refused(await read(user, { ids }), 'ids', 'format');
  }
  const noKey = await app.call('POST', '/inbox/read', { token: user.token, body: {} });
  assert.deepEqual([noKey.status, noKey.body.error.code], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
  // nothing above marked anything
  assert.equal(ok(await get(user, '/inbox')).unreadCount, 1);
  // unknown members are ignored
  assert.deepEqual(ok(await read(user, { all: false })), { unreadCount: 0 });
});
