// The weekly-rollover job (F-11, R-D07, R-D08): from Monday 03:30 Asia/Ho_Chi_Minh, every closed
// week not older than 28 days that is not applied yet is scored for its full seven days and
// handed to job_apply_guild_week (51-guild-week.sql), which stores it and pays the rewards once.
// Oldest first, one transaction per week: a server that was down for two Mondays settles both
// weeks, in order, on its next run.
import type { PoolClient } from 'pg';
import { guildWeeklyReward } from '../../../domain/economy.ts';
import { addDays } from '../../../domain/logicalDate.ts';
import type { DateLabel } from '../../../domain/types.ts';
import { withRole } from '../db.ts';
import { ictWeek, scoreWeek } from '../leaderboardCache.ts';
import { logGrants } from '../readModels/delta.ts';
import type { Grant } from '../readModels/delta.ts';
import type { Job } from './scheduler.ts';

/** A week is closed for the rollover from 03:30 of the Monday after it. */
const CLOSE_AFTER_MS = (3 * 60 + 30) * 60_000;
const CATCH_UP_WEEKS = 4; // 28 days

/** The Monday of the week that is still open for the rollover at `now`. */
const openWeek = (now: Date): DateLabel => ictWeek(new Date(now.getTime() - CLOSE_AFTER_MS)).weekStart;

/** That Monday 03:30 Asia/Ho_Chi_Minh (UTC+7, no daylight saving): the slot of the last run due. */
const slotOf = (now: Date): number => Date.parse(`${openWeek(now)}T03:30:00+07:00`);

type Applied = { applied: boolean; grants: (Grant & { userId: string })[] };

/** Scores the week of `weekStart` and applies it; `db` in an app_job transaction. */
export async function settleWeek(db: PoolClient, weekStart: DateLabel): Promise<Applied> {
  const guilds = await scoreWeek(db, weekStart, addDays(weekStart, 6));
  const rows = guilds.map(guild => ({
    guildId: guild.guildId,
    avgCompletion: guild.avgCompletion,
    activeMembers: guild.activeMembers,
    rank: guild.rank,
    ...(guild.rank === null ? { coins: null, badgeCode: null } : guildWeeklyReward(guild.rank)),
    members: guild.activeUserIds,
  }));
  const { rows: result } = await db.query<{ result: Applied }>(
    'SELECT job_apply_guild_week($1, $2) AS result',
    [weekStart, JSON.stringify(rows)],
  );
  return result[0].result;
}

const weeklyRollover: Job = {
  name: 'weekly-rollover',
  due: (now, lastRunAt) => lastRunAt === null || lastRunAt.getTime() < slotOf(now),
  async run(pool, now, log) {
    const open = openWeek(now);
    const applied: DateLabel[] = [];
    let grants = 0;
    // ponytail: scores each of the 4 weeks again on every run (an applied week answers
    // applied: false); one read per week, once a week. Ask job_runs first if it ever costs.
    for (let back = CATCH_UP_WEEKS; back >= 1; back--) {
      const weekStart = addDays(open, -7 * back);
      const result = await withRole(pool, 'app_job', null, db => settleWeek(db, weekStart));
      if (result.applied) {
        applied.push(weekStart);
        grants += result.grants.length;
        for (const grant of result.grants) {
          logGrants({ log, userId: grant.userId }, [grant]);
        }
      }
    }
    return { applied, grants };
  },
};

export default weeklyRollover;
