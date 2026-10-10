import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  JOURNAL_XP,
  LATE_WINDOW_HOURS,
  PERKS,
  STREAK_MILESTONES,
  SWAPS_PER_SLOT,
  TICKET_CAP,
  UNDO_WINDOW_SERVER_MS,
  UNDO_WINDOW_UI_MS,
  guildWeeklyReward,
} from './economy.ts';

test('economy constants are the plan values (R-D05, R-D07)', () => {
  assert.deepEqual(PERKS, {
    MEAL_SWAP_PLUS: { cost: 2 },
    TICKET_CAP_PLUS: { cost: 3 },
    THEME_UNLOCK: { cost: 1 },
  });
  assert.deepEqual(SWAPS_PER_SLOT, { base: 3, withPerk: 5 });
  assert.deepEqual(TICKET_CAP, { base: 2, withPerk: 3 });
  assert.deepEqual(STREAK_MILESTONES, [
    { days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' },
    { days: 30, coins: 200, badgeCode: 'BADGE_STREAK_30' },
    { days: 100, coins: 500, badgeCode: 'BADGE_STREAK_100' },
  ]);
  assert.equal(JOURNAL_XP, 15);
  assert.equal(UNDO_WINDOW_SERVER_MS, 10000);
  assert.equal(UNDO_WINDOW_UI_MS, 5000);
  assert.equal(LATE_WINDOW_HOURS, 48);
});

test('guildWeeklyReward: 150 + badge, 100, 60, then 20 for any other rank', () => {
  assert.deepEqual(guildWeeklyReward(1), {
    coins: 150,
    badgeCode: 'BADGE_GUILD_TOP1',
  });
  assert.deepEqual(guildWeeklyReward(2), { coins: 100, badgeCode: null });
  assert.deepEqual(guildWeeklyReward(3), { coins: 60, badgeCode: null });
  assert.deepEqual(guildWeeklyReward(4), { coins: 20, badgeCode: null });
  assert.deepEqual(guildWeeklyReward(50), { coins: 20, badgeCode: null });
});
