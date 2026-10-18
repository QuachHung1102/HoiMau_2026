// Gate 2, the attack cases of guilds (50-guild.sql): the tables read directly, a transfer aimed at
// the decoy guild's members, the decoy guild's invite code, and the overview. A is placed where
// only the guild or owner condition stands between it and the decoy's rows: a LEADER of its own
// guild aiming at a member row that exists, or a member of the decoy guild itself reading the
// membership table.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DECOY_1, DECOY_2, decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/86-decoy-guild.sql.
const DECOY_GUILD = '00000000-0000-4000-8000-0000000d1301';
const DECOY_CODE = 'DECOY000';

const HM = 'HM000';

/** The decoy guild and its members as the owner reads them (decoyRows does not reach guilds). */
const decoyGuild = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      `SELECT to_jsonb(g) AS guild,
              ARRAY(SELECT m.user_id || ':' || m.role FROM guild_memberships m
                     WHERE m.guild_id = g.id ORDER BY m.user_id) AS members
         FROM guilds g WHERE g.id = $1`,
      [DECOY_GUILD],
    )
  ).rows[0];

/** decoyUntouched, plus the decoy guild row and its member list, value for value. */
async function guildUntouched(ctx: AttackCtx, attack: () => Promise<void>): Promise<void> {
  const before = await decoyGuild(ctx);
  assert.deepEqual(before?.members, [`${DECOY_1}:LEADER`, `${DECOY_2}:MEMBER`], 'no decoy guild: nothing to attack');
  await decoyUntouched(ctx, attack);
  assert.deepEqual(await decoyGuild(ctx), before, 'the attack changed the decoy guild');
}

/** A is the LEADER of a guild of its own for the attack; the guild is deleted afterwards. */
async function aLeads(ctx: AttackCtx, attack: (guildId: string) => Promise<void>): Promise<void> {
  const { rows } = await ctx.asUser(ctx.app, ctx.userA, c =>
    c.query<{ id: string }>('SELECT guild_create($1, $2) AS id', [`Tổ của A ${randomUUID().slice(0, 8)}`, '']),
  );
  try {
    await attack(rows[0].id);
  } finally {
    await ctx.admin.query('DELETE FROM guilds WHERE id = $1', [rows[0].id]);
  }
}

/** A is a MEMBER of the decoy guild for the attack, written by the owner: nobody can join it. */
async function aInDecoyGuild(ctx: AttackCtx, attack: () => Promise<void>): Promise<void> {
  await ctx.admin.query("INSERT INTO guild_memberships (user_id, guild_id, role) VALUES ($1, $2, 'MEMBER')", [
    ctx.userA,
    DECOY_GUILD,
  ]);
  try {
    await attack();
  } finally {
    await ctx.admin.query('DELETE FROM guild_memberships WHERE user_id = $1', [ctx.userA]);
  }
}

export const attacks: Attack[] = [
  {
    name: 'app_auth reads no guild row and writes no membership directly',
    run: ctx =>
      guildUntouched(ctx, async () => {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT * FROM guilds')),
          { code: '42501', messagePrefix: 'permission denied for table guilds' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('INSERT INTO guild_memberships DEFAULT VALUES')),
          { code: '42501', messagePrefix: 'permission denied for table guild_memberships' },
        );
      }),
  },
  {
    name: 'A, a member of the decoy guild, selecting guild_memberships gets its own row only',
    run: ctx =>
      guildUntouched(ctx, () =>
        aInDecoyGuild(ctx, async () => {
          const { rows } = await ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT user_id, guild_id, role FROM guild_memberships ORDER BY user_id'),
          );
          assert.deepEqual(rows, [{ user_id: ctx.userA, guild_id: DECOY_GUILD, role: 'MEMBER' }]);
        }),
      ),
  },
  {
    name: 'A outside any guild, then A leading a guild of its own, selecting guild_memberships sees no decoy LEADER or MEMBER row',
    run: ctx =>
      guildUntouched(ctx, async () => {
        const visible = () =>
          ctx.asUser(ctx.app, ctx.userA, async c =>
            (await c.query('SELECT user_id, guild_id, role FROM guild_memberships ORDER BY user_id')).rows,
          );
        assert.deepEqual(await visible(), []);
        await aLeads(ctx, async guildId => {
          assert.deepEqual(await visible(), [{ user_id: ctx.userA, guild_id: guildId, role: 'LEADER' }]);
        });
      }),
  },
  {
    name: "A, leader of its own guild, transfers to each decoy member: TRANSFER_TARGET_INVALID, the decoy's roles unchanged",
    run: ctx =>
      guildUntouched(ctx, () =>
        aLeads(ctx, async guildId => {
          for (const target of [DECOY_2, DECOY_1]) {
            await ctx.expectPgError(
              ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT guild_transfer($1)', [target])),
              { code: HM, messagePrefix: 'TRANSFER_TARGET_INVALID' },
            );
          }
          // A is still the leader of its own guild: the refusal was about the target
          const own = await ctx.admin.query('SELECT guild_id, role FROM guild_memberships WHERE user_id = $1', [ctx.userA]);
          assert.deepEqual(own.rows, [{ guild_id: guildId, role: 'LEADER' }]);
        }),
      ),
  },
  {
    name: 'A, a member of the decoy guild, cannot transfer its leadership, and leaving takes only its own row',
    run: ctx =>
      guildUntouched(ctx, () =>
        aInDecoyGuild(ctx, async () => {
          for (const target of [ctx.userA, DECOY_2]) {
            await ctx.expectPgError(
              ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT guild_transfer($1)', [target])),
              { code: HM, messagePrefix: 'NOT_LEADER' },
            );
          }
          await ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT guild_leave()'));
          const own = await ctx.admin.query('SELECT 1 FROM guild_memberships WHERE user_id = $1', [ctx.userA]);
          assert.equal(own.rowCount, 0, 'the leave did not happen');
        }),
      ),
  },
  {
    name: "guild_join with the decoy guild's invite code, in any spelling, is INVITE_CODE_INVALID",
    run: ctx =>
      guildUntouched(ctx, async () => {
        for (const code of [DECOY_CODE, DECOY_CODE.toLowerCase(), ` ${DECOY_CODE} `]) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT guild_join($1)', [code])),
            { code: HM, messagePrefix: 'INVITE_CODE_INVALID' },
          );
        }
      }),
  },
  {
    name: 'guild_overview: A outside any guild gets {"guild": null}; A in its own guild sees only itself',
    run: ctx =>
      guildUntouched(ctx, async () => {
        const overview = () =>
          ctx.asUser(ctx.app, ctx.userA, async c => (await c.query('SELECT guild_overview() AS o')).rows[0].o);
        assert.deepEqual(await overview(), { guild: null });
        await aLeads(ctx, async guildId => {
          const { guild } = await overview();
          assert.equal(guild.id, guildId);
          assert.deepEqual(
            guild.members.map((m: { userId: string }) => m.userId),
            [ctx.userA],
          );
        });
      }),
  },
];
