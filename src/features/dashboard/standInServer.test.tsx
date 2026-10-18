// The stand-in servers of todayTestKit / workoutTestKit against what the real routes answer (server Task 20 report §6,
// Task 21 report §8). Every mobile test that reads a stand-in's answer is only as true as these. No app is mounted:
// the requests go straight to the stubbed fetch.
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { DayState } from '../../../domain/contract/core.ts';
import type { MealPlanState, SwapCandidates, WorkoutResult } from '../../../domain/contract/content.ts';
import { newActionId } from '../../shared/api/uuid';
import { catalog, detail, gym, installWorkoutTestEnv, serverCatalog } from '../workout/workoutTestKit';
import { BEDTIME, dayOf, fetchMock, HIDDEN, mealByCode, meOf, nearLevelUp, NUTRITION, STAND_UP, world } from './todayTestKit';

installWorkoutTestEnv();

const BASE = 'http://localhost:8787/api/v1';
const HOUR = 3_600_000;
const WATER_TICK = '/day/quests/WATER_8/progress';
const WATER_UNDO = '/day/quests/WATER_8/undo';
const COMPLETE = '/workout/complete';

type Answer = { status: number; json: any };
/** One request to the stand-in, with a text body as written on the wire (`undefined` = no body). */
async function send(method: string, path: string, raw?: string, key = newActionId()): Promise<Answer & { key: string }> {
  const init = { method, headers: { 'Idempotency-Key': key }, ...(raw === undefined ? {} : { body: raw }), signal: new AbortController().signal };
  const response = (await fetchMock(BASE + path, init)) as { status: number; text: () => Promise<string> };
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined, key };
}
const post = (path: string, body: unknown, key?: string) => send('POST', path, JSON.stringify(body), key);
const get = (path: string) => send('GET', path);
const code = (answer: Answer) => `${answer.status} ${answer.json?.error?.code}`;
const fields = (answer: Answer) => answer.json.error.details.fields;
const quest = (day: DayState, name: string) => day.quests.find(item => item.code === name) as DayState['quests'][number];
/** An instant that falls at `hh:mm` of the user's zone (UTC+7), within the last 24 to 48 hours. */
const localInstant = (hh: number, mm: number) => new Date(Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR - 24 * HOUR + (hh - 7) * HOUR + mm * 60_000).toISOString();

describe('undo (Task 20 §6 rows 1-5)', () => {
  test('refuses as the route does: unknown, another quest\'s or undone tick 404; a later live tick 409; no tickId 422', async () => {
    const first = await post(WATER_TICK, {});
    const second = await post(WATER_TICK, {});
    expect(code(await post(WATER_UNDO, { tickId: first.key }))).toBe('409 UNDO_NOT_LATEST');
    expect(code(await post(WATER_UNDO, { tickId: newActionId() }))).toBe('404 TICK_NOT_FOUND');
    expect(code(await post(`/day/quests/${STAND_UP}/undo`, { tickId: second.key }))).toBe('404 TICK_NOT_FOUND');
    expect((await post(WATER_UNDO, { tickId: second.key })).status).toBe(200);
    expect(code(await post(WATER_UNDO, { tickId: second.key }))).toBe('404 TICK_NOT_FOUND');
    const missing = await post(WATER_UNDO, {});
    expect([code(missing), fields(missing)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'tickId', rule: 'required' }]]);
    const malformed = await post(WATER_UNDO, { tickId: 'not-a-uuid' });
    expect([code(malformed), fields(malformed)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'tickId', rule: 'format' }]]);
  });

  test('lastTick after an undo is the previous live tick, null only when none is left; its `at` is the server\'s instant', async () => {
    world.day = dayOf({}, { progress: 1, lastTick: null });
    const first = await post(WATER_TICK, {});
    const second = await post(WATER_TICK, {});
    expect(Math.abs(Date.parse(quest(second.json.day, 'WATER_8').lastTick?.at ?? '') - Date.now())).toBeLessThan(2000);
    const undone = await post(WATER_UNDO, { tickId: second.key });
    expect(quest(undone.json.day, 'WATER_8')).toMatchObject({ progress: 2, lastTick: { id: first.key } });
    const last = await post(WATER_UNDO, { tickId: first.key });
    expect(quest(last.json.day, 'WATER_8')).toMatchObject({ progress: 1, lastTick: null });
  });

  test('more than 10 s after the tick was recorded: 409 UNDO_WINDOW_EXPIRED (the fixture\'s own tick is an hour old)', async () => {
    expect(code(await post(WATER_UNDO, { tickId: quest(world.day, 'WATER_8').lastTick?.id }))).toBe('409 UNDO_WINDOW_EXPIRED');
    const tick = await post(WATER_TICK, {});
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 10_001);
    expect(code(await post(WATER_UNDO, { tickId: tick.key }))).toBe('409 UNDO_WINDOW_EXPIRED');
    spy.mockReturnValue(now + 9_000);
    expect((await post(WATER_UNDO, { tickId: tick.key })).status).toBe(200);
    spy.mockRestore();
  });
});

