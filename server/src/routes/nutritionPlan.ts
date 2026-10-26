// Meal plan routes: today's plan, the candidates of a swap, the swap.
//
// The meals are chosen in Node with rankMeals and pickMeal (domain/mealPlan.ts) and stored by
// nutrition_plan_save (40-nutrition.sql), which takes only the caller's open today and never
// overwrites a row: two first reads racing end with the plan of the first one. A swap's
// candidates are ranked again on every request; nutrition_swap enforces the limit, the slot,
// "not logged" and "not shown before" whoever calls it, the route adds "one of the ranked
// candidates". Every refusal is THROWN.
import type { Meal, SwapCandidates } from '../../../domain/contract/content.ts';
import { pickMeal, rankMeals, slotTarget } from '../../../domain/mealPlan.ts';
import type { MealSlot } from '../../../domain/types.ts';
import type { Ctx, Route, RouteResponse } from '../app.ts';
import { AppError } from '../errors.ts';
import { idempotencyKey } from '../idempotency.ts';
import {
  MEAL_SLOTS,
  mealPlanState,
  readMeals,
  readPlan,
} from '../readModels/mealPlan.ts';
import type { PlanInputs } from '../readModels/mealPlan.ts';
import { objectBody, refuse } from './day.ts';

/** The most candidates a swap offers. */
const CANDIDATES_MAX = 3;

const isSlot = (value: unknown): value is MealSlot =>
  typeof value === 'string' && (MEAL_SLOTS as readonly string[]).includes(value);

/** Today's plan inputs, after storing a fresh plan when today has none yet. */
async function ensurePlan(ctx: Ctx, meals: Meal[]): Promise<PlanInputs> {
  const inputs = await readPlan(ctx);
  if (inputs.rows.length > 0) {
    return inputs;
  }
  const slots = MEAL_SLOTS.map(mealSlot => {
    const { ranked, macroWarning } = rankMeals(
      meals,
      slotTarget(inputs.target, mealSlot),
      mealSlot,
      { excludeIds: [], excludedTags: inputs.excludedTags },
    );
    return { mealSlot, mealId: pickMeal(ranked, Math.random)?.id ?? null, macroWarning };
  });
  await ctx.db.query('SELECT nutrition_plan_save($1, $2)', [
    inputs.logicalDate,
    JSON.stringify(slots),
  ]);
  return readPlan(ctx);
}

/**
 * The first ranked candidates of a slot, whatever swaps are left: not a meal planned today in
 * any slot, not one the slot has shown, not one with an excluded tag. `kcalDelta` = candidate
 * kcal - kcal of the meal planned now (0 for a slot without a meal).
 */
function rankedCandidates(
  inputs: PlanInputs,
  meals: Meal[],
  mealSlot: MealSlot,
): SwapCandidates['candidates'] {
  const row = inputs.rows.find(r => r.mealSlot === mealSlot);
  const planned = inputs.rows.flatMap(r => (r.mealId === null ? [] : [r.mealId]));
  const byId = new Map(meals.map(meal => [meal.id, meal]));
  const current = row?.mealId ? byId.get(row.mealId)?.kcal ?? 0 : 0;
  const { ranked } = rankMeals(meals, slotTarget(inputs.target, mealSlot), mealSlot, {
    excludeIds: [...(row?.shownMealIds ?? []), ...planned],
    excludedTags: inputs.excludedTags,
  });
  return ranked.slice(0, CANDIDATES_MAX).map(candidate => {
    const meal = byId.get(candidate.id)!;
    return { ...meal, kcalDelta: meal.kcal - current };
  });
}

async function plan(ctx: Ctx): Promise<RouteResponse> {
  const meals = await readMeals(ctx);
  return { status: 200, body: mealPlanState(await ensurePlan(ctx, meals), meals) };
}

async function candidates(ctx: Ctx): Promise<RouteResponse> {
  const mealSlot = ctx.query.get('mealSlot');
  if (mealSlot === null || mealSlot === '') {
    throw refuse('mealSlot', 'required');
  }
  if (!isSlot(mealSlot)) {
    throw refuse('mealSlot', 'enum');
  }
  const meals = await readMeals(ctx);
  const inputs = await ensurePlan(ctx, meals);
  const row = inputs.rows.find(r => r.mealSlot === mealSlot);
  // a logged slot cannot be swapped any more: nothing remains, nothing is offered
  const swapsRemaining =
    row === undefined || row.logged ? 0 : Math.max(0, inputs.swapsAllowed - row.swapsUsed);
  const answer: SwapCandidates = {
    mealSlot,
    swapsRemaining,
    candidates: swapsRemaining > 0 ? rankedCandidates(inputs, meals, mealSlot) : [],
  };
  return { status: 200, body: answer };
}

async function swap(ctx: Ctx): Promise<RouteResponse> {
  const body = objectBody(ctx.body);
  const fields = [];
  if (body.mealSlot === undefined) {
    fields.push({ field: 'mealSlot', rule: 'required' } as const);
  } else if (!isSlot(body.mealSlot)) {
    fields.push({ field: 'mealSlot', rule: 'enum' } as const);
  }
  const mealId = typeof body.mealId === 'string' ? idempotencyKey(body.mealId) : null;
  if (mealId === null) {
    fields.push({ field: 'mealId', rule: body.mealId === undefined ? 'required' : 'format' } as const);
  }
  if (fields.length > 0) {
    throw new AppError('VALIDATION_FAILED', { fields });
  }
  const mealSlot = body.mealSlot as MealSlot;
  const meals = await readMeals(ctx);
  const before = await readPlan(ctx);
  const offered = rankedCandidates(before, meals, mealSlot);
  // the function's refusals (no plan, logged, limit, wrong slot) come first; then the route's
  await ctx.db.query('SELECT nutrition_swap($1, $2, $3)', [mealSlot, mealId, ctx.actionId]);
  if (!offered.some(candidate => candidate.id === mealId)) {
    throw new AppError('SWAP_CANDIDATE_INVALID');
  }
  return { status: 200, body: mealPlanState(await readPlan(ctx), meals) };
}

const routes: Route[] = [
  { method: 'GET', path: '/nutrition/plan', auth: 'user', handler: plan },
  { method: 'GET', path: '/nutrition/swap-candidates', auth: 'user', handler: candidates },
  {
    method: 'POST',
    path: '/nutrition/swap',
    auth: 'user',
    idempotent: true,
    handler: swap,
  },
];

export default routes;
