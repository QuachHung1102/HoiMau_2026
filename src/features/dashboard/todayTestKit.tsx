/* eslint-env jest */
// Test kit for the home tab and its water tracker (used by *.test.tsx files; never imported by app code).
// The whole app as App.tsx mounts it (the sync kit), opened on the first tab, against a small stand-in for the day
// routes of the server: it keeps a day and a profile, applies a write to both, and answers as the routes of server
// Tasks 20 and 21 do (status, error code, body, what a replay remembers).
import { configure, screen } from '@testing-library/react-native';
import type { ActionResult, GameEvent } from '../../../domain/contract/common.ts';
import type { DayState, Me, QuestState, Settings } from '../../../domain/contract/core.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { cumulativeXpForLevel, levelForXp, perkPointsEarned, titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { mapStats } from '../../../domain/stats.ts';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { clearCelebrations } from '../progression/celebrations';
import { tickPath, WATER } from '../quests/api';
import { fetchMock, installSyncTestEnv, mountApp, refuse, respond, settle, tabsSettled, USER, writes } from '../sync/syncTestKit';

export { app, fetchMock, idsOnDisk, queryClient, refuse, requested, respond, seedQueue, settle, stored, USER, writes } from '../sync/syncTestKit';

const BASE = 'http://localhost:8787/api/v1';
const HOUR = 60 * 60 * 1000;
const LEVEL = 5;
export const TICK = `POST ${tickPath(WATER)}`;
export const UNDO = `POST /day/quests/${WATER}/undo`;
export const STAND_UP = 'STAND_UP';
export const BEDTIME = 'POST /day/bedtime';
export const NUTRITION = 'POST /nutrition/log';
export const HIDDEN = 'BEDTIME_BEFORE_23';
const NUTRITION_QUEST = 'NUTRITION_TARGET';
/** The kcal target behind the fixture's calorie window and its `en` stat. */
const CALORIE_TARGET = 2394;

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
    calorieWindow: calorieWindow(CALORIE_TARGET),
    quests: [
      quest('WORKOUT_MAIN', 'STORY', 50, 20),
      quest('NUTRITION_TARGET', 'STORY', 50, 20),
      quest(WATER, 'DAILY', 10, 5, { progress: 3, targetCount: 8, lastTick: { id: '8a3f6c1e-2b47-4d19-9c05-71e2a4b6d803', at: new Date(now - HOUR).toISOString() }, ...water }),
      quest('STAND_UP', 'DAILY', 10, 5, { targetCount: 6 }),
      quest('BEDTIME_BEFORE_23', 'HIDDEN', 30, 15, { locked: true }),
    ],
    story: { done: 0, total: 2 },
    streak: { current: 4, best: 9 },
    unreadCount: 0,
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
 * The stand-in server. A test changes `day`, `me`, `settings`; sets `down` for "no connection"; sets `hour` (the
 * hour of the server's clock in the user's zone, which only the bedtime mark reads); or takes a request over with
 * `answer` ("METHOD /path" -> a response, a promise of one, or undefined to let the server answer).
 * What it answers is what server Tasks 20 and 21 answer (task-20-report.md §6, task-21-report.md §8): only what the
 * mobile tests exercise is modelled, and the places where it stays short say `not modelled`.
 */
export const world = {} as {
  day: DayState;
  me: Me;
  settings: Settings;
  down: boolean;
  /** The server's wall-clock hour (0-23, the user's zone) for a bedtime mark that names no `occurredAt`. */
  hour: number;
  /** The logicalDate the server calls closed (and every earlier one): a write for that day meets `409 DAY_CLOSED`. */
  closedDate?: string;
  /** How far the device's clock runs ahead of the server's, in ms: `occurredAt` is judged by the server's clock. */
  skew: number;
  /** The highest XP the profile has had: LEVEL_UP fires when a grant moves it over a level. */
  highWater?: number;
  /** Minutes of the last seven days, behind `stats.str` and `stats.spd`. */
  minutes: { resistance: number; cardio: number };
  answer?: (request: string, init: Init) => unknown;
};

