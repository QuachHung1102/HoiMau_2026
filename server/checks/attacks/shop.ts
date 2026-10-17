// Gate 2, the attack cases of the shop (41-shop.sql): direct writes of the inventory and the coin
// ledger, and purchase, equip and perk unlock by A of the theme the decoy owns, equips and
// unlocked with a perk, so that only the owner conditions stand between A and the decoy's rows.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cumulativeXpForLevel } from '../../../domain/progression.ts';
import { decoyRows, decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/80-decoy-base.sql.
const DECOY_INVENTORY = '00000000-0000-4000-8000-0000000d1006';
const DECOY_PERK = '00000000-0000-4000-8000-0000000d1007';
const THEME = 'THEME_FOREST';

const HM = 'HM000';

/** What A owns, as the owner reads it. */
const ownedByA = async (ctx: AttackCtx) =>
  (
    await ctx.admin.query(
      `SELECT (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin,
              ARRAY(SELECT s.code || CASE WHEN i.equipped THEN '*' ELSE '' END
                      FROM inventory i JOIN shop_items s ON s.id = i.shop_item_id
                     WHERE i.user_id = $1 ORDER BY s.code) AS inventory,
              ARRAY(SELECT k.perk_code FROM perk_unlocks k WHERE k.user_id = $1) AS perks`,
      [ctx.userA],
    )
  ).rows[0];

/** The decoy owns THEME_FOREST, through a THEME_UNLOCK, and for the attack has it equipped. */
async function decoyThemeEquipped(ctx: AttackCtx, attack: () => Promise<void>): Promise<void> {
  const rows = await decoyRows(ctx.admin);
  assert.ok((rows.inventory as { id: string }[]).some(row => row.id === DECOY_INVENTORY), 'no decoy inventory row');
  assert.ok((rows.perk_unlocks as { id: string }[]).some(row => row.id === DECOY_PERK), 'no decoy perk row');
  await ctx.admin.query('UPDATE inventory SET equipped = true WHERE id = $1', [DECOY_INVENTORY]);
  try {
    await decoyUntouched(ctx, attack);
  } finally {
    await ctx.admin.query('UPDATE inventory SET equipped = false WHERE id = $1', [DECOY_INVENTORY]);
  }
}

/**
 * Gives A `xp` XP and `coin` coins for the length of the attack, and takes back afterwards every
 * row the attack gave A, so the attacks that follow meet A as api-check made it.
 */
async function withFundsOfA(ctx: AttackCtx, xp: number, coin: number, attack: () => Promise<void>) {
  const { rows } = await ctx.admin.query('SELECT xp_high_water FROM progression_state WHERE user_id = $1', [ctx.userA]);
  const ref = randomUUID();
  await ctx.admin.query("SELECT app._grant($1, $2, $3, 'ATTACK', $4)", [ctx.userA, xp, coin, ref]);
  try {
    await attack();
  } finally {
    await ctx.admin.query(
      `WITH a AS (DELETE FROM inventory WHERE user_id = $1),
            b AS (DELETE FROM perk_unlocks WHERE user_id = $1),
            c AS (DELETE FROM coin_ledger WHERE user_id = $1 AND (ref_id = $2 OR reason = 'PURCHASE')),
            d AS (DELETE FROM xp_ledger WHERE user_id = $1 AND ref_id = $2)
       UPDATE progression_state SET xp_high_water = $3 WHERE user_id = $1`,
      [ctx.userA, ref, rows[0].xp_high_water],
    );
  }
}

export const attacks: Attack[] = [
  {
    name: 'a direct INSERT into inventory, coin_ledger or perk_unlocks by A stops at the grant',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        for (const table of ['inventory', 'coin_ledger', 'perk_unlocks']) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query(`INSERT INTO ${table} DEFAULT VALUES`)),
            { code: '42501', messagePrefix: `permission denied for table ${table}` },
          );
        }
      }),
  },
  {
    name: "A buys and equips the theme the decoy owns and has equipped: A's rows only, the decoy's unchanged",
    run: ctx =>
      decoyThemeEquipped(ctx, () =>
        withFundsOfA(ctx, 0, 1000, async () => {
          assert.deepEqual(await ownedByA(ctx), { coin: 1000, inventory: [], perks: [] });
          // A does not own it yet: the decoy's row must not count as A's
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT inventory_equip($1)', [THEME])),
            { code: HM, messagePrefix: 'ITEM_NOT_OWNED' },
          );
          await ctx.asUser(ctx.app, ctx.userA, async c => {
            await c.query('SELECT shop_purchase($1, $2)', [THEME, randomUUID()]);
            await c.query('SELECT inventory_equip($1)', [THEME]);
          });
          const price = (await ctx.admin.query('SELECT price_coin FROM shop_items WHERE code = $1', [THEME])).rows[0]
            .price_coin as number;
          // the calls did write: otherwise "the decoy is untouched" says nothing
          assert.deepEqual(await ownedByA(ctx), { coin: 1000 - price, inventory: [`${THEME}*`], perks: [] });
        }),
      ),
  },
  {
    name: 'A unlocks with its one perk point the theme the decoy unlocked with a perk: A\'s rows only, the decoy\'s unchanged',
    run: ctx =>
      decoyThemeEquipped(ctx, () =>
        withFundsOfA(ctx, cumulativeXpForLevel(2), 0, async () => {
          assert.deepEqual(await ownedByA(ctx), { coin: 0, inventory: [], perks: [] });
          // the decoy's spent point and its row of the theme are not A's
          await ctx.asUser(ctx.app, ctx.userA, c => c.query('SELECT perk_unlock($1, $2)', ['THEME_UNLOCK', THEME]));
          assert.deepEqual(await ownedByA(ctx), { coin: 0, inventory: [THEME], perks: ['THEME_UNLOCK'] });
        }),
      ),
  },
];
