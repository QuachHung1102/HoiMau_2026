// POST /nutrition/log over HTTP, on the real database: the manual entry, the latch of
// NUTRITION_TARGET on the band of calorieWindow, what a body may be, the action id. Time is the
// test clock. Expected numbers come from the domain functions and the content, never from the
// code under test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { calorieWindow } from '../../../domain/energy.ts';
import { QUESTS } from '../../content/quests.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh
const HOUR = 3600_000;
const NUTRITION = QUESTS.find(quest => quest.code === 'NUTRITION_TARGET')!;

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  try {
    // a log line is a request line or a ledger line: never a body, a label or a calorie number
    for (const line of app.logs) {
      const allowed =
        line.evt === 'ledger'
          ? ['ts', 'evt', 'kind', 'userId', 'amount', 'reason', 'refId']
          : ['ts', 'level', 'method', 'route', 'status', 'ms', 'userId'];
      assert.deepEqual(Object.keys(line).filter(name => !allowed.includes(name)), [], JSON.stringify(line));
    }
    assert.ok(!app.logText().includes('Bữa phở'));
  } finally {
    await setTestClock(db.admin, null);
    await app.close();
    await db.drop();
  }
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;
const clock = (at: string) => setTestClock(db.admin, at);
const plus = (from: string, ms: number) => new Date(Date.parse(from) + ms).toISOString();
const log = (user: { token: string }, body: unknown, key = randomUUID()) =>
  app.call('POST', '/nutrition/log', { token: user.token, key, body });

function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
function refusal(result: CallResult, status: number, code: string, details?: unknown) {
  assert.deepEqual(
    [result.status, result.body?.error?.code, result.body?.error?.details],
    [status, code, details],
    JSON.stringify(result.body),
  );
}
const fields = (...pairs: [string, string][]) => ({ fields: pairs.map(([field, rule]) => ({ field, rule })) });

