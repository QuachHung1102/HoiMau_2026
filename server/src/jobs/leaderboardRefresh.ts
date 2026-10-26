// The leaderboard-refresh job: every 5 minutes the live board of the running
// Asia/Ho_Chi_Minh week, through today's date there, into the in-process cache that
// GET /leaderboard?week=current serves (leaderboardCache.ts).
import { withRole } from '../db.ts';
import { computeBoard, setBoard } from '../leaderboardCache.ts';
import type { Job } from './scheduler.ts';

const EVERY_MS = 5 * 60_000;

const leaderboardRefresh: Job = {
  name: 'leaderboard-refresh',
  due: (now, lastRunAt) => lastRunAt === null || now.getTime() - lastRunAt.getTime() >= EVERY_MS,
  async run(pool, now) {
    const board = await withRole(pool, 'app_job', null, db => computeBoard(db, now));
    setBoard(board);
    return { weekStart: board.weekStart, guilds: board.byGuild.size, ranked: board.entries.length };
  },
};

export default leaderboardRefresh;
