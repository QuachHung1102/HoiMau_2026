// The day-close job (AR-09, F-08): closes every past logical day of every onboarded user, in every
// time zone. SQL says which users and which dates (job_day_close_candidates: the user's stored
// zone and app.logical_date, never a zone database of Node); the domain decides the streak, the
// missed run and what was earned (closeDays, AR-03); job_apply_day_close writes it, one user per
// transaction, as a compare-and-set behind the user's row lock (32-dayclose.sql). A user whose
// apply fails is counted and logged and does not stop the others; a user whose days changed
// since they were read (a late write) or whom another run closed first applies nothing
// ("skipped") and is offered again by the next run if anything is left to close.
import type { Pool } from 'pg';
import { STREAK_MILESTONES } from '../../../domain/economy.ts';
import { closeDays } from '../../../domain/streak.ts';
import type { DayInput, StreakState } from '../../../domain/streak.ts';
import { withRole } from '../db.ts';
import { describeError } from '../log.ts';
import { logGrants } from '../readModels/delta.ts';
import type { Grant } from '../readModels/delta.ts';
import type { Job } from './scheduler.ts';

const BATCH = 200;
const HOUR_MS = 3_600_000;
const SLOT_MS = 15 * 60_000;

/** The latest hh:15 at or before `now`: day-close is due once per hour from minute 15. */
const slotOf = (now: Date) =>
  Math.floor((now.getTime() - SLOT_MS) / HOUR_MS) * HOUR_MS + SLOT_MS;

type Candidate = {
  user_id: string;
  last_closed: string | null;
  state: StreakState;
  days: DayInput[];
};

const CANDIDATES =
  'SELECT user_id, last_closed::text AS last_closed, state, days FROM job_day_close_candidates($1, $2, $3)';

/** What the apply is handed for one candidate: the new state and what it earned. */
async function closeUser(
  pool: Pool,
  row: Candidate,
): Promise<{ applied: boolean; grants: Grant[] }> {
  const { state, events } = closeDays(row.state, row.days);
  const earned = events.flatMap((event): object[] => {
    if (event.type === 'STREAK_MILESTONE') {
      const { days, coins, badgeCode } = STREAK_MILESTONES.find(
        milestone => milestone.days === event.days,
      )!;
      return [{ type: event.type, days, coins, badgeCode }];
    }
    // a broken streak is no notification: nobody is blamed (S67 lives on the journey screen)
    return event.type === 'PET_TIRED' ? [event] : [];
  });
  const { rows } = await withRole(pool, 'app_job', null, c =>
    c.query<{ result: { applied: boolean; grants: Grant[] } }>(
      'SELECT job_apply_day_close($1, $2, $3, $4, $5, $6) AS result',
      [
        row.user_id,
        row.last_closed,
        // the last date SQL offered: never a date computed here
        row.days[row.days.length - 1].date,
        JSON.stringify(row.days),
        JSON.stringify(state),
        JSON.stringify(earned),
      ],
    ),
  );
  return rows[0].result;
}

const dayClose: Job = {
  name: 'day-close',
  due: (now, lastRunAt) =>
    lastRunAt === null || lastRunAt.getTime() < slotOf(now),
  async run(pool, now, log) {
    const counts = { users: 0, applied: 0, skipped: 0, failed: 0, dates: 0 };
    let after: string | null = null;
    for (;;) {
      const { rows } = await withRole(pool, 'app_job', null, c =>
        c.query<Candidate>(CANDIDATES, [now, BATCH, after]),
      );
      if (rows.length === 0) {
        return counts;
      }
      for (const row of rows) {
        after = row.user_id;
        counts.users++;
        try {
          const { applied, grants } = await closeUser(pool, row);
          if (applied) {
            counts.applied++;
            counts.dates += row.days.length;
            logGrants({ log, userId: row.user_id }, grants);
          } else {
            counts.skipped++;
          }
        } catch (e) {
          counts.failed++;
          // the class and code of the error, never its message (it can quote a row)
          log.line({
            level: 'error',
            evt: 'job_user_failed',
            job: 'day-close',
            userId: row.user_id,
            ...describeError(e),
          });
        }
      }
    }
  },
};

export default dayClose;