// ---- how the server refuses, and what it remembers ----

class Stop {
  constructor(readonly answer: unknown) {}
}
/** Runs a request; a refusal raised by `stop` is its answer. */
export function guard(run: () => unknown) {
  try {
    return run();
  } catch (failure) {
    if (failure instanceof Stop) return failure.answer;
    throw failure;
  }
}
/** Ends the request with this refusal. */
export function stop(status: number, code: string, fields?: { field: string; rule: string }[]): never {
  throw new Stop(refuse(status, code, fields && { fields }));
}

const replies = new Map<string, { request: string; body: string; answer: { ok: boolean } }>();
const canonical = (text: string | undefined) =>
  JSON.stringify(text === undefined ? null : JSON.parse(text), (_name, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value,
  );
/**
 * Runs a write once per key: `run` gets the key and the body, which must be a JSON object. Only a 2xx is remembered
 * under its key (a refusal runs again); the same key with another path or body is `409 IDEMPOTENCY_KEY_REUSED`.
 */
export function keyed(request: string, init: Init, run: (key: string, body: Record<string, unknown>) => { ok: boolean }) {
  const key = init.headers['Idempotency-Key'];
  const body = canonical(init.body);
  const known = replies.get(key);
  if (known) return known.request === request && known.body === body ? known.answer : refuse(409, 'IDEMPOTENCY_KEY_REUSED');
  return guard(() => {
    if (init.body === undefined) stop(422, 'VALIDATION_FAILED', [{ field: 'body', rule: 'required' }]);
    const parsed: unknown = JSON.parse(init.body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) stop(422, 'VALIDATION_FAILED', [{ field: 'body', rule: 'format' }]);
    const answer = run(key, parsed as Record<string, unknown>);
    if (answer.ok) replies.set(key, { request, body, answer });
    return answer;
  });
}

const INSTANT = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
/**
 * The `occurredAt` rules of every day write: not an RFC 3339 instant -> 422 format; more than 120 s ahead -> 422
 * OCCURRED_AT_INVALID; older than 48 h, or a closed day -> 409 DAY_CLOSED. Not modelled: a write that lands on a day
 * other than the one in `world.day` (the fixture's date is not tied to the clock), and a year past 9999.
 */
export function checkOccurredAt(body: Record<string, unknown>) {
  const { occurredAt } = body;
  if (occurredAt !== undefined) {
    const [, year, month, day] = (typeof occurredAt === 'string' && INSTANT.exec(occurredAt)) || [];
    const at = Date.parse(String(occurredAt));
    // a date that exists: 30 February is not rolled over into March
    if (!year || Number.isNaN(at) || new Date(Date.UTC(+year, +month - 1, +day)).getUTCDate() !== +day) stop(422, 'VALIDATION_FAILED', [{ field: 'occurredAt', rule: 'format' }]);
    const now = Date.now() - world.skew;
    if (at > now + 120_000) stop(422, 'OCCURRED_AT_INVALID');
    if (at < now - 48 * HOUR) stop(409, 'DAY_CLOSED');
  }
  if (world.closedDate !== undefined && world.day.logicalDate <= world.closedDate) stop(409, 'DAY_CLOSED');
}

// ---- what a write changes ----

const questOf = (code: string) => world.day.quests.find(item => item.code === code);
/** The day after a write, with its own `serverTime`: later than that of any answer before it. */
export function changeDay(change: (day: DayState) => DayState) {
  world.day = { ...change(world.day), serverTime: new Date().toISOString() };
}
export const completeQuest = (code: string) =>
  changeDay(day => ({ ...day, quests: day.quests.map(item => (item.code === code ? { ...item, progress: item.targetCount, completed: true } : item)) }));
const storyDone = () => world.day.quests.filter(item => item.category === 'STORY' && item.completed).length;
export const storyWhole = () => storyDone() === world.day.story.total;
/** Settles the story counter after a write; STORY_ALL_DONE when that write made the story whole. */
export function settleStory(wasWhole: boolean): GameEvent[] {
  changeDay(day => ({ ...day, story: { ...day.story, done: storyDone() } }));
  return !wasWhole && storyWhole() ? [{ type: 'STORY_ALL_DONE' }] : [];
}

/** The four stats as `mapStats` gives them: today's water, bedtime mark and calories, and the minutes. */
export function refreshStats() {
  if (!world.me.stats) return;
  const { day, minutes, me } = world;
  world.me = {
    ...me,
    stats: mapStats({
      waterMl: day.waterMl,
      waterTargetMl: day.waterTargetMl,
      bedtimeMarked: day.bedtimeMarkedAt !== null,
      streakCurrent: me.progression?.streakCurrent ?? day.streak.current,
      caloriesIn: day.caloriesIn,
      calorieTarget: CALORIE_TARGET,
      resistanceMinutes7d: minutes.resistance,
      cardioMinutes7d: minutes.cardio,
    }),
  };
}
/** The server's grant: the XP sum moves (never below 0), the level follows it, LEVEL_UP when the high-water mark crosses a level. */
export function pay(xp: number, coin: number): GameEvent[] {
  const { progression } = world.me;
  if (!progression) return [];
  const total = Math.max(0, progression.xp + xp);
  const before = world.highWater ?? progression.xp;
  const after = (world.highWater = Math.max(before, total));
  const { level, xpIntoLevel, xpForNextLevel } = levelForXp(total);
  world.me = { ...world.me, progression: { ...progression, xp: total, level, titleKey: titleKeyForLevel(level), xpIntoLevel, xpForNextLevel, coin: progression.coin + coin } };
  const up = levelForXp(after).level;
  return up > levelForXp(before).level ? [{ type: 'LEVEL_UP', level: up, titleKey: titleKeyForLevel(up), perkPointsGained: perkPointsEarned(after) - perkPointsEarned(before) }] : [];
}
/** The profile `xpShort` XP below the next level: the next grant of that size levels up. */
export function nearLevelUp(xpShort = 5) {
  const { progression } = world.me;
  if (!progression) return;
  const xp = cumulativeXpForLevel(progression.level + 1) - xpShort;
  world.me = { ...world.me, progression: { ...progression, xp, xpIntoLevel: xp - cumulativeXpForLevel(progression.level) } };
  world.highWater = undefined;
}
/** The 200 of a day write. */
export function answerOf(actionId: string, delta: ActionResult['delta']) {
  refreshStats();
  return respond(200, { actionId, day: world.day, delta } satisfies ActionResult);
}

// ---- the routes ----

/** Ticks the server has per quest, oldest first; the fixture's own `lastTick` is the first one of its quest. */
const ledger = new Map<string, { id: string; at: string; undone: boolean }[]>();
function ticksOf(code: string) {
  const first = questOf(code)?.lastTick;
  if (!ledger.has(code)) ledger.set(code, first ? [{ ...first, undone: false }] : []);
  return ledger.get(code) ?? [];
}
const UNDO_WINDOW_MS = 10_000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the stand-in server answers by itself; a test that takes a request over can still let it happen. */
export function serverAnswer(request: string, init: Init): unknown {
  if (world.down) throw new TypeError('Network request failed');
  if (request === 'GET /me') return respond(200, world.me);
  if (request === 'GET /day') return respond(200, world.day);
  if (request === 'GET /settings') return respond(200, world.settings);
  if (request === 'POST /auth/logout') return respond(204);
  if (request === BEDTIME) return keyed(request, init, bedtime);
  if (request === NUTRITION) return keyed(request, init, nutritionLog);
  const [, code, verb] = /^POST \/day\/quests\/([^/]+)\/(progress|undo)$/.exec(request) ?? [];
  if (verb === 'progress') return keyed(request, init, (key, body) => tick(code, key, body));
  if (verb === 'undo') return keyed(request, init, (key, body) => undo(code, key, body));
  return respond(404);
}

/** One tick of a DAILY daily. Refusals in the server's order: unknown, not tickable, `occurredAt`, complete. */
function tick(code: string, id: string, body: Record<string, unknown>) {
  const daily = questOf(code);
  if (!daily) stop(404, 'QUEST_NOT_FOUND');
  if (daily.category !== 'DAILY') stop(409, 'QUEST_NOT_TICKABLE');
  checkOccurredAt(body);
  if (daily.progress >= daily.targetCount) stop(409, 'QUEST_ALREADY_COMPLETE');
  const made = { id, at: new Date().toISOString() };
  ticksOf(code).push({ ...made, undone: false });
  return moveBy(1, daily, made, id);
}
/** Takes back a live tick of that daily: the latest one, inside its own 10 s. */
function undo(code: string, id: string, body: Record<string, unknown>) {
  const { tickId } = body;
  if (typeof tickId !== 'string' || !UUID.test(tickId)) stop(422, 'VALIDATION_FAILED', [{ field: 'tickId', rule: tickId === undefined ? 'required' : 'format' }]);
  const daily = questOf(code);
  const live = ticksOf(code).filter(item => !item.undone);
  const target = live.find(item => item.id === tickId);
  if (!daily || !target) stop(404, 'TICK_NOT_FOUND');
  if (live.at(-1) !== target) stop(409, 'UNDO_NOT_LATEST');
  if (Date.now() - Date.parse(target.at) > UNDO_WINDOW_MS) stop(409, 'UNDO_WINDOW_EXPIRED');
  target.undone = true;
  const previous = live.at(-2);
  return moveBy(-1, daily, previous ? { id: previous.id, at: previous.at } : null, id);
}
function moveBy(by: 1 | -1, daily: QuestState, lastTick: QuestState['lastTick'], id: string) {
  const progress = daily.progress + by;
  changeDay(day => ({
    ...day,
    waterMl: daily.code === WATER ? Math.round((day.waterTargetMl * progress) / daily.targetCount) : day.waterMl,
    quests: day.quests.map(item => (item.code === daily.code ? { ...item, progress, completed: progress >= item.targetCount, lastTick } : item)),
  }));
  const xp = by * daily.xpReward;
  const coin = by * daily.coinReward;
  const paid = pay(xp, coin);
  // QUEST_COMPLETED on the tick that reaches the target; an undo carries no events
  const events: GameEvent[] = by === 1 ? [...(progress >= daily.targetCount ? [{ type: 'QUEST_COMPLETED', questCode: daily.code } as GameEvent] : []), ...paid] : [];
  return answerOf(id, { xp, coin, events });
}

/** The hour of `occurredAt` (or of the server's clock) in the user's zone: UTC+7, Asia/Ho_Chi_Minh has no daylight saving. */
const hourOf = (body: Record<string, unknown>) => (typeof body.occurredAt === 'string' ? (new Date(body.occurredAt).getUTCHours() + 7) % 24 : world.hour);
/** "Close today": 03:00-17:59 is too early; 18:00-22:59 completes the hidden quest, once; the earliest mark is kept. */
function bedtime(id: string, body: Record<string, unknown>) {
  checkOccurredAt(body);
  const hour = hourOf(body);
  if (hour >= 3 && hour < 18) stop(409, 'BEDTIME_TOO_EARLY');
  const hidden = questOf(HIDDEN);
  const reward = hour >= 18 && hour < 23 && hidden !== undefined && !hidden.completed;
  const at = new Date(typeof body.occurredAt === 'string' ? body.occurredAt : Date.now()).toISOString();
  changeDay(day => ({ ...day, bedtimeMarkedAt: day.bedtimeMarkedAt !== null && day.bedtimeMarkedAt < at ? day.bedtimeMarkedAt : at }));
  if (!reward) return answerOf(id, { xp: 0, coin: 0, events: [] });
  completeQuest(HIDDEN);
  return answerOf(id, { xp: hidden.xpReward, coin: hidden.coinReward, events: [{ type: 'QUEST_COMPLETED', questCode: HIDDEN }, ...pay(hidden.xpReward, hidden.coinReward)] });
}

const SLOTS = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
/** The manual calorie log: 1 to 5000 (fractions allowed), the total is the sum, the nutrition quest latches inside the window. */
function nutritionLog(id: string, body: Record<string, unknown>) {
  const { kcal, mealSlot, label } = body;
  if (kcal !== undefined && mealSlot !== undefined) stop(422, 'VALIDATION_FAILED', [{ field: 'mealSlot', rule: 'format' }]);
  if (mealSlot !== undefined) {
    if (typeof mealSlot !== 'string' || !SLOTS.includes(mealSlot)) stop(422, 'VALIDATION_FAILED', [{ field: 'mealSlot', rule: 'enum' }]);
    stop(409, 'PLAN_NOT_FOUND'); // until Task 33
  }
  const fields: { field: string; rule: string }[] = [];
  if (kcal === undefined) fields.push({ field: 'kcal', rule: 'required' });
  else if (typeof kcal !== 'number') fields.push({ field: 'kcal', rule: 'format' });
  else if (kcal < 1) fields.push({ field: 'kcal', rule: 'min' });
  else if (kcal > 5000) fields.push({ field: 'kcal', rule: 'max' });
  if (label !== undefined && label !== null) {
    if (typeof label !== 'string') fields.push({ field: 'label', rule: 'format' });
    else if ([...label.normalize('NFC').trim()].length > 60) fields.push({ field: 'label', rule: 'max' });
  }
  if (fields.length > 0) stop(422, 'VALIDATION_FAILED', fields);
  checkOccurredAt(body);
  const wasWhole = storyWhole();
  const caloriesIn = world.day.caloriesIn + (kcal as number);
  const { min, max } = world.day.calorieWindow;
  const meal = questOf(NUTRITION_QUEST);
  const reward = meal !== undefined && !meal.completed && caloriesIn >= min && caloriesIn <= max;
  changeDay(day => ({ ...day, caloriesIn }));
  if (!reward) return answerOf(id, { xp: 0, coin: 0, events: [] });
  completeQuest(NUTRITION_QUEST);
  const events: GameEvent[] = [{ type: 'QUEST_COMPLETED', questCode: NUTRITION_QUEST }, ...settleStory(wasWhole), ...pay(meal.xpReward, meal.coinReward)];
  return answerOf(id, { xp: meal.xpReward, coin: meal.coinReward, events });
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
  const view = await mountApp({ landed: false, ...options });
  await screen.findByRole('header', { name: tabLabel.Today });
  await settle();
  await tabsSettled();
  return view;
}

/** The ticks that reached the server, in order: the action id of each. */
export const tickIds = () =>
  writes()
    .filter(request => request.path === tickPath(WATER))
    .map(request => request.id);
export const undos = () => writes().filter(request => request.path === `/day/quests/${WATER}/undo`);

export function installTodayTestEnv() {
  // A step of these tests can be a delivery by the queue plus the reads that follow it; on a machine that is busy
  // with other suites that takes longer than the default second.
  configure({ asyncUtilTimeout: 3000 });
  installSyncTestEnv();
  beforeEach(() => {
    replies.clear();
    ledger.clear();
    Object.assign(world, { day: dayOf(), me: meOf(), settings: settingsOf(), down: false, hour: 19, closedDate: undefined, skew: 0, highWater: undefined, minutes: { resistance: 60, cardio: 45 }, answer: undefined });
    fetchMock.mockImplementation(async (url, init) => {
      const request = `${init.method} ${url.replace(BASE, '')}`;
      const taken = await world.answer?.(request, init);
      return taken ?? serverAnswer(request, init);
    });
  });
  afterEach(() => clearCelebrations());
}
