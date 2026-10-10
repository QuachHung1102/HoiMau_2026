import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MacroTarget, MealCandidate } from './mealPlan.ts';
import {
  SLOT_SHARE,
  TOLERANCES,
  macroDistance,
  pickMeal,
  rankMeals,
  slotTarget,
} from './mealPlan.ts';
import type { MealSlot } from './types.ts';

// Every expected order and number in this file comes from a throwaway oracle (explicit loops,
// Math.hypot, insertion ordering) that never imports this module.
const TARGET: MacroTarget = { kcal: 700, proteinG: 49, carbsG: 82, fatG: 20 };

const meal = (
  id: string,
  mealSlot: MealSlot,
  kcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  tags: string[] = [],
): MealCandidate => ({ id, mealSlot, kcal, proteinG, carbsG, fatG, tags });

// 17 LUNCH meals around a 700 kcal target: ±12 % = 616…784, ±20 % = 560…840, ±30 % = 490…910.
// Frozen: rankMeals must not reorder its input.
// prettier-ignore
const MEALS = Object.freeze([
  meal('L12', 'LUNCH', 900, 70, 100, 30, ['co:hai-san']),
  meal('L07', 'LUNCH', 690, 45, 80, 21, ['co:trung']),
  meal('B01', 'BREAKFAST', 700, 49, 82, 20),
  meal('L03', 'LUNCH', 760, 55, 90, 24, ['co:hai-san']),
  meal('L15', 'LUNCH', 1100, 80, 120, 40, ['co:thit-do']),
  meal('L09', 'LUNCH', 830, 52, 100, 28, ['co:thit-do']),
  meal('L01', 'LUNCH', 700, 49, 82, 20),
  meal('S01', 'SNACK', 200, 8, 25, 6),
  meal('L14', 'LUNCH', 300, 20, 30, 10, ['chay']),
  meal('L05', 'LUNCH', 784, 60, 95, 26, ['co:thit-do']),
  meal('L10', 'LUNCH', 560, 30, 75, 15, ['chay']),
  meal('L06', 'LUNCH', 690, 45, 80, 21, ['co:sua']),
  meal('D01', 'DINNER', 690, 48, 80, 20),
  meal('L17', 'LUNCH', 480, 30, 50, 15),
  meal('L02', 'LUNCH', 650, 40, 85, 18, ['co:gia-cam']),
  meal('L13', 'LUNCH', 910, 49, 82, 20),
  meal('L08', 'LUNCH', 600, 50, 60, 18, ['co:gia-cam']),
  meal('B02', 'BREAKFAST', 400, 25, 50, 10),
  meal('L04', 'LUNCH', 616, 35, 70, 22, ['chay']),
  meal('L16', 'LUNCH', 950, 60, 110, 35),
  meal('L11', 'LUNCH', 500, 25, 70, 12, ['chay']),
]) as MealCandidate[];

const WITHIN_12 = ['L01', 'L06', 'L07', 'L02', 'L03', 'L04', 'L05'];
const WITHIN_20 = ['L08', 'L09', 'L10'];
const WITHIN_30 = ['L13', 'L11', 'L12'];

const rank = (
  slot: MealSlot,
  excludeIds: string[] = [],
  excludedTags: string[] = [],
  meals = MEALS,
) => {
  const result = rankMeals(meals, TARGET, slot, { excludeIds, excludedTags });
  return { ...result, ranked: result.ranked.map(m => m.id) };
};

const near = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `expected ${expected}, got ${actual}`,
  );

test('slot shares and tolerance steps are the spec values (F-04)', () => {
  assert.deepEqual(SLOT_SHARE, {
    BREAKFAST: 0.25,
    LUNCH: 0.35,
    DINNER: 0.3,
    SNACK: 0.1,
  });
  assert.deepEqual(TOLERANCES, [0.12, 0.2, 0.3]);
});

test('slotTarget: each slot gets its share and the four shares sum to the day target', () => {
  const dayTarget = { kcal: 2811, proteinG: 140, carbsG: 387, fatG: 78 };
  const expected: Record<MealSlot, MacroTarget> = {
    BREAKFAST: { kcal: 702.75, proteinG: 35, carbsG: 96.75, fatG: 19.5 },
    LUNCH: { kcal: 983.85, proteinG: 49, carbsG: 135.45, fatG: 27.3 },
    DINNER: { kcal: 843.3, proteinG: 42, carbsG: 116.1, fatG: 23.4 },
    SNACK: { kcal: 281.1, proteinG: 14, carbsG: 38.7, fatG: 7.8 },
  };
  const sum = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const slot of ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const) {
    const actual = slotTarget(dayTarget, slot);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(sum).sort());
    for (const key of ['kcal', 'proteinG', 'carbsG', 'fatG'] as const) {
      near(actual[key], expected[slot][key]);
      sum[key] += actual[key];
    }
  }
  for (const key of ['kcal', 'proteinG', 'carbsG', 'fatG'] as const) {
    assert.ok(Math.abs(sum[key] - dayTarget[key]) < 1e-9, key);
  }
});

