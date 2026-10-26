import type { MealSlot } from './types.ts';

export const SLOT_SHARE: Record<MealSlot, number> = {
  BREAKFAST: 0.25,
  LUNCH: 0.35,
  DINNER: 0.3,
  SNACK: 0.1,
};

/** kcal tolerance steps around the slot target, tried in order (F-04). */
export const TOLERANCES = [0.12, 0.2, 0.3] as const;

export type MacroTarget = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};
export type MealCandidate = MacroTarget & {
  id: string;
  mealSlot: MealSlot;
  tags: string[];
};

/** The slot's share of the day target; not rounded, so the four slots sum to the day. */
export function slotTarget(day: MacroTarget, slot: MealSlot): MacroTarget {
  const share = SLOT_SHARE[slot];
  return {
    kcal: day.kcal * share,
    proteinG: day.proteinG * share,
    carbsG: day.carbsG * share,
    fatG: day.fatG * share,
  };
}

/** Euclidean norm of the relative protein, carbs and fat gaps (denominator 1 for a 0 target). */
export function macroDistance(meal: MacroTarget, target: MacroTarget): number {
  return Math.sqrt(
    ((meal.proteinG - target.proteinG) / (target.proteinG || 1)) ** 2 +
      ((meal.carbsG - target.carbsG) / (target.carbsG || 1)) ** 2 +
      ((meal.fatG - target.fatG) / (target.fatG || 1)) ** 2,
  );
}

/**
 * Meals of `slot` that are not excluded by id or tag, from the narrowest kcal tolerance that
 * yields any, closest macros first. When none is inside ±30 %: every remaining meal by kcal gap,
 * with `macroWarning`. Ties go by `id` (code-unit order), so the result is stable everywhere.
 */
export function rankMeals(
  meals: MealCandidate[],
  target: MacroTarget,
  slot: MealSlot,
  opts: { excludeIds: string[]; excludedTags: string[] },
): {
  ranked: MealCandidate[];
  tolerance: 0.12 | 0.2 | 0.3 | null;
  macroWarning: boolean;
} {
  const pool = meals.filter(
    meal =>
      meal.mealSlot === slot &&
      !opts.excludeIds.includes(meal.id) &&
      !meal.tags.some(tag => opts.excludedTags.includes(tag)),
  );
  const kcalGap = (meal: MealCandidate) => Math.abs(meal.kcal - target.kcal);
  // Slot targets are fractional floats, so sort keys are compared at 9 decimals: exact ties
  // stay ties and `id` decides them, not the last bit.
  const key = (value: number) => Math.round(value * 1e9);
  const distance = (meal: MealCandidate) => key(macroDistance(meal, target));
  const byId = (a: MealCandidate, b: MealCandidate) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  for (const tolerance of TOLERANCES) {
    // + 1e-9: a meal exactly on the edge is inside (F-04); kcal values have at most one decimal,
    // so nothing really outside comes that close to an edge.
    const inside = pool.filter(
      meal => kcalGap(meal) <= tolerance * target.kcal + 1e-9,
    );
    if (inside.length > 0) {
      inside.sort((a, b) => distance(a) - distance(b) || byId(a, b));
      return { ranked: inside, tolerance, macroWarning: false };
    }
  }
  pool.sort((a, b) => key(kcalGap(a)) - key(kcalGap(b)) || byId(a, b));
  return { ranked: pool, tolerance: null, macroWarning: true };
}

/** Uniform among the first 5 by the caller's `rng` ([0, 1)); `null` for an empty list. */
export function pickMeal(
  ranked: MealCandidate[],
  rng: () => number,
): MealCandidate | null {
  return ranked[Math.floor(rng() * Math.min(5, ranked.length))] ?? null;
}
