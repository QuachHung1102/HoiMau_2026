// The quote of a journal entry (F-13): at random among the quotes the caller has not received in
// the last 30 days, else the least recently received. The pool is cut to three quotes through the
// owner connection (keeping Q001, which the decoy entry references), in a database of its own.
// The clock is the test clock; Asia/Ho_Chi_Minh (UTC+7).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { asUser, setTestClock } from '../../test/helpers.ts';
import { TEST_JOURNAL_KEY, newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { encryptJournal } from '../journalCrypto.ts';

const POOL = ['Q001', 'Q002', 'Q003'];

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await db.admin.query('DELETE FROM quotes WHERE code <> ALL ($1)', [POOL]);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

const noon = (date: string) => setTestClock(db.admin, `${date}T05:00:00.000Z`);

/** The quote journal_create would hand out now, in a transaction that is rolled back. */
async function wouldGet(userId: string): Promise<string> {
  let code = '';
  const rollback = new Error('rollback');
  await asUser(db.app, userId, async c => {
    const id = randomUUID();
    const { rows } = await c.query('SELECT journal_create($1, $2) AS r', [id, encryptJournal(TEST_JOURNAL_KEY, userId, id, 'x')]);
    code = rows[0].r.quote.code;
    throw rollback;
  }).catch(e => {
    if (e !== rollback) throw e;
  });
  return code;
}

test('three entries get three different quotes, the fourth the least recently received; 30 days later a quote is free again, and among free quotes the pick is random', async () => {
  assert.deepEqual((await db.admin.query('SELECT code FROM quotes ORDER BY code')).rows.map(r => r.code), POOL);
  await noon('2027-03-10');
  const user = await newOnboardedUser(db);
  const got: string[] = [];
  for (const date of ['2027-03-10', '2027-03-12', '2027-03-14', '2027-03-16']) {
    await noon(date);
    const result = await app.call('POST', '/journal', { token: user.token, key: randomUUID(), body: { body: `Ngày ${date}` } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    got.push(result.body.quote.code);
  }
  const [a, b, c, fourth] = got;
  assert.deepEqual([a, b, c].sort(), POOL);
  assert.equal(fourth, a);
  const quote = (await app.call('GET', `/journal`, { token: user.token })).body.entries[0].quoteCode;
  assert.equal(quote, a);

  // last received: a 03-16, b 03-12, c 03-14. On 04-12 only b is older than 30 days.
  await noon('2027-04-12');
  for (let i = 0; i < 10; i++) {
    assert.equal(await wouldGet(user.userId), b);
  }
  // on 04-14 b and c are both free (a is not): either, at random, never a
  await noon('2027-04-14');
  const picks = new Set<string>();
  for (let i = 0; i < 40; i++) {
    picks.add(await wouldGet(user.userId));
  }
  assert.deepEqual([...picks].sort(), [b, c].sort());
});
