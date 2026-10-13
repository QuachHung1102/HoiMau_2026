/* eslint-env jest */
// Test kit for the home tab and its water tracker (used by *.test.tsx files; never imported by app code).
// The whole app as App.tsx mounts it (the sync kit), opened on the first tab, against a small stand-in for the day
// routes of the server: it keeps a day and a profile, applies a tick or an undo to both, and answers as the API
// contract says. The real routes do not exist yet (server Task 20).
import { screen } from '@testing-library/react-native';
import type { ActionResult, GameEvent } from '../../../domain/contract/common.ts';
import type { DayState, Me, QuestState, Settings } from '../../../domain/contract/core.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { cumulativeXpForLevel, titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { clearCelebrations } from '../progression/celebrations';
import { tickPath, WATER } from '../quests/api';
import { fetchMock, installSyncTestEnv, mountApp, refuse, respond, settle, USER, writes } from '../sync/syncTestKit';

export { app, fetchMock, idsOnDisk, queryClient, refuse, requested, respond, seedQueue, settle, stored, USER, writes } from '../sync/syncTestKit';

const BASE = 'http://localhost:8787/api/v1';
const HOUR = 60 * 60 * 1000;
const LEVEL = 5;
export const TICK = `POST ${tickPath(WATER)}`;
export const UNDO = `POST /day/quests/${WATER}/undo`;

const quest = (code: string, category: QuestState['category'], xpReward: number, coinReward: number, more: Partial<QuestState> = {}): QuestState => ({
  code,
  category,
  titleKey: code,
  progress: 0,
  targetCount: 1,
  completed: false,
  xpReward,
  coinReward,
  locked: false,
  lastTick: null,
  ...more,
});

/** A day in progress that closes six hours from now: 3 of 8 parts of water, nothing else done. */
export function dayOf(more: Partial<DayState> = {}, water: Partial<QuestState> = {}): DayState {
  const now = Date.now();
  return {
    logicalDate: '2026-10-14',
    serverTime: new Date(now).toISOString(),
    closesAt: new Date(now + 6 * HOUR).toISOString(),
    caloriesIn: 1650,
    waterMl: 750,
    waterTargetMl: 2000,
    bedtimeMarkedAt: null,
    calorieWindow: calorieWindow(2394),
    quests: [
      quest('WORKOUT_MAIN', 'STORY', 50, 20),
      quest('NUTRITION_TARGET', 'STORY', 50, 20),
      quest(WATER, 'DAILY', 10, 5, { progress: 3, targetCount: 8, lastTick: { id: '8a3f6c1e-2b47-4d19-9c05-71e2a4b6d803', at: new Date(now - HOUR).toISOString() }, ...water }),
      quest('STAND_UP', 'DAILY', 10, 5, { targetCount: 6 }),
      quest('BEDTIME_BEFORE_23', 'HIDDEN', 30, 15, { locked: true }),
    ],
    story: { done: 0, total: 2 },
    streak: { current: 4, best: 9 },
    unreadCount: 1,
    celebrations: [],
    ...more,
  };
}

export function meOf(more: Partial<Me> = {}): Me {
  return {
    user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: 'TANKER', archetypeChangeAvailableAt: null, onboarded: true },
    progression: {
      xp: cumulativeXpForLevel(LEVEL) + 340,
      level: LEVEL,
      titleKey: titleKeyForLevel(LEVEL),
      xpIntoLevel: 340,
      xpForNextLevel: xpRequiredForLevel(LEVEL),
      coin: 250,
      streakCurrent: 4,
      streakBest: 9,
      perkPointsAvailable: 0,
      milestones: [
        { days: 7, achieved: true },
        { days: 30, achieved: false },
        { days: 100, achieved: false },
      ],
      lastOutcome: 'COMPLETED',
      breakNotice: null,
    },
    stats: { hp: 26, en: 69, str: 40, spd: 30 },
    pet: { stage: 'HATCHLING', stageIndex: 1, growthPercent: 64, mood: 'HAPPY', skinCode: 'SKIN_DEFAULT', nextStage: 'JUVENILE' },
    appearance: { themeCode: 'default', petSkinCode: 'SKIN_DEFAULT', badgeCode: null },
    ...more,
  };
}

export const settingsOf = (more: Partial<Settings> = {}): Settings => ({
  nudgesEnabled: true,
  reminderEnabled: false,
  reminderWindow: 'EVENING',
  hideStreak: false,
  soundEnabled: false,
  motion: 'SYSTEM',
  excludedMealTags: [],
  ...more,
});