describe('a tick (Task 20 §6 rows 8, 9, 13)', () => {
  test('a quest that cannot be ticked is 409 QUEST_NOT_TICKABLE, an unknown one 404 QUEST_NOT_FOUND, both with an error body', async () => {
    for (const [name, expected] of [
      ['WORKOUT_MAIN', '409 QUEST_NOT_TICKABLE'],
      [HIDDEN, '409 QUEST_NOT_TICKABLE'],
      ['NOPE', '404 QUEST_NOT_FOUND'],
    ]) {
      const answer = await post(`/day/quests/${name}/progress`, {});
      expect(code(answer)).toBe(expected);
      expect(answer.json.error.message).toEqual(expect.any(String));
    }
  });

  test('occurredAt: 48 h old is 409 DAY_CLOSED, over 120 s ahead 422 OCCURRED_AT_INVALID, not an instant 422 format; 60 s ahead counts as now', async () => {
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    expect(code(await post(WATER_TICK, { occurredAt: at(-49 * HOUR) }))).toBe('409 DAY_CLOSED');
    expect(code(await post(WATER_TICK, { occurredAt: at(121_000) }))).toBe('422 OCCURRED_AT_INVALID');
    for (const bad of ['2027-02-30T05:00:00Z', '2027-03-12T24:00:00Z', '2027-03-12 05:00:00Z', 5]) {
      const answer = await post(WATER_TICK, { occurredAt: bad });
      expect([code(answer), fields(answer)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'occurredAt', rule: 'format' }]]);
    }
    expect((await post(WATER_TICK, { occurredAt: at(60_000) })).status).toBe(200);
    world.closedDate = world.day.logicalDate;
    expect(code(await post(WATER_TICK, {}))).toBe('409 DAY_CLOSED');
  });

  test('QUEST_COMPLETED on the tick that reaches the target, again after an undo and a new tick; an undo carries no events', async () => {
    world.day = dayOf({}, { progress: 7, lastTick: null });
    const eighth = await post(WATER_TICK, {});
    expect(eighth.json.delta.events).toEqual([{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }]);
    const undone = await post(WATER_UNDO, { tickId: eighth.key });
    expect(undone.json.delta).toEqual({ xp: -10, coin: -5, events: [] });
    expect((await post(WATER_TICK, {})).json.delta.events).toEqual([{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }]);
  });

  test('the profile follows the XP sum (level included, LEVEL_UP once) and the stats are mapStats of the day', async () => {
    nearLevelUp(5);
    const tick = await post(WATER_TICK, {});
    expect(tick.json.delta.events).toEqual([{ type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 }]);
    expect((await get('/me')).json.progression).toMatchObject({ level: 6, xpIntoLevel: 5 });
    expect((await get('/me')).json.stats.hp).toBe(31); // 4 of 8 parts of water: 20 + the streak's 11
    await post(WATER_UNDO, { tickId: tick.key });
    expect((await get('/me')).json.progression).toMatchObject({ level: 5 });
    // the high-water mark stays: the same grant again is not a new level
    expect((await post(WATER_TICK, {})).json.delta.events).toEqual([]);
  });
});

