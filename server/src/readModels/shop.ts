// What a user reads back about the shop, the inventory and the perks. Everything is derived at
// read time: coins are the ledger sum, the level comes from the XP sum, perk points from
// xp_high_water, ownership and equips from the inventory rows; a default item is owned by
// everyone and equipped when no row of its kind is. Read as app_auth inside the request
// transaction.
import type { Inventory, Shop, ShopItem } from '../../../domain/contract/content.ts';
import type { PerkCode, Perks } from '../../../domain/contract/core.ts';
import { PERKS } from '../../../domain/economy.ts';
import { levelForXp, perkPointsEarned } from '../../../domain/progression.ts';
import type { Ctx } from '../app.ts';

type Reader = Pick<Ctx, 'db'>;

type Wallet = { xp: number; coin: number; xp_high_water: number; perk_spent: number; unlocked: PerkCode[] };

async function wallet({ db }: Reader): Promise<Wallet> {
  const { rows } = await db.query<Wallet>(
    `SELECT (SELECT coalesce(sum(l.amount), 0)::int FROM xp_ledger l WHERE l.user_id = s.user_id) AS xp,
            (SELECT coalesce(sum(l.amount), 0)::int FROM coin_ledger l WHERE l.user_id = s.user_id) AS coin,
            s.xp_high_water,
            (SELECT coalesce(sum(k.cost), 0)::int FROM perk_unlocks k WHERE k.user_id = s.user_id) AS perk_spent,
            ARRAY(SELECT DISTINCT k.perk_code FROM perk_unlocks k WHERE k.user_id = s.user_id) AS unlocked
       FROM progression_state s WHERE s.user_id = app.current_user_id()`,
  );
  if (rows.length !== 1) {
    throw new Error('this read model is for an onboarded user');
  }
  return rows[0];
}

type ItemRow = Omit<ShopItem, 'locked'>;

// Every item, in a fixed order: kind, the default first, then level, price and code.
const ITEMS = `
  SELECT s.code, s.name, s.kind, s.price_coin AS "priceCoin", s.min_level AS "minLevel",
         s.asset_key AS "assetKey", s.purchasable, s.is_default AS "isDefault",
         s.is_default OR v.id IS NOT NULL AS owned,
         coalesce(v.equipped, false)
           OR (s.is_default AND NOT EXISTS (
                 SELECT 1 FROM inventory e
                  WHERE e.user_id = app.current_user_id() AND e.kind = s.kind AND e.equipped)) AS equipped
    FROM shop_items s
    LEFT JOIN inventory v ON v.shop_item_id = s.id AND v.user_id = app.current_user_id()
   ORDER BY array_position(ARRAY['THEME', 'PET_SKIN', 'BADGE'], s.kind), s.is_default DESC,
            s.min_level, s.price_coin, s.code`;

async function items(ctx: Reader, level: number): Promise<ShopItem[]> {
  const { rows } = await ctx.db.query<ItemRow>(ITEMS);
  return rows.map(row => ({ ...row, locked: level < row.minLevel }));
}

/** `GET /shop`: the purchasable and the default items, the balance and the level. */
export async function buildShop(ctx: Reader): Promise<Shop> {
  const { xp, coin } = await wallet(ctx);
  const { level } = levelForXp(xp);
  const all = await items(ctx, level);
  return { coin, level, items: all.filter(item => item.purchasable || item.isDefault) };
}

/** `GET /inventory`: what the caller owns, the defaults and earned badges included. */
export async function buildInventory(ctx: Reader): Promise<Inventory> {
  const { level } = levelForXp((await wallet(ctx)).xp);
  return { items: (await items(ctx, level)).filter(item => item.owned) };
}

/** `GET /perks`: the three perks in the order of PERKS, and the points left. */
export async function buildPerks(ctx: Reader): Promise<Perks> {
  const { xp_high_water, perk_spent, unlocked } = await wallet(ctx);
  return {
    pointsAvailable: perkPointsEarned(xp_high_water) - perk_spent,
    perks: (Object.keys(PERKS) as PerkCode[]).map(code => ({
      code,
      cost: PERKS[code].cost,
      unlocked: unlocked.includes(code),
      repeatable: code === 'THEME_UNLOCK',
    })),
  };
}
