// What GET /freeze-tickets and POST /freeze-tickets/use answer (S34, S78). Which dates are
// eligible, their deadlines, whether a ticket is needed and whether one is used come from
// ticket_overview (60-journal.sql), which reads the same app._ticket_needed that ticket_use
// enforces: the screen and the function cannot disagree. Only the two streak numbers are the
// domain's (ticketPreview): an open date is previewed as the open day ('TODAY') on the state the
// day-close will leave once the open days before it are closed (closeDays over `before`, the
// projection app._ticket_needed makes too), a closed one as the day that just closed ('YESTERDAY').
import type { Tickets } from '../../../domain/contract/social.ts';
import { closeDays, ticketPreview } from '../../../domain/streak.ts';
import type { DayInput, StreakState } from '../../../domain/streak.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { Ctx } from '../app.ts';
import { buildProgression } from './me.ts';

type Overview = {
  available: number;
  cap: number;
  state: StreakState;
  eligible: {
    date: DateLabel;
    target: 'TODAY' | 'YESTERDAY';
    open: boolean;
    before: DayInput[];
    deadline: string;
    needed: boolean;
    alreadyUsed: boolean;
  }[];
};

export async function buildTickets(ctx: Pick<Ctx, 'db' | 'now'>): Promise<Tickets> {
  const { rows } = await ctx.db.query<{ overview: Overview | null }>('SELECT ticket_overview() AS overview');
  const { overview } = rows[0];
  if (overview === null) {
    throw new Error('this read model is for an onboarded user');
  }
  return {
    serverTime: ctx.now.toISOString(),
    available: overview.available,
    cap: overview.cap,
    eligible: overview.eligible.map(({ date, target, open, before, deadline, needed, alreadyUsed }) => {
      const { withoutTicket, withTicket } = open
        ? ticketPreview(closeDays(overview.state, before).state, 'TODAY')
        : ticketPreview(overview.state, 'YESTERDAY');
      return { date, target, deadline: new Date(deadline).toISOString(), needed, withoutTicket, withTicket, alreadyUsed };
    }),
    progression: await buildProgression(ctx),
  };
}