describe('what a key remembers (Task 20 §6 rows 6, 7; Task 21 §8 workout 7, nutrition 6)', () => {
  test('only a 2xx: a refusal runs again under the same key', async () => {
    world.day = dayOf({}, { progress: 8, completed: true });
    const key = newActionId();
    expect(code(await post(WATER_TICK, {}, key))).toBe('409 QUEST_ALREADY_COMPLETE');
    world.day = dayOf({}, { progress: 3 });
    expect((await post(WATER_TICK, {}, key)).status).toBe(200);
  });

  test('the same request again is the stored answer, day included (older than the day by then); another body or path is 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const first = await post(WATER_TICK, {});
    await post(WATER_TICK, {});
    const replay = await post(WATER_TICK, {}, first.key);
    expect(replay.json).toEqual(first.json);
    expect(quest(replay.json.day, 'WATER_8').progress).toBe(4);
    expect(quest(world.day, 'WATER_8').progress).toBe(5);
    // the late flush of a record first sent without occurredAt
    expect(code(await post(WATER_TICK, { occurredAt: new Date(Date.now() - 90_000).toISOString() }, first.key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    expect(code(await post(`/day/quests/${STAND_UP}/progress`, {}, first.key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    // the members of an object in another order are the same body
    const logged = await post(NUTRITION.slice(5), { kcal: 100, label: 'x' });
    expect((await post(NUTRITION.slice(5), { label: 'x', kcal: 100 }, logged.key)).json).toEqual(logged.json);
  });

  test('the body of a write is a JSON object: none is 422 body/required, null or an array 422 body/format', async () => {
    for (const path of [WATER_TICK, WATER_UNDO, BEDTIME.slice(5), NUTRITION.slice(5), COMPLETE]) {
      const none = await send('POST', path);
      expect([code(none), fields(none)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'body', rule: 'required' }]]);
      for (const raw of ['null', '[]', '5', '"x"']) expect([path, code(await send('POST', path, raw))]).toEqual([path, '422 VALIDATION_FAILED']);
      expect(fields(await send('POST', path, 'null'))).toEqual([{ field: 'body', rule: 'format' }]);
    }
  });
});

describe('bedtime (Task 20 §6 rows 10-12)', () => {
  test('03:00-17:59 is too early; from 23:00 the mark is made and the hidden quest is not completed', async () => {
    world.hour = 10;
    expect(code(await post(BEDTIME.slice(5), {}))).toBe('409 BEDTIME_TOO_EARLY');
    expect(world.day.bedtimeMarkedAt).toBeNull();
    world.hour = 23;
    const late = await post(BEDTIME.slice(5), {});
    expect(late.json.delta).toEqual({ xp: 0, coin: 0, events: [] });
    expect(late.json.day.bedtimeMarkedAt).not.toBeNull();
    expect(quest(late.json.day, HIDDEN).completed).toBe(false);
  });

  test('marks out of order: the one at 22:55 delivered after 23:10 is rewarded, once; bedtimeMarkedAt is the earliest', async () => {
    const path = BEDTIME.slice(5);
    expect((await post(path, { occurredAt: localInstant(23, 10) })).json.delta).toEqual({ xp: 0, coin: 0, events: [] });
    const rewarded = await post(path, { occurredAt: localInstant(22, 55) });
    expect(rewarded.json.delta).toMatchObject({ xp: 30, coin: 15, events: [{ type: 'QUEST_COMPLETED', questCode: HIDDEN }] });
    expect(rewarded.json.day.bedtimeMarkedAt).toBe(localInstant(22, 55));
    const again = await post(path, { occurredAt: localInstant(22, 40) });
    expect(again.json.delta).toEqual({ xp: 0, coin: 0, events: [] });
    expect(again.json.day.bedtimeMarkedAt).toBe(localInstant(22, 40));
    expect((await post(path, { occurredAt: localInstant(23, 30) })).json.day.bedtimeMarkedAt).toBe(localInstant(22, 40));
    expect(code(await post(path, { occurredAt: localInstant(12, 0) }))).toBe('409 BEDTIME_TOO_EARLY');
  });
});

describe('POST /nutrition/log (Task 21 §8, nutrition 1-9)', () => {
  const log = (body: unknown) => post(NUTRITION.slice(5), body);

  test('kcal is any number from 1 to 5000, fractions included; the refusals name the rule', async () => {
    expect((await log({ kcal: 12.5 })).json.day.caloriesIn).toBe(1662.5);
    const bad = async (body: unknown) => fields(await log(body));
    expect(await bad({ kcal: 0 })).toEqual([{ field: 'kcal', rule: 'min' }]);
    expect(await bad({ kcal: 5001 })).toEqual([{ field: 'kcal', rule: 'max' }]);
    expect(await bad({ kcal: '5' })).toEqual([{ field: 'kcal', rule: 'format' }]);
    expect(await bad({})).toEqual([{ field: 'kcal', rule: 'required' }]);
    expect(await bad({ kcal: 100, label: 5 })).toEqual([{ field: 'label', rule: 'format' }]);
    expect(await bad({ kcal: 100, label: 'x'.repeat(61) })).toEqual([{ field: 'label', rule: 'max' }]);
    expect((await log({ kcal: 100, label: 'x'.repeat(60) })).status).toBe(200);
  });

  test('mealSlot: a valid slot is the planned meal (409 PLAN_NOT_FOUND without one), an unknown one 422 enum, with kcal as well 422 format', async () => {
    world.plan.planned.LUNCH = null;
    expect(code(await log({ mealSlot: 'LUNCH' }))).toBe('409 PLAN_NOT_FOUND');
    expect(fields(await log({ mealSlot: 'BRUNCH' }))).toEqual([{ field: 'mealSlot', rule: 'enum' }]);
    expect(fields(await log({ mealSlot: 'LUNCH', kcal: 100 }))).toEqual([{ field: 'mealSlot', rule: 'format' }]);
  });

  test('DAY_CLOSED comes from the day of occurredAt; the nutrition quest latches once, STORY_ALL_DONE on the write that makes the story whole', async () => {
    expect(code(await log({ kcal: 100, occurredAt: new Date(Date.now() - 49 * HOUR).toISOString() }))).toBe('409 DAY_CLOSED');
    expect(code(await log({ kcal: 100, occurredAt: new Date(Date.now() + 5 * 60_000).toISOString() }))).toBe('422 OCCURRED_AT_INVALID');
    const met = await log({ kcal: 600 }); // 1650 + 600 = 2250, inside the window
    expect(met.json.delta).toMatchObject({ xp: 50, coin: 20, events: [{ type: 'QUEST_COMPLETED', questCode: 'NUTRITION_TARGET' }] });
    expect(met.json.day.story).toEqual({ done: 1, total: 2 });
    const more = await log({ kcal: 10 });
    expect(more.json.delta).toEqual({ xp: 0, coin: 0, events: [] });
    // the workout completes the story
    const session = await post(COMPLETE, { exerciseItemId: detail.id, elapsedSec: 600 });
    expect(session.json.delta.events).toEqual([{ type: 'QUEST_COMPLETED', questCode: 'WORKOUT_MAIN' }, { type: 'STORY_ALL_DONE' }]);
    expect(session.json.day.story).toEqual({ done: 2, total: 2 });
  });
});

describe('the workout routes (Task 21 §8, workout 1-11)', () => {
  const withGear = [catalog[0], { ...catalog[1], equipment: ['ta-tay'] }, { ...catalog[2], equipment: ['ta-tay', 'tham'] }];
  const ask = (query: string) => serverCatalog(new URLSearchParams(query), withGear).map(item => item.name);

  test('the catalog: the equipment parameter absent filters nothing, empty is "owns nothing", a list is what is owned', () => {
    expect(ask('duration=15')).toHaveLength(3);
    expect(ask('duration=15&equipment=')).toEqual([catalog[0].name]);
    expect(ask('duration=15&equipment=ta-tay')).toEqual([catalog[0].name, catalog[1].name]);
    expect(ask('duration=15&equipment=ta-tay,tham,day-khang-luc')).toHaveLength(3);
    expect(ask('duration=30')).toEqual([]);
    expect(ask('space=GYM')).toEqual([]);
    expect(ask('space=ROOM&duration=15')).toHaveLength(3);
  });

  test('over HTTP: a value outside the lists is 422 enum; no match is 200 with an empty list; the default catalog is filtered by the query', async () => {
    for (const [query, field] of [['duration=7', 'duration'], ['space=MOON', 'space'], ['equipment=tham,jetpack', 'equipment']]) {
      const answer = await get(`/workout/catalog?${query}`);
      expect([code(answer), fields(answer)]).toEqual(['422 VALIDATION_FAILED', [{ field, rule: 'enum' }]]);
    }
    expect((await get('/workout/catalog?duration=45')).json).toEqual({ items: [] });
    expect((await get('/workout/catalog?duration=15&equipment=')).json.items).toHaveLength(catalog.length);
    gym.items = query => serverCatalog(query, withGear);
    expect((await get('/workout/catalog?duration=15&equipment=')).json.items).toHaveLength(1);
    expect((await get('/workout/catalog?duration=15')).json.items).toHaveLength(3);
  });

  test('an item: a non-UUID id is 422 id/format, an unknown UUID 404 NOT_FOUND', async () => {
    expect((await get(`/workout/items/${detail.id}`)).json.name).toBe(detail.name);
    expect(fields(await get('/workout/items/not-a-uuid'))).toEqual([{ field: 'id', rule: 'format' }]);
    expect(code(await get(`/workout/items/${newActionId()}`))).toBe('404 NOT_FOUND');
  });

  test('a session: each wrong member is named with its rule; an unknown workout is 404; occurredAt is judged as on a tick', async () => {
    const bad = async (body: unknown) => fields(await post(COMPLETE, body));
    expect(await bad({})).toEqual([{ field: 'exerciseItemId', rule: 'required' }, { field: 'elapsedSec', rule: 'required' }]);
    expect(await bad({ exerciseItemId: 'x', elapsedSec: 1.5 })).toEqual([{ field: 'exerciseItemId', rule: 'format' }, { field: 'elapsedSec', rule: 'format' }]);
    expect(await bad({ exerciseItemId: detail.id, elapsedSec: 0 })).toEqual([{ field: 'elapsedSec', rule: 'min' }]);
    expect(await bad({ exerciseItemId: detail.id, elapsedSec: 2 ** 31 })).toEqual([{ field: 'elapsedSec', rule: 'max' }]);
    expect(await bad({ exerciseItemId: detail.id, elapsedSec: 2 * detail.durationSec + 1 })).toEqual([{ field: 'elapsedSec', rule: 'max' }]);
    expect(code(await post(COMPLETE, { exerciseItemId: newActionId(), elapsedSec: 60 }))).toBe('404 NOT_FOUND');
    const old = new Date(Date.now() - 49 * HOUR).toISOString();
    expect(code(await post(COMPLETE, { exerciseItemId: detail.id, elapsedSec: 60, occurredAt: old }))).toBe('409 DAY_CLOSED');
    expect(code(await post(COMPLETE, { exerciseItemId: detail.id, elapsedSec: 60, occurredAt: '2027-02-30T05:00:00Z' }))).toBe('422 VALIDATION_FAILED');
    expect((await post(COMPLETE, { exerciseItemId: detail.id, elapsedSec: 2 * detail.durationSec })).status).toBe(200);
  });

  test('the answer: completes at half the duration, the day is the server\'s (story counted), the profile follows, the minutes move the stats', async () => {
    const before = (await get('/me')).json.stats;
    const key = newActionId();
    const body = { exerciseItemId: detail.id, elapsedSec: 450 };
    const answer = (await post(COMPLETE, body, key)).json as WorkoutResult;
    expect(answer).toMatchObject({ completed: true, xpAwarded: 50, coinAwarded: 20, elapsedSec: 450, durationSec: 900 });
    expect(answer.delta.events).toEqual([{ type: 'QUEST_COMPLETED', questCode: 'WORKOUT_MAIN' }]);
    expect(answer.day.story.done).toBe(1);
    expect((await get('/me')).json.progression).toMatchObject({ xp: (meOf().progression?.xp ?? 0) + 50, coin: 270 });
    expect((await get('/me')).json.stats.str).toBeGreaterThan(before.str);
    expect((await post(COMPLETE, body, key)).json).toEqual(answer);
    expect(code(await post(COMPLETE, { ...body, elapsedSec: 451 }, key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
  });
});

describe('the day the stand-in holds', () => {
  test('every answer carries a serverTime later than the one before (acceptDay reads it)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const first = (await post(WATER_TICK, {})).json as ActionResult;
    jest.setSystemTime(Date.now() + 5);
    const second = (await post(WATER_TICK, {})).json as ActionResult;
    expect(Date.parse(second.day.serverTime)).toBeGreaterThan(Date.parse(first.day.serverTime));
    jest.useRealTimers();
  });

  test('unreadCount is 0 until Task 22', () => {
    expect(dayOf().unreadCount).toBe(0);
  });
});

// Task 28's routes: server Task 20 (history), Task 22 (the inbox, `celebrations`) and Task 14 (`/progression`).
describe('GET /progression and the history (Task 14, Task 20 §5)', () => {
  test('/progression is the profile\'s progression; before onboarding it is 409 ONBOARDING_REQUIRED', async () => {
    expect((await get('/progression')).json).toEqual(world.me.progression);
    world.me = { ...world.me, progression: null };
    expect(code(await get('/progression'))).toBe('409 ONBOARDING_REQUIRED');
  });

  test('a range is one summary per date, oldest first, both ends included: OPEN from the server\'s today on, NONE before; at most 92 dates', async () => {
    world.history = { '2026-10-13': { summary: { logicalDate: '2026-10-13', outcome: 'FROZEN', storyDone: 0, storyTotal: 2, waterMl: 0, caloriesIn: 0, workoutMinutes: 0 }, actions: [] } };
    const range = await get('/day/history?from=2026-10-12&to=2026-10-15');
    expect(range.status).toBe(200);
    expect((range.json.days as { logicalDate: string; outcome: string }[]).map(day => `${day.logicalDate} ${day.outcome}`)).toEqual([
      '2026-10-12 NONE',
      '2026-10-13 FROZEN',
      '2026-10-14 OPEN',
      '2026-10-15 OPEN',
    ]);
    expect((await get('/day/history?from=2026-07-15&to=2026-10-14')).json.days).toHaveLength(92);
    const tooMany = await get('/day/history?from=2026-07-14&to=2026-10-14');
    expect([code(tooMany), fields(tooMany)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'to', rule: 'max' }]]);
    const backwards = await get('/day/history?from=2026-10-15&to=2026-10-14');
    expect([code(backwards), fields(backwards)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'to', rule: 'min' }]]);
  });

  test('from and to are required calendar dates', async () => {
    expect(fields(await get('/day/history?to=2026-10-14'))).toEqual([{ field: 'from', rule: 'required' }]);
    expect(fields(await get('/day/history?from=2026-10-14'))).toEqual([{ field: 'to', rule: 'required' }]);
    expect(fields(await get('/day/history?from=2026-02-30&to=2026-10-14'))).toEqual([{ field: 'from', rule: 'format' }]);
    expect(fields(await get('/day/history?from=yesterday&to=2026-10-14'))).toEqual([{ field: 'from', rule: 'format' }]);
  });

  test('one date: its summary and its actions as stored; a date nothing was recorded on has none; a bad date is 422', async () => {
    const action = { id: 'a1', kind: 'BEDTIME', at: '2026-10-13T15:30:00.000Z', mealSlot: null, label: null, value: null, undone: false };
    world.history = { '2026-10-13': { summary: { logicalDate: '2026-10-13', outcome: 'COMPLETED', storyDone: 2, storyTotal: 2, waterMl: 2000, caloriesIn: 2400, workoutMinutes: 30 }, actions: [action as never] } };
    expect((await get('/day/history/2026-10-13')).json).toEqual({ summary: world.history['2026-10-13'].summary, actions: [action] });
    expect((await get('/day/history/2026-10-12')).json).toEqual({ summary: expect.objectContaining({ logicalDate: '2026-10-12', outcome: 'NONE' }), actions: [] });
    expect(fields(await get('/day/history/2026-13-40'))).toEqual([{ field: 'date', rule: 'format' }]);
  });
});

describe('POST /inbox/read (Task 22 §5)', () => {
  const ITEM = '9d1c2f3a-4b5e-4f60-8a71-b2c3d4e5f601';
  const OTHER = '9d1c2f3a-4b5e-4f60-8a71-b2c3d4e5f602';
  const item = (id: string) => ({ id, kind: 'STREAK_MILESTONE' as const, createdAt: '2026-10-14T01:00:00.000Z', readAt: null, payload: { days: 7 as const, coins: 50, badgeCode: 'BADGE_STREAK_7' } });
  beforeEach(() => {
    world.day = dayOf({ celebrations: [item(ITEM), item(OTHER)], unreadCount: 3 });
  });

  test('the ids given are read: the day lists the others and the unread count is the day\'s, less those; an unknown id changes nothing', async () => {
    const answer = await post('/inbox/read', { ids: [ITEM, '9d1c2f3a-4b5e-4f60-8a71-b2c3d4e5f6ff'] });
    expect([answer.status, answer.json]).toEqual([200, { unreadCount: 2 }]);
    expect(world.day.celebrations.map(each => each.id)).toEqual([OTHER]);
  });

  test('without ids it reads every unread item', async () => {
    expect((await post('/inbox/read', {})).json).toEqual({ unreadCount: 1 });
    expect(world.day.celebrations).toEqual([]);
  });

  test('ids that are not an array of UUIDs are 422 ids/format; no body 422 body/required', async () => {
    for (const ids of ['x', [1], ['not-a-uuid'], null]) expect([code(await post('/inbox/read', { ids })), fields(await post('/inbox/read', { ids }))]).toEqual(['422 VALIDATION_FAILED', [{ field: 'ids', rule: 'format' }]]);
    const none = await send('POST', '/inbox/read');
    expect([code(none), fields(none)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'body', rule: 'required' }]]);
    expect(world.day.celebrations).toHaveLength(2);
  });

  test('the same key again is the stored answer; the same key with another body is 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const first = await post('/inbox/read', { ids: [ITEM] });
    expect((await post('/inbox/read', { ids: [ITEM] }, first.key)).json).toEqual(first.json);
    expect(code(await post('/inbox/read', { ids: [OTHER] }, first.key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    expect(world.day.celebrations.map(each => each.id)).toEqual([OTHER]);
  });
});

describe('the meal plan routes (Task 33 report, "Notes for Task 34")', () => {
  const plan = async () => (await get('/nutrition/plan')).json as MealPlanState;
  const slotOf = async (slot: string) => (await plan()).slots.find(item => item.mealSlot === slot) as MealPlanState['slots'][number];
  const swap = (mealSlot: unknown, mealId: unknown, key?: string) => post('/nutrition/swap', { mealSlot, mealId }, key);
  const offered = async (slot: string) => (await get(`/nutrition/swap-candidates?mealSlot=${slot}`)).json as SwapCandidates;

  test('the plan: four slots in order, each with a Meal and the limit; the day total and the window are the day\'s', async () => {
    const state = await plan();
    expect(state.slots.map(item => item.mealSlot)).toEqual(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);
    expect(state.slots.map(item => [item.logged, item.swapsUsed, item.swapsAllowed, item.macroWarning])).toEqual(Array(4).fill([false, 0, 3, false]));
    expect(state.caloriesIn).toBe(world.day.caloriesIn);
    expect(state.calorieWindow).toEqual(world.day.calorieWindow);
    expect(Object.keys(state.slots[1].meal ?? {}).sort()).toEqual(['carbsG', 'code', 'description', 'fatG', 'id', 'imageKey', 'kcal', 'mealSlot', 'name', 'portionText', 'proteinG', 'tags']);
  });

  test('candidates: at most three, ranked, kcalDelta = candidate kcal - the planned meal\'s; no mealSlot 422 required, a bad one 422 enum', async () => {
    const answer = await offered('LUNCH');
    expect(answer.swapsRemaining).toBe(3);
    // frame S15: 790, 760 and 745 against 820
    expect(answer.candidates.map(item => [item.name, item.kcalDelta])).toEqual([['Cơm cá và rau luộc', -30], ['Bún gà rau thơm', -60], ['Đậu hũ, cơm và nấm', -75]]);
    expect(fields(await get('/nutrition/swap-candidates'))).toEqual([{ field: 'mealSlot', rule: 'required' }]);
    expect(fields(await get('/nutrition/swap-candidates?mealSlot=BRUNCH'))).toEqual([{ field: 'mealSlot', rule: 'enum' }]);
  });

  test('a swap puts the meal in, counts one, and the next candidates leave out what the slot has shown', async () => {
    const first = (await offered('LUNCH')).candidates[0];
    const answer = await swap('LUNCH', first.id);
    expect(answer.status).toBe(200);
    expect(answer.json.slots[1]).toMatchObject({ meal: { id: first.id }, swapsUsed: 1, logged: false });
    const next = await offered('LUNCH');
    expect(next.swapsRemaining).toBe(2);
    expect(next.candidates.map(item => item.id)).not.toContain(first.id);
    expect(next.candidates.map(item => item.id)).not.toContain(mealByCode('COM_GA').id);
  });

  test('refusals: not one of the three 422 SWAP_CANDIDATE_INVALID; bad body 422; the fourth swap 409 SWAP_LIMIT_REACHED (any meal)', async () => {
    expect(code(await swap('LUNCH', mealByCode('COM_TAM').id))).toBe('422 SWAP_CANDIDATE_INVALID');
    expect(code(await swap('LUNCH', mealByCode('YEN_MACH').id))).toBe('422 SWAP_CANDIDATE_INVALID');
    const bad = await swap('BRUNCH', 'x');
    expect([code(bad), fields(bad)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'mealSlot', rule: 'enum' }, { field: 'mealId', rule: 'format' }]]);
    for (let n = 0; n < 3; n++) expect((await swap('LUNCH', (await offered('LUNCH')).candidates[0].id)).status).toBe(200);
    expect(await offered('LUNCH')).toEqual({ mealSlot: 'LUNCH', swapsRemaining: 0, candidates: [] });
    expect(code(await swap('LUNCH', mealByCode('COM_TAM').id))).toBe('409 SWAP_LIMIT_REACHED');
    // another slot is not affected
    expect((await offered('DINNER')).swapsRemaining).toBe(3);
  });

  test('a logged slot: no candidates and swapsRemaining 0 (like the limit); a swap is 409 MEAL_ALREADY_LOGGED', async () => {
    expect((await post(NUTRITION.slice(5), { mealSlot: 'LUNCH' })).status).toBe(200);
    expect(await offered('LUNCH')).toEqual({ mealSlot: 'LUNCH', swapsRemaining: 0, candidates: [] });
    expect(code(await swap('LUNCH', mealByCode('COM_CA').id))).toBe('409 MEAL_ALREADY_LOGGED');
  });

  test('excluded tags leave the candidates at once, the planned meals stay (PATCH /settings, AR-15)', async () => {
    const answer = await send('PATCH', '/settings', JSON.stringify({ excludedMealTags: ['co:hai-san', 'co:gia-cam'] }));
    // kept once each, in the order of the list of eight (as the route does)
    expect([answer.status, answer.json.excludedMealTags]).toEqual([200, ['co:gia-cam', 'co:hai-san']]);
    expect((await offered('LUNCH')).candidates.map(item => item.code)).toEqual(['DAU_HU_NAM', 'COM_TAM']);
    expect((await slotOf('DINNER')).meal?.code).toBe('CA_AP_CHAO');
    const bad = await send('PATCH', '/settings', JSON.stringify({ excludedMealTags: ['co:nope'] }));
    expect([code(bad), fields(bad)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'excludedMealTags', rule: 'enum' }]]);
  });

  test('a closed day: the swap is 409 DAY_CLOSED, before the plan, the logged slot and the limit; the reads of a stored plan still answer', async () => {
    world.closedDate = world.day.logicalDate;
    world.plan.logged.LUNCH = true;
    expect(code(await swap('LUNCH', mealByCode('COM_CA').id))).toBe('409 DAY_CLOSED');
    expect((await get('/nutrition/plan')).status).toBe(200);
    // the body is checked first
    expect(code(await swap('BRUNCH', 'x'))).toBe('422 VALIDATION_FAILED');
    world.closedDate = undefined;
    expect(code(await swap('LUNCH', mealByCode('COM_CA').id))).toBe('409 MEAL_ALREADY_LOGGED');
  });

  test('a first read stores the plan, which only an open day takes: closed -> 409 DAY_CLOSED on both reads; no plan stored -> a swap is 409 PLAN_NOT_FOUND', async () => {
    world.plan.stored = false;
    world.closedDate = world.day.logicalDate;
    expect(code(await get('/nutrition/plan'))).toBe('409 DAY_CLOSED');
    expect(code(await get('/nutrition/swap-candidates?mealSlot=LUNCH'))).toBe('409 DAY_CLOSED');
    // a bad slot is the route's own check, before the plan is touched
    expect(code(await get('/nutrition/swap-candidates?mealSlot=BRUNCH'))).toBe('422 VALIDATION_FAILED');
    world.closedDate = undefined;
    expect(code(await swap('LUNCH', mealByCode('COM_CA').id))).toBe('409 PLAN_NOT_FOUND');
    expect((await get('/nutrition/plan')).status).toBe(200);
    expect(world.plan.stored).toBe(true);
    expect((await swap('LUNCH', (await offered('LUNCH')).candidates[0].id)).status).toBe(200);
  });

  test('before onboarding every nutrition route is 409 ONBOARDING_REQUIRED, ahead of the body', async () => {
    world.me = meOf({ progression: undefined });
    expect(code(await get('/nutrition/plan'))).toBe('409 ONBOARDING_REQUIRED');
    expect(code(await get('/nutrition/swap-candidates?mealSlot=BRUNCH'))).toBe('409 ONBOARDING_REQUIRED');
    expect(code(await swap('BRUNCH', 'x'))).toBe('409 ONBOARDING_REQUIRED');
  });

  test('PATCH /settings: each field of the route is applied, one wrong or read-only member is 422 naming every one, an unknown member is ignored', async () => {
    const patch = (body: unknown) => send('PATCH', '/settings', JSON.stringify(body));
    const changed = await patch({ nudgesEnabled: false, reminderEnabled: true, reminderWindow: 'MORNING', hideStreak: true, motion: 'REDUCED', theme: 'dark' });
    expect(changed.json).toEqual({ ...world.settings, nudgesEnabled: false, reminderEnabled: true, reminderWindow: 'MORNING', hideStreak: true, motion: 'REDUCED' });
    expect(world.settings).toMatchObject({ nudgesEnabled: false, reminderEnabled: true, reminderWindow: 'MORNING', hideStreak: true, motion: 'REDUCED', soundEnabled: false });
    expect(world.settings).not.toHaveProperty('theme');
    // nothing sent: nothing changed
    expect((await patch({})).json).toEqual(world.settings);
    const before = world.settings;
    const bad = await patch({ nudgesEnabled: 0, reminderWindow: 'NIGHT', soundEnabled: false, motion: 'NONE', excludedMealTags: 'co:sua' });
    expect([code(bad), fields(bad)]).toEqual([
      '422 VALIDATION_FAILED',
      [{ field: 'nudgesEnabled', rule: 'format' }, { field: 'reminderWindow', rule: 'enum' }, { field: 'soundEnabled', rule: 'format' }, { field: 'motion', rule: 'enum' }, { field: 'excludedMealTags', rule: 'format' }],
    ]);
    // a refusal writes nothing, even of the valid members
    expect(fields(await patch({ hideStreak: false, soundEnabled: true }))).toEqual([{ field: 'soundEnabled', rule: 'format' }]);
    expect(world.settings).toEqual(before);
  });

  test('POST /nutrition/log with a slot: the planned meal\'s kcal join the total once; the same slot again is 409 MEAL_ALREADY_LOGGED', async () => {
    const before = world.day.caloriesIn;
    const logged = await post(NUTRITION.slice(5), { mealSlot: 'DINNER' });
    expect(logged.json.day.caloriesIn).toBe(before + mealByCode('CA_AP_CHAO').kcal);
    expect((await slotOf('DINNER')).logged).toBe(true);
    expect((await plan()).caloriesIn).toBe(before + 720);
    expect(code(await post(NUTRITION.slice(5), { mealSlot: 'DINNER' }))).toBe('409 MEAL_ALREADY_LOGGED');
    world.plan.planned.SNACK = null;
    expect(code(await post(NUTRITION.slice(5), { mealSlot: 'SNACK' }))).toBe('409 PLAN_NOT_FOUND');
  });
});

