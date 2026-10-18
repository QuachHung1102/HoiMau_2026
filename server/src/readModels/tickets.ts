// What GET /freeze-tickets and POST /freeze-tickets/use answer (S34, S78). Which dates are
// eligible, their deadlines, whether a ticket is needed and whether one is used come from
// ticket_overview (60-journal.sql), which reads the same app._ticket_needed that ticket_use
// enforces: the screen and the function cannot disagree. Only the two streak numbers are the
// domain's (ticketPreview): an open date is previewed as the open day ('TODAY'), a closed one as
// the day that just closed ('YESTERDAY').
import type { Tickets } from '../../../domain/contract/social.ts';
import { ticketPreview } from '../../../domain/streak.ts';
import type { StreakState } from '../../../domain/streak.ts';
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
    eligible: overview.eligible.map(({ date, target, open, deadline, needed, alreadyUsed }) => {
      const { withoutTicket, withTicket } = ticketPreview(overview.state, open ? 'TODAY' : 'YESTERDAY');
      return { date, target, deadline: new Date(deadline).toISOString(), needed, withoutTicket, withTicket, alreadyUsed };
    }),
    progression: await buildProgression(ctx),
  };
}
