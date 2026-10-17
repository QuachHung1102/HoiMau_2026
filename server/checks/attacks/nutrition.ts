// Gate 2, the attack cases of the meal plan (40-nutrition.sql): a plan for a day that is not the
// caller's today, the decoy's plan row through nutrition_swap and nutrition_log_slot, and the
// plan table through a direct write.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decoyRows, decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/84-decoy-nutrition.sql and 82-decoy-story.sql.
const DECOY_DATE = '2026-01-01';
const DECOY_MEAL = 'COM_GA_RAU_CU';
const DECOY_NUTRITION_LOG = '00000000-0000-4000-8000-0000000d100c';

const HM = 'HM000';

const ownPlan = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      `SELECT meal_slot, meal_id, swaps_used, logged_action_id FROM daily_meal_plans
        WHERE user_id = $1 ORDER BY logical_date, meal_slot`,
      [ctx.userA],
    )
  ).rows;

const mealOf = async (ctx: AttackCtx, code: string) =>
  (await ctx.admin.query('SELECT id, meal_slot FROM meal_plans WHERE code = $1', [code])).rows[0] as {
    id: string;
    meal_slot: string;
  };

/** User A's today, as SQL decides it. */
const todayOfA = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      "SELECT to_char(app.logical_date(app.now(), timezone), 'YYYY-MM-DD') AS day FROM users WHERE id = $1",
      [ctx.userA],
    )
  ).rows[0].day as string;

const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function decoyPlanIsThere(ctx: AttackCtx): Promise<string> {
  const meal = await mealOf(ctx, DECOY_MEAL);
  const rows = (await decoyRows(ctx.admin)).daily_meal_plans as {
    logical_date: string;
    meal_slot: string;
    meal_id: string;
  }[];
  assert.ok(
    rows.some(row => row.logical_date === DECOY_DATE && row.meal_slot === 'LUNCH' && row.meal_id === meal.id),
    'no decoy plan row',
  );
  return meal.id;
}

export const attacks: Attack[] = [
  {
    name: 'nutrition_plan_save for yesterday is DAY_CLOSED and for tomorrow OCCURRED_AT_INVALID; for the decoy\'s date DAY_CLOSED',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const meal = await decoyPlanIsThere(ctx);
        const today = await todayOfA(ctx);
        const slots = JSON.stringify([{ mealSlot: 'LUNCH', mealId: meal, macroWarning: false }]);
        const before = await ownPlan(ctx);
        for (const [day, code] of [
          [shift(today, -1), 'DAY_CLOSED'],
          [shift(today, 1), 'OCCURRED_AT_INVALID'],
          [DECOY_DATE, 'DAY_CLOSED'],
        ]) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT nutrition_plan_save($1, $2)', [day, slots])),
            { code: HM, messagePrefix: code },
          );
        }
        assert.deepEqual(await ownPlan(ctx), before);
      }),
  },
  {
    name: 'nutrition_swap and nutrition_log_slot by A reach only A\'s plan: without one PLAN_NOT_FOUND, the decoy\'s row unchanged',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyPlanIsThere(ctx);
        const lunch = (
          await ctx.admin.query(
            `SELECT id FROM meal_plans WHERE meal_slot = 'LUNCH' AND code <> $1 ORDER BY code LIMIT 1`,
            [DECOY_MEAL],
          )
        ).rows[0].id as string;
        // A has no plan today (api-check makes none): the decoy's LUNCH is the only one there is
        assert.deepEqual(await ownPlan(ctx), []);
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT nutrition_swap($1, $2, $3)', ['LUNCH', lunch, randomUUID()]),
          ),
          { code: HM, messagePrefix: 'PLAN_NOT_FOUND' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT nutrition_log_slot($1, $2, $3)', [randomUUID(), 'LUNCH', null]),
          ),
          { code: HM, messagePrefix: 'PLAN_NOT_FOUND' },
        );
        assert.deepEqual(await ownPlan(ctx), []);
      }),
  },
  {
    name: 'nutrition_log_slot with the calorie log id of the decoy as its action id is IDEMPOTENCY_KEY_REUSED',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const rows = (await decoyRows(ctx.admin)).nutrition_logs as { id: string }[];
        assert.ok(rows.some(row => row.id === DECOY_NUTRITION_LOG), 'no decoy nutrition log');
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT nutrition_log_slot($1, $2, $3)', [DECOY_NUTRITION_LOG, 'LUNCH', null]),
          ),
          { code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED' },
        );
      }),
  },
  {
    name: 'a direct UPDATE of daily_meal_plans by A stops at the grant',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyPlanIsThere(ctx);
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('UPDATE daily_meal_plans SET swaps_used = 0')),
          { code: '42501', messagePrefix: 'permission denied for table daily_meal_plans' },
        );
      }),
  },
  {
    name: 'a plan saved and swapped by A writes rows of A and none of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const today = await todayOfA(ctx);
        const lunches = (
          await ctx.admin.query(`SELECT id FROM meal_plans WHERE meal_slot = 'LUNCH' ORDER BY code LIMIT 2`)
        ).rows.map(row => row.id as string);
        await ctx.asUser(ctx.app, ctx.userA, async c => {
          await c.query('SELECT nutrition_plan_save($1, $2)', [
            today,
            JSON.stringify([{ mealSlot: 'LUNCH', mealId: lunches[0], macroWarning: false }]),
          ]);
          await c.query('SELECT nutrition_swap($1, $2, $3)', ['LUNCH', lunches[1], randomUUID()]);
        });
        // the calls did write: otherwise "the decoy is untouched" says nothing
        assert.deepEqual(await ownPlan(ctx), [
          { meal_slot: 'LUNCH', meal_id: lunches[1], swaps_used: 1, logged_action_id: null },
        ]);
      }),
  },
];