type Init = Parameters<typeof fetchMock>[1];
/**
 * The stand-in server. A test changes `day`, `me`, `settings`; sets `down` for "no connection"; puts game events in
 * `events` for the next tick's answer; or takes a request over with `answer` ("METHOD /path" -> a response, a
 * promise of one, or undefined to let the server answer).
 */
export const world = {} as {
  day: DayState;
  me: Me;
  settings: Settings;
  down: boolean;
  events: GameEvent[];
  answer?: (request: string, init: Init) => unknown;
};

const water = () => world.day.quests.find(item => item.code === WATER) as QuestState;
/** The numbers the server would change with one tick (or take back with an undo): they are its own, not the app's. */
function shift(by: 1 | -1, lastTick: QuestState['lastTick']): ActionResult['delta'] {
  const { xpReward, coinReward, targetCount } = water();
  const progress = water().progress + by;
  world.day = {
    ...world.day,
    waterMl: Math.round((world.day.waterTargetMl * progress) / targetCount),
    quests: world.day.quests.map(item => (item.code === WATER ? { ...item, progress, completed: progress >= targetCount, lastTick } : item)),
  };
  const { progression, stats } = world.me;
  if (progression && stats) {
    world.me = {
      ...world.me,
      progression: { ...progression, xp: progression.xp + by * xpReward, xpIntoLevel: progression.xpIntoLevel + by * xpReward, coin: progression.coin + by * coinReward },
      stats: { ...stats, hp: stats.hp + by * 5 },
    };
  }
  return { xp: by * xpReward, coin: by * coinReward, events: by === 1 ? world.events : [] };
}

const replies = new Map<string, unknown>();
/** What the stand-in server answers by itself; a test that takes a request over can still let it happen. */
export function serverAnswer(request: string, init: Init): unknown {
  if (world.down) throw new TypeError('Network request failed');
  if (request === 'GET /me') return respond(200, world.me);
  if (request === 'GET /day') return respond(200, world.day);
  if (request === 'GET /settings') return respond(200, world.settings);
  if (request === 'POST /auth/logout') return respond(204);
  if (request !== TICK && request !== UNDO) return respond(404);
  // An Idempotency-Key that was answered before gets the same answer again.
  const key = init.headers['Idempotency-Key'];
  if (!replies.has(key)) replies.set(key, request === TICK ? tick(key) : undo(key, JSON.parse(init.body ?? '{}').tickId));
  return replies.get(key);
}
function tick(id: string) {
  if (water().progress >= water().targetCount) return refuse(409, 'QUEST_ALREADY_COMPLETE');
  const delta = shift(1, { id, at: new Date().toISOString() });
  return respond(200, { actionId: id, day: world.day, delta } satisfies ActionResult);
}
function undo(id: string, tickId: string) {
  if (water().lastTick?.id !== tickId) return refuse(409, 'UNDO_NOT_LATEST');
  const delta = shift(-1, null);
  return respond(200, { actionId: id, day: world.day, delta } satisfies ActionResult);
}

/** Keeps every `request` open until `release`; then the given response, or the server's own answer, comes back. */
export function hold(request: string) {
  let open!: (answer: unknown) => void;
  const gate = new Promise<unknown>(resolve => (open = resolve));
  const before = world.answer;
  world.answer = (asked, init) => (asked === request ? gate.then(answer => answer ?? serverAnswer(asked, init)) : before?.(asked, init));
  return { release: (answer?: unknown) => open(answer) };
}

/** The app on its first tab, with the day loaded (or its first-load state when the day cannot be had). */
export async function openToday(options: Parameters<typeof mountApp>[0] = {}) {
  const view = await mountApp({ tab: 'Today', landed: false, ...options });
  await screen.findByRole('header', { name: tabLabel.Today });
  await settle();
  await settle(); // the tab shell's mount animations have ended (16 ms each in Jest's Animated)
  return view;
}

/** The ticks that reached the server, in order: the action id of each. */
export const tickIds = () =>
  writes()
    .filter(request => request.path === tickPath(WATER))
    .map(request => request.id);
export const undos = () => writes().filter(request => request.path === `/day/quests/${WATER}/undo`);

export function installTodayTestEnv() {
  installSyncTestEnv();
  beforeEach(() => {
    replies.clear();
    Object.assign(world, { day: dayOf(), me: meOf(), settings: settingsOf(), down: false, events: [], answer: undefined });
    fetchMock.mockImplementation(async (url, init) => {
      const request = `${init.method} ${url.replace(BASE, '')}`;
      const taken = await world.answer?.(request, init);
      return taken ?? serverAnswer(request, init);
    });
  });
  afterEach(() => clearCelebrations());
}
