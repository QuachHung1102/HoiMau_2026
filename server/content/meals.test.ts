import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findBannedTerms } from '../../domain/language.ts';
import { rankMeals, SLOT_SHARE, slotTarget } from '../../domain/mealPlan.ts';
import type { MealSlot } from '../../domain/types.ts';
import { INGREDIENT_TAGS, STYLE_TAGS } from '../../domain/types.ts';
import { MEALS } from './meals.ts';

const SLOTS = Object.keys(SLOT_SHARE) as MealSlot[];
const MIN_PER_SLOT: Record<MealSlot, number> = {
  BREAKFAST: 12,
  LUNCH: 12,
  DINNER: 12,
  SNACK: 8,
};
const TARGETS = [1200, 1500, 1800, 2100, 2400, 2700, 3000, 3400];
const MID_TARGETS = [1500, 1800, 2100, 2400, 2700];
const FLESH = ['co:thit-do', 'co:gia-cam', 'co:hai-san'];

// Same comparison as domain/mealPlan.ts rankMeals: an exact edge counts as inside.
const inside = (kcal: number, target: number, tolerance: number) =>
  Math.abs(kcal - target) <= tolerance * target + 1e-9;
const dayTarget = (kcal: number) => ({
  kcal,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
});
const countInside = (slot: MealSlot, day: number, tolerance: number) => {
  const target = slotTarget(dayTarget(day), slot).kcal;
  return MEALS.filter(
    m => m.mealSlot === slot && inside(m.kcal, target, tolerance),
  ).length;
};

test('at least 44 meals, with the minimum per slot', () => {
  assert.ok(MEALS.length >= 44, `${MEALS.length} meals`);
  for (const slot of SLOTS) {
    const n = MEALS.filter(m => m.mealSlot === slot).length;
    assert.ok(n >= MIN_PER_SLOT[slot], `${slot}: ${n}`);
  }
});

