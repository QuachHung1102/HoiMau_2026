/* eslint-env jest */
// Test kit for the workout screens (used by *.test.tsx files; never imported by app code).
// The whole app as App.tsx mounts it (todayTestKit), plus a stand-in for the three workout routes of the server,
// which do not exist yet (server Task 21). It answers as the API contract and AR-11 say; the workouts are the
// real content, copied into workoutFixture.json by .superpowers/sdd/evidence/task-27/make-fixture.mjs.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { GameEvent } from '../../../domain/contract/common.ts';
import type { WorkoutDetail, WorkoutResult, WorkoutSummary } from '../../../domain/contract/content.ts';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { questTitle } from '../../shared/i18n/vi/quests';
import * as vi from '../../shared/i18n/vi/workout';
import { fetchMock, installTodayTestEnv, openToday, refuse, respond, world, writes } from '../dashboard/todayTestKit';
import { WORKOUT_COMPLETE_PATH, WORKOUT_QUEST } from './api';
import fixture from './workoutFixture.json';

export const catalog = fixture.catalog as unknown as WorkoutSummary[];
export const detail = fixture.detail as unknown as WorkoutDetail;
export const COMPLETE = `POST ${WORKOUT_COMPLETE_PATH}`;
const CATALOG = '/workout/catalog';
const ITEM = '/workout/items/';

/**
 * The stand-in for the workout routes. A test changes `items` (what the catalog answers, given the query it was
 * asked with), `workout` (what the item route answers, for its id) and `events` (game events of the next recorded session); `given` is the XP the quest has paid today.
 */
export const gym = {} as { items: (query: URLSearchParams) => WorkoutSummary[]; workout: WorkoutDetail; events: GameEvent[]; given: number };

type Init = Parameters<typeof fetchMock>[1];
const replies = new Map<string, { body: string; answer: unknown }>();

/** AR-11: the quest pays at most its XP per day; a session of at least half completes it, a shorter one earns its share. */
function recordSession(body: { exerciseItemId?: unknown; elapsedSec?: unknown }) {
  if (body.exerciseItemId !== detail.id) return refuse(404, 'NOT_FOUND');
  const { elapsedSec } = body;
  if (typeof elapsedSec !== 'number' || !Number.isInteger(elapsedSec) || elapsedSec < 1 || elapsedSec > 2 * detail.durationSec) {
    return refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'elapsedSec', rule: 'max' }] });
  }
  const quest = world.day.quests.find(item => item.code === WORKOUT_QUEST);
  if (!quest) return refuse(404, 'NOT_FOUND');
  const left = quest.xpReward - gym.given;
  const completed = elapsedSec * 2 >= detail.durationSec;
  const first = completed && !quest.completed;
  const xp = quest.completed ? 0 : first ? left : Math.min(Math.floor((quest.xpReward * elapsedSec) / detail.durationSec), left);
  const coin = first ? quest.coinReward : 0;
  gym.given += xp;
  if (first) {
    world.day = {
      ...world.day,
      quests: world.day.quests.map(item => (item.code === WORKOUT_QUEST ? { ...item, progress: 1, completed: true } : item)),
      story: { ...world.day.story, done: world.day.story.done + 1 },
    };
  }
  const { progression } = world.me;
  if (progression) world.me = { ...world.me, progression: { ...progression, xp: progression.xp + xp, xpIntoLevel: progression.xpIntoLevel + xp, coin: progression.coin + coin } };
  const events: GameEvent[] = [...(first ? [{ type: 'QUEST_COMPLETED', questCode: WORKOUT_QUEST } as GameEvent] : []), ...gym.events];
  return respond(200, { completed, xpAwarded: xp, coinAwarded: coin, elapsedSec, durationSec: detail.durationSec, day: world.day, delta: { xp, coin, events } } satisfies WorkoutResult);
}

function workoutAnswer(request: string, init: Init): unknown {
  if (world.down) return undefined; // the kit's own server throws the network failure
  const [method, target] = request.split(' ');
  const [path, query = ''] = target.split('?');
  if (method === 'GET' && path === CATALOG) return respond(200, { items: gym.items(new URLSearchParams(query)) });
  if (method === 'GET' && path.startsWith(ITEM)) return path.slice(ITEM.length) === gym.workout.id ? respond(200, gym.workout) : refuse(404, 'NOT_FOUND');
  if (request !== COMPLETE) return undefined;
  // An Idempotency-Key that was answered before gets the same answer again; with another body it is refused.
  const key = init.headers['Idempotency-Key'];
  const body = init.body ?? '{}';
  const known = replies.get(key);
  if (known) return known.body === body ? known.answer : refuse(409, 'IDEMPOTENCY_KEY_REUSED');
  const answer = recordSession(JSON.parse(body));
  replies.set(key, { body, answer });
  return answer;
}

/** The query strings the catalog was asked with, in order. */
export const catalogQueries = () =>
  fetchMock.mock.calls
    .map(([url]) => url)
    .filter(url => url.includes(`${CATALOG}?`))
    .map(url => url.slice(url.indexOf('?') + 1));
/** The sessions that reached the server, in order: action id and body. */
export const sessions = () => writes().filter(request => request.path === WORKOUT_COMPLETE_PATH);

const header = (name: string) => screen.findByRole('header', { name });
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

/** The second tab. */
export async function openPlan(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('tab', { name: tabLabel.Plan }));
  await header(tabLabel.Plan);
  return view;
}
/** Hôm nay, then its workout row: the catalog as a person reaches it. */
export async function openCatalog(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  press(new RegExp(`^${questTitle[WORKOUT_QUEST]}`));
  await header(vi.catalogTitle);
  return view;
}
/** The catalog, then the highlighted workout. */
export async function openDetail(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openCatalog(options);
  fireEvent.press(await screen.findByRole('button', { name: `${vi.seeGuide}: ${detail.name}` }));
  await header(detail.name);
  return view;
}
/** The workout, then "start": the session is running. */
export async function startSession(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openDetail(options);
  press(vi.start);
  await header(vi.focusTitle);
  return view;
}

// Timers only: a microtask queued by an unmount is not something that keeps Jest alive.
export const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
/** Lets `ms` of time pass: the clock and every timer due in it. */
export const pass = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
let listeners: ((state: string) => void)[] = [];
/** The app in the foreground, and (with `system`) a way to move it to the background and back as the system would. */
export function foreground() {
  mockedAppState.currentState = 'active';
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter(item => item !== listener);
      },
    };
  }) as never);
}
export const system = (state: 'active' | 'background' | 'inactive') => act(async () => listeners.forEach(listener => listener(state)));

export function installWorkoutTestEnv() {
  installTodayTestEnv();
  beforeEach(() => {
    replies.clear();
    Object.assign(gym, { items: () => catalog, workout: detail, events: [], given: 0 });
    world.answer = workoutAnswer;
  });
  afterEach(() => {
    mockedAppState.currentState = appStateAtLoad;
    listeners = [];
  });
}
