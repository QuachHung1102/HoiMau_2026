// The ticket-grant job (AR-10): at minute 20 of every hour, job_ticket_grant (60-journal.sql)
// decides the weekly ticket of every user who wrote in the journal this week and has no
// decision for it. journal_create decides it already, so a run normally finds nothing: this is
// the idempotent safety net, calling the same app._ticket_grant_check.
import { withRole } from '../db.ts';
import type { Job } from './scheduler.ts';

const HOUR_MS = 3_600_000;
const SLOT_MS = 20 * 60_000;

/** The latest hh:20 at or before `now`. */
const slotOf = (now: Date) => Math.floor((now.getTime() - SLOT_MS) / HOUR_MS) * HOUR_MS + SLOT_MS;

const ticketGrant: Job = {
  name: 'ticket-grant',
  due: (now, lastRunAt) => lastRunAt === null || lastRunAt.getTime() < slotOf(now),
  async run(pool, now) {
    const { rows } = await withRole(pool, 'app_job', null, c =>
      c.query<{ decided: number }>('SELECT job_ticket_grant($1) AS decided', [now]),
    );
    return { decided: rows[0].decided };
  },
};

export default ticketGrant;
