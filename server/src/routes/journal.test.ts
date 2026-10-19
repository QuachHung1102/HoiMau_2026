// POST /journal, GET /journal, GET /journal/{id} over HTTP on the real database: the round trip of
// the encrypted text, where the text must never be (logs, the idempotency table, the stored bytes,
// an index, an error), the XP of a logical day, the weekly ticket, the validation and its order,
// paging, the rate limit, the privacy of GET /guilds/me now that a journal exists, and two entries
// of one fresh day at the same moment. Fixtures and read-backs go through the owner connection; the
// clock is the test clock. 2027-03-10 is a Wednesday; the zone is Asia/Ho_Chi_Minh (UTC+7).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import { JOURNAL_XP, TICKET_CAP } from '../../../domain/economy.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

/** The instant of local time `hhmm` on calendar date `date` in Asia/Ho_Chi_Minh. */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();
const clock = (date: string, hhmm: string) => setTestClock(db.admin, at(date, hhmm));
const write = (user: { token: string }, body: unknown, key: string = randomUUID(), on: TestApp = app) =>
  on.call('POST', '/journal', { token: user.token, key, body: { body } });
const get = (user: { token: string }, path: string) => app.call('GET', path, { token: user.token });
function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
const refused = (result: CallResult) => [result.status, result.body?.error?.code, result.body?.error?.details];
const blobOf = async (id: string): Promise<Buffer> =>
  (await db.admin.query('SELECT body_encrypted FROM journal_entries WHERE id = $1', [id])).rows[0].body_encrypted;

const TEXT = '  Hôm nay mình đi bộ quanh hồ Gươm, trời se lạnh, lòng nhẹ hẳn — cảm ơn bản thân đã cố gắng 🌿✨ thêm một ngày nữa.  ';
const SENTINEL = 'Câu canh gác 7f3a: điều này chỉ nằm trong nhật ký 🔒';

test('round trip: create, list preview (80 characters), read back the trimmed text; the stored bytes hold no plaintext; swapped or tampered blobs answer 500, logged with the entry id only', async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const id = randomUUID();
  const created = ok(await write(user, TEXT, id));
  assert.equal(created.entry.id, id);
  assert.ok(!JSON.stringify(created).includes('Gươm'));
  const trimmed = TEXT.trim();
  const listed = ok(await get(user, '/journal'));
  assert.deepEqual(listed.entries, [
    { id, createdAt: created.entry.createdAt, preview: [...trimmed].slice(0, 80).join(''), quoteCode: created.quote.code },
  ]);
  assert.equal(listed.nextBefore, null);
  assert.ok([...trimmed].length > 80 && listed.entries[0].preview !== trimmed);
  assert.deepEqual(ok(await get(user, `/journal/${id}`)), {
    id,
    createdAt: created.entry.createdAt,
    body: trimmed,
    quote: created.quote,
  });

  const blob = await blobOf(id);
  assert.equal(blob[0], 0x01);
  for (const piece of [trimmed, 'Gươm', 'cảm ơn bản thân', '🌿']) {
    assert.equal(blob.indexOf(Buffer.from(piece, 'utf8')), -1, piece);
  }

  // another user's blob in this row, and this row's blob in theirs: the authenticated data differs
  const other = await newOnboardedUser(db);
  const otherId = randomUUID();
  ok(await write(other, 'Một dòng khác của người khác.', otherId));
  const otherBlob = await blobOf(otherId);
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [id, otherBlob]);
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [otherId, blob]);
  const mark = app.logs.length;
  assert.deepEqual(refused(await get(user, `/journal/${id}`)), [500, 'INTERNAL', undefined]);
  assert.deepEqual(refused(await get(other, `/journal/${otherId}`)), [500, 'INTERNAL', undefined]);
  assert.deepEqual(ok(await get(user, '/journal')), { entries: [], nextBefore: null });
  const failures = app.logs.slice(mark).filter(line => line.evt === 'journal_decrypt_failed');
  assert.deepEqual(
    failures.map(({ ts: _ts, ...rest }) => rest),
    [
      { level: 'error', evt: 'journal_decrypt_failed', entryId: id },
      { level: 'error', evt: 'journal_decrypt_failed', entryId: otherId },
      { level: 'error', evt: 'journal_decrypt_failed', entryId: id },
    ],
  );
  // back in place it opens again; then one flipped byte of the ciphertext fails it
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [id, blob]);
  assert.equal(ok(await get(user, `/journal/${id}`)).body, trimmed);
  const tampered = Buffer.from(blob);
  tampered[20] = 255 - tampered[20];
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [id, tampered]);
  assert.deepEqual(refused(await get(user, `/journal/${id}`)), [500, 'INTERNAL', undefined]);
});

