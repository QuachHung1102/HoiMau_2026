// GET /leaderboard?week=current|previous (S28, S73). current: the live board of the in-process
// cache (leaderboardCache.ts), final false. previous: the week the rollover stored
// (leaderboard_final, 51-guild-week.sql), final true. Either way guild name, completion ratio,
// active-member count and rank only (R-P.1), plus the row of the caller's own guild.
import type { Leaderboard } from '../../../domain/contract/social.ts';
import { addDays } from '../../../domain/logicalDate.ts';
import type { Route } from '../app.ts';
import { AppError } from '../errors.ts';
import { boardFor, ictWeek } from '../leaderboardCache.ts';

type Final = {
  updatedAt: string | null;
  entries: Leaderboard['entries'];
  mine: Leaderboard['mine'];
};

const routes: Route[] = [
  {
    method: 'GET',
    path: '/leaderboard',
    auth: 'user',
    handler: async ctx => {
      const week = ctx.query.get('week');
      if (week !== 'current' && week !== 'previous') {
        throw new AppError('VALIDATION_FAILED', {
          fields: [{ field: 'week', rule: week === null ? 'required' : 'format' }],
        });
      }
      const userId = ctx.userId as string;
      if (week === 'previous') {
        const weekStart = addDays(ictWeek(ctx.now).weekStart, -7);
        const { rows } = await ctx.db.query<{ board: Final }>('SELECT leaderboard_final($1) AS board', [weekStart]);
        const { updatedAt, entries, mine } = rows[0].board;
        const body: Leaderboard = {
          weekStart,
          final: true,
          // before the rollover of that week nothing is stored: the board is empty as of now
          updatedAt: new Date(updatedAt ?? ctx.now).toISOString(),
          entries,
          mine,
        };
        return { status: 200, body };
      }
      const board = await boardFor(ctx.db, userId, ctx.now);
      const { rows } = await ctx.db.query<{ guild_id: string }>(
        'SELECT guild_id FROM guild_memberships WHERE user_id = app.current_user_id()',
      );
      const guildId = rows[0]?.guild_id ?? null;
      const own = guildId === null ? undefined : board.byGuild.get(guildId);
      const body: Leaderboard = {
        weekStart: board.weekStart,
        final: false,
        updatedAt: board.updatedAt.toISOString(),
        entries: board.entries.map(entry => ({
          rank: entry.rank as number,
          guildName: entry.name,
          avgCompletion: entry.avgCompletion,
          activeMembers: entry.activeMembers,
          isMine: entry.guildId === guildId,
        })),
        // a guild made after the board was computed is on it from the next refresh: unranked till then
        mine:
          guildId === null
            ? null
            : {
                ranked: own?.ranked ?? false,
                rank: own?.rank ?? null,
                avgCompletion: own?.avgCompletion ?? 0,
                activeMembers: own?.activeMembers ?? 0,
              },
      };
      return { status: 200, body };
    },
  },
];

export default routes;
