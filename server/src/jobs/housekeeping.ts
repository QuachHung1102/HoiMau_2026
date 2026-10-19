// The housekeeping job (spec R-P.2, AR-08, AR-30): once a day from 04:00 Asia/Ho_Chi_Minh,
// hard-deletes the accounts whose 30 days are over (job_account_purge), the idempotency keys of
// 7 days or more (job_purge_idempotency) and the sessions, reset codes and throttle rows nobody
// reads any more (job_purge_auth), all in 61-privacy.sql, one transaction each. Never a decoy.
import type { Pool } from 'pg';
import { withRole } from '../db.ts';
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
  async run(pool, now) {
    return {
      accounts: await purge(pool, 'job_account_purge', now),
      idempotencyKeys: await purge(pool, 'job_purge_idempotency', now),
      authRows: await purge(pool, 'job_purge_auth', now),
    };
  },
};

export default housekeeping;
