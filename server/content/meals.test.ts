import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findBannedTerms, normalizeVi } from '../../domain/language.ts';
import { rankMeals, SLOT_SHARE, slotTarget } from '../../domain/mealPlan.ts';
import type { IngredientTag, MealSlot } from '../../domain/types.ts';
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
const FLESH: IngredientTag[] = ['co:thit-do', 'co:gia-cam', 'co:hai-san'];

// Same comparison as domain/mealPlan.ts rankMeals: an exact edge counts as inside.
const inside = (kcal: number, target: number, tolerance: number) =>
  Math.abs(kcal - target) <= tolerance * target + 1e-9;
const dayTarget = (kcal: number) => ({
  kcal,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
});
const slotKcal = (slot: MealSlot, day: number) =>
  slotTarget(dayTarget(day), slot).kcal;
const countInside = (
  meals: typeof MEALS,
  slot: MealSlot,
  day: number,
  tolerance: number,
) =>
  meals.filter(
    m => m.mealSlot === slot && inside(m.kcal, slotKcal(slot, day), tolerance),
  ).length;

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

test('text fields are filled, kcal and macros positive, and the portion gives a gram or ml figure', () => {
  for (const m of MEALS) {
    for (const text of [m.name, m.portionText, m.description])
      assert.ok(text.trim().length > 0, m.code);
    assert.ok(
      m.kcal > 0 && m.proteinG > 0 && m.carbsG >= 0 && m.fatG >= 0,
      m.code,
    );
    assert.match(m.portionText, /\d+\s?(g|ml)\b/, `${m.code}: portion`);
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
    for (const tag of m.tags)
      assert.ok(allowed.includes(tag), `${m.code}: ${tag}`);
    assert.equal(new Set(m.tags).size, m.tags.length, m.code);
  }
});

// Words (diacritics stripped, whole words) that name each ingredient tag in dish text. Both
// directions are checked: a tag needs a word that names it, and a word needs its tag. `strip`
// removes the known false positives first: "mì gạo" and "mì Quảng" are rice noodles, "sữa đậu
// nành" is soy not dairy, "trứng gà" is egg not poultry, "cà chua" is tomato not fish, and so on.
// "cà chua", "cà rốt", "cả xương", "cả khi" and "cả lõi" are not fish; "không trứng" and the sentence that says a dish
// has no meat, fish or egg are the reason a tag is absent, not a mention.
const NOT_FISH = [
  'ca chua',
  'ca rot',
  'ca phe',
  'ca tim',
  'ca ri',
  'ca xuong',
  'ca khi',
  'ca loi',
];
const NOT_FLESH_EGG = ['khong dung thit ca hay trung', 'khong trung'];
const TAG_WORDS: Record<
  IngredientTag,
  { words: string[]; strip?: string[] }
