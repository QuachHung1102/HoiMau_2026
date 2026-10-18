// What a member reads back about the own guild: `GuildState`. guild_overview (50-guild.sql) hands
// over the raw facts of the caller's guild only, and nothing a member may not see (R-P.1); the
// numbers are made here with the domain, so the app and the weekly job count alike. The week is
// the Monday-based Asia/Ho_Chi_Minh one, through today's date there (AR-17, R-D08); only
// storyDoneToday is about each member's own logical day.
import type { GuildRole, GuildState } from '../../../domain/contract/social.ts';
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
    }[];
  };
};

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
  // no member ever logged: counted from the day the guild was made
  const since = guild.lastLogDate ?? localParts(Date.parse(guild.createdAt), 'Asia/Ho_Chi_Minh').date;
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
          // Task 41 fills this in; until then nobody can be nudged
          nudge: { allowed: false, reason: null },
        };
      }),
    },
  };
}
