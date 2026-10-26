import { useEffect, type ReactElement } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { poses } from '../../../src/assets/motion/poses';
import { moves, Rig, tracksOf } from '../../../src/features/workout/rig';
import type { WorkoutCatalog, WorkoutDetail, WorkoutResult } from '../../../domain/contract/content.ts';
import type { DayState } from '../../../domain/contract/core.ts';
import { catalogKey, workoutKey, type CatalogFilters } from '../../../src/features/workout/api';
import fixture from '../../../src/features/workout/workoutFixture.json';
import { retry } from '../../../src/shared/i18n/vi/common';
import * as vi from '../../../src/shared/i18n/vi/workout';
import { meKey } from '../../../src/features/auth/api';
import { dayKey, settingsKey } from '../../../src/features/quests/api';
import type { RouteName } from '../../../src/app/routes';
import { beginDrive, withApp, type Entries } from '../harness';
import { app, dayOf, meOf, pathOf, respond, settingsOf, USER } from './today';

// The answers of the server for a person who has 15 minutes, a room and no equipment: values copied from the real
// content (server/content/exercises.ts): the catalog items and the starter workout as the routes answer them.
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
    const done = beginDrive();
    let next = 0;
    const timer = setInterval(() => {
      if (steps[next]()) next += 1;
      if (next < steps.length) return;
      clearInterval(timer);
      done();
    }, 50);
    return () => {
      clearInterval(timer);
      done();
    };
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
const session = (steps: (() => boolean)[], fetchStub?: (url: string, init?: RequestInit) => unknown) =>
  app({ route: 'FocusSession', params: { id: detail.id }, queries: withDetail, fetchStub, extra: <Script steps={steps} /> });

/** No answer to the first send of the session; every later send of it is refused because its day has closed. */
const refusedLater = () => {
  let sends = 0;
  return (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if ((sends += 1) === 1) throw new TypeError('Network request failed');
      return respond(409, { error: { code: 'DAY_CLOSED', message: 'preview' } });
    }
    const path = pathOf(url);
    return path === '/day' ? respond(200, dayOf()) : path === '/me' ? respond(200, meOf()) : path === '/settings' ? respond(200, settingsOf()) : respond(404);
  };
};

// ---- The demos. app() takes its screenshots under reduced motion; these show the moving figure. ----
type Move = WorkoutDetail['steps'][number]['move'];
/** The workout with the move of step `index` replaced (moves of the real content, copied from server/content/exercises.ts). */
const withMove = (index: number, move: Move, repsText?: string): WorkoutDetail => ({
  ...detail,
  steps: detail.steps.map((step, i) => (i === index ? { ...step, move, repsText: repsText ?? step.repsText } : step)),
});
const NECK_TILT: Move = {
  code: 'NGHIENG_CO',
  name: 'Nghiêng cổ nhẹ',
  demoCode: 'exercise-nghieng-co-nhe',
  steps: ['Ngồi hoặc đứng thẳng, vai thả lỏng.', 'Nghiêng tai về phía vai phải đến khi thấy giãn nhẹ, rồi trở về giữa.', 'Làm tương tự sang bên trái, thật chậm rãi.'],
  caution: 'Không xoay tròn cổ hay vặn mạnh. Dừng nếu cổ đau, tê tay hoặc chóng mặt.',
};
const BOX_BREATH: Move = {
  code: 'THO_VUONG',
  name: 'Thở vuông',
  demoCode: 'exercise-tho-vuong',
  steps: ['Ngồi thoải mái, lưng thẳng.', 'Hít vào 4 giây, giữ hơi nhẹ 4 giây, thở ra 4 giây, nghỉ nhẹ 4 giây.', 'Lặp lại theo nhịp, giữ mặt và vai thả lỏng.'],
  caution: 'Rút ngắn quãng giữ hơi nếu thấy tức ngực hay hồi hộp. Nếu thấy chóng mặt, quay về thở bình thường.',
};
const BODY_SCAN: Move = {
  code: 'QUET_CO_THE',
  name: 'Thả lỏng từng vùng',
  demoCode: 'exercise-tha-long-tung-vung',
  steps: ['Ngồi hoặc nằm thoải mái ở nơi an toàn.', 'Chú ý lần lượt từ trán, vai, tay, bụng đến chân.', 'Ở mỗi vùng, thở ra và thả lỏng cơ.'],
  caution: 'Không làm khi đang lái xe. Dừng và thở bình thường nếu thấy chóng mặt hoặc không thoải mái.',
};
const FOUR_FOUR: Move = {
  code: 'THO_4_4',
  name: 'Thở 4-4',
  demoCode: 'focus-breathe',
  steps: ['Ngồi hoặc đứng thoải mái, một tay đặt lên bụng.', 'Hít vào bằng mũi trong 4 giây.', 'Thở ra từ từ trong 4 giây, rồi lặp lại theo nhịp.'],
  caution: 'Thở nhẹ, không gắng sức. Nếu thấy chóng mặt, dừng lại và thở tự nhiên.',
};
const SQUAT = detail.steps[1];
/** The app on `route`, signed in, with `workout` in the cache, and motion on. */
const moving = (name: RouteName, params: object, workout: WorkoutDetail = detail, extra?: ReactElement) =>
  withApp(extra ?? null, {
    session: { userId: USER },
    motion: 'FULL',
    route: { name, params },
    queries: [[meKey, meOf()], [dayKey, dayOf()], [settingsKey, settingsOf()], [workoutKey(workout.id), workout]],
  });
