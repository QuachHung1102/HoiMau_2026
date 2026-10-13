// GET /progression and GET /pet: read-only, everything derived at read time (readModels/me.ts).
// No route writes XP, coins, level, perk points or a stat (R-03.1).
import type { Route } from '../app.ts';
import { buildPet, buildProgression } from '../readModels/me.ts';

const routes: Route[] = [
  {
    method: 'GET',
    path: '/progression',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildProgression(ctx) }),
  },
  {
    method: 'GET',
    path: '/pet',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildPet(ctx) }),
  },
];

export default routes;