test('macroDistance: identical macros → 0, whatever the kcal', () => {
  assert.equal(macroDistance(TARGET, TARGET), 0);
  assert.equal(macroDistance({ ...TARGET, kcal: 910 }, TARGET), 0);
});

test('macroDistance: Euclidean norm of the relative protein, carbs and fat gaps', () => {
  near(
    macroDistance(MEALS.find(m => m.id === 'L05')!, TARGET),
    0.4068531889649322,
  );
  near(
    macroDistance(MEALS.find(m => m.id === 'L14')!, TARGET),
    1.0012054249376323,
  );
});

test('macroDistance: a zero target macro uses denominator 1 instead of dividing by zero', () => {
  const target = { kcal: 200, proteinG: 0, carbsG: 30, fatG: 0 };
  near(
    macroDistance({ kcal: 200, proteinG: 3, carbsG: 30, fatG: 4 }, target),
    5,
  );
  near(
    macroDistance({ kcal: 200, proteinG: 0, carbsG: 45, fatG: 0 }, target),
    0.5,
  );
  // carbs: gap 12 over denominator 1
  near(macroDistance({ ...TARGET, carbsG: 12 }, { ...TARGET, carbsG: 0 }), 12);
});

test('rankMeals: candidates inside ±12 % sorted by macroDistance, ties by id, both edges included', () => {
  assert.deepEqual(rank('LUNCH'), {
    ranked: WITHIN_12,
    tolerance: 0.12,
    macroWarning: false,
  });
});

test('rankMeals: with the ±12 % set removed the ±20 % set is used', () => {
  assert.deepEqual(rank('LUNCH', WITHIN_12), {
    ranked: WITHIN_20,
    tolerance: 0.2,
    macroWarning: false,
  });
});

test('rankMeals: then the ±30 % set', () => {
  assert.deepEqual(rank('LUNCH', [...WITHIN_12, ...WITHIN_20]), {
    ranked: WITHIN_30,
    tolerance: 0.3,
    macroWarning: false,
  });
});

test('rankMeals: none inside ±30 % → all remaining meals by kcal distance, with a macro warning', () => {
  assert.deepEqual(rank('LUNCH', [...WITHIN_12, ...WITHIN_20, ...WITHIN_30]), {
    ranked: ['L17', 'L16', 'L14', 'L15'], // gaps 220, 250, 400, 400 (tie by id)
    tolerance: null,
    macroWarning: true,
  });
});

test('rankMeals: excludedTags remove meals before the tolerance steps', () => {
  assert.deepEqual(rank('LUNCH', [], ['co:hai-san', 'chay']), {
    ranked: ['L01', 'L06', 'L07', 'L02', 'L05'],
    tolerance: 0.12,
    macroWarning: false,
  });
  // every ±12 % and ±20 % meal is excluded by id or tag, so the step widens to ±30 %
  assert.deepEqual(
    rank(
      'LUNCH',
      ['L01'],
      ['co:gia-cam', 'co:hai-san', 'chay', 'co:thit-do', 'co:trung', 'co:sua'],
    ),
    { ranked: ['L13'], tolerance: 0.3, macroWarning: false },
  );
});

test('rankMeals: meals of other slots never appear', () => {
  assert.deepEqual(rank('BREAKFAST'), {
    ranked: ['B01'],
    tolerance: 0.12,
    macroWarning: false,
  });
  assert.deepEqual(rank('DINNER'), {
    ranked: ['D01'],
    tolerance: 0.12,
    macroWarning: false,
  });
  assert.deepEqual(rank('SNACK'), {
    ranked: ['S01'],
    tolerance: null,
    macroWarning: true,
  });
});

test('rankMeals: the result does not depend on the input order', () => {
  const reversed = [...MEALS].reverse();
  assert.deepEqual(rank('LUNCH', [], [], reversed), rank('LUNCH'));
  const outside = [...WITHIN_12, ...WITHIN_20, ...WITHIN_30];
  assert.deepEqual(
    rank('LUNCH', outside, [], reversed),
    rank('LUNCH', outside),
  );
});

test('rankMeals: empty input → empty result', () => {
  assert.deepEqual(rank('LUNCH', [], [], []), {
    ranked: [],
    tolerance: null,
    macroWarning: true,
  });
});

test('pickMeal: uniform among the first 5 by the injected rng', () => {
  const seven = MEALS.slice(0, 7);
  assert.equal(
    pickMeal(seven, () => 0),
    seven[0],
  );
  assert.equal(
    pickMeal(seven, () => 0.5),
    seven[2],
  );
  assert.equal(
    pickMeal(seven, () => 0.999),
    seven[4],
  );
});

test('pickMeal: a short list is never indexed beyond its end; empty list → null', () => {
  const two = MEALS.slice(0, 2);
  assert.equal(
    pickMeal(two, () => 0),
    two[0],
  );
  assert.equal(
    pickMeal(two, () => 0.5),
    two[1],
  );
  assert.equal(
    pickMeal(two, () => 0.999),
    two[1],
  );
  assert.equal(
    pickMeal([], () => 0.5),
    null,
  );
});
