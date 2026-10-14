/* eslint-env jest */
// Test kit for the progress screens and the celebration host (used by *.test.tsx files; never imported by app code).
// It builds on the home-tab kit: the same whole app against the same stand-in server, which also answers
// `GET /progression`, `GET /day/history*` and `POST /inbox/read` as the real routes do.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import type { DayDetail, DaySummary, InboxItemStreakMilestone, Progression } from '../../../domain/contract/core.ts';
import { cumulativeXpForLevel, levelForXp, titleKeyForLevel } from '../../../domain/progression.ts';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { journeyTitle, historyTitle, levelsTitle, journeyRows } from '../../shared/i18n/vi/progression';
import { seeJourney } from '../../shared/i18n/vi/today';
import { celebratedKey } from '../../shared/storage/celebrated';
import { openToday, settle, USER, world } from '../dashboard/todayTestKit';

export { dayOf, fetchMock, installTodayTestEnv, meOf, openToday, queryClient, requested, settle, USER, world, writes } from '../dashboard/todayTestKit';
import { tabsSettled } from '../sync/syncTestKit';
export { app, seedQueue } from '../sync/syncTestKit';

/** A Friday: its week (Monday 12 to Sunday 18 October) has days before, the day itself and days after. */
export const FRIDAY = '2026-10-16';

/** The profile at `level` with `xpIntoLevel` XP into it (the numbers come from the domain, never typed). */
export function setLevel(level: number, xpIntoLevel = 340, more: Partial<Progression> = {}) {
  const { xpForNextLevel } = levelForXp(cumulativeXpForLevel(level));
  world.me = {
    ...world.me,
    progression: {
      ...(world.me.progression as Progression),
      xp: cumulativeXpForLevel(level) + xpIntoLevel,
      level,
      titleKey: titleKeyForLevel(level),
      xpIntoLevel,
      xpForNextLevel,
      ...more,
    },
  };
}

export const summary = (logicalDate: string, outcome: DaySummary['outcome'], more: Partial<DaySummary> = {}): DaySummary => ({
  logicalDate,
  outcome,
  storyDone: outcome === 'COMPLETED' ? 2 : 0,
  storyTotal: 2,
  waterMl: 0,
  caloriesIn: 0,
  workoutMinutes: 0,
  ...more,
});
/** What the stand-in knows of one date: its summary and its recorded actions. */
export function setHistory(date: string, outcome: DaySummary['outcome'], actions: DayDetail['actions'] = [], more: Partial<DaySummary> = {}) {
  world.history = { ...world.history, [date]: { summary: summary(date, outcome, more), actions } };
}

export const milestoneItem = (id: string, days: 7 | 30 | 100 = 7, coins = 50): InboxItemStreakMilestone => ({
  id,
  kind: 'STREAK_MILESTONE',
  createdAt: '2026-10-14T01:00:00.000Z',
  readAt: null,
  payload: { days, coins, badgeCode: `BADGE_STREAK_${days}` },
});

/** The level this device last celebrated, as an earlier run of the app left it. */
export const keepCelebrated = (level: number, userId = USER) => AsyncStorage.setItem(celebratedKey(userId), JSON.stringify(level));
export const keptCelebrated = async (userId = USER) => AsyncStorage.getItem(celebratedKey(userId));

const header = (name: string) => screen.findByRole('header', { name });
/** What a screen has just asked for (the profile, the day, then the history that follows the day) has landed inside act(). */
const landed = async () => {
  await settle();
  await settle();
  await settle();
};

/** The fourth tab. */
export async function openProfile(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('tab', { name: tabLabel.Profile }));
  await header(tabLabel.Profile);
  await landed();
  await tabsSettled();
  return view;
}
/** Hôm nay, then "xem hành trình". */
export async function openJourney(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('link', { name: seeJourney }));
  await header(journeyTitle);
  await landed();
  return view;
}
/** The journey, then its history row. */
export async function openHistory(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openJourney(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${journeyRows.history.title}`) }));
  await header(historyTitle);
  await landed();
  return view;
}
/** The journey, then its levels row. */
export async function openLevels(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openJourney(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${journeyRows.levels.title}`) }));
  await header(levelsTitle);
  await landed();
  return view;
}

/** Every string drawn on screen, in order. */
export function allText(): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') {
      const { children } = node as { children?: unknown[] | null };
      (children ?? []).forEach(walk);
    }
  };
  const tree = screen.toJSON();
  (Array.isArray(tree) ? tree : [tree]).forEach(walk);
  return out;
}
