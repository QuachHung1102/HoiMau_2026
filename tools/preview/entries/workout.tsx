import { useEffect } from 'react';
import type { WorkoutCatalog, WorkoutDetail, WorkoutResult } from '../../../domain/contract/content.ts';
import type { DayState } from '../../../domain/contract/core.ts';
import { catalogKey, workoutKey, type CatalogFilters } from '../../../src/features/workout/api';
import fixture from '../../../src/features/workout/workoutFixture.json';
import * as vi from '../../../src/shared/i18n/vi/workout';
import type { Entries } from '../harness';
import { app, dayOf } from './today';

// The answers of the server for a person who has 15 minutes, a room and no equipment: values copied from the real
// content (server/content/exercises.ts) by .superpowers/sdd/evidence/task-27/make-fixture.mjs.
const catalog = { items: fixture.catalog } as unknown as WorkoutCatalog;
const detail = fixture.detail as unknown as WorkoutDetail;
const START: CatalogFilters = { duration: 15, space: 'ROOM', equipment: [] };
const withDetail: [readonly unknown[], unknown][] = [[workoutKey(detail.id), detail]];

/**
 * shot.mjs cannot press anything or wait: this does the steps in order, each one tried every 50 ms until it says it
 * is done.
 */
function Script({ steps }: { steps: readonly (() => boolean)[] }) {
  useEffect(() => {
    let next = 0;
    const timer = setInterval(() => {
      if (next >= steps.length) return clearInterval(timer);
      if (steps[next]()) next += 1;
    }, 50);
    return () => clearInterval(timer);
  }, [steps]);
  return null;
}
const press = (text: string) => () => {
  const control = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(item => item.textContent === text);
  control?.click();
  return control !== undefined;
};
const shown = (text: string) => () => [...document.querySelectorAll('[dir="auto"]')].some(item => item.textContent === text);
/** The session has begun; from now on the device clock is `seconds` further: the countdown follows it at its next look. */
const afterTraining = (seconds: number) => () => {
  if (!shown(vi.remaining)()) return false;
  const real = Date.now.bind(Date);
  Date.now = () => real() + seconds * 1000;
  return true;
};
const session = (...steps: (() => boolean)[]) => app({ route: 'FocusSession', params: { id: detail.id }, queries: withDetail, extra: <Script steps={steps} /> });

// What the server answers to a recorded session (AR-11): at least half completes the quest (the rest of its 50 XP
// and 20 coins), less gives its share of the XP and no coins.
const result = (elapsedSec: number): WorkoutResult => {
  const completed = elapsedSec * 2 >= detail.durationSec;
  const xp = completed ? 50 : Math.floor((50 * elapsedSec) / detail.durationSec);
  const day: DayState = dayOf();
  return {
    completed,
    xpAwarded: xp,
    coinAwarded: completed ? 20 : 0,
    elapsedSec,
    durationSec: detail.durationSec,
    day: { ...day, quests: day.quests.map(quest => (quest.code === 'WORKOUT_MAIN' ? { ...quest, completed, progress: completed ? 1 : 0 } : quest)), story: { done: completed ? 1 : 0, total: 2 } },
    delta: { xp, coin: completed ? 20 : 0, events: [] },
  };
};
// 06:18 of 15:00, as in frames S63 and S64.
const PART = 6 * 60 + 18;

export const entries: Entries = {
  's12-plan': () => app({ route: 'Plan' }),
  's17-catalog': () => app({ route: 'WorkoutCatalog', queries: [[catalogKey(START), catalog]] }),
  's48-catalog-empty': () => app({ route: 'WorkoutCatalog', queries: [[catalogKey(START), { items: [] } satisfies WorkoutCatalog]] }),
  's18-workout-detail': () => app({ route: 'WorkoutDetail', params: { id: detail.id }, queries: withDetail }),
  's19-focus-session': () => session(afterTraining(PART), shown('08:42')),
  's41-focus-paused': () => session(afterTraining(PART), shown('08:42'), press(vi.pause)),
  's63-exit-dialog': () => session(afterTraining(PART), shown('08:42'), press(vi.endSession)),
  's20-result-completed': () => app({ route: 'WorkoutResult', params: { result: result(detail.durationSec) } }),
  's64-result-partial': () => app({ route: 'WorkoutResult', params: { result: result(PART) } }),
  // Ended after ten minutes with no network (no fetch stub: every request fails): kept on this device, no reward named.
  's20-result-queued': () => session(afterTraining(600), shown('05:00'), press(vi.endSession), press(vi.endAndSave)),
};
