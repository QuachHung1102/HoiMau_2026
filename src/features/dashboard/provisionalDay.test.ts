import type { DayState, QuestState } from '../../../domain/contract/core.ts';
import { provisionalDay } from './provisionalDay';

const quest = (code: string, more: Partial<QuestState> = {}): QuestState => ({
  code,
  category: 'DAILY',
  titleKey: code,
  progress: 0,
  targetCount: 1,
  completed: false,
  xpReward: 10,
  coinReward: 5,
  locked: false,
  lastTick: null,
  ...more,
});
// The logical day 2026-10-14 in Asia/Ho_Chi_Minh, as it ended: everything done, closed at 03:00 on the 15th (20:00 UTC).
const kept: DayState = {
  logicalDate: '2026-10-14',
  serverTime: '2026-10-14T16:00:00.000Z',
  closesAt: '2026-10-14T20:00:00.000Z',
  caloriesIn: 2380,
  waterMl: 2000,
  waterTargetMl: 2000,
  bedtimeMarkedAt: '2026-10-14T15:30:00.000Z',
  calorieWindow: { min: 2155, max: 2633, target: 2394 },
  quests: [
    quest('WORKOUT_MAIN', { category: 'STORY', xpReward: 50, coinReward: 20, progress: 1, completed: true }),
    quest('NUTRITION_TARGET', { category: 'STORY', xpReward: 50, coinReward: 20, progress: 1, completed: true }),
    quest('WATER_8', { progress: 8, targetCount: 8, completed: true, lastTick: { id: 't8', at: '2026-10-14T14:00:00.000Z' } }),
    quest('STAND_UP', { progress: 4, targetCount: 6, lastTick: { id: 's4', at: '2026-10-14T10:00:00.000Z' } }),
    quest('BEDTIME_BEFORE_23', { category: 'HIDDEN', xpReward: 30, coinReward: 15, progress: 1, completed: true }),
  ],
  story: { done: 2, total: 2 },
  streak: { current: 4, best: 9 },
  unreadCount: 2,
  celebrations: [{ id: 'c1', kind: 'STREAK_MILESTONE', payload: { days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' }, createdAt: '2026-10-14T20:00:01.000Z', readAt: null }],
};
const at = (iso: string) => Date.parse(iso);

test('the morning after: the next logical day, closing 24 h later, with the same quests and targets and nothing done', () => {
  const today = provisionalDay(kept, at('2026-10-14T23:30:00.000Z'));
  expect(today.logicalDate).toBe('2026-10-15');
  expect(today.closesAt).toBe('2026-10-15T20:00:00.000Z');
  // the same quest list, in the same order, with the same targets and rewards
  expect(today.quests.map(q => [q.code, q.category, q.titleKey, q.targetCount, q.xpReward, q.coinReward])).toEqual(
    kept.quests.map(q => [q.code, q.category, q.titleKey, q.targetCount, q.xpReward, q.coinReward]),
  );
  // nothing of yesterday is carried over as done
  expect(today.quests.every(q => q.progress === 0 && !q.completed && q.lastTick === null)).toBe(true);
  expect(today.story).toEqual({ done: 0, total: 2 });
  expect(today.waterMl).toBe(0);
  expect(today.caloriesIn).toBe(0);
  expect(today.bedtimeMarkedAt).toBeNull();
  // the targets are the kept ones
  expect(today.waterTargetMl).toBe(2000);
  expect(today.calorieWindow).toEqual(kept.calorieWindow);
  // yesterday's milestone is not celebrated again from a guess
  expect(today.celebrations).toEqual([]);
  // whether there is unread mail this morning is not known: none is claimed
  expect(today.unreadCount).toBe(0);
});

test.each([
  ['at the very moment the kept day closed', '2026-10-14T20:00:00.000Z', '2026-10-15', '2026-10-15T20:00:00.000Z'],
  ['one millisecond before the next close', '2026-10-15T19:59:59.999Z', '2026-10-15', '2026-10-15T20:00:00.000Z'],
  ['two days later', '2026-10-16T01:00:00.000Z', '2026-10-16', '2026-10-16T20:00:00.000Z'],
  ['nine days later, over a month end', '2026-10-23T20:00:00.000Z', '2026-10-24', '2026-10-24T20:00:00.000Z'],
  ['over a year end', '2027-01-01T05:00:00.000Z', '2027-01-01', '2027-01-01T20:00:00.000Z'],
])('%s: the day that is open now, closing in the future', (_name, now, logicalDate, closesAt) => {
  const today = provisionalDay(kept, at(now));
  expect(today.logicalDate).toBe(logicalDate);
  expect(today.closesAt).toBe(closesAt);
  expect(Date.parse(today.closesAt)).toBeGreaterThan(at(now));
  expect(Date.parse(today.closesAt) - at(now)).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
});

test('the kept day is left as it was', () => {
  const before = JSON.stringify(kept);
  provisionalDay(kept, at('2026-10-16T01:00:00.000Z'));
  expect(JSON.stringify(kept)).toBe(before);
});
