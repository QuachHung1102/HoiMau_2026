/* eslint-env jest */
// Test kit for the workout screens (used by *.test.tsx files; never imported by app code).
// The whole app as App.tsx mounts it (todayTestKit), plus a stand-in for the three workout routes of the server,
// (server Task 21). It answers as those routes do (the catalog's filter, AR-11, what a replay remembers); the workouts are the
// real content, copied into workoutFixture.json by .superpowers/sdd/evidence/task-27/make-fixture.mjs.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { GameEvent } from '../../../domain/contract/common.ts';
import type { WorkoutDetail, WorkoutResult, WorkoutSummary } from '../../../domain/contract/content.ts';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { questTitle } from '../../shared/i18n/vi/quests';
import * as vi from '../../shared/i18n/vi/workout';
import { changeDay, checkOccurredAt, completeQuest, fetchMock, guard, installTodayTestEnv, keyed, openToday, pay, refreshStats, respond, settleStory, stop, storyWhole, UUID, world, writes } from '../dashboard/todayTestKit';
import { WORKOUT_COMPLETE_PATH, WORKOUT_QUEST } from './api';
import fixture from './workoutFixture.json';

export const catalog = fixture.catalog as unknown as WorkoutSummary[];
export const detail = fixture.detail as unknown as WorkoutDetail;
export const COMPLETE = `POST ${WORKOUT_COMPLETE_PATH}`;
const CATALOG = '/workout/catalog';
const ITEM = '/workout/items/';

/**
 * The stand-in for the workout routes. A test changes `items` (what the catalog answers, given the query it was
 * asked with; by default what the server answers: filtered by the query), `workout` (what the item route answers,
 * for its id); `given` is the XP the quest has paid today.
 */
export const gym = {} as { items: (query: URLSearchParams) => WorkoutSummary[]; workout: WorkoutDetail; given: number };

type Init = Parameters<typeof fetchMock>[1];
const DURATION_SEC: Record<string, number> = { '5': 300, '15': 900, '30': 1800, '45': 2700 };
const SPACES = ['DESK_SIDE', 'ROOM', 'GYM', 'OUTDOOR'];
const EQUIPMENT = ['tham', 'ta-tay', 'day-khang-luc'];
const INT_MAX = 2 ** 31 - 1;
const enumFail = (field: string): never => stop(422, 'VALIDATION_FAILED', [{ field, rule: 'enum' }]);

/**
 * `GET /workout/catalog` as the server filters it: the duration in minutes, the space by equality, and the equipment
 * as the set the person owns (a workout matches when it needs nothing outside it). A parameter that is absent filters
 * nothing; `equipment=` (present, empty) is the empty set, which is not the same. A value outside the lists is 422.
 */
export function serverCatalog(query: URLSearchParams, items: WorkoutSummary[] = catalog): WorkoutSummary[] {
  const duration = query.get('duration');
  const space = query.get('space');
  const owned = query.get('equipment');
  if (duration !== null && !Object.hasOwn(DURATION_SEC, duration)) enumFail('duration');
  if (space !== null && !SPACES.includes(space)) enumFail('space');
  const own = owned === null ? null : owned === '' ? [] : owned.split(',');
  if (own?.some(code => !EQUIPMENT.includes(code))) enumFail('equipment');
  return items.filter(
    item => (duration === null || item.durationSec === DURATION_SEC[duration]) && (space === null || item.spaceNeeded === space) && (own === null || item.equipment.every(code => own.includes(code))),
  );
}

/** AR-11: the quest pays at most its XP per day; a session of at least half completes it, a shorter one earns its share. */
function recordSession(id: string, body: Record<string, unknown>) {
  const { exerciseItemId, elapsedSec } = body;
  const fields: { field: string; rule: string }[] = [];
  if (typeof exerciseItemId !== 'string' || !UUID.test(exerciseItemId)) fields.push({ field: 'exerciseItemId', rule: exerciseItemId === undefined ? 'required' : 'format' });
  if (elapsedSec === undefined) fields.push({ field: 'elapsedSec', rule: 'required' });
  else if (typeof elapsedSec !== 'number' || !Number.isInteger(elapsedSec)) fields.push({ field: 'elapsedSec', rule: 'format' });
  else if (elapsedSec < 1) fields.push({ field: 'elapsedSec', rule: 'min' });
  else if (elapsedSec > INT_MAX) fields.push({ field: 'elapsedSec', rule: 'max' });
  if (fields.length > 0) stop(422, 'VALIDATION_FAILED', fields);
  if (exerciseItemId !== detail.id) stop(404, 'NOT_FOUND');
  const seconds = elapsedSec as number;
  if (seconds > 2 * detail.durationSec) stop(422, 'VALIDATION_FAILED', [{ field: 'elapsedSec', rule: 'max' }]);
  checkOccurredAt(body);
  const quest = world.day.quests.find(item => item.code === WORKOUT_QUEST);
  if (!quest) stop(404, 'NOT_FOUND');
  const left = quest.xpReward - gym.given;
  const completed = seconds * 2 >= detail.durationSec;
  const first = completed && !quest.completed;
  const xp = quest.completed ? 0 : first ? left : Math.min(Math.floor((quest.xpReward * seconds) / detail.durationSec), left);
  const coin = first ? quest.coinReward : 0;
  gym.given += xp;
  const wasWhole = storyWhole();
  changeDay(day => day);
  if (first) completeQuest(WORKOUT_QUEST);
  const minutes = world.minutes;
  if (detail.modality === 'RESISTANCE') minutes.resistance += seconds / 60;
  else if (detail.modality === 'CARDIO' || detail.modality === 'HIIT') minutes.cardio += seconds / 60;
  const events: GameEvent[] = [...(first ? [{ type: 'QUEST_COMPLETED', questCode: WORKOUT_QUEST } as GameEvent, ...settleStory(wasWhole)] : []), ...pay(xp, coin)];
  refreshStats();
  return respond(200, { completed, xpAwarded: xp, coinAwarded: coin, elapsedSec: seconds, durationSec: detail.durationSec, day: world.day, delta: { xp, coin, events } } satisfies WorkoutResult);
}

function workoutAnswer(request: string, init: Init): unknown {
  if (world.down) return undefined; // the kit's own server throws the network failure
  const [method, target] = request.split(' ');
  const [path, query = ''] = target.split('?');
  if (method === 'GET' && path === CATALOG) return guard(() => respond(200, { items: gym.items(new URLSearchParams(query)) }));
  if (method === 'GET' && path.startsWith(ITEM)) {
    const id = path.slice(ITEM.length);
    return guard(() => (UUID.test(id) ? (id === gym.workout.id ? respond(200, gym.workout) : stop(404, 'NOT_FOUND')) : stop(422, 'VALIDATION_FAILED', [{ field: 'id', rule: 'format' }])));
  }
  return request === COMPLETE ? keyed(request, init, recordSession) : undefined;
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
    Object.assign(gym, { items: serverCatalog, workout: detail, given: 0 });
    world.answer = workoutAnswer;
  });
  afterEach(() => {
    mockedAppState.currentState = appStateAtLoad;
    listeners = [];
  });
}
