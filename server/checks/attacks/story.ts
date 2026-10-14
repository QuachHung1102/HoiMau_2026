// Gate 2, the attack cases of the STORY actions (31-story.sql): the calorie log and the workout
// session of the decoy are the rows to reach, through the two functions that take an action id
// from the client, and the calories of a day through a direct write.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decoyRows, decoyUntouched } from './base.ts';
import type { AttackCtx } from './base.ts';
import type { Attack } from './base.ts';

// The fixed values of server/sql/82-decoy-story.sql.
const DECOY_NUTRITION_LOG = '00000000-0000-4000-8000-0000000d100c';
const DECOY_SESSION = '00000000-0000-4000-8000-0000000d100d';

const HM = 'HM000';

/** What user A owns in the day and story tables and the ledgers. */
const ownRows = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      `SELECT (SELECT count(*)::int FROM daily_logs WHERE user_id = $1) AS logs,
              (SELECT coalesce(sum(calories_in), 0)::float8 FROM daily_logs WHERE user_id = $1) AS calories,
              (SELECT count(*)::int FROM nutrition_logs WHERE user_id = $1) AS meals,
              (SELECT count(*)::int FROM workout_sessions WHERE user_id = $1) AS sessions,
              (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
              (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin`,
      [ctx.userA],
    )
  ).rows[0];

const desk = async (ctx: AttackCtx) =>
  (await ctx.admin.query("SELECT id FROM exercise_items WHERE code = 'DESK_STRETCH'")).rows[0]
    .id as string;

async function decoyRowIs(ctx: AttackCtx, table: string, id: string): Promise<void> {
  const rows = (await decoyRows(ctx.admin))[table] as { id: string }[];
  assert.ok(
    rows.some(row => row.id === id),
    `no decoy row ${id} in ${table}`,
  );
}

export const attacks: Attack[] = [
  {
    name: 'nutrition_log_manual with the calorie log id of the decoy as its action id is IDEMPOTENCY_KEY_REUSED',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyRowIs(ctx, 'nutrition_logs', DECOY_NUTRITION_LOG);
        const before = await ownRows(ctx);
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT nutrition_log_manual($1, $2, $3, $4)', [
              DECOY_NUTRITION_LOG,
              500,
              null,
              null,
            ]),
          ),
          { code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED' },
        );
        assert.deepEqual(await ownRows(ctx), before);
      }),
  },
  {
    name: 'workout_complete with the session id of the decoy as its action id is IDEMPOTENCY_KEY_REUSED',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyRowIs(ctx, 'workout_sessions', DECOY_SESSION);
        const before = await ownRows(ctx);
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, async c =>
            c.query('SELECT workout_complete($1, $2, $3, $4)', [
              DECOY_SESSION,
              await desk(ctx),
              300,
              null,
            ]),
          ),
          { code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED' },
        );
        assert.deepEqual(await ownRows(ctx), before);
      }),
  },
  {
    name: 'a direct UPDATE daily_logs SET calories_in by A stops at the grant',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('UPDATE daily_logs SET calories_in = 2000'),
          ),
          { code: '42501', messagePrefix: 'permission denied for table daily_logs' },
        );
      }),
  },
  {
    name: 'a calorie log and a session by A write rows of A and none of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const before = await ownRows(ctx);
        await ctx.asUser(ctx.app, ctx.userA, async c => {
          await c.query('SELECT nutrition_log_manual($1, $2, $3, $4)', [randomUUID(), 300, 'Cơm', null]);
          await c.query('SELECT workout_complete($1, $2, $3, $4)', [randomUUID(), await desk(ctx), 60, null]);
        });
        // the calls did write: otherwise "the decoy is untouched" says nothing
        const after = await ownRows(ctx);
        assert.deepEqual(
          [after.calories, after.meals, after.sessions],
          [before.calories + 300, before.meals + 1, before.sessions + 1],
        );
      }),
  },
];