test('one blob that does not open: GET /journal leaves that entry out and answers the others (paging intact), logged with its id only; GET /journal/{id} of it is 500 INTERNAL', async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const ids: string[] = [];
  for (const [i, text] of ['Dòng một', 'Dòng hai', 'Dòng ba'].entries()) {
    await clock('2027-03-10', `12:0${i}`);
    const id = randomUUID();
    ok(await write(user, text, id));
    ids.push(id);
  }
  const [first, middle, last] = ids;
  const blob = await blobOf(middle);
  const broken = Buffer.from(blob);
  broken[broken.length - 1] = 255 - broken[broken.length - 1];
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [middle, broken]);

  const mark = app.logs.length;
  const listed = ok(await get(user, '/journal'));
  assert.deepEqual(
    listed.entries.map((e: { id: string; preview: string }) => [e.id, e.preview]),
    [
      [last, 'Dòng ba'],
      [first, 'Dòng một'],
    ],
  );
  // a page that ends on the bad entry still points past it
  const page = ok(await get(user, '/journal?limit=2'));
  assert.deepEqual([page.entries.map((e: { id: string }) => e.id), page.nextBefore], [[last], middle]);
  assert.deepEqual(ok(await get(user, `/journal?before=${middle}`)).entries.map((e: { id: string }) => e.id), [first]);
  assert.deepEqual(refused(await get(user, `/journal/${middle}`)), [500, 'INTERNAL', undefined]);
  assert.deepEqual(
    app.logs
      .slice(mark)
      .filter(line => line.evt === 'journal_decrypt_failed')
      .map(({ ts: _ts, ...rest }) => rest),
    [
      { level: 'error', evt: 'journal_decrypt_failed', entryId: middle },
      { level: 'error', evt: 'journal_decrypt_failed', entryId: middle },
      { level: 'error', evt: 'journal_decrypt_failed', entryId: middle },
    ],
  );
});

test('the sentinel sentence is in no log line (also of a 422, a 429 and a failed decryption), not in idempotency_keys.response, not in the stored bytes, and no index covers the body', async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const id = randomUUID();
  const key = randomUUID();
  ok(await write(user, SENTINEL, id));
  ok(await write(user, SENTINEL, id)); // the replay
  assert.deepEqual(refused(await write(user, `${SENTINEL} ${'x'.repeat(5000)}`, key)).slice(0, 2), [422, 'VALIDATION_FAILED']);
  assert.equal(ok(await get(user, `/journal/${id}`)).body, SENTINEL);
  ok(await get(user, '/journal'));
  // a decryption failure of this very entry
  const blob = await blobOf(id);
  const broken = Buffer.from(blob);
  broken[broken.length - 1] = 255 - broken[broken.length - 1];
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [id, broken]);
  assert.equal((await get(user, `/journal/${id}`)).status, 500);
  await db.admin.query('UPDATE journal_entries SET body_encrypted = $2 WHERE id = $1', [id, blob]);

  // eleven writes in a minute on an app with its limits on: the eleventh is 429
  const limited = await startTestApp(db, { rateLimits: true });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await write(user, `${SENTINEL} ${i}`, randomUUID(), limited)).status);
    }
    assert.deepEqual(statuses, [...Array(10).fill(200), 429]);
    const pieces = [SENTINEL, 'canh gác 7f3a', JSON.stringify(SENTINEL).slice(1, -1)];
    for (const text of [app.logText(), limited.logText()]) {
      for (const piece of pieces) {
        assert.ok(!text.includes(piece), `"${piece}" in the log`);
      }
    }
    assert.ok(app.logs.some(line => line.evt === 'journal_decrypt_failed' && line.entryId === id));
  } finally {
    await limited.close();
  }

  const { rows } = await db.admin.query<{ response: string; bodies: Buffer[] }>(
    `SELECT (SELECT string_agg(coalesce(k.response::text, ''), ' ') FROM idempotency_keys k WHERE k.user_id = $1) AS response,
            ARRAY(SELECT e.body_encrypted FROM journal_entries e WHERE e.user_id = $1) AS bodies`,
    [user.userId],
  );
  assert.ok(rows[0].response.includes(id), 'the stored answers are there');
  assert.ok(!rows[0].response.includes('canh gác'));
  assert.equal(rows[0].bodies.length, 11);
  for (const body of rows[0].bodies) {
    assert.equal(body.indexOf(Buffer.from('canh gác 7f3a', 'utf8')), -1);
  }
  const indexes = await db.admin.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE tablename = 'journal_entries' ORDER BY indexname",
  );
  assert.deepEqual(
    indexes.rows.map(row => row.indexdef.replace(/^.* USING /, '')),
    ['btree (id)', 'btree (user_id, created_at DESC, id DESC)'],
  );
});