// Task 37: the shop, the inventory, the perks and the pet, against server/src/routes/shop.ts, perks.ts and
// server/sql/41-shop.sql (task-37-report.md "Notes for Task 38"). The error order is that of the SQL functions.
describe('the shop, the inventory, the perks and the pet (Task 37)', () => {
  const FOREST = 'THEME_FOREST';
  const SKY = 'THEME_SKY';
  const buy = (item: string, key?: string) => send('POST', `/shop/${item}/purchase`, undefined, key);
  const equip = (item: string) => send('POST', `/inventory/${item}/equip`);
  const unlock = (body: unknown) => post('/perks/unlock', body);
  const items = (answer: Answer) => answer.json.items as { code: string; owned: boolean; equipped: boolean; locked: boolean }[];
  const coin = () => world.me.progression?.coin;
  const withPoints = (perkPointsAvailable: number) => {
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), perkPointsAvailable } };
  };
  const withCoins = (amount: number) => {
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), coin: amount } };
  };

  test('GET /shop: the purchasable and the default items in the order of the server, the balance and the level; locked is the level alone; earned badges are not for sale', async () => {
    const shop = await get('/shop');
    expect([shop.status, shop.json.coin, shop.json.level]).toEqual([200, 250, 5]);
    expect(items(shop).map(item => item.code)).toEqual(['THEME_DEFAULT', FOREST, SKY, 'SKIN_DEFAULT', 'SKIN_FOX', 'BADGE_NEW_DAY', 'BADGE_STEP_BY_STEP']);
    expect(items(shop).filter(item => item.locked).map(item => item.code)).toEqual([SKY]);
    // the defaults are owned, and in use while nothing of their kind is equipped
    expect(items(shop).filter(item => item.owned || item.equipped).map(item => [item.code, item.owned, item.equipped])).toEqual([
      ['THEME_DEFAULT', true, true],
      ['SKIN_DEFAULT', true, true],
    ]);
    expect(shop.json.items[1]).toEqual({ code: FOREST, name: 'Rừng xanh', kind: 'THEME', priceCoin: 80, minLevel: 1, assetKey: 'forest', purchasable: true, isDefault: false, owned: false, equipped: false, locked: false });
  });

  test('GET /inventory: the defaults, what was bought, an earned badge; nothing else', async () => {
    expect(items(await get('/inventory')).map(item => item.code)).toEqual(['THEME_DEFAULT', 'SKIN_DEFAULT']);
    world.shop.owned = [FOREST, 'BADGE_STREAK_7'];
    expect(items(await get('/inventory')).map(item => item.code)).toEqual(['THEME_DEFAULT', FOREST, 'SKIN_DEFAULT', 'BADGE_STREAK_7']);
  });

  test('a purchase: the coins go down by the price, the item is owned, the answer is { coin, item }; the same key again is the stored answer and charges nothing', async () => {
    const bought = await buy(FOREST);
    expect([bought.status, bought.json.coin, coin()]).toEqual([200, 170, 170]);
    expect(bought.json.item).toMatchObject({ code: FOREST, owned: true, equipped: false });
    expect(world.shop.owned).toEqual([FOREST]);
    const replay = await buy(FOREST, bought.key);
    expect([replay.status, replay.json, coin(), world.shop.owned]).toEqual([200, bought.json, 170, [FOREST]]);
    // the same key for another item is another request
    expect(code(await buy('SKIN_FOX', bought.key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
  });

  test('the refusals, each with its status and details, in the order of shop_purchase: item, for sale, level, owned, coins', async () => {
    expect(code(await buy('NOPE'))).toBe('404 ITEM_NOT_FOUND');
    expect(code(await buy('BADGE_STREAK_7'))).toBe('409 ITEM_NOT_PURCHASABLE');
    expect(code(await buy('THEME_DEFAULT'))).toBe('409 ITEM_NOT_PURCHASABLE');
    // level before coins: the sky opens at level 8 and costs 300, and the person has neither
    withCoins(0);
    const locked = await buy(SKY);
    expect([code(locked), locked.json.error.details]).toEqual(['409 ITEM_LOCKED_LEVEL', { minLevel: 8 }]);
    // level before owned
    world.shop.owned = [SKY];
    expect(code(await buy(SKY))).toBe('409 ITEM_LOCKED_LEVEL');
    // owned before coins
    world.shop.owned = [FOREST];
    expect(code(await buy(FOREST))).toBe('409 ALREADY_OWNED');
    world.shop.owned = [];
    withCoins(30);
    const poor = await buy(FOREST);
    expect([code(poor), poor.json.error.details]).toEqual(['409 INSUFFICIENT_COINS', { price: 80, coin: 30 }]);
    // a refusal writes nothing, and its key is free again (only a 2xx is remembered)
    expect([coin(), world.shop.owned]).toEqual([30, []]);
    withCoins(250);
    expect((await buy(FOREST, poor.key)).status).toBe(200);
  });

  test('every route of these is for an onboarded user first: ONBOARDING_REQUIRED, before the item is even looked at', async () => {
    world.me = { ...world.me, progression: null };
    for (const answer of [await get('/shop'), await get('/inventory'), await get('/perks'), await get('/pet'), await buy('NOPE'), await equip('NOPE'), await unlock({})]) {
      expect(code(answer)).toBe('409 ONBOARDING_REQUIRED');
    }
  });

  test('equip: an item that is not the person\'s (an unknown code too) is 409 ITEM_NOT_OWNED; one item per kind is in use afterwards, the other kinds are not touched; a default leaves the kind with none', async () => {
    expect(code(await equip(FOREST))).toBe('409 ITEM_NOT_OWNED');
    expect(code(await equip('NOPE'))).toBe('409 ITEM_NOT_OWNED');
    world.shop.owned = [FOREST, 'SKIN_FOX', 'BADGE_STREAK_7'];
    const skin = await equip('SKIN_FOX');
    expect(skin.status).toBe(200);
    const theme = await equip(FOREST);
    expect(items(theme).filter(item => item.equipped).map(item => item.code)).toEqual([FOREST, 'SKIN_FOX']);
    expect(world.me.appearance).toEqual({ themeCode: FOREST, petSkinCode: 'SKIN_FOX', badgeCode: null });
    expect((await get('/me')).json.appearance).toEqual(world.me.appearance);
    expect(world.me.pet?.skinCode).toBe('SKIN_FOX');
    // the default theme: no theme row is equipped, and the default says "in use" again
    const back = await equip('THEME_DEFAULT');
    expect(items(back).filter(item => item.equipped).map(item => item.code)).toEqual(['THEME_DEFAULT', 'SKIN_FOX']);
    expect(world.shop.equipped.THEME).toBeNull();
    expect((await get('/me')).json.appearance).toEqual({ themeCode: 'THEME_DEFAULT', petSkinCode: 'SKIN_FOX', badgeCode: null });
    // a badge is equipped like the others
    await equip('BADGE_STREAK_7');
    expect(world.me.appearance?.badgeCode).toBe('BADGE_STREAK_7');
  });

  test('GET /perks: the three perks in order with their costs, the points of the profile; GET /pet is the profile\'s Mầm', async () => {
    withPoints(3);
    const perks = await get('/perks');
    expect(perks.json).toEqual({
      pointsAvailable: 3,
      perks: [
        { code: 'MEAL_SWAP_PLUS', cost: 2, unlocked: false, repeatable: false },
        { code: 'TICKET_CAP_PLUS', cost: 3, unlocked: false, repeatable: false },
        { code: 'THEME_UNLOCK', cost: 1, unlocked: false, repeatable: true },
      ],
    });
    expect((await get('/pet')).json).toEqual(world.me.pet);
  });

  test('POST /perks/unlock: the body is checked first (422 naming each member); itemCode matters to THEME_UNLOCK only', async () => {
    withPoints(3);
    const none = await unlock({});
    expect([code(none), fields(none)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'perkCode', rule: 'required' }]]);
    expect(fields(await unlock({ perkCode: 'NOPE' }))).toEqual([{ field: 'perkCode', rule: 'enum' }]);
    expect(fields(await unlock({ perkCode: 'THEME_UNLOCK' }))).toEqual([{ field: 'itemCode', rule: 'required' }]);
    expect(fields(await unlock({ perkCode: 'THEME_UNLOCK', itemCode: 7 }))).toEqual([{ field: 'itemCode', rule: 'format' }]);
    // another perk ignores whatever itemCode says
    expect((await unlock({ perkCode: 'MEAL_SWAP_PLUS', itemCode: 7 })).status).toBe(200);
  });

  test('MEAL_SWAP_PLUS and TICKET_CAP_PLUS once each: already unlocked before the points; too few points 409; the points go down by the cost and the answer is the perks', async () => {
    withPoints(2);
    expect(code(await unlock({ perkCode: 'TICKET_CAP_PLUS' }))).toBe('409 PERK_POINTS_INSUFFICIENT');
    expect(world.shop.unlocked).toEqual([]);
    const done = await unlock({ perkCode: 'MEAL_SWAP_PLUS' });
    expect([done.status, done.json.pointsAvailable, done.json.perks[0].unlocked, world.me.progression?.perkPointsAvailable]).toEqual([200, 0, true, 0]);
    // 0 points left, and the perk is used: "already" is said, not "not enough"
    expect(code(await unlock({ perkCode: 'MEAL_SWAP_PLUS' }))).toBe('409 PERK_ALREADY_UNLOCKED');
    expect(world.shop.unlocked).toEqual([{ perk: 'MEAL_SWAP_PLUS', cost: 2 }]);
  });

  test('THEME_UNLOCK: a theme that is not a theme, or is the default, is 404; owned, then the level (with minLevel), then the points; the theme is added, coins untouched, and the perk can be used again', async () => {
    withPoints(0);
    for (const itemCode of ['NOPE', 'SKIN_FOX', 'THEME_DEFAULT']) expect(code(await unlock({ perkCode: 'THEME_UNLOCK', itemCode }))).toBe('404 ITEM_NOT_FOUND');
    world.shop.owned = [FOREST];
    expect(code(await unlock({ perkCode: 'THEME_UNLOCK', itemCode: FOREST }))).toBe('409 ALREADY_OWNED');
    const locked = await unlock({ perkCode: 'THEME_UNLOCK', itemCode: SKY });
    expect([code(locked), locked.json.error.details]).toEqual(['409 ITEM_LOCKED_LEVEL', { minLevel: 8 }]);
    // everything the theme needs is there but the point
    world.shop.owned = [];
    expect(code(await unlock({ perkCode: 'THEME_UNLOCK', itemCode: FOREST }))).toBe('409 PERK_POINTS_INSUFFICIENT');
    withPoints(2);
    const coins = coin();
    const opened = await unlock({ perkCode: 'THEME_UNLOCK', itemCode: FOREST });
    expect([opened.status, opened.json.pointsAvailable, opened.json.perks[2], coin(), world.shop.owned]).toEqual([200, 1, { code: 'THEME_UNLOCK', cost: 1, unlocked: true, repeatable: true }, coins, [FOREST]]);
    expect(code(await unlock({ perkCode: 'THEME_UNLOCK', itemCode: FOREST }))).toBe('409 ALREADY_OWNED');
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), level: 8 } };
    expect((await unlock({ perkCode: 'THEME_UNLOCK', itemCode: SKY })).json.pointsAvailable).toBe(0);
  });

  test('an undo whose coins were spent (a purchase inside the window) is 409 UNDO_COINS_SPENT and writes nothing; DAY_CLOSED comes first', async () => {
    withCoins(78);
    const tick = await post(WATER_TICK, {}); // +5 coins: 83
    expect(coin()).toBe(83);
    expect((await buy(FOREST)).status).toBe(200); // 3 left
    world.closedDate = world.day.logicalDate;
    expect(code(await post(WATER_UNDO, { tickId: tick.key }))).toBe('409 DAY_CLOSED');
    world.closedDate = undefined;
    const refused = await post(WATER_UNDO, { tickId: tick.key });
    expect(code(refused)).toBe('409 UNDO_COINS_SPENT');
    expect([coin(), quest(world.day, 'WATER_8').progress]).toEqual([3, 4]);
    // the coins are back (a later grant): the same undo goes through
    withCoins(10);
    expect((await post(WATER_UNDO, { tickId: tick.key })).status).toBe(200);
    expect(coin()).toBe(5);
  });
});
