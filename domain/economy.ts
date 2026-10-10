/** Perk costs in perk points (R-D07). */
export const PERKS = {
  MEAL_SWAP_PLUS: { cost: 2 },
  TICKET_CAP_PLUS: { cost: 3 },
  THEME_UNLOCK: { cost: 1 },
} as const;

export const SWAPS_PER_SLOT = { base: 3, withPerk: 5 } as const;
export const TICKET_CAP = { base: 2, withPerk: 3 } as const;

export const STREAK_MILESTONES: readonly {
  days: 7 | 30 | 100;
  coins: number;
  badgeCode: string;
}[] = [
  { days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' },
  { days: 30, coins: 200, badgeCode: 'BADGE_STREAK_30' },
  { days: 100, coins: 500, badgeCode: 'BADGE_STREAK_100' },
];

const GUILD_TOP_COINS = [150, 100, 60];

/** Weekly reward per active member of a ranked guild; `rank` starts at 1. */
export function guildWeeklyReward(rank: number): {
  coins: number;
  badgeCode: string | null;
} {
  return {
    coins: GUILD_TOP_COINS[rank - 1] ?? 20,
    badgeCode: rank === 1 ? 'BADGE_GUILD_TOP1' : null,
  };
}

export const JOURNAL_XP = 15;
export const UNDO_WINDOW_SERVER_MS = 10000;
export const UNDO_WINDOW_UI_MS = 5000;
export const LATE_WINDOW_HOURS = 48;
