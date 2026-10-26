// The guild week as the domain counts it, and the live leaderboard kept in memory.
// scoreWeek reads every guild with job_guild_week_inputs (51-guild-week.sql, app_job only) and
// scores and ranks it with scoreGuildWeek and rankGuilds: the leaderboard-refresh job, the
// weekly-rollover job and GET /leaderboard all go through it, so they cannot count apart.
//
// The live week is the Monday-based Asia/Ho_Chi_Minh one, through today's date there (D-08). The board is refreshed every 5 minutes by the job; a request finds it fresh, or
// computes it once (single flight) when it is missing, older than 10 minutes or of another week.
import type { PoolClient } from 'pg';
import { memberWeek, rankGuilds, scoreGuildWeek } from '../../domain/guild.ts';
import type { MemberWeek } from '../../domain/guild.ts';
import { localParts, weekStartOf } from '../../domain/logicalDate.ts';
import type { DateLabel } from '../../domain/types.ts';
import { setRole } from './db.ts';

export const ICT = 'Asia/Ho_Chi_Minh';
export const TOP = 50;
const STALE_MS = 10 * 60_000;

type InputRow = { guild_id: string; name: string; created_at: Date; members: MemberWeek[] };

/** The one reader of job_guild_week_inputs; an object so that a test can count the calls. */
export const weekInputs = {
  async read(db: PoolClient, weekStart: DateLabel, through: DateLabel): Promise<InputRow[]> {
    const { rows } = await db.query<InputRow>(
      'SELECT guild_id, name, created_at, members FROM job_guild_week_inputs($1, $2)',
      [weekStart, through],
    );
    return rows;
  },
};

export type GuildWeek = {
  guildId: string;
  name: string;
  createdAt: string;
  avgCompletion: number;
  activeMembers: number;
  ranked: boolean;
  rank: number | null;
  /** The ids of the active members: whom the rollover pays. Never sent to a client. */
  activeUserIds: string[];
};

/**
 * Every guild of the week `weekStart` through `through`, ranked ones first by rank. `db` must be
 * in an app_job transaction. Rows of equal avgCompletion, activeMembers and createdAt keep the
 * order of the input, which is sorted by guild id here: the last tie-break is the id.
 */
export async function scoreWeek(db: PoolClient, weekStart: DateLabel, through: DateLabel): Promise<GuildWeek[]> {
  const rows = await weekInputs.read(db, weekStart, through);
  rows.sort((a, b) => (a.guild_id < b.guild_id ? -1 : a.guild_id > b.guild_id ? 1 : 0));
  return rankGuilds(
    rows.map(row => ({
      guildId: row.guild_id,
      name: row.name,
      createdAt: row.created_at.toISOString(),
      ...scoreGuildWeek(row.members, weekStart, through),
      activeUserIds: row.members
        .filter(member => memberWeek(member, weekStart, through).active)
        .map(member => member.userId),
    })),
  );
}

/** The Asia/Ho_Chi_Minh date of `now` and the Monday of its week. */
export function ictWeek(now: Date): { today: DateLabel; weekStart: DateLabel } {
  const today = localParts(now.getTime(), ICT).date;
  return { today, weekStart: weekStartOf(today) };
}

export type Board = {
  weekStart: DateLabel;
  /** The instant it was computed for. */
  updatedAt: Date;
  /** The ranked guilds, the first TOP by rank. */
  entries: GuildWeek[];
  byGuild: Map<string, GuildWeek>;
};

/** The live board at `now`; `db` must be in an app_job transaction. */
export async function computeBoard(db: PoolClient, now: Date): Promise<Board> {
  const { today, weekStart } = ictWeek(now);
  const guilds = await scoreWeek(db, weekStart, today);
  return {
    weekStart,
    updatedAt: now,
    entries: guilds.filter(guild => guild.rank !== null).slice(0, TOP),
    byGuild: new Map(guilds.map(guild => [guild.guildId, guild])),
  };
}

// ponytail: in-process cache, one server process
let board: Board | null = null;
let computing: Promise<Board> | null = null;

export const setBoard = (next: Board | null): void => {
  board = next;
};

const fresh = (b: Board | null, now: Date): b is Board =>
  b !== null &&
  b.weekStart === ictWeek(now).weekStart &&
  now.getTime() >= b.updatedAt.getTime() &&
  now.getTime() - b.updatedAt.getTime() <= STALE_MS;

/**
 * The board for a request of `userId` at `now`: the cached one when fresh, else computed once
 * for every request that asks meanwhile. The computing request lends its own transaction: it
 * switches to app_job (only that role may read job_guild_week_inputs) and back to app_auth as
 * `userId`. A second pooled client per request could starve the pool (app.ts, noPoolInHandler).
 */
export async function boardFor(db: PoolClient, userId: string, now: Date): Promise<Board> {
  if (fresh(board, now)) {
    return board;
  }
  computing ??= (async () => {
    try {
      await setRole(db, 'app_job', null);
      const next = await computeBoard(db, now);
      await setRole(db, 'app_auth', userId);
      board = next;
      return next;
    } finally {
      computing = null;
    }
  })();
  return computing;
}
