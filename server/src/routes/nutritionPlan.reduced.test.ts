// GET /nutrition/plan over a meal library cut down (as the owner) to the one meal the decoy's plan
// names: a breakfast far from the target of a 1200 kcal day, and no meal for the other slots. In
// a file of its own: the cut is of this file's database only.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { rankMeals, slotTarget } from '../../../domain/mealPlan.ts';
import type { MealCandidate } from '../../../domain/mealPlan.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await setTestClock(db.admin, '2027-03-10T05:00:00.000Z');
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

test('a slot whose meals all lie outside ±30 % gets the closest one with macroWarning; a slot without any meal gets none, also with macroWarning', async () => {
  // the meal the decoy's plan names stays (84-decoy-nutrition.sql), a lunch: nothing else
  await db.admin.query("DELETE FROM meal_plans WHERE code NOT IN ('COM_GA_RAU_CU')");
  const { rows: meals } = await db.admin.query<MealCandidate & { code: string }>(
    `SELECT id, code, meal_slot AS "mealSlot", kcal::float8 AS kcal, protein_g::float8 AS "proteinG",
            carbs_g::float8 AS "carbsG", fat_g::float8 AS "fatG", tags FROM meal_plans`,
  );
  const user = await newOnboardedUser(db);
  await db.admin.query(
    'UPDATE prescriptions SET calorie_target = 1200, protein_g = 90, carbs_g = 120, fat_g = 40 WHERE user_id = $1',
    [user.userId],
  );
  const target = { kcal: 1200, proteinG: 90, carbsG: 120, fatG: 40 };
  const lunch = meals.find(meal => meal.code === 'COM_GA_RAU_CU')!;
  const expected = rankMeals(meals, slotTarget(target, 'LUNCH'), 'LUNCH', { excludeIds: [], excludedTags: [] });
  // the fixture is what the test says it is: the lunch lies outside ±30 % of 420 kcal
  assert.deepEqual([expected.tolerance, expected.macroWarning, expected.ranked[0].id], [null, true, lunch.id]);

  const plan = (await app.call('GET', '/nutrition/plan', { token: user.token })).body as any;
  assert.equal(meals.length, 1);
  assert.deepEqual(
    plan.slots.map((slot: any) => [slot.mealSlot, slot.meal?.code ?? null, slot.macroWarning]),
    [
      ['BREAKFAST', null, true],
      ['LUNCH', 'COM_GA_RAU_CU', true],
      ['DINNER', null, true],
      ['SNACK', null, true],
    ],
  );
  // no candidate exists for any slot
  const candidates = await app.call('GET', '/nutrition/swap-candidates?mealSlot=LUNCH', { token: user.token });
  assert.deepEqual((candidates.body as any).candidates, []);
  // a slot without a meal cannot be logged
  const logged = await app.call('POST', '/nutrition/log', {
    token: user.token,
    key: crypto.randomUUID(),
    body: { mealSlot: 'SNACK' },
  });
  assert.deepEqual([logged.status, (logged.body as any).error.code], [409, 'PLAN_NOT_FOUND']);
});
