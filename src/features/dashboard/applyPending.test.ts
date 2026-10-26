import type { DayState, QuestState } from '../../../domain/contract/core.ts';
import type { PendingAction } from '../../shared/storage/pendingActions';
import { applyPending } from './applyPending';

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
// The logical day 2026-10-14 in Asia/Ho_Chi_Minh: 03:00 local on the 14th until 03:00 on the 15th (20:00 UTC).
const day: DayState = {
  logicalDate: '2026-10-14',
  serverTime: '2026-10-14T02:00:00.000Z',
  closesAt: '2026-10-14T20:00:00.000Z',
  caloriesIn: 1650,
  waterMl: 750,
  waterTargetMl: 2000,
  bedtimeMarkedAt: null,
  calorieWindow: { min: 2155, max: 2633, target: 2394 },
  quests: [
    quest('WORKOUT_MAIN', { category: 'STORY', xpReward: 50, coinReward: 20 }),
    quest('NUTRITION_TARGET', { category: 'STORY', xpReward: 50, coinReward: 20 }),
    quest('WATER_8', { progress: 3, targetCount: 8, lastTick: { id: 't3', at: '2026-10-14T01:00:00.000Z' } }),
    quest('STAND_UP', { progress: 1, targetCount: 6 }),
    quest('BEDTIME_BEFORE_23', { category: 'HIDDEN', xpReward: 30, coinReward: 15, locked: true }),
  ],
  story: { done: 0, total: 2 },
  streak: { current: 4, best: 9 },
  unreadCount: 0,
  celebrations: [],
};
let n = 0;
const action = (path: string, body: Record<string, unknown> = {}, createdAt = '2026-10-14T02:30:00.000Z'): PendingAction => ({
  id: `a${(n += 1)}`,
  userId: 'u1',
  method: 'POST',
  path,
  body,
  createdAt,
  attempts: 1,
  status: 'queued',
});
const water = (createdAt?: string) => action('/day/quests/WATER_8/progress', {}, createdAt);
const progressOf = (state: DayState, code: string) => state.quests.find(q => q.code === code)?.progress;

test('nothing waiting: the day as the server gave it, nothing marked', () => {
  expect(applyPending(day, [])).toEqual({ ...day, pending: { ticks: {}, bedtime: false, kcal: 0 } });
});

test('waiting ticks are added to their own quest and marked; water in ml follows the parts', () => {
  const shown = applyPending(day, [water(), water(), action('/day/quests/STAND_UP/progress')]);
  expect(progressOf(shown, 'WATER_8')).toBe(5);
  expect(progressOf(shown, 'STAND_UP')).toBe(2);
  expect(shown.pending.ticks).toEqual({ WATER_8: 2, STAND_UP: 1 });
  // round(waterTarget x progress / 8), the server's own rule
  expect(shown.waterMl).toBe(Math.round((2000 * 5) / 8));
  // the latest tick the server knows is still the only one that can be undone
  expect(shown.quests.find(q => q.code === 'WATER_8')?.lastTick).toEqual({ id: 't3', at: '2026-10-14T01:00:00.000Z' });
});

test('the cap: 3 confirmed and 7 waiting show 8 of 8, of which 5 are marked', () => {
  const shown = applyPending(day, Array.from({ length: 7 }, () => water()));
  expect(progressOf(shown, 'WATER_8')).toBe(8);
  expect(shown.pending.ticks).toEqual({ WATER_8: 5 });
  expect(shown.waterMl).toBe(2000);
});

test('no reward is added: nothing is completed, the story count and the streak stay the server numbers', () => {
  const shown = applyPending(day, Array.from({ length: 5 }, () => water()));
  expect(progressOf(shown, 'WATER_8')).toBe(8);
  expect(shown.quests.every(q => !q.completed)).toBe(true);
  expect(shown.story).toEqual(day.story);
  expect(shown.streak).toEqual(day.streak);
});

test('a tick of a quest that is not in the day is not shown anywhere', () => {
  const shown = applyPending(day, [action('/day/quests/GONE/progress')]);
  expect(shown.quests).toEqual(day.quests);
  expect(shown.pending.ticks).toEqual({});
});

test('a waiting bedtime mark shows as marked at the time it was made, and is flagged', () => {
  const shown = applyPending(day, [action('/day/bedtime', {}, '2026-10-14T14:10:00.000Z')]);
  expect(shown.bedtimeMarkedAt).toBe('2026-10-14T14:10:00.000Z');
  expect(shown.pending.bedtime).toBe(true);
});

test('a bedtime mark the server already has is not replaced or flagged', () => {
  const marked = { ...day, bedtimeMarkedAt: '2026-10-14T13:00:00.000Z' };
  const shown = applyPending(marked, [action('/day/bedtime', {}, '2026-10-14T14:10:00.000Z')]);
  expect(shown.bedtimeMarkedAt).toBe('2026-10-14T13:00:00.000Z');
  expect(shown.pending.bedtime).toBe(false);
});

test('waiting manual kcal logs are added to the calories; a planned-meal log has no number to add', () => {
  const shown = applyPending(day, [
    action('/nutrition/log', { kcal: 320, label: 'x' }),
    action('/nutrition/log', { kcal: 80 }),
    action('/nutrition/log', { mealSlot: 'LUNCH' }),
  ]);
  expect(shown.caloriesIn).toBe(1650 + 320 + 80);
  expect(shown.pending.kcal).toBe(400);
  expect(shown.calorieWindow).toEqual(day.calorieWindow);
});

test('a workout waiting to be sent changes nothing here', () => {
  expect(applyPending(day, [action('/workout/complete', { id: 'w1', elapsedSec: 600 })])).toEqual({ ...day, pending: { ticks: {}, bedtime: false, kcal: 0 } });
});

test('records made before this logical day began are not shown in it', () => {
  const shown = applyPending(day, [
    water('2026-10-13T19:59:59.999Z'), // the last moment of the day before
    water('2026-10-13T20:00:00.000Z'), // the first moment of this day
    water('2026-10-14T19:59:59.999Z'), // its last moment
    action('/day/bedtime', {}, '2026-10-13T15:00:00.000Z'),
    action('/nutrition/log', { kcal: 500 }, '2026-10-13T12:00:00.000Z'),
  ]);
  expect(progressOf(shown, 'WATER_8')).toBe(5);
  expect(shown.bedtimeMarkedAt).toBeNull();
  expect(shown.caloriesIn).toBe(1650);
});

test('a record made after the close of the day on screen is shown on it: that day is on screen then only because the server still calls it today', () => {
  const shown = applyPending(day, [
    water('2026-10-14T20:00:00.000Z'), // the close itself, by this device's clock
    water('2026-10-14T20:04:00.000Z'),
    action('/day/bedtime', {}, '2026-10-14T20:05:00.000Z'),
    action('/nutrition/log', { kcal: 120 }, '2026-10-14T20:06:00.000Z'),
  ]);
  expect(progressOf(shown, 'WATER_8')).toBe(5);
  expect(shown.pending).toEqual({ ticks: { WATER_8: 2 }, bedtime: true, kcal: 120 });
});

test('the day passed in is left as it was', () => {
  const before = JSON.stringify(day);
  applyPending(day, [water(), action('/day/bedtime'), action('/nutrition/log', { kcal: 10 })]);
  expect(JSON.stringify(day)).toBe(before);
});