async function stored(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT (SELECT count(*)::int FROM daily_logs WHERE user_id = $1) AS logs,
            (SELECT coalesce(sum(calories_in), 0)::float8 FROM daily_logs WHERE user_id = $1) AS calories,
            (SELECT count(*)::int FROM nutrition_logs WHERE user_id = $1) AS meals,
            (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows,
            (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
            (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin`,
    [userId],
  );
  return rows[0];
}
const NOTHING = { logs: 0, calories: 0, meals: 0, xp_rows: 0, xp: 0, coin: 0 };
const nutritionQuest = (day: any) => day.quests.find((quest: any) => quest.code === 'NUTRITION_TARGET');

/** A user whose calorie target is `target` (set as the owner: the fixture, not the code under test). */
async function userWithTarget(target: number): Promise<User> {
  const user = await newOnboardedUser(db);
  await db.admin.query('UPDATE prescriptions SET calorie_target = $2 WHERE user_id = $1', [user.userId, target]);
  return user;
}

test('the totals add up; the entry that brings the day inside the window completes the quest once, for 50 XP and 20 coins; one that leaves it keeps it completed', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const day = ok(await app.call('GET', '/day', { token: user.token }));
  const { min, max } = calorieWindow(day.calorieWindow.target);
  const from = app.logs.length;

  const first = ok(await log(user, { kcal: 300, label: 'Bánh mì' }));
  assert.deepEqual([first.day.caloriesIn, nutritionQuest(first.day).completed, first.delta], [300, false, { xp: 0, coin: 0, events: [] }]);
  const second = ok(await log(user, { kcal: min - 300 }));
  assert.equal(second.day.caloriesIn, min);
  assert.equal(nutritionQuest(second.day).completed, true);
  assert.deepEqual(second.delta, {
    xp: NUTRITION.xpReward,
    coin: NUTRITION.coinReward,
    events: [{ type: 'QUEST_COMPLETED', questCode: 'NUTRITION_TARGET' }],
  });
  assert.deepEqual([NUTRITION.xpReward, NUTRITION.coinReward], [50, 20]);
  assert.equal(second.day.story.done, 1);
  // past the top of the window: still completed, nothing more
  const third = ok(await log(user, { kcal: max - min + 1 }));
  assert.deepEqual([third.day.caloriesIn, nutritionQuest(third.day).completed, third.delta], [max + 1, true, { xp: 0, coin: 0, events: [] }]);
  const fourth = ok(await log(user, { kcal: 1 }));
  assert.deepEqual(fourth.delta, { xp: 0, coin: 0, events: [] });
  assert.deepEqual(await stored(user.userId), { logs: 1, calories: max + 2, meals: 4, xp_rows: 1, xp: 50, coin: 20 });
  // one ledger line per ledger row, keyed by the quest and the date
  assert.deepEqual(
    app.logs.slice(from).filter(line => line.evt === 'ledger').map(({ kind, amount, reason, refId }) => ({ kind, amount, reason, refId })),
    [
      { kind: 'xp', amount: 50, reason: 'QUEST_COMPLETE', refId: 'NUTRITION_TARGET:2027-03-10' },
      { kind: 'coin', amount: 20, reason: 'QUEST_COMPLETE', refId: 'NUTRITION_TARGET:2027-03-10' },
    ],
  );
});

test('the ends of the window count as inside, one kcal beyond does not (targets 1235, 1245, 2000)', async () => {
  await clock(NOON);
  let cases = 0;
  for (const target of [1235, 1245, 2000]) {
    const { min, max } = calorieWindow(target);
    for (const [total, inside] of [[min - 1, false], [min, true], [max, true], [max + 1, false]] as const) {
      const user = await userWithTarget(target);
      const answer = ok(await log(user, { kcal: total }));
      assert.deepEqual(answer.day.calorieWindow, { min, max, target });
      assert.equal(nutritionQuest(answer.day).completed, inside, `target ${target}, total ${total}`);
      assert.equal(answer.delta.xp, inside ? 50 : 0, `target ${target}, total ${total}`);
      if (total === min - 1) {
        // one more kcal reaches the window
        assert.equal(nutritionQuest(ok(await log(user, { kcal: 1 })).day).completed, true);
      }
      cases++;
    }
  }
  assert.equal(cases, 12);
});

test('kcal and label: 0, 5001, a string, a negative, 1e400, a 61-character label are 422 and write nothing; a fractional kcal and a 60-character label are taken, NFC and trimmed', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  refusal(await log(user, { kcal: 0 }), 422, 'VALIDATION_FAILED', fields(['kcal', 'min']));
  refusal(await log(user, { kcal: -5 }), 422, 'VALIDATION_FAILED', fields(['kcal', 'min']));
  refusal(await log(user, { kcal: 5001 }), 422, 'VALIDATION_FAILED', fields(['kcal', 'max']));
  refusal(await log(user, { kcal: '500' }), 422, 'VALIDATION_FAILED', fields(['kcal', 'format']));
  refusal(await log(user, { kcal: null }), 422, 'VALIDATION_FAILED', fields(['kcal', 'format']));
  refusal(
    await app.call('POST', '/nutrition/log', { token: user.token, key: randomUUID(), rawBody: '{"kcal":1e400}', headers: { 'content-type': 'application/json' } }),
    422, 'VALIDATION_FAILED', fields(['kcal', 'format']),
  );
  refusal(await log(user, { kcal: 0, label: 'x'.repeat(61) }), 422, 'VALIDATION_FAILED', fields(['kcal', 'min'], ['label', 'max']));
  refusal(await log(user, { kcal: 100, label: 'x'.repeat(10_000) }), 422, 'VALIDATION_FAILED', fields(['label', 'max']));
  refusal(await log(user, { kcal: 100, label: 7 }), 422, 'VALIDATION_FAILED', fields(['label', 'format']));
  refusal(await log(user, { kcal: 100, label: null }), 422, 'VALIDATION_FAILED', fields(['label', 'format']));
  assert.deepEqual(await stored(user.userId), NOTHING);

  // 60 code points, one of them outside the BMP; decomposed letters are stored composed; blanks trimmed
  const sixty = '🍜' + 'a'.repeat(59);
  const keys = [randomUUID(), randomUUID(), randomUUID()];
  assert.equal(ok(await log(user, { kcal: 12.5, label: `  ${sixty}  ` }, keys[0])).day.caloriesIn, 12.5);
  ok(await log(user, { kcal: 100, label: 'Bữa phở' }, keys[1]));
  ok(await log(user, { kcal: 100, label: '   ' }, keys[2]));
  const { rows } = await db.admin.query('SELECT id, label, kcal::float8 AS kcal FROM nutrition_logs WHERE user_id = $1', [user.userId]);
  const byId = Object.fromEntries(rows.map(row => [row.id, [row.label, row.kcal]]));
  assert.deepEqual([byId[keys[0]], byId[keys[1]], byId[keys[2]]], [[sixty, 12.5], ['Bữa phở'.normalize('NFC'), 100], [null, 100]]);
  assert.equal(byId[keys[1]][0], 'Bữa phở');
});

test('exactly one of kcal and mealSlot: both or neither is 422; a slot without a plan today is 409 PLAN_NOT_FOUND; nothing is written', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  refusal(await log(user, {}), 422, 'VALIDATION_FAILED', fields(['kcal', 'required']));
  refusal(await log(user, { kcal: 100, mealSlot: 'LUNCH' }), 422, 'VALIDATION_FAILED', fields(['mealSlot', 'format']));
  refusal(await log(user, { mealSlot: 'BRUNCH' }), 422, 'VALIDATION_FAILED', fields(['mealSlot', 'enum']));
  refusal(await log(user, { mealSlot: 'LUNCH', occurredAt: 'yesterday' }), 422, 'VALIDATION_FAILED', fields(['occurredAt', 'format']));
  refusal(await log(user, { mealSlot: 'LUNCH' }), 409, 'PLAN_NOT_FOUND');
  // the body is a JSON object
  refusal(await app.call('POST', '/nutrition/log', { token: user.token, key: randomUUID() }), 422, 'VALIDATION_FAILED', fields(['body', 'required']));
  for (const body of [null, [], 5, 'x', true]) {
    refusal(await log(user, body), 422, 'VALIDATION_FAILED', fields(['body', 'format']));
  }
  // unknown members are ignored
  assert.equal(ok(await log(user, { kcal: 10, note: 'x' })).day.caloriesIn, 10);
  assert.deepEqual(await stored(user.userId), { ...NOTHING, logs: 1, calories: 10, meals: 1 });
});

test('the action id: the same key twice is one log and the same answer; with another body 409 and nothing written; a refused key is free again; a log of somebody else is 409', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  const key = randomUUID();
  const first = ok(await log(user, { kcal: 200 }, key));
  assert.equal(first.actionId, key);
  assert.deepEqual(ok(await log(user, { kcal: 200 }, key)), first);
  // the record first sent without occurredAt and sent again with it (the app adds it after 60 s)
  refusal(await log(user, { kcal: 200, occurredAt: NOON }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await stored(user.userId), { ...NOTHING, logs: 1, calories: 200, meals: 1 });
  // a refused key is free again, with a corrected body
  const refused = randomUUID();
  refusal(await log(user, { kcal: 0 }, refused), 422, 'VALIDATION_FAILED', fields(['kcal', 'min']));
  ok(await log(user, { kcal: 50 }, refused));
  // the id of another user's log, under another user's key space
  refusal(await log(other, { kcal: 300 }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await stored(other.userId), NOTHING);
  assert.deepEqual(await stored(user.userId), { ...NOTHING, logs: 1, calories: 250, meals: 2 });
});

test('occurredAt: a late entry lands on its own day; older than 48 h is 409 DAY_CLOSED; more than 120 s ahead 422 OCCURRED_AT_INVALID', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  await clock(plus(NOON, 30 * HOUR)); // the 11th, 18:00
  const late = ok(await log(user, { kcal: 400, occurredAt: plus(NOON, 2 * HOUR) }));
  assert.equal(late.day.logicalDate, '2027-03-11');
  assert.equal(late.day.caloriesIn, 0);
  refusal(await log(user, { kcal: 400, occurredAt: plus(NOON, -19 * HOUR) }), 409, 'DAY_CLOSED');
  refusal(await log(user, { kcal: 400, occurredAt: plus(NOON, 30 * HOUR + 121_000) }), 422, 'OCCURRED_AT_INVALID');
  const { rows } = await db.admin.query(
    'SELECT logical_date::text AS date, calories_in::float8 AS calories FROM daily_logs WHERE user_id = $1',
    [user.userId],
  );
  assert.deepEqual(rows, [{ date: '2027-03-10', calories: 400 }]);
});

test('GET /day/history/{date} lists a manual entry with its label (null without one), its kcal and no slot', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const labelled = randomUUID();
  const bare = randomUUID();
  ok(await log(user, { kcal: 450, label: 'Bữa phở' }, labelled));
  await clock(plus(NOON, 60_000));
  ok(await log(user, { kcal: 120.5 }, bare));
  const detail = ok(await app.call('GET', '/day/history/2027-03-10', { token: user.token }));
  assert.deepEqual(detail.actions, [
    { id: bare, kind: 'NUTRITION', at: plus(NOON, 60_000), mealSlot: null, label: null, value: 120.5, undone: false },
    { id: labelled, kind: 'NUTRITION', at: NOON, mealSlot: null, label: 'Bữa phở', value: 450, undone: false },
  ]);
  assert.equal(detail.summary.caloriesIn, 570.5);
});

test('POST /nutrition/log answers 401 without a session and 409 ONBOARDING_REQUIRED to a fresh account', async () => {
  refusal(await app.call('POST', '/nutrition/log', { key: randomUUID(), body: { kcal: 10 } }), 401, 'SESSION_INVALID');
  const fresh = await newUser(db);
  refusal(await log(fresh, { kcal: 10 }), 409, 'ONBOARDING_REQUIRED');
});
