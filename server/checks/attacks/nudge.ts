// Gate 2, the attack cases of nudges (52-nudge.sql): nudge_send aimed at the decoys, who are
// members of the decoy guild and not of A's, once with the decoy nudge's own id as the action
// id; the event table and the job's function as app_auth. A leads a guild of its own, so the
// guild condition is what stands between it and the decoys (outside any guild NOT_IN_GUILD
// would answer first).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DECOY_1, DECOY_2, decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/88-decoy-nudge.sql.
const DECOY_NUDGE = '00000000-0000-4000-8000-0000000d1501';

/** Every nudge of a decoy or of A, and every notification of the decoys, as the owner reads them. */
const nudgeRows = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      `SELECT ARRAY(SELECT to_jsonb(e)::text FROM nudge_events e
                     WHERE $1 IN (e.sender_id, e.receiver_id) OR e.receiver_id = ANY ($2) OR e.sender_id = ANY ($2)
                     ORDER BY e.id) AS events,
              ARRAY(SELECT to_jsonb(n)::text FROM notifications n WHERE n.user_id = ANY ($2) ORDER BY n.id) AS inbox`,
      [ctx.userA, [DECOY_1, DECOY_2]],
    )
  ).rows[0];

/** decoyUntouched, plus the decoy nudge and the decoys' inboxes, value for value, and no nudge of A. */
async function nudgesUntouched(ctx: AttackCtx, attack: () => Promise<void>): Promise<void> {
  const before = await nudgeRows(ctx);
  assert.equal(before.events.length, 1, 'no decoy nudge: nothing to attack');
  assert.equal(JSON.parse(before.events[0]).id, DECOY_NUDGE);
  await decoyUntouched(ctx, attack);
  assert.deepEqual(await nudgeRows(ctx), before, 'the attack wrote or changed a nudge or a decoy notification');
}

export const attacks: Attack[] = [
  {
    name: "nudge_send from A, leading a guild of its own, at decoy 1 and decoy 2 (with the decoy nudge's id): NUDGE_NOT_SAME_GUILD, no row",
    run: ctx =>
      nudgesUntouched(ctx, async () => {
        const { rows } = await ctx.asUser(ctx.app, ctx.userA, c =>
          c.query<{ id: string }>('SELECT guild_create($1, $2) AS id', [`Tổ của A ${randomUUID().slice(0, 8)}`, '']),
        );
        try {
          for (const [receiver, actionId] of [
            [DECOY_1, randomUUID()],
            [DECOY_2, DECOY_NUDGE],
          ]) {
            await ctx.expectPgError(
              ctx.asUser(ctx.app, ctx.userA, c =>
                c.query('SELECT nudge_send($1, $2, $3)', [receiver, 'MOVE_TOGETHER', actionId]),
              ),
              { code: 'HM000', messagePrefix: 'NUDGE_NOT_SAME_GUILD' },
            );
          }
        } finally {
          await ctx.admin.query('DELETE FROM guilds WHERE id = $1', [rows[0].id]);
        }
      }),
  },
  {
    name: 'app_auth reads and writes no nudge_events row, writes no template, and cannot call job_reminder_dispatch or app._nudge_block_reason',
    run: ctx =>
      nudgesUntouched(ctx, async () => {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT * FROM nudge_events')),
          { code: '42501', messagePrefix: 'permission denied for table nudge_events' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('DELETE FROM nudge_events')),
          { code: '42501', messagePrefix: 'permission denied for table nudge_events' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query("UPDATE nudge_templates SET text = 'x'")),
          { code: '42501', messagePrefix: 'permission denied for table nudge_templates' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT job_reminder_dispatch(now())')),
          { code: '42501', messagePrefix: 'permission denied for function job_reminder_dispatch' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT app._nudge_block_reason($1, $2)', [ctx.userA, DECOY_1])),
          { code: '42501', messagePrefix: 'permission denied for function _nudge_block_reason' },
        );
      }),
  },
];