> = {
  'co:thit-do': {
    words: ['heo', 'bo', 'suon', 'ba chi', 'gio', 'cha', 'xuc xich', 'pate'],
  },
  'co:gia-cam': { words: ['ga', 'vit'], strip: ['trung ga'] },
  'co:hai-san': {
    words: [
      'ca',
      'tom',
      'cua',
      'muc',
      'nuoc mam',
      'mam ruoc',
      'mam tom',
      'dau hao',
      'hai san',
    ],
    strip: [...NOT_FISH, ...NOT_FLESH_EGG],
  },
  'co:trung': { words: ['trung'], strip: NOT_FLESH_EGG },
  'co:sua': { words: ['sua', 'pho mai'], strip: ['sua dau nanh'] },
  'co:dau-phong': { words: ['dau phong', 'lac'] },
  'co:gluten': {
    words: ['banh mi', 'mi', 'yen mach', 'bot mi', 'banh bao'],
    strip: ['mi gao', 'mi quang'],
  },
  'co:dau-nanh': {
    words: ['dau hu', 'dau nanh', 'nuoc tuong', 'tuong'],
    strip: ['tuong ot'],
  },
};
const mentions = (text: string, tag: IngredientTag) => {
  const { words, strip = [] } = TAG_WORDS[tag];
  let haystack = ` ${normalizeVi(text).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const s of strip) haystack = haystack.split(` ${s} `).join(' ');
  return words.filter(w => haystack.includes(` ${w} `));
};
const textOf = (m: (typeof MEALS)[number]) =>
  `${m.name}. ${m.portionText} ${m.description}`;

test('tags match text: a tag has a word that names it, a word has its tag', () => {
  const problems: string[] = [];
  for (const m of MEALS)
    for (const tag of INGREDIENT_TAGS) {
      const found = mentions(textOf(m), tag);
      const has = m.tags.includes(tag);
      if (found.length > 0 && !has)
        problems.push(`${m.code}: text names "${found[0]}" but no ${tag}`);
      if (found.length === 0 && has)
        problems.push(`${m.code}: ${tag} but the text does not name it`);
    }
  assert.deepEqual(problems, []);
});

test('chay and khong-thit hold: no flesh tag, no fish sauce; chay also no egg and no dairy', () => {
  for (const m of MEALS) {
    if (!m.tags.includes('khong-thit') && !m.tags.includes('chay')) continue;
    for (const tag of FLESH) assert.ok(!m.tags.includes(tag), `${m.code}: ${tag}`);
    const text = ` ${normalizeVi(textOf(m)).replace(/[^a-z0-9]+/g, ' ')} `;
    for (const word of ['nuoc mam', 'mam', 'tom kho', 'dau hao'])
      assert.ok(!text.includes(` ${word} `), `${m.code}: names "${word}"`);
    if (m.tags.includes('chay')) {
      assert.ok(m.tags.includes('khong-thit'), `${m.code}: chay needs khong-thit`);
      assert.ok(
        !m.tags.includes('co:trung') && !m.tags.includes('co:sua'),
        m.code,
      );
    }
  }
});

test('at least 8 meatless meals, spread over all four slots', () => {
  const meatless = MEALS.filter(
    m => m.tags.includes('khong-thit') || m.tags.includes('chay'),
  );
  assert.ok(meatless.length >= 8, `${meatless.length}`);
  for (const slot of SLOTS)
    assert.ok(
      meatless.some(m => m.mealSlot === slot),
      slot,
    );
});

test('lunch has at least 5 meals without fish sauce, one light (about 420 kcal) and one large (about 1000)', () => {
  const lunch = MEALS.filter(
    m => m.mealSlot === 'LUNCH' && !m.tags.includes('co:hai-san'),
  );
  assert.ok(lunch.length >= 5, `${lunch.length}`);
  assert.ok(lunch.some(m => m.kcal >= 380 && m.kcal <= 460));
  assert.ok(lunch.some(m => m.kcal >= 950 && m.kcal <= 1050));
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
  assert.ok(
    MEALS.find(m => m.name === 'Đậu hũ, cơm và nấm')?.tags.includes(
      'khong-thit',
    ),
  );
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
      const n12 = countInside(MEALS, slot, day, 0.12);
      const n20 = countInside(MEALS, slot, day, 0.2);
      const n30 = countInside(MEALS, slot, day, 0.3);
      rows[slot][String(day)] = `${n12}/${n20}/${n30}`;
      assert.ok(n30 >= 1, `${slot} at ${day}: none within ±30 %`);
      if (MID_TARGETS.includes(day))
        assert.ok(n12 >= 2, `${slot} at ${day}: ${n12} within ±12 %`);
      // The domain's own ranking agrees with the count at the tolerance it settles on.
      const ranked = rankMeals(
        MEALS.map(m => ({ ...m, id: m.code })),
        slotTarget(dayTarget(day), slot),
        slot,
        { excludeIds: [], excludedTags: [] },
      );
      const tolerance = ranked.tolerance as 0.12 | 0.2 | 0.3;
      assert.equal(
        ranked.ranked.length,
        countInside(MEALS, slot, day, tolerance),
      );
    }
  }
  console.log('meals inside ±12 % / ±20 % / ±30 % of the slot target');
  console.table(rows);
});

test('excluding any single ingredient tag leaves at least 5 meals per slot and a meal within ±30 % of every day target', () => {
  const failures: string[] = [];
  const rows: Record<string, Record<string, number>> = {};
  for (const tag of INGREDIENT_TAGS) {
    const left = MEALS.filter(m => !m.tags.includes(tag));
    rows[tag] = {};
    for (const slot of SLOTS) {
      const n = left.filter(m => m.mealSlot === slot).length;
      rows[tag][slot] = n;
      if (n < 5) failures.push(`without ${tag}: ${slot} has ${n}`);
      for (const day of TARGETS)
        if (countInside(left, slot, day, 0.3) < 1)
          failures.push(`without ${tag}: ${slot} at ${day} has none within ±30 %`);
    }
  }
  console.log('meals left per slot after excluding one ingredient tag');
  console.table(rows);
  assert.deepEqual(failures, []);
});
