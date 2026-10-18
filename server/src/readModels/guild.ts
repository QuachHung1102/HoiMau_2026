// What a member reads back about the own guild: `GuildState`. guild_overview (50-guild.sql,
// re-created by 52-nudge.sql with the nudge reason of each member) hands over the raw facts of
// the caller's guild only, and nothing a member may not see (R-P.1); the
// numbers are made here with the domain, so the app and the weekly job count alike. The week is
// the Monday-based Asia/Ho_Chi_Minh one, through today's date there (AR-17, R-D08); only
// storyDoneToday is about each member's own logical day.
import type { GuildMember, GuildRole, GuildState, NudgeBlockReason } from '../../../domain/contract/social.ts';
import { GUILD_INACTIVE_DAYS, memberWeek, scoreGuildWeek } from '../../../domain/guild.ts';
import type { MemberWeek } from '../../../domain/guild.ts';
import { daysBetween, localParts } from '../../../domain/logicalDate.ts';
import { levelForXp } from '../../../domain/progression.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { Ctx } from '../app.ts';

type Overview = {
  guild: null | {
    id: string;
    name: string;
    motto: string;
    inviteCode: string;
    createdAt: string;
    myRole: GuildRole;
    today: DateLabel;
    weekStart: DateLabel;
    lastLogDate: DateLabel | null;
    members: {
      userId: string;
      displayName: string;
      role: GuildRole;
      joinedDate: DateLabel;
      xp: number;
      days: MemberWeek['days'];
      today: { date: DateLabel; storyDone: number; storyTotal: number };
      /** app._nudge_block_reason(caller, member): null = may be nudged now. */
      nudge: BlockReason;
    }[];
  };
};

type BlockReason = NudgeBlockReason | 'NOT_IN_GUILD' | 'NUDGE_NOT_SAME_GUILD' | null;

/**
 * `GuildMember.nudge`: what nudge_send would raise. The caller's own row is the contract's
 * `{allowed: false, reason: null}` (nobody nudges themselves; SQL says NUDGE_NOT_SAME_GUILD);
 * on another member's row of the own guild the reason is one of NudgeBlockReason.
 */
const nudgeOf = (isMe: boolean, reason: BlockReason): GuildMember['nudge'] =>
  isMe ? { allowed: false, reason: null } : { allowed: reason === null, reason: reason as NudgeBlockReason | null };

const allDone = (day: { storyDone: number; storyTotal: number }) =>
  day.storyTotal > 0 && day.storyDone === day.storyTotal;

/** `GET /guilds/me` and the answer of every guild write: `{guild: null}` outside a guild. */
export async function buildGuild({ db, userId }: Pick<Ctx, 'db' | 'userId'>): Promise<GuildState> {
  const { rows } = await db.query<{ overview: Overview }>('SELECT guild_overview() AS overview');
  const guild = rows[0].overview.guild;
  if (guild === null) {
    return { guild: null };
  }
  const { today, weekStart } = guild;
  const weeks: MemberWeek[] = guild.members.map(({ userId: id, joinedDate, days }) => ({
    userId: id,
    joinedDate,
    days,
  }));
  // from the later of the latest log of any member and the day the guild was made: a guild cannot
  // have been quiet longer than it has existed
  const created = localParts(Date.parse(guild.createdAt), 'Asia/Ho_Chi_Minh').date;
  const since = guild.lastLogDate !== null && guild.lastLogDate > created ? guild.lastLogDate : created;
  const inactiveDays = Math.max(0, daysBetween(since, today));
  return {
    guild: {
      id: guild.id,
      name: guild.name,
      motto: guild.motto,
      inviteCode: guild.inviteCode,
      myRole: guild.myRole,
      weekCompletion: scoreGuildWeek(weeks, weekStart, today).avgCompletion,
      inactive: inactiveDays >= GUILD_INACTIVE_DAYS,
      inactiveDays,
      members: guild.members.map((member, i) => {
        const from = member.joinedDate > weekStart ? member.joinedDate : weekStart;
        return {
          userId: member.userId,
          displayName: member.displayName,
          level: levelForXp(member.xp).level,
          role: member.role,
          isMe: member.userId === userId,
          // the days memberWeek counts on which every STORY quest is done (a frozen one too, AR-10)
          daysCompletedThisWeek: member.days.filter(day => day.date >= from && day.date <= today && allDone(day))
            .length,
          daysCountedThisWeek: memberWeek(weeks[i], weekStart, today).countedDays,
          storyDoneToday: allDone(member.today),
          nudge: nudgeOf(member.userId === userId, member.nudge),
        };
      }),
    },
  };
}
