// GET /nutrition/plan, GET /nutrition/swap-candidates, POST /nutrition/swap and the mealSlot branch
// of POST /nutrition/log over HTTP, on the real database. Expected meals come from the domain
// functions (rankMeals, slotTarget) over the library and the prescription read as the owner,
// never from the code under test. Time is the test clock.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { calorieWindow } from '../../../domain/energy.ts';
import { SLOT_SHARE, rankMeals, slotTarget } from '../../../domain/mealPlan.ts';
import type { MealCandidate } from '../../../domain/mealPlan.ts';
import type { MealSlot } from '../../../domain/types.ts';
import { MEALS } from '../../content/meals.ts';
import { asUser, expectPgError, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh
const SLOTS: MealSlot[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await setTestClock(db.admin, NOON);
});
after(async () => {
  try {
    // a log line never carries a calorie number or a meal
    for (const line of app.logs) {
      const allowed =
        line.evt === 'ledger'
          ? ['ts', 'evt', 'kind', 'userId', 'amount', 'reason', 'refId']
          : ['ts', 'level', 'method', 'route', 'status', 'ms', 'userId'];
      assert.deepEqual(Object.keys(line).filter(name => !allowed.includes(name)), [], JSON.stringify(line));
    }
  } finally {
    await setTestClock(db.admin, null);
    await app.close();
    await db.drop();
  }
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;

function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
function refusal(result: CallResult, status: number, code: string) {
  assert.deepEqual([result.status, result.body?.error?.code], [status, code], JSON.stringify(result.body));
}
const getPlan = (user: User) => app.call('GET', '/nutrition/plan', { token: user.token });
const getCandidates = (user: User, slot: string) =>
  app.call('GET', `/nutrition/swap-candidates?mealSlot=${slot}`, { token: user.token });
const swap = (user: User, mealSlot: string, mealId: string, key = randomUUID()) =>
  app.call('POST', '/nutrition/swap', { token: user.token, key, body: { mealSlot, mealId } });
const logSlot = (user: User, mealSlot: string, key = randomUUID()) =>
  app.call('POST', '/nutrition/log', { token: user.token, key, body: { mealSlot } });

/** The library as the owner reads it, in the domain's shape. */
async function library(): Promise<MealCandidate[]> {
  const { rows } = await db.admin.query(
    `SELECT id, code, meal_slot AS "mealSlot", kcal::float8 AS kcal, protein_g::float8 AS "proteinG",
            carbs_g::float8 AS "carbsG", fat_g::float8 AS "fatG", tags FROM meal_plans`,
  );
  return rows;
}
async function dayTarget(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT calorie_target::float8 AS kcal, protein_g::float8 AS "proteinG", carbs_g::float8 AS "carbsG",
            fat_g::float8 AS "fatG" FROM prescriptions WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}
async function planRows(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT meal_slot, meal_id, swaps_used, shown_meal_ids, logged_action_id
       FROM daily_meal_plans WHERE user_id = $1 ORDER BY meal_slot`,
    [userId],
  );
  return rows;
}

test('the first read stores exactly four rows, the second answers the same meals; ten parallel first reads end with four rows', async () => {
  const user = await newOnboardedUser(db);
  const first = ok(await getPlan(user));
  assert.equal((await planRows(user.userId)).length, 4);
  assert.deepEqual(first.slots.map((slot: any) => slot.mealSlot), SLOTS);
  assert.equal(first.logicalDate, '2027-03-10');
  const second = ok(await getPlan(user));
  assert.deepEqual(second, first);

  const racer = await newOnboardedUser(db);
  const answers = (await Promise.all(Array.from({ length: 10 }, () => getPlan(racer)))).map(ok);
  const rows = await planRows(racer.userId);
  assert.equal(rows.length, 4);
  // every answer shows the one stored plan
  for (const answer of answers) {
    assert.deepEqual(
      answer.slots.map((slot: any) => slot.meal?.id ?? null),
      SLOTS.map(slot => rows.find(row => row.meal_slot === slot).meal_id),
    );
  }
});

test('every planned meal is one of the five rankMeals puts first for its slot, with its macroWarning; the state carries targets, window and swaps', async () => {
  const meals = await library();
  for (let i = 0; i < 5; i++) {
    const user = await newOnboardedUser(db);
    const target = await dayTarget(user.userId);
    const plan = ok(await getPlan(user));
    assert.deepEqual(plan.target, target);
    assert.deepEqual(plan.calorieWindow, calorieWindow(target.kcal));
    assert.equal(plan.caloriesIn, 0);
    for (const slot of plan.slots) {
      const expected = rankMeals(meals, slotTarget(target, slot.mealSlot), slot.mealSlot, {
        excludeIds: [],
        excludedTags: [],
      });
      assert.ok(expected.tolerance !== null);
      assert.ok(
        expected.ranked.slice(0, 5).some(meal => meal.id === slot.meal.id),
        `${slot.mealSlot}: ${slot.meal.code} is not among the first five`,
      );
      const share = slotTarget(target, slot.mealSlot).kcal;
      assert.ok(Math.abs(slot.meal.kcal - share) <= expected.tolerance! * share + 1e-9);
      assert.deepEqual(
        [slot.macroWarning, slot.logged, slot.swapsUsed, slot.swapsAllowed],
        [expected.macroWarning, false, 0, 3],
      );
      // the meal is the content's, member for member
      const content = MEALS.find(meal => meal.code === slot.meal.code)!;
      assert.deepEqual(slot.meal, { id: slot.meal.id, ...content });
    }
  }
});

test('with excluded tags no planned meal and no candidate carries one of them', async () => {
  const excluded = ['co:thit-do', 'co:hai-san', 'co:gluten'];
  for (let i = 0; i < 5; i++) {
    const user = await newOnboardedUser(db);
    ok(await app.call('PATCH', '/settings', { token: user.token, key: randomUUID(), body: { excludedMealTags: excluded } }));
    const plan = ok(await getPlan(user));
    for (const slot of plan.slots) {
      assert.ok(slot.meal !== null);
      assert.deepEqual(slot.meal.tags.filter((tag: string) => excluded.includes(tag)), [], slot.meal.code);
      const { candidates } = ok(await getCandidates(user, slot.mealSlot));
      for (const candidate of candidates) {
        assert.deepEqual(candidate.tags.filter((tag: string) => excluded.includes(tag)), [], candidate.code);
      }
    }
  }
});

test('targets of 1200 and of 4000 kcal both get four planned meals', async () => {
  for (const kcal of [1200, 4000]) {
    const user = await newOnboardedUser(db);
    await db.admin.query('UPDATE prescriptions SET calorie_target = $2 WHERE user_id = $1', [user.userId, kcal]);
    const plan = ok(await getPlan(user));
    assert.equal(plan.target.kcal, kcal);
    assert.deepEqual(plan.slots.map((slot: any) => slot.meal !== null), [true, true, true, true]);
    assert.equal((await planRows(user.userId)).length, 4);
  }
});

test('candidates: at most three, never a meal planned today or shown before in the slot, ranked as rankMeals ranks, kcalDelta against the current meal', async () => {
  const meals = await library();
  const user = await newOnboardedUser(db);
  const target = await dayTarget(user.userId);
  let plan = ok(await getPlan(user));
  for (let round = 0; round < 3; round++) {
    const current = plan.slots.find((slot: any) => slot.mealSlot === 'LUNCH').meal;
    const shown = (await planRows(user.userId)).find(row => row.meal_slot === 'LUNCH').shown_meal_ids;
    const planned = plan.slots.map((slot: any) => slot.meal.id);
    const answer = ok(await getCandidates(user, 'LUNCH'));
    const expected = rankMeals(meals, slotTarget(target, 'LUNCH'), 'LUNCH', {
      excludeIds: [...shown, ...planned],
      excludedTags: [],
    }).ranked.slice(0, 3);
    assert.deepEqual(answer.candidates.map((c: any) => c.id), expected.map(meal => meal.id));
    assert.ok(answer.candidates.length >= 1 && answer.candidates.length <= 3);
    assert.equal(answer.swapsRemaining, 3 - round);
    for (const candidate of answer.candidates) {
      assert.ok(!planned.includes(candidate.id) && !shown.includes(candidate.id));
      assert.equal(candidate.kcalDelta, candidate.kcal - current.kcal);
      assert.equal(candidate.mealSlot, 'LUNCH');
    }
    plan = ok(await swap(user, 'LUNCH', answer.candidates[answer.candidates.length - 1].id));
  }
  // the three meals swapped away are now shown ones
  assert.equal((await planRows(user.userId)).find(row => row.meal_slot === 'LUNCH').shown_meal_ids.length, 3);
});

test('swaps: 2, 1, 0 left, then SWAP_LIMIT_REACHED; with MEAL_SWAP_PLUS five; a meal outside the candidates is 422; a replay swaps nothing', async () => {
  const user = await newOnboardedUser(db);
  ok(await getPlan(user));
  const remaining = [];
  for (let i = 0; i < 3; i++) {
    const { candidates } = ok(await getCandidates(user, 'DINNER'));
    const key = randomUUID();
    const answer = ok(await swap(user, 'DINNER', candidates[0].id, key));
    const dinner = answer.slots.find((slot: any) => slot.mealSlot === 'DINNER');
    assert.deepEqual([dinner.meal.id, dinner.swapsUsed], [candidates[0].id, i + 1]);
    // the same key again: the stored answer, no fourth swap counted
    assert.deepEqual(ok(await swap(user, 'DINNER', candidates[0].id, key)), answer);
    remaining.push(ok(await getCandidates(user, 'DINNER')).swapsRemaining);
  }
  assert.deepEqual(remaining, [2, 1, 0]);
  assert.deepEqual(ok(await getCandidates(user, 'DINNER')).candidates, []);
  const held = await planRows(user.userId);
  const anyDinner = (await library()).find(meal => meal.mealSlot === 'DINNER' && !held.some(row => row.meal_id === meal.id))!;
  refusal(await swap(user, 'DINNER', anyDinner.id), 409, 'SWAP_LIMIT_REACHED');
  assert.deepEqual(await planRows(user.userId), held);

  const plus = await newOnboardedUser(db);
  await db.admin.query("INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'MEAL_SWAP_PLUS', 2)", [plus.userId]);
  assert.equal(ok(await getPlan(plus)).slots[0].swapsAllowed, 5);
  for (let i = 0; i < 5; i++) {
    const { candidates, swapsRemaining } = ok(await getCandidates(plus, 'BREAKFAST'));
    assert.equal(swapsRemaining, 5 - i);
    ok(await swap(plus, 'BREAKFAST', candidates[0].id));
  }
  assert.equal(ok(await getCandidates(plus, 'BREAKFAST')).swapsRemaining, 0);
  const plusRows = await planRows(plus.userId);
  const anyBreakfast = (await library()).find(meal => meal.mealSlot === 'BREAKFAST' && !plusRows.some(row => row.meal_id === meal.id))!;
  refusal(await swap(plus, 'BREAKFAST', anyBreakfast.id), 409, 'SWAP_LIMIT_REACHED');

  // a meal of the slot that is not among the three candidates: refused, nothing changes
  const other = await newOnboardedUser(db);
  ok(await getPlan(other));
  const { candidates } = ok(await getCandidates(other, 'LUNCH'));
  const planned = (await planRows(other.userId)).map(row => row.meal_id);
  const outside = (await library()).find(
    meal => meal.mealSlot === 'LUNCH' && !planned.includes(meal.id) && !candidates.some((c: any) => c.id === meal.id),
  )!;
  const untouched = await planRows(other.userId);
  refusal(await swap(other, 'LUNCH', outside.id), 422, 'SWAP_CANDIDATE_INVALID');
  // a meal of another slot, and a meal that does not exist
  refusal(await swap(other, 'LUNCH', anyBreakfast.id), 422, 'SWAP_CANDIDATE_INVALID');
  refusal(await swap(other, 'LUNCH', randomUUID()), 422, 'SWAP_CANDIDATE_INVALID');
  assert.deepEqual(await planRows(other.userId), untouched);
});

test('a swap before any plan is PLAN_NOT_FOUND; what a swap body and the candidates query may be', async () => {
  const user = await newOnboardedUser(db);
  const meal = (await library()).find(m => m.mealSlot === 'LUNCH')!;
  refusal(await swap(user, 'LUNCH', meal.id), 409, 'PLAN_NOT_FOUND');
  assert.equal((await planRows(user.userId)).length, 0);
  refusal(await swap(user, 'BRUNCH', meal.id), 422, 'VALIDATION_FAILED');
  refusal(await swap(user, 'LUNCH', 'not-a-uuid'), 422, 'VALIDATION_FAILED');
  refusal(await app.call('POST', '/nutrition/swap', { token: user.token, key: randomUUID(), body: {} }), 422, 'VALIDATION_FAILED');
  refusal(await app.call('GET', '/nutrition/swap-candidates', { token: user.token }), 422, 'VALIDATION_FAILED');
  refusal(await getCandidates(user, 'BRUNCH'), 422, 'VALIDATION_FAILED');
});

test('logging a planned meal adds its kcal, marks it logged, latches NUTRITION_TARGET inside the window; again is MEAL_ALREADY_LOGGED; a logged slot cannot be swapped', async () => {
  const user = await newOnboardedUser(db);
  const plan = ok(await getPlan(user));
  const lunch = plan.slots.find((slot: any) => slot.mealSlot === 'LUNCH').meal;
  const { min } = plan.calorieWindow;
  // a manual entry first, so that the planned lunch brings the day exactly to the window
  ok(await app.call('POST', '/nutrition/log', { token: user.token, key: randomUUID(), body: { kcal: min - lunch.kcal } }));
  const key = randomUUID();
  const answer = ok(await logSlot(user, 'LUNCH', key));
  assert.equal(answer.actionId, key);
  assert.equal(answer.day.caloriesIn, min);
  assert.equal(answer.day.quests.find((q: any) => q.code === 'NUTRITION_TARGET').completed, true);
  assert.deepEqual(answer.delta.events, [{ type: 'QUEST_COMPLETED', questCode: 'NUTRITION_TARGET' }]);
  assert.equal(answer.delta.xp, 50);
  // the same key again: the stored answer
  assert.deepEqual(ok(await logSlot(user, 'LUNCH', key)), answer);

  const later = ok(await getPlan(user));
  const slot = later.slots.find((s: any) => s.mealSlot === 'LUNCH');
  assert.deepEqual([slot.logged, slot.meal.id, later.caloriesIn], [true, lunch.id, min]);
  const { rows } = await db.admin.query(
    'SELECT meal_slot, meal_id, label, kcal::float8 AS kcal FROM nutrition_logs WHERE id = $1',
    [key],
  );
  assert.deepEqual(rows, [{ meal_slot: 'LUNCH', meal_id: lunch.id, label: lunch.name, kcal: lunch.kcal }]);
  assert.equal((await planRows(user.userId)).find(row => row.meal_slot === 'LUNCH').logged_action_id, key);
  // the day's history names the meal
  const detail = ok(await app.call('GET', '/day/history/2027-03-10', { token: user.token }));
  assert.ok(detail.actions.some((a: any) => a.id === key && a.mealSlot === 'LUNCH' && a.label === lunch.name && a.value === lunch.kcal));

  refusal(await logSlot(user, 'LUNCH'), 409, 'MEAL_ALREADY_LOGGED');
  assert.deepEqual(ok(await getCandidates(user, 'LUNCH')), { mealSlot: 'LUNCH', swapsRemaining: 0, candidates: [] });
  const anyLunch = (await library()).find(m => m.mealSlot === 'LUNCH' && m.id !== lunch.id)!;
  refusal(await swap(user, 'LUNCH', anyLunch.id), 409, 'MEAL_ALREADY_LOGGED');
  refusal(
    await app.call('POST', '/nutrition/log', { token: user.token, key: randomUUID(), body: { mealSlot: 'DINNER', kcal: 100 } }),
    422,
    'VALIDATION_FAILED',
  );
  // nothing more was added
  assert.equal(ok(await getPlan(user)).caloriesIn, min);
});

test('nutrition_swap called directly as app_auth with a meal of another slot is SWAP_CANDIDATE_INVALID', async () => {
  const user = await newOnboardedUser(db);
  ok(await getPlan(user));
  const breakfast = (await library()).find(m => m.mealSlot === 'BREAKFAST')!;
  const held = await planRows(user.userId);
  await expectPgError(
    asUser(db.app, user.userId, c => c.query('SELECT nutrition_swap($1, $2, $3)', ['LUNCH', breakfast.id, randomUUID()])),
    { code: 'HM000', messagePrefix: 'SWAP_CANDIDATE_INVALID' },
  );
  assert.deepEqual(await planRows(user.userId), held);
});

test('nutrition_plan_save never overwrites: a second save, also one racing the first, leaves the first plan', async () => {
  const meals = await library();
  const pick = (slot: MealSlot, n: number) => meals.filter(m => m.mealSlot === slot)[n].id;
  const plan = (n: number) =>
    JSON.stringify(SLOTS.map(mealSlot => ({ mealSlot, mealId: pick(mealSlot, n), macroWarning: false })));
  const user = await newOnboardedUser(db);
  const save = (c: { query: (...args: any[]) => Promise<unknown> }, n: number) =>
    c.query('SELECT nutrition_plan_save($1, $2)', ['2027-03-10', plan(n)]);

  // two request transactions: the second waits for the first, then stores nothing
  const first = await db.app.connect();
  const second = await db.app.connect();
  try {
    for (const c of [first, second]) {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE app_auth');
      await c.query("SELECT set_config('app.user_id', $1, true)", [user.userId]);
    }
    await save(first, 0);
    const waiting = save(second, 1).then(() => second.query('COMMIT'));
    await first.query('COMMIT');
    await waiting;
  } finally {
    first.release();
    second.release();
  }
  const stored = async () => (await planRows(user.userId)).map(row => [row.meal_slot, row.meal_id]);
  const expected = SLOTS.map(slot => [slot, pick(slot, 0)]).sort();
  assert.deepEqual(await stored(), expected);
  await asUser(db.app, user.userId, c => save(c, 2));
  assert.deepEqual(await stored(), expected);
  // and the route shows that plan
  assert.deepEqual(
    ok(await getPlan(user)).slots.map((slot: any) => slot.meal.id),
    SLOTS.map(slot => pick(slot, 0)),
  );
});

test('the meal library is the content file, by code; a second seeding rewrites no row; a swapped-in meal carries the macroWarning rankMeals gives it', async () => {
  const { rows } = await db.admin.query(
    `SELECT code, name, meal_slot AS "mealSlot", kcal::float8 AS kcal, protein_g::float8 AS "proteinG",
            carbs_g::float8 AS "carbsG", fat_g::float8 AS "fatG", tags, portion_text AS "portionText",
            description, image_key AS "imageKey", xmin::text AS xmin
       FROM meal_plans ORDER BY code`,
  );
  const byCode = (a: { code: string }, b: { code: string }) => (a.code < b.code ? -1 : 1);
  assert.deepEqual(rows.map(({ xmin: _xmin, ...meal }) => meal).sort(byCode), [...MEALS].sort(byCode));
  const { seed } = await import('../seed/meals.ts');
  const client = await db.admin.connect();
  try {
    await seed(client);
  } finally {
    client.release();
  }
  const again = await db.admin.query('SELECT xmin::text AS xmin FROM meal_plans ORDER BY code');
  assert.deepEqual(again.rows.map(row => row.xmin), rows.map(row => row.xmin));

  // every swap of a 1200 kcal day: the stored warning is what rankMeals says of that one meal
  const meals = await library();
  const user = await newOnboardedUser(db);
  await db.admin.query('UPDATE prescriptions SET calorie_target = 1200 WHERE user_id = $1', [user.userId]);
  const target = await dayTarget(user.userId);
  ok(await getPlan(user));
  let checked = 0;
  for (const mealSlot of SLOTS) {
    for (let i = 0; i < 3; i++) {
      const { candidates } = ok(await getCandidates(user, mealSlot));
      if (candidates.length === 0) {
        break;
      }
      const chosen = candidates[candidates.length - 1];
      const plan = ok(await swap(user, mealSlot, chosen.id));
      const slot = plan.slots.find((s: any) => s.mealSlot === mealSlot);
      const alone = rankMeals([meals.find(m => m.id === chosen.id)!], slotTarget(target, mealSlot), mealSlot, {
        excludeIds: [],
        excludedTags: [],
      });
      assert.equal(slot.macroWarning, alone.macroWarning, `${mealSlot} ${chosen.code}`);
      checked++;
    }
  }
  assert.ok(checked >= 4);
});

test('nutrition_plan_save refuses a malformed plan with VALIDATION_FAILED and stores nothing; a slot with mealId null is accepted', async () => {
  const meals = await library();
  const breakfast = meals.find(m => m.mealSlot === 'BREAKFAST')!;
  const lunch = meals.find(m => m.mealSlot === 'LUNCH')!;
  const user = await newOnboardedUser(db);
  const save = (slots: unknown) =>
    asUser(db.app, user.userId, c =>
      c.query('SELECT nutrition_plan_save($1, $2)', ['2027-03-10', JSON.stringify(slots)]),
    );
  for (const slots of [
    [{ mealSlot: 'LUNCH', mealId: breakfast.id, macroWarning: false }], // a meal of another slot
    [{ mealSlot: 'LUNCH', mealId: randomUUID(), macroWarning: false }], // no such meal
    { mealSlot: 'LUNCH', mealId: lunch.id, macroWarning: false }, // not an array
    [{ mealSlot: 'LUNCH', mealId: lunch.id, macroWarning: 'false' }], // macroWarning a string
    [{ mealSlot: 'LUNCH', macroWarning: false }], // no mealId member
    [{ mealSlot: 'BRUNCH', mealId: lunch.id, macroWarning: false }], // no such slot
    // one bad element refuses the whole plan
    [{ mealSlot: 'BREAKFAST', mealId: breakfast.id, macroWarning: false }, { mealSlot: 'LUNCH', mealId: breakfast.id, macroWarning: false }],
  ]) {
    await expectPgError(save(slots), { code: 'HM000', messagePrefix: 'VALIDATION_FAILED' });
    assert.deepEqual(await planRows(user.userId), [], JSON.stringify(slots));
  }
  await save([{ mealSlot: 'SNACK', mealId: null, macroWarning: true }]);
  assert.deepEqual(
    (await planRows(user.userId)).map(row => [row.meal_slot, row.meal_id]),
    [['SNACK', null]],
  );
});

test('nutrition_swap called directly refuses a meal the slot has shown and the meal it holds: SWAP_CANDIDATE_INVALID', async () => {
  const user = await newOnboardedUser(db);
  const first = ok(await getPlan(user)).slots.find((slot: any) => slot.mealSlot === 'DINNER').meal;
  const { candidates } = ok(await getCandidates(user, 'DINNER'));
  ok(await swap(user, 'DINNER', candidates[0].id));
  const held = await planRows(user.userId);
  assert.deepEqual(held.find(row => row.meal_slot === 'DINNER').shown_meal_ids, [first.id]);
  for (const mealId of [first.id, candidates[0].id]) {
    await expectPgError(
      asUser(db.app, user.userId, c => c.query('SELECT nutrition_swap($1, $2, $3)', ['DINNER', mealId, randomUUID()])),
      { code: 'HM000', messagePrefix: 'SWAP_CANDIDATE_INVALID' },
    );
  }
  assert.deepEqual(await planRows(user.userId), held);
});

test('the slot shares of nutrition_swap are SLOT_SHARE of the domain', async () => {
  const { rows } = await db.admin.query(
    "SELECT pg_get_functiondef('nutrition_swap(text, uuid, uuid)'::regprocedure) AS def",
  );
  // the CASE over the slot (the function has other CASEs)
  const def = /CASE p_meal_slot ([\s\S]*?) END/.exec(rows[0].def as string)?.[1] ?? '';
  const shares: Record<string, number> = {};
  for (const [, slot, share] of def.matchAll(/WHEN '(\w+)' THEN ([\d.]+)/g)) {
    shares[slot] = Number(share);
  }
  const rest = /ELSE ([\d.]+)\s*$/.exec(def);
  assert.ok(rest, 'no ELSE share');
  for (const slot of SLOTS.filter(s => !(s in shares))) {
    shares[slot] = Number(rest[1]);
  }
  assert.deepEqual(shares, SLOT_SHARE);
});

test('logging a planned meal: OCCURRED_AT_INVALID ahead, DAY_CLOSED past 48 hours, and on yesterday while it is open it logs yesterday\'s plan', async () => {
  const user = await newOnboardedUser(db);
  const yesterday = ok(await getPlan(user));
  const lunch = yesterday.slots.find((slot: any) => slot.mealSlot === 'LUNCH').meal;
  const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();
  const send = (occurredAt: string) =>
    app.call('POST', '/nutrition/log', { token: user.token, key: randomUUID(), body: { mealSlot: 'LUNCH', occurredAt } });
  refusal(await send(at(10 * 60_000)), 422, 'OCCURRED_AT_INVALID');
  refusal(await send(at(-49 * 3600_000)), 409, 'DAY_CLOSED');
  assert.equal(yesterday.caloriesIn, 0);
  try {
    // the next day at 10:00 local; 2027-03-10 has not been closed
    await setTestClock(db.admin, at(22 * 3600_000));
    const today = ok(await getPlan(user));
    assert.equal(today.logicalDate, '2027-03-11');
    const answer = ok(await send(NOON));
    assert.equal(answer.day.logicalDate, '2027-03-11');
    const { rows } = await db.admin.query(
      `SELECT p.logical_date::text AS day, p.meal_slot, p.logged_action_id IS NOT NULL AS logged, d.calories_in::float8 AS kcal
         FROM daily_meal_plans p JOIN daily_logs d ON d.user_id = p.user_id AND d.logical_date = p.logical_date
        WHERE p.user_id = $1 AND p.meal_slot = 'LUNCH'`,
      [user.userId],
    );
    assert.deepEqual(rows, [{ day: '2027-03-10', meal_slot: 'LUNCH', logged: true, kcal: lunch.kcal }]);
    // today's lunch is still open
    assert.equal(ok(await getPlan(user)).slots.find((slot: any) => slot.mealSlot === 'LUNCH').logged, false);
  } finally {
    await setTestClock(db.admin, NOON);
  }
});
