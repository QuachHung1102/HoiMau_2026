import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { DayState, Me, QuestState, Settings } from '../../../domain/contract/core.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { cumulativeXpForLevel, titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { AppNavigation, stateForRoute } from '../../../src/app/navigation';
import type { RouteName } from '../../../src/app/routes';
import { meKey } from '../../../src/features/auth/api';
import { dayKey, settingsKey, tickPath, WATER } from '../../../src/features/quests/api';
import { PendingBanner } from '../../../src/features/sync/PendingBanner';
import { waterTitle } from '../../../src/shared/i18n/vi/quests';
import { withApp, type Entries } from '../harness';

export const USER = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';
const HOUR = 60 * 60 * 1000;
const LEVEL = 5;

export const quest = (code: string, category: QuestState['category'], xpReward: number, coinReward: number, more: Partial<QuestState> = {}): QuestState => ({
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
// Illustrative values, as in frame S09: 3 of 8 parts, 1.650 of 2.394 kcal, a streak of 4 days, one unread letter.
export const dayOf = (parts = 3, more: Partial<DayState> = {}): DayState => ({
  logicalDate: '2026-10-14',
  serverTime: new Date().toISOString(),
  closesAt: new Date(Date.now() + 6 * HOUR).toISOString(),
  caloriesIn: 1650,
  waterMl: Math.round((2000 * parts) / 8),
  waterTargetMl: 2000,
  bedtimeMarkedAt: null,
  calorieWindow: calorieWindow(2394),
  quests: [
    quest('WORKOUT_MAIN', 'STORY', 50, 20),
    quest('NUTRITION_TARGET', 'STORY', 50, 20),
    quest(WATER, 'DAILY', 10, 5, { progress: parts, targetCount: 8 }),
    quest('STAND_UP', 'DAILY', 10, 5, { targetCount: 6 }),
    quest('BEDTIME_BEFORE_23', 'HIDDEN', 30, 15, { locked: true }),
  ],
  story: { done: 0, total: 2 },
  streak: { current: 4, best: 9 },
  unreadCount: 1,
  celebrations: [],
  ...more,
});
// Level 5 with 340 XP into it, 250 coins, the four stats of the frame.
export const meOf = (xpIntoLevel = 340, coin = 250, hp = 26, more: Partial<Me> = {}): Me => ({
  user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: 'TANKER', archetypeChangeAvailableAt: null, onboarded: true },
  progression: {
    xp: cumulativeXpForLevel(LEVEL) + xpIntoLevel,
    level: LEVEL,
    titleKey: titleKeyForLevel(LEVEL),
    xpIntoLevel,
    xpForNextLevel: xpRequiredForLevel(LEVEL),
    coin,
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
  stats: { hp, en: 69, str: 40, spd: 30 },
  pet: { stage: 'HATCHLING', stageIndex: 1, growthPercent: 64, mood: 'HAPPY', skinCode: 'SKIN_DEFAULT', nextStage: 'JUVENILE' },
  appearance: { themeCode: 'default', petSkinCode: 'SKIN_DEFAULT', badgeCode: null },
  ...more,
});
export const settingsOf = (hideStreak = false): Settings => ({
  nudgesEnabled: true,
  reminderEnabled: false,
  reminderWindow: 'EVENING',
  hideStreak,
  soundEnabled: false,
  motion: 'SYSTEM',
  excludedMealTags: [],
});

export const respond = (status: number, body?: unknown) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
export const pathOf = (url: string) => url.slice(url.indexOf('/api/v1') + '/api/v1'.length);

/** Puts what an earlier run of the app would have left on disk, then mounts the app. */
function Seeded({ storage, children }: { storage: Record<string, unknown>; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    AsyncStorage.setMany(Object.fromEntries(Object.entries(storage).map(([key, value]) => [key, JSON.stringify(value)]))).then(() => setReady(true));
  }, [storage]);
  return ready ? <>{children}</> : null;
}

/** shot.mjs cannot press anything: this presses the water tracker once it is on the page. */
function PressTracker() {
  useEffect(() => {
    const timer = setInterval(() => {
      const row = document.querySelector<HTMLElement>(`[aria-label^="${waterTitle}"]`);
      if (!row) return;
      clearInterval(timer);
      row.click();
    }, 50);
    return () => clearInterval(timer);
  }, []);
  return null;
}

type Options = {
  route?: RouteName;
  /** null: nothing in the query cache (the day comes from what the storage holds, as on a cold start). */
  day?: DayState | null;
  me?: Me;
  settings?: Settings;
  storage?: Record<string, unknown>;
  fetchStub?: (url: string, init?: RequestInit) => unknown;
  extra?: ReactNode;
};
const nothingStored = {};

/**
 * The app as App.tsx lays it out (the S38 row above the navigators), signed in, with the day, the profile and the
 * settings already in the query cache. Reduced motion: the screenshot is taken at once, not in the middle of an
 * animation, so the undo countdown is the text "Còn 5 giây" instead of the shrinking bar.
 */
export const app = ({ route = 'Today', day = dayOf(), me = meOf(), settings = settingsOf(), storage = nothingStored, fetchStub, extra }: Options = {}) =>
  withApp(
    <Seeded storage={storage}>
      <View style={styles.fill}>
        <PendingBanner />
        <AppNavigation initialState={stateForRoute(route)} />
      </View>
      {extra}
    </Seeded>,
    {
      session: { userId: USER },
      motion: 'REDUCED',
      queries: [[meKey, me], ...(day ? [[dayKey, day] as [readonly unknown[], unknown]] : []), [settingsKey, settings]],
      fetchStub,
    },
  );

/** A server that answers the tick with `tick` and every later read with the state after it. */
const serverAfterTick = (tick: (key: string) => unknown, day: DayState, me: Me) => (url: string, init?: RequestInit) => {
  const path = pathOf(url);
  if (init?.method === 'POST') return tick((init.headers as Record<string, string>)['Idempotency-Key']);
  return path === '/day' ? respond(200, day) : path === '/me' ? respond(200, me) : path === '/settings' ? respond(200, settingsOf()) : respond(404);
};

const waiting = (id: string) => ({ id, userId: USER, method: 'POST', path: tickPath(WATER), body: {}, createdAt: new Date().toISOString(), attempts: 0, status: 'queued' });

export const entries: Entries = {
  's09-today': () => app(),
  's09-today-streak-hidden': () => app({ settings: settingsOf(true) }),
  's09-today-mam-tired': () =>
    app({
      day: dayOf(0, { streak: { current: 0, best: 9 }, unreadCount: 0 }),
      me: meOf(340, 250, 0, { pet: { stage: 'HATCHLING', stageIndex: 1, growthPercent: 64, mood: 'TIRED', skinCode: 'SKIN_DEFAULT', nextStage: 'JUVENILE' } }),
    }),
  // One part recorded and confirmed: the server's answer gives 4 of 8, +10 XP, and the profile read after it 255 coins.
  's57-today-just-recorded': () => {
    const after = dayOf(4);
    const result = (key: string): ActionResult => ({ actionId: key, day: after, delta: { xp: 10, coin: 5, events: [] } });
    return app({ fetchStub: serverAfterTick(key => respond(200, result(key)), after, meOf(350, 255, 31)), extra: <PressTracker /> });
  },
  // One part recorded and refused by the server.
  's58-today-not-saved': () =>
    app({
      fetchStub: serverAfterTick(() => respond(409, { error: { code: 'QUEST_ALREADY_COMPLETE', message: 'preview' } }), dayOf(), meOf()),
      extra: <PressTracker />,
    }),
  // Two parts recorded without a network (no fetch stub: every request fails), found again at the next start.
  's09-today-pending': () =>
    app({ storage: { [`pending:v1:${USER}`]: [waiting('8a3f6c1e-2b47-4d19-9c05-71e2a4b6d801'), waiting('8a3f6c1e-2b47-4d19-9c05-71e2a4b6d802')] } }),
  // The morning after, without a network: the day kept on this device is over (everything in it was done), so a
  // provisional day is shown, and the first part recorded on it waits.
  's09-today-new-day-offline': () =>
    app({
      day: null,
      storage: {
        [`cache:v1:${USER}:day`]: dayOf(8, { closesAt: new Date(Date.now() - 2 * HOUR).toISOString(), caloriesIn: 2380, story: { done: 2, total: 2 } }),
        [`pending:v1:${USER}`]: [waiting('8a3f6c1e-2b47-4d19-9c05-71e2a4b6d804')],
      },
    }),
  's47-stats-explainer': () => app({ route: 'StatsExplainer' }),
};

const styles = StyleSheet.create({ fill: { flex: 1 } });
