// What a user reads back about today's meal plan (`GET /nutrition/plan`, the answer of
// `POST /nutrition/swap`), and the inputs the routes rank meals with. Read as app_auth inside the
// request transaction; nothing here writes. "Today" is the logical date of app.now() in the
// caller's stored zone, decided by SQL as everywhere else.
import type { Meal, MealPlanState } from '../../../domain/contract/content.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import type { MacroTarget } from '../../../domain/mealPlan.ts';
import type { DateLabel, MealSlot } from '../../../domain/types.ts';
import type { Ctx } from '../app.ts';

type Reader = Pick<Ctx, 'db'>;

export const MEAL_SLOTS: readonly MealSlot[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

export type PlanRow = {
  mealSlot: MealSlot;
  mealId: string | null;
  swapsUsed: number;
  shownMealIds: string[];
  macroWarning: boolean;
  logged: boolean;
};

export type PlanInputs = {
  logicalDate: DateLabel;
  /** The current prescription. */
  target: MacroTarget;
  caloriesIn: number;
  excludedTags: string[];
  /** 3, or 5 with the perk MEAL_SWAP_PLUS. */
  swapsAllowed: number;
  /** The stored rows of today, in no particular order; empty before the first read. */
  rows: PlanRow[];
};

// One statement, one snapshot: today, the targets, today's calories, the exclusions, the perk
// and today's plan rows.
const PLAN = `
  WITH me AS (
    SELECT u.id, app.logical_date(app.now(), u.timezone) AS day
      FROM users u WHERE u.id = app.current_user_id()
  )
  SELECT to_char(me.day, 'YYYY-MM-DD') AS "logicalDate",
         jsonb_build_object('kcal', p.calorie_target, 'proteinG', p.protein_g,
                            'carbsG', p.carbs_g, 'fatG', p.fat_g) AS target,
         coalesce(d.calories_in, 0)::float8 AS "caloriesIn",
         s.excluded_meal_tags AS "excludedTags",
         CASE WHEN EXISTS (SELECT 1 FROM perk_unlocks k
                            WHERE k.user_id = me.id AND k.perk_code = 'MEAL_SWAP_PLUS')
              THEN 5 ELSE 3 END AS "swapsAllowed",
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'mealSlot', x.meal_slot, 'mealId', x.meal_id, 'swapsUsed', x.swaps_used,
                   'shownMealIds', to_jsonb(x.shown_meal_ids), 'macroWarning', x.macro_warning,
                   'logged', x.logged_action_id IS NOT NULL)), '[]'::jsonb)
            FROM daily_meal_plans x
           WHERE x.user_id = me.id AND x.logical_date = me.day) AS rows
    FROM me
    JOIN prescriptions p ON p.user_id = me.id
    JOIN user_settings s ON s.user_id = me.id
    LEFT JOIN daily_logs d ON d.user_id = me.id AND d.logical_date = me.day`;

const MEALS = `
  SELECT id, code, name, meal_slot AS "mealSlot", kcal::float8 AS kcal, protein_g::float8 AS "proteinG",
         carbs_g::float8 AS "carbsG", fat_g::float8 AS "fatG", tags, portion_text AS "portionText",
         description, image_key AS "imageKey"
    FROM meal_plans ORDER BY code`;

/** The caller's plan inputs. For an onboarded caller. */
export async function readPlan({ db }: Reader): Promise<PlanInputs> {
  const { rows } = await db.query<PlanInputs>(PLAN);
  if (rows.length !== 1) {
    throw new Error('this read model is for an onboarded user');
  }
  return rows[0];
}

/** The whole meal library, by code. */
export async function readMeals({ db }: Reader): Promise<Meal[]> {
  return (await db.query<Meal>(MEALS)).rows;
}

/**
 * Today's plan as the app shows it: always the four slots, in slot order. A slot without a
 * stored row shows no meal and no swap used.
 */
export function mealPlanState(inputs: PlanInputs, meals: Meal[]): MealPlanState {
  const byId = new Map(meals.map(meal => [meal.id, meal]));
  return {
    logicalDate: inputs.logicalDate,
    target: inputs.target,
    caloriesIn: inputs.caloriesIn,
    calorieWindow: calorieWindow(inputs.target.kcal),
    slots: MEAL_SLOTS.map(mealSlot => {
      const row = inputs.rows.find(r => r.mealSlot === mealSlot);
      return {
        mealSlot,
        meal: (row?.mealId && byId.get(row.mealId)) || null,
        logged: row?.logged ?? false,
        swapsUsed: row?.swapsUsed ?? 0,
        swapsAllowed: inputs.swapsAllowed,
        macroWarning: row?.macroWarning ?? false,
      };
    }),
  };
}

/** `GET /nutrition/plan` as it stands: the caller's today, read only. */
export async function buildMealPlan(ctx: Reader): Promise<MealPlanState> {
  return mealPlanState(await readPlan(ctx), await readMeals(ctx));
}
