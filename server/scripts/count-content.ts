// Counts the seed content and fails when a required category is below its minimum.
// Usage: npm run content:count -- --require=quests,shopItems,nudgeTemplates   (default: every category)
// A content module that does not exist yet counts as 0.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Loaded = Record<string, unknown>;

const MINIMUMS = {
  quests: 5,
  shopItems: 9,
  nudgeTemplates: 3,
  meals: 44,
  moves: 20,
  workouts: 30,
  quotes: 40,
} as const;
type Category = keyof typeof MINIMUMS;

const MEALS_PER_SLOT = {
  BREAKFAST: 12,
  LUNCH: 12,
  DINNER: 12,
  SNACK: 8,
} as const;

async function load(file: string): Promise<Loaded> {
  const path = fileURLToPath(new URL(`../content/${file}`, import.meta.url));
  return existsSync(path)
    ? ((await import(pathToFileURL(path).href)) as Loaded)
    : {};
}

const list = (mod: Loaded, name: string): { mealSlot?: string }[] =>
  Array.isArray(mod[name]) ? (mod[name] as { mealSlot?: string }[]) : [];

const [quests, shopItems, nudgeTemplates, meals, exercises, quotes] =
  await Promise.all([
    load('quests.ts'),
    load('shopItems.ts'),
    load('nudgeTemplates.ts'),
    load('meals.ts'),
    load('exercises.ts'),
    load('quotes.ts'),
  ]);

const mealList = list(meals, 'MEALS');
const counts: Record<Category, number> = {
  quests: list(quests, 'QUESTS').length,
  shopItems: list(shopItems, 'SHOP_ITEMS').length,
  nudgeTemplates: list(nudgeTemplates, 'NUDGE_TEMPLATES').length,
  meals: mealList.length,
  moves: list(exercises, 'MOVES').length,
  workouts: list(exercises, 'WORKOUTS').length,
  quotes: list(quotes, 'QUOTES').length,
};

const slotCounts = Object.fromEntries(
  Object.keys(MEALS_PER_SLOT).map(slot => [
    slot,
    mealList.filter(m => m.mealSlot === slot).length,
  ]),
) as Record<keyof typeof MEALS_PER_SLOT, number>;

// `npm run content:count -- --require=…` from the repository root is swallowed by the inner npm as its own
// option and reaches this script only as npm_config_require, so read both.
const arg = process.argv.slice(2).find(a => a.startsWith('--require='));
const requested = arg
  ? arg.slice('--require='.length)
  : process.env.npm_config_require;
const required = requested
  ? requested.split(',').filter(Boolean)
  : Object.keys(MINIMUMS);
const unknown = required.filter(name => !(name in MINIMUMS));
if (unknown.length > 0) {
  console.error(
    `unknown category: ${unknown.join(', ')} (known: ${Object.keys(
      MINIMUMS,
    ).join(', ')})`,
  );
  process.exit(2);
}

const failures: string[] = [];
for (const name of Object.keys(MINIMUMS) as Category[]) {
  const detail =
    name === 'meals'
      ? ` (${Object.entries(slotCounts)
          .map(([s, n]) => `${s} ${n}`)
          .join(', ')})`
      : '';
  const isRequired = required.includes(name);
  console.log(
    `${name.padEnd(15)} ${String(counts[name]).padStart(3)} / min ${
      MINIMUMS[name]
    }${detail}${isRequired ? '' : ' [not required]'}`,
  );
  if (!isRequired) continue;
  if (counts[name] < MINIMUMS[name])
    failures.push(`${name}: ${counts[name]} < ${MINIMUMS[name]}`);
  if (name === 'meals') {
    for (const [slot, min] of Object.entries(MEALS_PER_SLOT)) {
      const n = slotCounts[slot as keyof typeof MEALS_PER_SLOT];
      if (n < min) failures.push(`meals ${slot}: ${n} < ${min}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`below minimum: ${failures.join('; ')}`);
  process.exit(1);
}
