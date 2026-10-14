import type { DayDetail, DaySummary, Me, Progression } from '../../../domain/contract/core.ts';
import { cumulativeXpForLevel, levelForXp, titleKeyForLevel } from '../../../domain/progression.ts';
import { CelebrationOverlay } from '../../../src/features/progression/CelebrationHost';
import { dayDetailKey, historyRangeKey, progressionKey } from '../../../src/features/progression/api';
import { withApp, type Entries } from '../harness';
import names from './progressionNames.json';
import { app, dayOf, meOf } from './today';

// The names of the meal and the workout are server data, kept in a JSON file (no Vietnamese text in a source file).
// Illustrative values, as in the frames: level 5 with 340 XP into it, a record of 12 days. The week is Monday 12 to Sunday 18
// October 2026 (the server's labels; the preview never reads a calendar).
const FRIDAY = '2026-10-16';
const MONDAY = '2026-10-12';
const at = (time: string) => `2026-10-14T${time}:00.000Z`;

const progressionOf = (more: Partial<Progression> = {}): Progression => {
  const level = 5;
  const { xpForNextLevel } = levelForXp(cumulativeXpForLevel(level));
  return {
    xp: cumulativeXpForLevel(level) + 340,
    level,
    titleKey: titleKeyForLevel(level),
    xpIntoLevel: 340,
    xpForNextLevel,
    coin: 250,
    streakCurrent: 4,
    streakBest: 12,
    perkPointsAvailable: 1,
    milestones: [
      { days: 7, achieved: true },
      { days: 30, achieved: false },
      { days: 100, achieved: false },
    ],
    lastOutcome: 'COMPLETED',
    breakNotice: null,
    ...more,
  };
};
const summary = (logicalDate: string, outcome: DaySummary['outcome'], more: Partial<DaySummary> = {}): DaySummary => ({
  logicalDate,
  outcome,
  storyDone: outcome === 'COMPLETED' ? 2 : 0,
  storyTotal: 2,
  waterMl: 0,
  caloriesIn: 0,
  workoutMinutes: 0,
  ...more,
});
const withProgression = (more: Partial<Progression> = {}): Me => {
  const progression = progressionOf(more);
  return meOf(progression.xpIntoLevel, progression.coin, 26, { progression });
};

/** The week through Friday, as the server would give it. */
const week = (outcomes: DaySummary['outcome'][]) => ({
  days: outcomes.map((outcome, index) => summary(`2026-10-${12 + index}`, outcome)),
});

const frozenWeek = week(['COMPLETED', 'FROZEN', 'COMPLETED', 'COMPLETED', 'OPEN']);
const plainWeek = week(['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'OPEN']);

const todayDetail = (actions: DayDetail['actions'], more: Partial<DaySummary> = {}): DayDetail => ({ summary: summary('2026-10-14', 'OPEN', more), actions });

const journey = (name: string, progression: Progression, history: ReturnType<typeof week>, date = FRIDAY) =>
  [name, () => app({ route: 'Journey', me: withProgression(progression), day: dayOf(3, { logicalDate: date }), queries: [[progressionKey, progression], [historyRangeKey(MONDAY, date), history]] })] as const;

export const entries: Entries = {
  's31-profile': () => app({ route: 'Profile' }),
  ...Object.fromEntries([
    journey('s21-journey', progressionOf(), plainWeek),
    journey('s21-journey-frozen-day', progressionOf(), frozenWeek),
    // The streak has just ended, on the first day of a new week: every mark is an empty ring, the record stays.
    journey('s67-journey-restart', progressionOf({ streakCurrent: 0, breakNotice: { previous: 12, date: '2026-10-11' } }), week(['OPEN']), MONDAY),
  ]),
  's51-day-history': () =>
    app({
      route: 'DayHistory',
      queries: [
        [
          dayDetailKey('2026-10-14'),
          todayDetail(
            [
              { id: 'a4', kind: 'BEDTIME', at: at('15:30'), mealSlot: null, label: null, value: null, undone: false },
              { id: 'a3', kind: 'WORKOUT', at: at('10:10'), mealSlot: null, label: names.workout, value: 1500, undone: false },
              { id: 'a2', kind: 'NUTRITION', at: at('05:00'), mealSlot: 'LUNCH', label: names.meal, value: 450, undone: false },
              { id: 'a1', kind: 'TICK', at: at('01:10'), mealSlot: null, label: 'WATER_8', value: null, undone: true },
              { id: 'a0', kind: 'TICK', at: at('00:45'), mealSlot: null, label: 'WATER_8', value: null, undone: false },
            ],
            { storyDone: 1, waterMl: 250, caloriesIn: 450, workoutMinutes: 25 },
          ),
        ],
      ],
    }),
  's51-day-history-empty': () => app({ route: 'DayHistory', queries: [[dayDetailKey('2026-10-14'), todayDetail([])]] }),
  's46-levels': () => app({ route: 'Levels', me: withProgression(), queries: [[progressionKey, progressionOf()]] }),
  // The two overlays are what CelebrationHost puts on screen (its own component), with the final card of a reduced-motion run.
  's65-level-up-overlay': () =>
    withApp(<CelebrationOverlay shown={{ id: 'level-up:5', kind: 'LEVEL_UP', level: 5, titleKey: 'NGUOI_KIEN_TRI', points: 1 }} stage="HATCHLING" onClose={() => undefined} onSee={() => undefined} />, {
      motion: 'REDUCED',
    }),
  's66-milestone-overlay': () =>
    withApp(<CelebrationOverlay shown={{ id: 'item-7', kind: 'STREAK_MILESTONE', days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' }} stage="HATCHLING" onClose={() => undefined} onSee={() => undefined} />, {
      motion: 'REDUCED',
    }),
};
