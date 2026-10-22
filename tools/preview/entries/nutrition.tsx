import type { Meal, MealPlanState, SwapCandidates } from '../../../domain/contract/content.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import type { IngredientTag, MealSlot } from '../../../domain/types.ts';
import { MEALS } from '../../../server/content/meals.ts';
import { mealPlanKey, swapCandidatesKey } from '../../../src/features/nutrition/api';
import type { Entries } from '../harness';
import { PressWhen } from './guild';
import { app, settingsOf } from './today';

// The meals are the real content (server/content/meals.ts), by code; the ids are their codes. The numbers of the
// day are those of frame S09: 1.650 of 2.394 kcal, the band 2.155-2.633.
const meal = (code: string): Meal => {
  const found = MEALS.find(item => item.code === code);
  if (!found) throw new Error(`no meal ${code}`);
  return { ...found, id: code };
};
const BREAKFAST = meal('YEN_MACH_TRAI_CAY');
const LUNCH = meal('COM_GA_RAU_CU');
const DINNER = meal('CA_AP_CHAO_COM_RAU');
const SNACK = meal('SUA_CHUA_VA_HAT');

type Slot = MealPlanState['slots'][number];
const slot = (mealSlot: MealSlot, planned: Meal, more: Partial<Slot> = {}): Slot => ({ mealSlot, meal: planned, logged: false, swapsUsed: 0, swapsAllowed: 3, macroWarning: false, ...more });
/** Frame S13: breakfast, lunch and the snack are logged, dinner is still a suggestion. */
const plan = (lunch: Partial<Slot> = { logged: true }, dinner: Partial<Slot> = {}): MealPlanState => ({
  logicalDate: '2026-10-14',
  target: { kcal: 2394, proteinG: 150, carbsG: 270, fatG: 66 },
  caloriesIn: 1650,
  calorieWindow: calorieWindow(2394),
  slots: [slot('BREAKFAST', BREAKFAST, { logged: true }), slot('LUNCH', LUNCH, lunch), slot('DINNER', DINNER, dinner), slot('SNACK', SNACK, { logged: true })],
});

// Frame S15: against the planned 820, 790 / 760 / 745 kcal.
const offered = (codes: string[], planned: Meal): SwapCandidates['candidates'] => codes.map(code => ({ ...meal(code), kcalDelta: meal(code).kcal - planned.kcal }));
const LUNCH_CANDIDATES = ['COM_CA_RAU_LUOC', 'BUN_GA_RAU_THOM', 'DAU_HU_COM_NAM'];
const candidates = (swapsRemaining: number, list: SwapCandidates['candidates']): [readonly unknown[], SwapCandidates] => [swapCandidatesKey('LUNCH'), { mealSlot: 'LUNCH', swapsRemaining, candidates: list }];

const firstChoice = () => document.querySelector<HTMLElement>('[role="radio"]');

const swapRoute = { route: 'MealSwap', params: { mealSlot: 'LUNCH' } } as const;
const avoiding: IngredientTag[] = ['co:thit-do', 'co:gia-cam', 'co:hai-san', 'co:dau-nanh'];

export const entries: Entries = {
  's13-meal-plan': () => app({ route: 'MealPlan', queries: [[mealPlanKey, plan()]] }),
  's13-meal-plan-macro-warning': () => app({ route: 'MealPlan', queries: [[mealPlanKey, plan({ logged: true }, { macroWarning: true })]] }),
  's14-meal-detail': () => app({ route: 'MealDetail', params: { mealSlot: 'LUNCH' }, queries: [[mealPlanKey, plan({})]] }),
  's14-meal-detail-logged': () => app({ route: 'MealDetail', params: { mealSlot: 'LUNCH' }, queries: [[mealPlanKey, plan({ logged: true })]] }),
  // Two swaps left: one is used. The first suggestion is chosen, as in the frame.
  's15-meal-swap': () =>
    app({ ...swapRoute, queries: [[mealPlanKey, plan({ swapsUsed: 1 })], candidates(2, offered(LUNCH_CANDIDATES, LUNCH))], extra: <PressWhen find={firstChoice} /> }),
  // Swaps remain but nothing else fits what is excluded.
  's15-meal-swap-no-candidate': () =>
    app({ ...swapRoute, queries: [[mealPlanKey, plan({ swapsUsed: 1 })], candidates(2, [])], settings: { ...settingsOf(), excludedMealTags: avoiding } }),
  's59-meal-swap-limit': () => app({ ...swapRoute, queries: [[mealPlanKey, plan({ swapsUsed: 3 })], candidates(0, [])] }),
};