test(`XP: the first entry of a logical day +${JOURNAL_XP}, a second the same day 0, at 02:59 the next calendar day still 0, from 03:00 +${JOURNAL_XP}; one ledger row per day, each logged`, async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const xp: number[] = [];
  for (const [date, hhmm] of [
    ['2027-03-10', '12:00'],
    ['2027-03-10', '21:00'],
    ['2027-03-11', '02:59'],
    ['2027-03-11', '03:00'],
  ]) {
    await clock(date, hhmm);
    const result = ok(await write(user, `Ngày ${date} lúc ${hhmm}`));
    assert.equal(result.delta.xp, result.xpAwarded);
    xp.push(result.xpAwarded);
  }
  assert.deepEqual(xp, [JOURNAL_XP, 0, 0, JOURNAL_XP]);
  const { rows } = await db.admin.query(
    "SELECT amount, ref_id FROM xp_ledger WHERE user_id = $1 AND reason = 'JOURNAL' ORDER BY ref_id",
    [user.userId],
  );
  assert.deepEqual(rows, [
    { amount: 15, ref_id: '2027-03-10' },
    { amount: 15, ref_id: '2027-03-11' },
  ]);
  const ledger = app.logs.filter(line => line.evt === 'ledger' && line.userId === user.userId && line.reason === 'JOURNAL');
  assert.deepEqual(
    ledger.map(line => [line.kind, line.amount, line.refId]),
    [
      ['xp', 15, '2027-03-10'],
      ['xp', 15, '2027-03-11'],
    ],
  );
});

