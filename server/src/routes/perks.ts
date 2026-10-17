// GET /perks and POST /perks/unlock. Costs, "once" and the points are perk_unlock's
// (41-shop.sql), under the caller's lock; the route checks the shape of the body.
import type { FieldError } from '../../../domain/validation.ts';
import { PERKS } from '../../../domain/economy.ts';
import type { Route } from '../app.ts';
import { AppError } from '../errors.ts';
import { buildPerks } from '../readModels/shop.ts';
import { objectBody } from './day.ts';

const routes: Route[] = [
  {
    method: 'GET',
    path: '/perks',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildPerks(ctx) }),
  },
  {
    method: 'POST',
    path: '/perks/unlock',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      const { perkCode, itemCode } = objectBody(ctx.body);
      const fields: FieldError[] = [];
      if (perkCode === undefined) {
        fields.push({ field: 'perkCode', rule: 'required' });
      } else if (typeof perkCode !== 'string' || !Object.hasOwn(PERKS, perkCode)) {
        fields.push({ field: 'perkCode', rule: 'enum' });
      }
      if (perkCode === 'THEME_UNLOCK' && itemCode === undefined) {
        fields.push({ field: 'itemCode', rule: 'required' });
      } else if (itemCode !== undefined && typeof itemCode !== 'string') {
        fields.push({ field: 'itemCode', rule: 'format' });
      }
      if (fields.length > 0) {
        throw new AppError('VALIDATION_FAILED', { fields });
      }
      // the theme of THEME_UNLOCK only: another perk ignores an itemCode
      await ctx.db.query('SELECT perk_unlock($1, $2)', [
        perkCode,
        perkCode === 'THEME_UNLOCK' ? itemCode : null,
      ]);
      return { status: 200, body: await buildPerks(ctx) };
    },
  },
];

export default routes;
