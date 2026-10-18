// Gate 2, the attack cases of the guild week (51-guild-week.sql): the jobs' functions and the
// score table as app_auth, and leaderboard_final aimed at the decoy guild's stored week. A is
// placed where only the caller condition and the rank condition stand between it and the
// decoy's row: leading a guild of its own, and asking for the decoy's very week.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/87-decoy-guild-week.sql.
const DECOY_SCORE = '00000000-0000-4000-8000-0000000d1401';
const DECOY_WEEK = '2026-01-05';

const decoyScore = async (ctx: AttackCtx) =>
  (await ctx.admin.query('SELECT to_jsonb(s) AS row FROM guild_weekly_scores s WHERE s.id = $1', [DECOY_SCORE])).rows[0]
    ?.row;

/** decoyUntouched, plus the decoy guild's stored week, value for value. */
async function scoreUntouched(ctx: AttackCtx, attack: () => Promise<void>): Promise<void> {
  const before = await decoyScore(ctx);
  assert.equal(before?.rank, null, 'no unranked decoy score: nothing to attack');
  await decoyUntouched(ctx, attack);
  assert.deepEqual(await decoyScore(ctx), before, 'the attack changed the decoy score');
}

const final = (ctx: AttackCtx) =>
  ctx.asUser(ctx.app, ctx.userA, async c => (await c.query('SELECT leaderboard_final($1) AS b', [DECOY_WEEK])).rows[0].b);

export const attacks: Attack[] = [
  {
    name: 'app_auth cannot call job_guild_week_inputs or job_apply_guild_week, nor read or write guild_weekly_scores',
    run: ctx =>
      scoreUntouched(ctx, async () => {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT * FROM job_guild_week_inputs($1, $2)', [DECOY_WEEK, DECOY_WEEK])),
          { code: '42501', messagePrefix: 'permission denied for function job_guild_week_inputs' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT job_apply_guild_week($1, $2)', ['2026-01-12', '[]'])),
          { code: '42501', messagePrefix: 'permission denied for function job_apply_guild_week' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT * FROM guild_weekly_scores')),
          { code: '42501', messagePrefix: 'permission denied for table guild_weekly_scores' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('DELETE FROM guild_weekly_scores')),
          { code: '42501', messagePrefix: 'permission denied for table guild_weekly_scores' },
        );
      }),
  },
  {
    name: "leaderboard_final of the decoy guild's week: A outside any guild, then A leading a guild of its own, sees no entry and mine null",
    run: ctx =>
      scoreUntouched(ctx, async () => {
        assert.deepEqual(await final(ctx), { updatedAt: null, entries: [], mine: null });
        const { rows } = await ctx.asUser(ctx.app, ctx.userA, c =>
          c.query<{ id: string }>('SELECT guild_create($1, $2) AS id', [`Tổ của A ${randomUUID().slice(0, 8)}`, '']),
        );
        try {
          assert.deepEqual(await final(ctx), { updatedAt: null, entries: [], mine: null });
        } finally {
          await ctx.admin.query('DELETE FROM guilds WHERE id = $1', [rows[0].id]);
        }
      }),
  },
];