test('weekly ticket: GRANTED, ALREADY_DECIDED, the week follows the logical-date label, GRANTED next week, AT_CAP at the cap and forfeited even after a ticket is used, TICKET_CAP_PLUS makes the cap 3', async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const ticketAt = async (date: string, hhmm: string) => {
    await clock(date, hhmm);
    return ok(await write(user, `Tuần nào? ${date} ${hhmm}`)).ticket;
  };
  const cap = TICKET_CAP.base;
  assert.deepEqual(await ticketAt('2027-03-10', '12:00'), { outcome: 'GRANTED', available: 1, cap });
  assert.deepEqual(await ticketAt('2027-03-10', '13:00'), { outcome: 'ALREADY_DECIDED', available: 1, cap });
  // Sunday 02:00 is Saturday's label; Monday 02:00 is Sunday's: both still the week of 03-08
  assert.deepEqual(await ticketAt('2027-03-14', '02:00'), { outcome: 'ALREADY_DECIDED', available: 1, cap });
  assert.deepEqual(await ticketAt('2027-03-15', '02:00'), { outcome: 'ALREADY_DECIDED', available: 1, cap });
  const labels = await db.admin.query(
    'SELECT logical_date::text FROM journal_entries WHERE user_id = $1 ORDER BY created_at',
    [user.userId],
  );
  assert.deepEqual(labels.rows.map(row => row.logical_date), ['2027-03-10', '2027-03-10', '2027-03-13', '2027-03-14']);
  assert.deepEqual(await ticketAt('2027-03-15', '03:00'), { outcome: 'GRANTED', available: 2, cap });
  assert.deepEqual(await ticketAt('2027-03-22', '12:00'), { outcome: 'AT_CAP', available: 2, cap });
  // a ticket used later in that week does not reopen it
  await db.admin.query(
    `UPDATE freeze_tickets SET used_at = app.now(), used_for_date = '2027-03-22'
      WHERE id = (SELECT id FROM freeze_tickets WHERE user_id = $1 ORDER BY granted_at LIMIT 1)`,
    [user.userId],
  );
  assert.deepEqual(await ticketAt('2027-03-23', '12:00'), { outcome: 'ALREADY_DECIDED', available: 1, cap });
  await db.admin.query("INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'TICKET_CAP_PLUS', 3)", [user.userId]);
  assert.deepEqual(await ticketAt('2027-03-29', '12:00'), { outcome: 'GRANTED', available: 2, cap: TICKET_CAP.withPerk });
  assert.deepEqual(await ticketAt('2027-04-05', '12:00'), { outcome: 'GRANTED', available: 3, cap: TICKET_CAP.withPerk });
  assert.deepEqual(await ticketAt('2027-04-12', '12:00'), { outcome: 'AT_CAP', available: 3, cap: TICKET_CAP.withPerk });
  const weeks = await db.admin.query(
    'SELECT week_start::text, granted FROM ticket_grant_weeks WHERE user_id = $1 ORDER BY week_start',
    [user.userId],
  );
  assert.deepEqual(
    weeks.rows.map(row => [row.week_start, row.granted]),
    [
      ['2027-03-08', true],
      ['2027-03-15', true],
      ['2027-03-22', false],
      ['2027-03-29', true],
      ['2027-04-05', true],
      ['2027-04-12', false],
    ],
  );
});

test('POST /journal refusals and their order: 401, 400 key, 409 onboarding, then body required/format/min/max (code points); 5000 emoji pass; a reused key 409; a replay answers the same and writes once', async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const fresh = await newUser(db);
  const field = (result: CallResult) => [result.status, result.body?.error?.code, result.body?.error?.details?.fields];
  assert.equal((await app.call('POST', '/journal', { key: randomUUID(), body: { body: 1 } })).status, 401);
  assert.deepEqual(refused(await app.call('POST', '/journal', { token: user.token, body: { body: 1 } })).slice(0, 2), [
    400,
    'IDEMPOTENCY_KEY_REQUIRED',
  ]);
  assert.deepEqual(refused(await write(fresh, 1)).slice(0, 2), [409, 'ONBOARDING_REQUIRED']);
  assert.deepEqual(field(await app.call('POST', '/journal', { token: user.token, key: randomUUID() })), [
    422,
    'VALIDATION_FAILED',
    [{ field: 'body', rule: 'required' }],
  ]);
  assert.deepEqual(field(await write(user, undefined)), [422, 'VALIDATION_FAILED', [{ field: 'body', rule: 'required' }]]);
  assert.deepEqual(field(await write(user, 42)), [422, 'VALIDATION_FAILED', [{ field: 'body', rule: 'format' }]]);
  assert.deepEqual(field(await write(user, ' \n\t ')), [422, 'VALIDATION_FAILED', [{ field: 'body', rule: 'min' }]]);
  assert.deepEqual(field(await write(user, `  ${'a'.repeat(5001)}  `)), [
    422,
    'VALIDATION_FAILED',
    [{ field: 'body', rule: 'max' }],
  ]);
  assert.deepEqual(field(await write(user, '🌿'.repeat(5001))), [422, 'VALIDATION_FAILED', [{ field: 'body', rule: 'max' }]]);
  const longest = '🌿'.repeat(5000); // 10000 UTF-16 units, 20000 bytes
  const longId = randomUUID();
  ok(await write(user, `  ${longest}  `, longId));
  assert.equal(ok(await get(user, `/journal/${longId}`)).body, longest);
  assert.equal(ok(await write(user, 'x')).xpAwarded, 0);

  const key = randomUUID();
  const first = ok(await write(user, 'Một lần thôi.', key));
  assert.deepEqual(ok(await write(user, 'Một lần thôi.', key)), first);
  assert.deepEqual(refused(await write(user, 'Một câu khác.', key)).slice(0, 2), [409, 'IDEMPOTENCY_KEY_REUSED']);
  const count = await db.admin.query('SELECT count(*)::int AS n FROM journal_entries WHERE id = $1', [key]);
  assert.equal(count.rows[0].n, 1);
  // the stored answer gone (purged): the id is already an entry
  await db.admin.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [user.userId, key]);
  assert.deepEqual(refused(await write(user, 'Một lần thôi.', key)).slice(0, 2), [409, 'IDEMPOTENCY_KEY_REUSED']);
});

