// The reminder-dispatch job (spec 6.2, AR-23): at minutes 0, 15, 30 and 45, one QUEST_REMINDER
// inbox item per user who asked for it, inside the chosen window of the user's own wall clock,
// once per logical day (job_reminder_dispatch, 52-nudge.sql: one statement, the dedupe key is
// the logical date, so a second run in the window creates nothing).
import { withRole } from '../db.ts';
import type { Job } from './scheduler.ts';

const SLOT_MS = 15 * 60_000;

const reminderDispatch: Job = {
  name: 'reminder-dispatch',
  // due once per quarter hour, from its first minute
  due: (now, lastRunAt) =>
    lastRunAt === null || lastRunAt.getTime() < Math.floor(now.getTime() / SLOT_MS) * SLOT_MS,
  async run(pool, now) {
    const { rows } = await withRole(pool, 'app_job', null, c =>
      c.query<{ created: number }>('SELECT job_reminder_dispatch($1) AS created', [now]),
    );
    return { created: rows[0].created };
  },
};

export default reminderDispatch;
