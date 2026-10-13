// Seeds shop_items from content/shopItems.ts, by code: an item keeps its id for good, so
// inventory rows keep pointing at it. Idempotent: a second run rewrites no row.
import type { ClientBase } from 'pg';
import { SHOP_ITEMS } from '../../content/shopItems.ts';

export async function seed(db: ClientBase): Promise<void> {
  await db.query(
    `INSERT INTO shop_items AS s (code, name, kind, price_coin, min_level, asset_key, purchasable, is_default)
     SELECT x.code, x.name, x.kind, x."priceCoin", x."minLevel", x."assetKey", x.purchasable, x."isDefault"
       FROM jsonb_to_recordset($1::jsonb) AS x (
         code text, name text, kind text, "priceCoin" int, "minLevel" int, "assetKey" text,
         purchasable boolean, "isDefault" boolean)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, kind = EXCLUDED.kind, price_coin = EXCLUDED.price_coin,
       min_level = EXCLUDED.min_level, asset_key = EXCLUDED.asset_key,
       purchasable = EXCLUDED.purchasable, is_default = EXCLUDED.is_default
      WHERE (s.name, s.kind, s.price_coin, s.min_level, s.asset_key, s.purchasable, s.is_default)
            IS DISTINCT FROM
            (EXCLUDED.name, EXCLUDED.kind, EXCLUDED.price_coin, EXCLUDED.min_level, EXCLUDED.asset_key,
             EXCLUDED.purchasable, EXCLUDED.is_default)`,
    [JSON.stringify(SHOP_ITEMS)],
  );
}