test('codes are unique UPPER_SNAKE ASCII; names are unique', () => {
  const codes = MEALS.map(m => m.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  const names = MEALS.map(m => m.name);
  assert.equal(new Set(names).size, names.length);
});

test('text fields are filled and kcal and macros are positive', () => {
  for (const m of MEALS) {
    for (const text of [m.name, m.portionText, m.description])
      assert.ok(text.trim().length > 0, m.code);
    assert.ok(m.kcal > 0 && m.proteinG > 0 && m.carbsG >= 0 && m.fatG >= 0, m.code);
    assert.match(m.portionText, /\d/, `${m.code}: portion needs a measure`);
  }
});

test('macros are consistent with kcal within 10 %', () => {
  for (const m of MEALS) {
    const fromMacros = 4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG;
    assert.ok(
      Math.abs(fromMacros - m.kcal) <= 0.1 * m.kcal,
      `${m.code}: macros give ${fromMacros}, kcal ${m.kcal}`,
    );
  }
});

test('tags come from the two vocabularies, without repeats', () => {
  const allowed: readonly string[] = [...STYLE_TAGS, ...INGREDIENT_TAGS];
  for (const m of MEALS) {
    for (const tag of m.tags) assert.ok(allowed.includes(tag), `${m.code}: ${tag}`);
    assert.equal(new Set(m.tags).size, m.tags.length, m.code);
  }
});

test('chay and khong-thit hold: no flesh tag; chay also no egg and no dairy', () => {
  for (const m of MEALS) {
    if (m.tags.includes('khong-thit') || m.tags.includes('chay'))
      for (const tag of FLESH) assert.ok(!m.tags.includes(tag as never), `${m.code}: ${tag}`);
    if (m.tags.includes('chay')) {
      assert.ok(m.tags.includes('khong-thit'), `${m.code}: chay without khong-thit`);
      assert.ok(!m.tags.includes('co:trung') && !m.tags.includes('co:sua'), m.code);
    }
  }
});

test('at least 8 meatless meals, spread over all four slots', () => {
  const meatless = MEALS.filter(
    m => m.tags.includes('khong-thit') || m.tags.includes('chay'),
  );
  assert.ok(meatless.length >= 8, `${meatless.length}`);
  for (const slot of SLOTS)
    assert.ok(meatless.some(m => m.mealSlot === slot), slot);
});

test('every non-null imageKey is an id in design/assets/sources.json', () => {
  const sources = JSON.parse(
    readFileSync(
      new URL('../../design/assets/sources.json', import.meta.url),
      'utf8',
    ),
  ) as { id: string }[];
  const ids = sources.map(s => s.id);
  for (const m of MEALS)
    if (m.imageKey !== null) assert.ok(ids.includes(m.imageKey), m.code);
});

test('the dishes in the approved frames keep their name, slot and kcal (R-D07)', () => {
  const frames: [string, MealSlot, number][] = [
    ['Yến mạch và trái cây', 'BREAKFAST', 540],
    ['Cơm gà, rau củ', 'LUNCH', 820],
    ['Cá áp chảo, cơm và rau', 'DINNER', 720],
    ['Sữa chua và hạt', 'SNACK', 290],
    ['Cơm cá và rau luộc', 'LUNCH', 790],
    ['Bún gà rau thơm', 'LUNCH', 760],
    ['Đậu hũ, cơm và nấm', 'LUNCH', 745],
  ];
  for (const [name, slot, kcal] of frames) {
    const meal = MEALS.find(m => m.name === name);
    assert.ok(meal, name);
    assert.deepEqual([meal.mealSlot, meal.kcal], [slot, kcal], name);
  }
  const lunch = MEALS.find(m => m.name === 'Cơm gà, rau củ');
  assert.deepEqual(
    [lunch?.proteinG, lunch?.carbsG, lunch?.fatG],
    [50, 100, 24],
  );
  assert.ok(MEALS.find(m => m.name === 'Đậu hũ, cơm và nấm')?.tags.includes('khong-thit'));
});

test('no banned term in any text of any meal', () => {
  for (const m of MEALS)
    for (const text of [m.name, m.portionText, m.description])
      assert.deepEqual(findBannedTerms(text), [], `${m.code}: ${text}`);
});

test('every slot has a meal within ±30 % of each day target, two within ±12 % for the middle targets', () => {
  const rows: Record<string, Record<string, string>> = {};
  for (const slot of SLOTS) {
    rows[slot] = {};
    for (const day of TARGETS) {
      const n12 = countInside(slot, day, 0.12);
      const n20 = countInside(slot, day, 0.2);
      const n30 = countInside(slot, day, 0.3);
      rows[slot][String(day)] = `${n12}/${n20}/${n30}`;
      assert.ok(n30 >= 1, `${slot} at ${day}: none within ±30 %`);
      if (MID_TARGETS.includes(day))
        assert.ok(n12 >= 2, `${slot} at ${day}: ${n12} within ±12 %`);
      // The domain's own ranking agrees: the pool is never empty and never needs the fallback.
      const ranked = rankMeals(
        MEALS.map(m => ({ ...m, id: m.code })),
        slotTarget(dayTarget(day), slot),
        slot,
        { excludeIds: [], excludedTags: [] },
      );
      assert.notEqual(ranked.tolerance, null, `${slot} at ${day}`);
      assert.equal(ranked.macroWarning, false, `${slot} at ${day}`);
      assert.equal(ranked.ranked.length, [n12, n20, n30][[0.12, 0.2, 0.3].indexOf(ranked.tolerance as number)]);
    }
  }
  console.log('meals inside ±12 % / ±20 % / ±30 % of the slot target');
  console.table(rows);
});

test('excluding any single ingredient tag leaves at least 4 meals in every slot', () => {
  for (const tag of INGREDIENT_TAGS)
    for (const slot of SLOTS) {
      const left = MEALS.filter(
        m => m.mealSlot === slot && !m.tags.includes(tag),
      ).length;
      assert.ok(left >= 4, `${slot} without ${tag}: ${left}`);
    }
});
