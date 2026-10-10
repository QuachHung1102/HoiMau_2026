import { daysBetween } from './logicalDate.ts';
import type { DateLabel } from './types.ts';

export const GUILD_MIN_ACTIVE = 3;
export const GUILD_MAX_MEMBERS = 8;
export const GUILD_INACTIVE_DAYS = 14;

export type MemberWeek = {
  userId: string;
  joinedDate: DateLabel;
  /** only days with a DailyLog */
  days: {
    date: DateLabel;
    storyDone: number;
    storyTotal: number;
    frozen: boolean;
  }[];
};

/**
 * One member's week from `weekStart` through `throughDate` (F-11, R-D08). Days count from the
 * join date; a frozen day, a day without a log and a day without STORY quests contribute 0.
 * `active` needs a log inside the week and at least one counted day: whoever joined after
 * `throughDate` was not a member during it, whatever they logged.
 */
export function memberWeek(
  member: MemberWeek,
  weekStart: DateLabel,
  throughDate: DateLabel,
): { active: boolean; countedDays: number; average: number } {
  const from = member.joinedDate > weekStart ? member.joinedDate : weekStart;
  const countedDays = Math.max(0, daysBetween(from, throughDate) + 1);
  const logged = member.days.filter(
    day => day.date >= weekStart && day.date <= throughDate,
  );
  let sum = 0;
  for (const day of logged) {
    if (day.date >= from && !day.frozen && day.storyTotal > 0) {
      sum += day.storyDone / day.storyTotal;
    }
  }
  return {
    active: countedDays > 0 && logged.length > 0,
    countedDays,
    average: sum / (countedDays || 1),
  };
}

/**
 * Mean of the active members' averages; ranked from GUILD_MIN_ACTIVE active members.
 * Rounded to 9 decimals: guilds with the same exact mean must get the same number, or float
 * noise in the last bit would decide the leaderboard instead of the AR-17 tie-breaks.
 */
export function scoreGuildWeek(
  members: MemberWeek[],
  weekStart: DateLabel,
  throughDate: DateLabel,
): { avgCompletion: number; activeMembers: number; ranked: boolean } {
  const active = members
    .map(member => memberWeek(member, weekStart, throughDate))
    .filter(week => week.active);
  const sum = active.reduce((total, week) => total + week.average, 0);
  return {
    avgCompletion: Math.round((sum / (active.length || 1)) * 1e9) / 1e9,
    activeMembers: active.length,
    ranked: active.length >= GUILD_MIN_ACTIVE,
  };
}

/**
 * Ranked rows first, numbered 1…n by avgCompletion desc, activeMembers desc, createdAt asc
 * (AR-17); unranked rows follow in input order with `rank: null`. `createdAt` is an ISO-8601
 * instant. The input is not modified.
 */
export function rankGuilds<
  T extends {
    avgCompletion: number;
    activeMembers: number;
    createdAt: string;
    ranked: boolean;
  },
>(rows: T[]): (T & { rank: number | null })[] {
  const ranked = rows
    .filter(row => row.ranked)
    .sort(
      (a, b) =>
        b.avgCompletion - a.avgCompletion ||
        b.activeMembers - a.activeMembers ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  return [
    ...ranked.map((row, index) => ({ ...row, rank: index + 1 })),
    ...rows.filter(row => !row.ranked).map(row => ({ ...row, rank: null })),
  ];
}
