// Freeze ticket routes: GET /freeze-tickets, POST /freeze-tickets/use (F-08, R-D04, AR-10). Every
// rule (eligible dates, one ticket per date, a ticket in hand, something to protect) and every
// lock is ticket_use's (60-journal.sql); a refusal is THROWN, so a refused use leaves no row.
import type { Route } from '../app.ts';
import { buildTickets } from '../readModels/tickets.ts';
import { dateOf, objectBody, refuse } from './day.ts';

const routes: Route[] = [
  {
    method: 'GET',
    path: '/freeze-tickets',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildTickets(ctx) }),
  },
  {
    method: 'POST',
    path: '/freeze-tickets/use',
    auth: 'user',
    idempotent: true,
    handler: async ctx => {
      const { date } = objectBody(ctx.body);
      if (date !== undefined && date !== null && typeof date !== 'string') {
        throw refuse('date', 'format');
      }
      await ctx.db.query('SELECT ticket_use($1, $2)', [dateOf(date, 'date'), ctx.actionId]);
      return { status: 200, body: await buildTickets(ctx) };
    },
  },
];

export default routes;
