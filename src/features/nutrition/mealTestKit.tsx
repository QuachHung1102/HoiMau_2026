/* eslint-env jest */
// Test kit for the meal screens (used by *.test.tsx files; never imported by app code). It builds on the home-tab kit:
// the same whole app against the same stand-in server, which also holds today's meal plan (`world.plan`) and answers
// the plan, the swap and the exclusions as the server routes do.
import { fireEvent, screen } from '@testing-library/react-native';
import type { MealSlot } from '../../../domain/types.ts';
import * as vi from '../../shared/i18n/vi/nutrition';
import { questTitle, undo } from '../../shared/i18n/vi/quests';
import { MEALS, openToday, settle, world, writes } from '../dashboard/todayTestKit';

export { act } from '@testing-library/react-native';
export { app, fetchMock, hold, installTodayTestEnv, mealByCode, queryClient, refuse, requested, respond, settle, world, writes } from '../dashboard/todayTestKit';

/** What a screen has just asked for (the day, the plan, the candidates that follow) has landed inside act(). */
export const landed = async () => {
  await settle();
  await settle();
  await settle();
};

const header = (name: string) => screen.findByRole('header', { name });
export const swaps = () => writes().filter(request => request.path === '/nutrition/swap');
export const logs = () => writes().filter(request => request.path === '/nutrition/log');

/** The name of a slot row as a screen reader reads it. */
export const rowName = (slot: MealSlot) => new RegExp(`^${vi.slotName[slot]}\\.`);
export const plannedMeal = (slot: MealSlot) => MEALS.find(meal => meal.id === world.plan.planned[slot]);

/** Hôm nay, then the nutrition task: S13. */
export async function openMealPlan(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${questTitle.NUTRITION_TARGET}`) }));
  await header(vi.planTitle);
  await landed();
  return view;
}

/** The plan, then one slot: S14. */
export async function openMealDetail(slot: MealSlot = 'LUNCH', options: Parameters<typeof openToday>[0] = {}) {
  const view = await openMealPlan(options);
  const meal = plannedMeal(slot);
  fireEvent.press(await screen.findByRole('button', { name: rowName(slot) }));
  await header(meal?.name ?? vi.slotName[slot]);
  await landed();
  return view;
}

/** The slot, then "Đổi món khác": S15 (or S59). */
export async function openMealSwap(slot: MealSlot = 'LUNCH', options: Parameters<typeof openToday>[0] = {}) {
  const view = await openMealDetail(slot, options);
  fireEvent.press(screen.getByRole('button', { name: vi.swapOther }));
  await header(vi.swapTitle(slot));
  await landed();
  return view;
}

export const noUndo = () => expect(screen.queryByRole('button', { name: undo, includeHiddenElements: true })).toBeNull();