// The figure drawn at its `poster` time beside the design's key-pose PNG of the same entry: they should match.
const POSTER_CHECK = ['exercise-squat', 'exercise-cau-mong', 'exercise-keo-day-khang-luc', 'exercise-day-vai-voi-ta-tay', 'exercise-xoay-than-khi-ngoi'];
function PosterCheck() {
  return (
    <View style={styles.posters}>
      {POSTER_CHECK.map(code => (
        // a visual check of two drawings side by side, nothing to read
        <View key={code} accessible={false} importantForAccessibility="no-hide-descendants" style={styles.posterRow}>
          <View style={styles.poster}>
            <Rig move={moves[code]} tracks={tracksOf(moves[code])} at={moves[code].poster} />
          </View>
          <Image source={poses[code]} style={styles.poster} resizeMode="contain" />
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  posters: { padding: 8, gap: 8, backgroundColor: '#EAF0FF' },
  posterRow: { flexDirection: 'row', gap: 8 },
  poster: { width: 183, height: 137 },
});

const demoOf = (workout: WorkoutDetail, index: number) => moving('MoveDemo', { workoutId: workout.id, code: workout.steps[index].move.code }, workout);

// What the server answers to a recorded session: at least half completes the quest (the rest of its 50 XP
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
  's19-focus-session': () => session([afterTraining(PART), shown('08:42')]),
  's41-focus-paused': () => session([afterTraining(PART), shown('08:42'), press(vi.pause)]),
  's63-exit-dialog': () => session([afterTraining(PART), shown('08:42'), press(vi.endSession)]),
  's20-result-completed': () => app({ route: 'WorkoutResult', params: { result: result(detail.durationSec) } }),
  's64-result-partial': () => app({ route: 'WorkoutResult', params: { result: result(PART) } }),
  // Ended after ten minutes with no network (no fetch stub: every request fails): kept on this device, no reward named.
  's20-result-queued': () => session([afterTraining(600), shown('05:00'), press(vi.endSession), press(vi.endAndSave)]),
  // The same, then the network returns and the retry of the S38 row sends it: refused, the day had closed. (The
  // app-wide notice that says the same is RejectedNotice, mounted by App.tsx and not by these entries.) The queue may send it
  // by itself first (any request that succeeds flushes it): then the row and its "Thử lại" are gone and the refusal shows.
  's20-result-refused-later': () =>
    session(
      [afterTraining(600), shown('05:00'), press(vi.endSession), press(vi.endAndSave), shown(vi.queuedTitle), () => shown(vi.refusedTitle)() || press(retry)()],
      refusedLater(),
    ),
  's82-move-demo': () => demoOf(detail, 1),
  's82-move-demo-reduced-motion': () => app({ route: 'MoveDemo', params: { workoutId: detail.id, code: SQUAT.move.code }, queries: withDetail }),
  's82-move-demo-text-only': () => demoOf(withMove(1, { ...SQUAT.move, demoCode: null }), 1),
  's82-move-demo-front': () => demoOf(withMove(1, NECK_TILT, '3 lần mỗi bên'), 1),
  's82-move-demo-breath': () => demoOf(withMove(1, BOX_BREATH, '3 vòng thở'), 1),
  // Reduced motion keeps Pause on a timed demo: the phase text still cycles.
  's82-move-demo-breath-reduced': () => {
    const breath = withMove(1, BOX_BREATH, '3 vòng thở');
    return app({ route: 'MoveDemo', params: { workoutId: breath.id, code: breath.steps[1].move.code }, queries: [[workoutKey(breath.id), breath]] });
  },
  's82-move-demo-body-scan': () => demoOf(withMove(1, BODY_SCAN, '50 giây'), 1),
  's82-rig-poster-check': () => <PosterCheck />,
  's18-workout-detail-demo': () => moving('WorkoutDetail', { id: detail.id }),
  's19-focus-session-demo': () => moving('FocusSession', { id: detail.id }, detail, <Script steps={[afterTraining(PART), shown('08:42')]} />),
  's19-focus-breathing': () => moving('FocusSession', { id: detail.id }, withMove(0, FOUR_FOUR, '6 nhịp thở')),
};