test('GET /journal pages newest first by (created_at, id) with nextBefore; limit and before are validated; GET /journal/{id}: 422 for a bad id, 404 for an unknown one or one of another user', async () => {
  await clock('2027-03-10', '12:00');
  const user = await newOnboardedUser(db);
  const ids: string[] = [];
  for (const hhmm of ['12:00', '12:00', '12:00', '13:00', '14:00']) {
    await clock('2027-03-10', hhmm);
    ids.push(ok(await write(user, `Lúc ${hhmm}`)).entry.id);
  }
  // three share one instant: the id breaks the tie, descending
  const expected = [ids[4], ids[3], ...ids.slice(0, 3).sort().reverse()];
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4 && (page === 0 || cursor !== null); page++) {
    const body: any = ok(await get(user, `/journal?limit=2${cursor === null ? '' : `&before=${cursor}`}`));
    seen.push(...body.entries.map((e: { id: string }) => e.id));
    cursor = body.nextBefore;
  }
  assert.deepEqual(seen, expected);
  assert.equal(cursor, null);
  assert.equal(ok(await get(user, '/journal')).entries.length, 5);
  for (const [query, rule] of [
    ['limit=0', 'min'],
    ['limit=51', 'max'],
    ['limit=x', 'format'],
    ['before=abc', 'format'],
  ]) {
    const result = await get(user, `/journal?${query}`);
    assert.deepEqual([result.status, result.body.error.details.fields], [422, [{ field: query.split('=')[0], rule }]]);
  }
  assert.equal(ok(await get(user, '/journal?limit=50')).entries.length, 5);
  assert.deepEqual(refused(await get(user, '/journal/abc')).slice(0, 2), [422, 'VALIDATION_FAILED']);
  assert.deepEqual(refused(await get(user, `/journal/${randomUUID()}`)).slice(0, 2), [404, 'NOT_FOUND']);
  const other = await newOnboardedUser(db);
  assert.deepEqual(refused(await get(other, `/journal/${ids[0]}`)).slice(0, 2), [404, 'NOT_FOUND']);
  assert.deepEqual(ok(await get(other, `/journal?before=${ids[4]}`)), { entries: [], nextBefore: null });
});

const FORBIDDEN_KEYS = ['weightKg', 'heightCm', 'calorieTarget', 'caloriesIn', 'bmr', 'tdee', 'waterMl', 'birthYear', 'sex'];
const keysOf = (value: unknown): string[] =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, inner]) => [...(Array.isArray(value) ? [] : [key]), ...keysOf(inner)])
    : [];

