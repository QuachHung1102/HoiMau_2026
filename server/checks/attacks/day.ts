// Gate 2, the attack cases of the day (30-day.sql): the tick of the decoy is the row to reach,
// through the two functions that take a tick id from the client.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decoyRows, decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/81-decoy-day.sql.
const DECOY_TICK = '00000000-0000-4000-8000-0000000d100b';

const HM = 'HM000';

/** The decoy's tick is there, live, and the latest of its quest: only its owner stands in the way. */
async function decoyTickIsLive(ctx: AttackCtx): Promise<void> {
  const { rows } = await ctx.admin.query(
    `SELECT 1 FROM quest_ticks t JOIN quests q ON q.id = t.quest_id
      WHERE t.id = $1 AND t.user_id = $2 AND t.undone_at IS NULL AND q.code = 'WATER_8'`,
    [DECOY_TICK, ctx.decoy],
  );
  assert.equal(rows.length, 1, 'no live WATER_8 tick of the decoy');
}

/** What user A owns in the day tables and the ledgers. */
const ownRows = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      `SELECT (SELECT count(*)::int FROM daily_logs WHERE user_id = $1) AS logs,
              (SELECT coalesce(sum(progress), 0)::int FROM quest_completions WHERE user_id = $1) AS progress,
              (SELECT count(*)::int FROM quest_ticks WHERE user_id = $1) AS ticks,
              (SELECT count(*)::int FROM quest_ticks WHERE user_id = $1 AND undone_at IS NULL) AS live,
              (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
              (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin`,
      [ctx.userA],
    )
  ).rows[0];

export const attacks: Attack[] = [
  {
    name: 'quest_undo with the tick id of the decoy is TICK_NOT_FOUND',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyTickIsLive(ctx);
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT quest_undo($1, $2)', ['WATER_8', DECOY_TICK]),
          ),
          { code: HM, messagePrefix: 'TICK_NOT_FOUND' },
        );
      }),
  },
  {
    name: 'quest_tick with the tick id of the decoy as its action id is IDEMPOTENCY_KEY_REUSED',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyTickIsLive(ctx);
        const before = await ownRows(ctx);
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT quest_tick($1, $2, $3)', [
              'WATER_8',
              DECOY_TICK,
              null,
            ]),
          ),
          { code: HM, messagePrefix: 'IDEMPOTENCY_KEY_REUSED' },
        );
        assert.deepEqual(await ownRows(ctx), before);
      }),
  },
  {
    name: 'quest_tick and day_bedtime with an instant one year ahead are OCCURRED_AT_INVALID',
    async run(ctx) {
      const before = await ownRows(ctx);
      for (const [sql, params] of [
        ['SELECT quest_tick($1, $2, $3)', ['WATER_8', randomUUID()]],
        ['SELECT day_bedtime($1, $2)', [randomUUID()]],
      ] as const) {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, async c => {
            const ahead = await c.query(
              "SELECT app.now() + interval '1 year' AS at",
            );
            await c.query(sql, [...params, ahead.rows[0].at]);
          }),
          { code: HM, messagePrefix: 'OCCURRED_AT_INVALID' },
        );
      }
      assert.deepEqual(await ownRows(ctx), before);
    },
  },
  {
    name: 'a tick and its undo by A write rows of A and none of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        // there is a decoy day to write into by mistake
        assert.ok((await decoyRows(ctx.admin)).daily_logs.length > 0);
        const before = await ownRows(ctx);
        const id = randomUUID();
        const ticked = await ctx.asUser(ctx.app, ctx.userA, c =>
          c.query('SELECT quest_tick($1, $2, $3) AS result', [
            'STAND_UP',
            id,
            null,
          ]),
        );
        assert.equal(ticked.rows[0].result.applied, true);
        // the calls did write: otherwise "the decoy is untouched" says nothing
        const between = await ownRows(ctx);
        assert.deepEqual(
          [
            between.ticks,
            between.live,
            between.progress,
            between.xp,
            between.coin,
          ],
          [
            before.ticks + 1,
            before.live + 1,
            before.progress + 1,
            before.xp + 10,
            before.coin + 5,
          ],
        );
        await ctx.asUser(ctx.app, ctx.userA, c =>
          c.query('SELECT quest_undo($1, $2)', ['STAND_UP', id]),
        );
        assert.deepEqual(await ownRows(ctx), {
          ...before,
          logs: between.logs,
          ticks: before.ticks + 1,
        });
      }),
  },
];
