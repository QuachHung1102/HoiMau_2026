// Nutrition routes: the calorie log. The manual entry hands the user's intent to
// nutrition_log_manual (31-story.sql), which decides the day, the total and the reward. Every
// refusal is THROWN: a refused log leaves no row, no calories and no ledger row, and frees its
// key. The planned meal of a slot (`mealSlot`) goes to nutrition_log_slot (40-nutrition.sql),
// which logs the kcal of that day's planned meal of the slot, once, with the same latch.
import type { GameEvent } from '../../../domain/contract/common.ts';
import type { FieldError } from '../../../domain/validation.ts';
import type { MealSlot } from '../../../domain/types.ts';
import type { Ctx, Route, RouteResponse } from '../app.ts';
import { AppError } from '../errors.ts';
import type { Grant } from '../readModels/delta.ts';
import { actionResult, objectBody, occurredAtOf } from './day.ts';

const MEAL_SLOTS: Record<MealSlot, true> = {
  BREAKFAST: true,
  LUNCH: true,
  DINNER: true,
  SNACK: true,
};
/** Code points of a label (contract: maxLength 60). */
const LABEL_MAX = 60;

type Field = { field: string; rule: FieldError['rule'] };

/** The kcal of a manual entry, or what is wrong with it. Any finite number from 1 to 5000. */
function kcalProblem(kcal: unknown): Field | null {
  if (typeof kcal !== 'number' || !Number.isFinite(kcal)) {
    return { field: 'kcal', rule: 'format' };
  }
  if (kcal < 1) {
    return { field: 'kcal', rule: 'min' };
  }
  return kcal > 5000 ? { field: 'kcal', rule: 'max' } : null;
}

/** The label trimmed and in NFC, null when it is absent or empty. */
function labelOf(label: unknown): string | null | Field {
  if (label === undefined) {
    return null;
  }
  if (typeof label !== 'string') {
    return { field: 'label', rule: 'format' };
  }
  const text = label.normalize('NFC').trim();
  if ([...text].length > LABEL_MAX) {
    return { field: 'label', rule: 'max' };
  }
  return text === '' ? null : text;
}

async function log(ctx: Ctx): Promise<RouteResponse> {
  const body = objectBody(ctx.body);
  const hasKcal = body.kcal !== undefined;
  const hasSlot = body.mealSlot !== undefined;
  if (hasKcal === hasSlot) {
    // exactly one of the two: a body with both matches both alternatives of the contract
    throw new AppError('VALIDATION_FAILED', {
      fields: [hasKcal ? { field: 'mealSlot', rule: 'format' } : { field: 'kcal', rule: 'required' }],
    });
  }
  if (hasSlot) {
    if (typeof body.mealSlot !== 'string' || !Object.hasOwn(MEAL_SLOTS, body.mealSlot)) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ field: 'mealSlot', rule: 'enum' }] });
    }
  }

  let call: [string, unknown[]];
  if (hasSlot) {
    call = [
      'SELECT nutrition_log_slot($1, $2, $3) AS result',
      [ctx.actionId, body.mealSlot, occurredAtOf(body)],
    ];
  } else {
    const label = labelOf(body.label);
    const fields = [
      kcalProblem(body.kcal),
      label !== null && typeof label === 'object' ? label : null,
    ].filter((field): field is Field => field !== null);
    if (fields.length > 0) {
      throw new AppError('VALIDATION_FAILED', { fields });
    }
    call = [
      'SELECT nutrition_log_manual($1, $2, $3, $4) AS result',
      [ctx.actionId, body.kcal, label, occurredAtOf(body)],
    ];
  }
  const { rows } = await ctx.db.query<{
    result: Grant & { completed: boolean; storyAllDone: boolean };
  }>(...call);
  const { result } = rows[0];
  const events: GameEvent[] = [
    ...(result.completed ? [{ type: 'QUEST_COMPLETED', questCode: 'NUTRITION_TARGET' } as const] : []),
    ...(result.storyAllDone ? [{ type: 'STORY_ALL_DONE' } as const] : []),
  ];
  return actionResult(ctx, [result], events);
}

const routes: Route[] = [
  {
    method: 'POST',
    path: '/nutrition/log',
    auth: 'user',
    idempotent: true,
    handler: log,
  },
];

export default routes;