test("privacy: a teammate's GET /guilds/me holds neither the journal sentinel nor any biometric or calorie key or sentinel value (Task 39's scan, repeated)", async () => {
  await clock('2027-03-10', '12:00');
  const leader = await newOnboardedUser(db);
  const member = await newOnboardedUser(db, { heightCm: 177.7, weightKg: 77.7, birthYear: 1979 });
  const made = ok(await app.call('POST', '/guilds', { token: leader.token, key: randomUUID(), body: { name: `Tổ ${randomUUID().slice(0, 8)}` } }));
  ok(await app.call('POST', '/guilds/join', { token: member.token, key: randomUUID(), body: { inviteCode: made.guild.inviteCode } }));
  await db.admin.query('UPDATE prescriptions SET calorie_target = 2777 WHERE user_id = $1', [member.userId]);
  ok(await app.call('POST', '/nutrition/log', { token: member.token, key: randomUUID(), body: { kcal: 1777.7 } }));
  ok(await write(member, SENTINEL));
  const stored = await db.admin.query(
    `SELECT s.height_cm::text, s.weight_kg::text, p.calorie_target::text, d.calories_in::text,
            (SELECT count(*)::int FROM journal_entries e WHERE e.user_id = s.user_id) AS entries
       FROM biometric_snapshots s JOIN prescriptions p USING (user_id) JOIN daily_logs d USING (user_id)
      WHERE s.user_id = $1`,
    [member.userId],
  );
  assert.deepEqual(stored.rows[0], { height_cm: '177.7', weight_kg: '77.7', calorie_target: '2777', calories_in: '1777.7', entries: 1 });
  const seen = ok(await app.call('GET', '/guilds/me', { token: leader.token }));
  assert.ok(seen.guild.members.some((m: { userId: string }) => m.userId === member.userId));
  assert.deepEqual(keysOf(seen).filter(key => FORBIDDEN_KEYS.includes(key)), []);
  let text = JSON.stringify(seen);
  for (const id of [seen.guild.id, seen.guild.inviteCode, ...seen.guild.members.map((m: { userId: string }) => m.userId)]) {
    text = text.replaceAll(id, '');
  }
  for (const sentinel of ['77.7', '177.7', '2777', '1777', '1979', 'canh gác', '7f3a', 'nhật ký']) {
    assert.ok(!text.includes(sentinel), `${sentinel} in ${text}`);
  }
});

/** How many backends of this database wait for a lock. */
const waiting = async () =>
  (
    await db.admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    )
  ).rows[0].n;
async function until(n: number) {
  for (let i = 0; i < 500 && (await waiting()) < n; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await waiting(), n, 'the requests did not line up behind the lock');
}
/**
 * The owner holds the users row of `user` until the returned function is called. The client goes
 * back to the pool (max 2, and the race test uses both) whatever throws: a failed lock destroys it.
 */
async function holdUser(userId: string): Promise<() => Promise<void>> {
  const hold: PoolClient = await db.admin.connect();
  try {
    await hold.query('BEGIN');
    await hold.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);
  } catch (e) {
    hold.release(true);
    throw e;
  }
  return async () => {
    try {
      await hold.query('COMMIT');
    } finally {
      hold.release();
    }
  };
}

test('a hold whose lock statement throws gives its client back to the pool', async () => {
  await assert.rejects(holdUser('not a uuid'), /invalid input syntax for type uuid/);
  assert.equal(db.admin.totalCount - db.admin.idleCount, 0, 'a client is still checked out');
});

test(`two entries of one fresh day at the same moment: both stored, +${JOURNAL_XP} once, one ticket decision`, async () => {
  await clock('2027-03-10', '12:00');
  for (let round = 0; round < 3; round++) {
    const user = await newOnboardedUser(db);
    const release = await holdUser(user.userId);
    const both = Promise.all([write(user, 'Song song một'), write(user, 'Song song hai')]);
    try {
      await until(2);
    } finally {
      await release();
    }
    const results = (await both).map(ok);
    assert.deepEqual(results.map(r => r.xpAwarded).sort(), [0, JOURNAL_XP]);
    assert.deepEqual(results.map(r => r.ticket.outcome).sort(), ['ALREADY_DECIDED', 'GRANTED']);
    const { rows } = await db.admin.query(
      `SELECT (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1 AND reason = 'JOURNAL') AS xp,
              (SELECT count(*)::int FROM journal_entries WHERE user_id = $1) AS entries,
              (SELECT count(*)::int FROM freeze_tickets WHERE user_id = $1) AS tickets,
              (SELECT count(*)::int FROM ticket_grant_weeks WHERE user_id = $1) AS weeks`,
      [user.userId],
    );
    assert.deepEqual(rows[0], { xp: JOURNAL_XP, entries: 2, tickets: 1, weeks: 1 });
  }
});
