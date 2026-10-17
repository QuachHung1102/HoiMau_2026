// The shop and the inventory: GET /shop, POST /shop/{itemCode}/purchase, GET /inventory,
// POST /inventory/{itemCode}/equip. The rules (price, level, ownership, balance, one equipped
// item per kind) are those of shop_purchase and inventory_equip (41-shop.sql), under the
// caller's lock; every refusal is THROWN, so a refused purchase leaves no row.
import type { PurchaseResult } from '../../../domain/contract/content.ts';
import type { Route } from '../app.ts';
import { logGrants } from '../readModels/delta.ts';
import type { Grant } from '../readModels/delta.ts';
import { buildInventory, buildShop } from '../readModels/shop.ts';

const routes: Route[] = [
  {
    method: 'GET',
    path: '/shop',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildShop(ctx) }),
  },
  {
    method: 'POST',
    path: '/shop/:itemCode/purchase',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      const { itemCode } = ctx.params;
      const { rows } = await ctx.db.query<{ result: Grant }>(
        'SELECT shop_purchase($1, $2) AS result',
        [itemCode, ctx.actionId],
      );
      logGrants(ctx, [rows[0].result]);
      const shop = await buildShop(ctx);
      const answer: PurchaseResult = {
        coin: shop.coin,
        item: shop.items.find(item => item.code === itemCode)!,
      };
      return { status: 200, body: answer };
    },
  },
  {
    method: 'GET',
    path: '/inventory',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildInventory(ctx) }),
  },
  {
    method: 'POST',
    path: '/inventory/:itemCode/equip',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      await ctx.db.query('SELECT inventory_equip($1)', [ctx.params.itemCode]);
      return { status: 200, body: await buildInventory(ctx) };
    },
  },
];

export default routes;
