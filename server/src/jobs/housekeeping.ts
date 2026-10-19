// The housekeeping job (spec R-P.2, AR-08, AR-30): once a day from 04:00 Asia/Ho_Chi_Minh,
// hard-deletes the accounts whose 30 days are over (job_account_purge), the idempotency keys of
// 7 days or more (job_purge_idempotency) and the sessions, reset codes and throttle rows nobody
// reads any more (job_purge_auth), all in 61-privacy.sql, one transaction each. Never a decoy.
// The three run apart: one that fails is logged with its error, the other two still run and
// commit, and the run is recorded failed (job_runs ok = false) once all three have had their turn.
import type { Pool } from 'pg';
import { withRole } from '../db.ts';
import { describeError } from '../log.ts';
import type { Job } from './scheduler.ts';

const DAY_MS = 86_400_000;
/** 04:00 at UTC+7 (no daylight saving) is 21:00 UTC. */
const SLOT_MS = 21 * 3_600_000;

/** The latest 04:00 Asia/Ho_Chi_Minh at or before `now`. */
const slotOf = (now: Date) => Math.floor((now.getTime() - SLOT_MS) / DAY_MS) * DAY_MS + SLOT_MS;

const purge = async (pool: Pool, fn: string, now: Date): Promise<number> =>
  (
    await withRole(pool, 'app_job', null, c =>
      c.query<{ n: number }>(`SELECT ${fn}($1) AS n`, [now]),
    )
  ).rows[0].n;

const housekeeping: Job = {
  name: 'housekeeping',
  due: (now, lastRunAt) => lastRunAt === null || lastRunAt.getTime() < slotOf(now),
  async run(pool, now, log) {
    const steps = {
      // at most 50 accounts per call (a statement under the timeout): called until none is due
      accounts: async () => {
        let total = 0;
        for (;;) {
          const n = await purge(pool, 'job_account_purge', now);
          if (n === 0) {
            return total;
          }
          total += n;
        }
      },
      idempotencyKeys: () => purge(pool, 'job_purge_idempotency', now),
      authRows: () => purge(pool, 'job_purge_auth', now),
    };
    const result: Record<string, number> = {};
    let failure: unknown;
    for (const [step, work] of Object.entries(steps)) {
      try {
        result[step] = await work();
      } catch (e) {
        failure ??= e;
        log.line({ level: 'error', evt: 'housekeeping_step', step, ...describeError(e) });
      }
    }
    if (failure !== undefined) {
      throw failure;
    }
    return result;
  },
};

export default housekeeping;
