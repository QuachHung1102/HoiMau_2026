/* eslint-env jest */
// Test kit for the home tab and its water tracker (used by *.test.tsx files; never imported by app code).
// The whole app as App.tsx mounts it (the sync kit), opened on the first tab, against a small stand-in for the day
// routes of the server: it keeps a day and a profile, applies a write to both, and answers as the routes of server
// Tasks 20 and 21 do (status, error code, body, what a replay remembers).
import { configure, screen } from '@testing-library/react-native';
import type { ActionResult, GameEvent } from '../../../domain/contract/common.ts';
import type { Inventory, Meal, MealPlanState, PurchaseResult, Shop, ShopItem, SwapCandidates } from '../../../domain/contract/content.ts';
import type { DayDetail, DaySummary, DayState, Inbox, InboxItem, InboxReadResult, Me, PerkCode, Perks, QuestState, Settings } from '../../../domain/contract/core.ts';
import type { GuildRole, GuildState, JournalCreateResult, JournalEntry, JournalList, Leaderboard, NudgeBlockReason, NudgeResult, NudgeTemplates, Quote, Tickets } from '../../../domain/contract/social.ts';
import { JOURNAL_XP, PERKS } from '../../../domain/economy.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { GUILD_INACTIVE_DAYS, GUILD_MAX_MEMBERS } from '../../../domain/guild.ts';
import { findBannedTerms } from '../../../domain/language.ts';
import { addDays, daysBetween, weekStartOf } from '../../../domain/logicalDate.ts';
import { rankMeals, slotTarget } from '../../../domain/mealPlan.ts';
import { cumulativeXpForLevel, levelForXp, perkPointsEarned, titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { mapStats } from '../../../domain/stats.ts';
import { closeDays, ticketPreview, type DayInput, type StreakState } from '../../../domain/streak.ts';
import { INGREDIENT_TAGS, type IngredientTag, type MealSlot } from '../../../domain/types.ts';
import { isDisplayName, LIMITS, stripUnseen } from '../../../domain/validation.ts';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { NUDGE_TEMPLATES } from '../../../server/content/nudgeTemplates.ts';
import { QUOTES } from '../../../server/content/quotes.ts';
import { SHOP_ITEMS } from '../../../server/content/shopItems.ts';
import fixture from '../nutrition/mealFixture.json';
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
export const INBOX_READ = 'POST /inbox/read';
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
    appearance: { themeCode: 'THEME_DEFAULT', petSkinCode: 'SKIN_DEFAULT', badgeCode: null },
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
  /** What `GET /day/history` knows per date; a date not listed is OPEN from today on and NONE before. */
  history: Record<string, DayDetail>;
  /** Minutes of the last seven days, behind `stats.str` and `stats.spd`. */
  minutes: { resistance: number; cardio: number };
  /** Today's meal plan: the meal of each slot, what is logged, the swaps used, the meals each slot has shown. */
  plan: ReturnType<typeof freshPlan>;
  /** What the shop knows of this person: items bought, the item equipped per kind, perks unlocked. */
  shop: ReturnType<typeof freshShop>;
  /** Every guild the server knows (the caller's own, when the caller is a member of one, among them) and the nudges the caller has sent today. */
  guild: ReturnType<typeof freshGuild>;
  /** The caller's notifications (`GET /inbox`), in any order; `seedInbox` keeps the day's unread count in step with them. */
  inbox: InboxItem[];
  /** The caller's journal entries and the POST /journal calls of the last minute (the limiter). */
  journal: ReturnType<typeof freshJournal>;
  /** The caller's freeze tickets and the streak facts behind what a ticket would protect (GET /freeze-tickets). */
  tickets: ReturnType<typeof freshTickets>;
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
/** Ends the request with a refusal that carries its own `details` (`{ minLevel }`, `{ price, coin }`). */
function stopWith(status: number, code: string, details: Record<string, unknown>): never {
  throw new Stop(refuse(status, code, details));
}

const replies = new Map<string, { request: string; body: string; answer: { ok: boolean } }>();
const canonical = (text: string | undefined) =>
  JSON.stringify(text === undefined ? null : JSON.parse(text), (_name, value) =>
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value,
  );
/**
 * Runs a write once per key: `run` gets the key and the body, which must be a JSON object. Only a 2xx is remembered
 * under its key (a refusal runs again); the same key with another path or body is `409 IDEMPOTENCY_KEY_REUSED`.
 * `bodyless`: a route that takes no body (a purchase, an equip): `run` gets `{}`.
 */
export function keyed(request: string, init: Init, run: (key: string, body: Record<string, unknown>) => { ok: boolean }, bodyless = false) {
  const key = init.headers['Idempotency-Key'];
  const body = canonical(init.body);
  const known = replies.get(key);
  if (known) return known.request === request && known.body === body ? known.answer : refuse(409, 'IDEMPOTENCY_KEY_REUSED');
  return guard(() => {
    if (bodyless) {
      const answer = run(key, {});
      if (answer.ok) replies.set(key, { request, body, answer });
      return answer;
    }
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
  if (dayClosed()) stop(409, 'DAY_CLOSED');
}
/** Today is not open: at or before the last closed date. (Not modelled: a day before the first one.) */
const dayClosed = () => world.closedDate !== undefined && world.day.logicalDate <= world.closedDate;

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
  if (request === 'GET /nutrition/plan') return guard(readPlan);
  const [, mealQuery] = /^GET \/nutrition\/swap-candidates(?:\?(.*))?$/.exec(request) ?? [];
  if (request.startsWith('GET /nutrition/swap-candidates')) return guard(() => candidates(new URLSearchParams(mealQuery)));
  if (request === 'POST /nutrition/swap') return guard(() => {
    onboarded();
    return keyed(request, init, swapMeal);
  });
  if (request === 'PATCH /settings') return keyed(request, init, patchSettings);
  const [, boughtCode] = /^POST \/shop\/([^/]+)\/purchase$/.exec(request) ?? [];
  if (boughtCode) return guard(() => {
    onboarded();
    return keyed(request, init, () => purchase(decodeURIComponent(boughtCode)), true);
  });
  const [, equipCode] = /^POST \/inventory\/([^/]+)\/equip$/.exec(request) ?? [];
  if (equipCode) return guard(() => {
    onboarded();
    return keyed(request, init, () => equip(decodeURIComponent(equipCode)), true);
  });
  if (request === 'GET /guilds/me') return guard(() => {
    onboarded();
    return respond(200, guildState());
  });
  if (request === 'POST /guilds') return guard(() => {
    onboarded();
    return keyed(request, init, (_key, body) => createGuild(body));
  });
  if (request === 'POST /guilds/join') return guard(() => {
    onboarded();
    return keyed(request, init, (_key, body) => joinGuild(body));
  });
  if (request === 'POST /guilds/me/leave') return guard(() => {
    onboarded();
    return keyed(request, init, leaveGuild, true);
  });
  if (request === 'POST /guilds/me/transfer') return guard(() => {
    onboarded();
    return keyed(request, init, (_key, body) => transferGuild(body));
  });
  if (request === 'GET /guilds/nudge-templates') return guard(() => {
    onboarded();
    return respond(200, { templates: [...NUDGE_TEMPLATES].sort((a, b) => (a.code < b.code ? -1 : 1)) } satisfies NudgeTemplates);
  });
  if (request === 'POST /guilds/nudge') return guard(() => {
    limitNudges();
    onboarded();
    return keyed(request, init, (_key, body) => sendNudge(body));
  });
  const [, boardQuery] = /^GET \/leaderboard(?:\?(.*))?$/.exec(request) ?? [];
  if (request.startsWith('GET /leaderboard')) return guard(() => {
    onboarded();
    return leaderboard(new URLSearchParams(boardQuery));
  });
  const [, inboxQuery] = /^GET \/inbox(?:\?(.*))?$/.exec(request) ?? [];
  if (request.startsWith('GET /inbox')) return guard(() => {
    onboarded();
    return inboxPage(new URLSearchParams(inboxQuery));
  });
  if (request === 'POST /journal') return guard(() => {
    limitJournal();
    onboarded();
    return keyed(request, init, createEntry);
  });
  const [, journalQuery] = /^GET \/journal(?:\?(.*))?$/.exec(request) ?? [];
  if (/^GET \/journal(\?.*)?$/.test(request)) return guard(() => {
    onboarded();
    return journalPage(new URLSearchParams(journalQuery));
  });
  const [, entryId] = /^GET \/journal\/([^/?]*)$/.exec(request) ?? [];
  if (entryId !== undefined) return guard(() => {
    onboarded();
    return journalEntry(decodeURIComponent(entryId));
  });
  if (request === 'GET /freeze-tickets') return guard(() => {
    onboarded();
    return respond(200, ticketsState());
  });
  if (request === 'POST /freeze-tickets/use') return guard(() => {
    onboarded();
    return keyed(request, init, (_key, body) => useTicket(body));
  });
  if (request === 'POST /perks/unlock') return guard(() => {
    onboarded();
    return keyed(request, init, (_key, body) => unlockPerk(body));
  });
  const reads: Record<string, () => unknown> = { 'GET /shop': shopState, 'GET /inventory': inventoryState, 'GET /perks': perksState, 'GET /pet': () => world.me.pet };
  if (request in reads) return guard(() => {
    onboarded();
    return respond(200, reads[request]());
  });
  if (request === 'GET /progression') return world.me.progression ? respond(200, world.me.progression) : refuse(409, 'ONBOARDING_REQUIRED');
  const [, route, query] = /^GET (\/day\/history(?:\/[^?]*)?)(?:\?(.*))?$/.exec(request) ?? [];
  if (route) return guard(() => history(route, new URLSearchParams(query)));
  if (request === INBOX_READ) return keyed(request, init, inboxRead);
  if (request === 'POST /auth/logout') return respond(204);
  if (request === BEDTIME) return keyed(request, init, bedtime);
  if (request === NUTRITION) return keyed(request, init, nutritionLog);
  const [, code, verb] = /^POST \/day\/quests\/([^/]+)\/(progress|undo)$/.exec(request) ?? [];
  if (verb === 'progress') return keyed(request, init, (key, body) => tick(code, key, body));
  if (verb === 'undo') return keyed(request, init, (key, body) => undo(code, key, body));
  return respond(404);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_MAX_DATES = 92;
/** A date as the server reads it: 422 `required` when missing, `format` when it is not a calendar date. */
function dateOf(value: string | null | undefined, field: string) {
  if (!value) stop(422, 'VALIDATION_FAILED', [{ field, rule: 'required' }]);
  const at = Date.parse(`${value}T00:00:00Z`);
  // a date that exists: 30 February is not rolled over into March
  if (!DATE.test(value) || value.startsWith('0000') || Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== value) stop(422, 'VALIDATION_FAILED', [{ field, rule: 'format' }]);
  return value;
}
/** A closed day that was not completed and has a ticket used for it is FROZEN (readModels/day.ts: completed, else frozen, else missed). */
const summaryOf = (date: string): DaySummary => {
  const summary = world.history[date]?.summary ?? { logicalDate: date, outcome: date >= world.day.logicalDate ? 'OPEN' : 'NONE', storyDone: 0, storyTotal: 2, waterMl: 0, caloriesIn: 0, workoutMinutes: 0 };
  return ticketUsedFor(date) && date <= closedOn() && summary.outcome !== 'COMPLETED' ? { ...summary, outcome: 'FROZEN' } : summary;
};
/** `GET /day/history?from&to` (at most 92 dates, oldest first) and `GET /day/history/{date}`. */
function history(route: string, query: URLSearchParams) {
  if (route === '/day/history') {
    const from = dateOf(query.get('from'), 'from');
    const to = dateOf(query.get('to'), 'to');
    const dates = daysBetween(from, to) + 1;
    if (dates < 1) stop(422, 'VALIDATION_FAILED', [{ field: 'to', rule: 'min' }]);
    if (dates > HISTORY_MAX_DATES) stop(422, 'VALIDATION_FAILED', [{ field: 'to', rule: 'max' }]);
    return respond(200, { days: Array.from({ length: dates }, (_, n) => summaryOf(addDays(from, n))) });
  }
  const date = dateOf(route.slice('/day/history/'.length), 'date');
  return respond(200, { summary: summaryOf(date), actions: world.history[date]?.actions ?? [] } satisfies DayDetail);
}
/**
 * `POST /inbox/read`: `ids` absent = every unread item; else UUIDs (an id that is not the caller's, or already read, changes
 * nothing). The answer is the unread count: of `world.inbox` when it holds notifications, else the day's, less what was read.
 */
function inboxRead(_key: string, body: Record<string, unknown>) {
  const { ids } = body;
  if (ids !== undefined && (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && UUID.test(id)))) stop(422, 'VALIDATION_FAILED', [{ field: 'ids', rule: 'format' }]);
  const named = (id: string) => ids === undefined || (ids as string[]).includes(id);
  const read = world.day.celebrations.filter(item => named(item.id));
  const stamp = new Date().toISOString();
  world.inbox = world.inbox.map(item => (item.readAt === null && named(item.id) ? { ...item, readAt: stamp } : item));
  const unread = world.inbox.length > 0 ? world.inbox.filter(item => item.readAt === null).length : Math.max(0, world.day.unreadCount - read.length);
  world.day = { ...world.day, celebrations: world.day.celebrations.filter(item => !read.includes(item)), unreadCount: unread };
  return respond(200, { unreadCount: unread } satisfies InboxReadResult);
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
  if (dayClosed()) stop(409, 'DAY_CLOSED');
  // the coins of the tick are spent (a purchase in between): taking them back would leave the coin sum below 0 (quest_undo)
  if ((world.me.progression?.coin ?? 0) < daily.coinReward) stop(409, 'UNDO_COINS_SPENT');
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
    checkOccurredAt(body);
    // The planned meal of the slot, in the server's order: no meal -> PLAN_NOT_FOUND, logged already -> MEAL_ALREADY_LOGGED.
    const planned = mealById(world.plan.planned[mealSlot as MealSlot]);
    if (!planned) stop(409, 'PLAN_NOT_FOUND');
    if (world.plan.logged[mealSlot as MealSlot]) stop(409, 'MEAL_ALREADY_LOGGED');
    world.plan.logged[mealSlot as MealSlot] = true;
    return addCalories(id, planned.kcal);
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
  return addCalories(id, kcal as number);
}
/** Adds an amount to the day: the total is the sum, the nutrition quest latches inside the window. */
function addCalories(id: string, amount: number) {
  const wasWhole = storyWhole();
  const caloriesIn = world.day.caloriesIn + amount;
  const { min, max } = world.day.calorieWindow;
  const meal = questOf(NUTRITION_QUEST);
  const reward = meal !== undefined && !meal.completed && caloriesIn >= min && caloriesIn <= max;
  changeDay(day => ({ ...day, caloriesIn }));
  if (!reward) return answerOf(id, { xp: 0, coin: 0, events: [] });
  completeQuest(NUTRITION_QUEST);
  const events: GameEvent[] = [{ type: 'QUEST_COMPLETED', questCode: NUTRITION_QUEST }, ...settleStory(wasWhole), ...pay(meal.xpReward, meal.coinReward)];
  return answerOf(id, { xp: meal.xpReward, coin: meal.coinReward, events });
}

// ---- the meal plan (server Task 33; task-33-report.md "Notes for Task 34") ----

// Illustrative meals in the shape of server/content/meals.ts (the three pictures are the real keys; names and numbers are in
// the fixture file). The macros are chosen so that, for the target below, the ranking of a lunch swap is the one of frame S15:
// fish, chicken noodles, tofu.
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
/** The meal library of the stand-in, as `Meal`. */
export const MEALS: Meal[] = (fixture as Omit<Meal, 'id'>[]).map((meal, n) => ({ ...meal, id: idOf(n) }));
export const mealByCode = (code: string) => MEALS.find(meal => meal.code === code) as Meal;
const mealById = (id: string | null | undefined) => MEALS.find(meal => meal.id === id);
export const PLAN_SLOTS: MealSlot[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
const PLAN_TARGET = { kcal: CALORIE_TARGET, proteinG: 150, carbsG: 270, fatG: 66 };
type PerSlot<T> = Record<MealSlot, T>;
const perSlot = <T,>(value: (slot: MealSlot) => T) => Object.fromEntries(PLAN_SLOTS.map(slot => [slot, value(slot)])) as PerSlot<T>;

/** Today's plan as the server holds it; `world.plan` is reset to this before every test. */
export function freshPlan() {
  const planned: PerSlot<string | null> = { BREAKFAST: mealByCode('YEN_MACH').id, LUNCH: mealByCode('COM_GA').id, DINNER: mealByCode('CA_AP_CHAO').id, SNACK: mealByCode('SUA_CHUA').id };
  return {
    planned,
    logged: perSlot(() => false),
    used: perSlot(() => 0),
    shown: perSlot(slot => (planned[slot] ? [planned[slot] as string] : [])),
    warning: perSlot(() => false),
    /** 3, or 5 with the perk. */
    allowed: 3,
    /** Whether the server has stored today's plan: a first read on a closed day is DAY_CLOSED, a swap without one PLAN_NOT_FOUND. */
    stored: true,
  };
}

/** What every user route does first (the sign-in is not modelled): 409 ONBOARDING_REQUIRED until onboarded, as `/progression`. */
function onboarded() {
  if (!world.me.progression) stop(409, 'ONBOARDING_REQUIRED');
}
/** The first read stores the plan (`nutrition_plan_save`), which only an open day takes. */
function ensurePlan() {
  if (world.plan.stored) return;
  if (dayClosed()) stop(409, 'DAY_CLOSED');
  world.plan.stored = true;
}

function readPlan() {
  onboarded();
  ensurePlan();
  return respond(200, planState());
}
function planState(): MealPlanState {
  const { planned, logged, used, warning, allowed } = world.plan;
  return {
    logicalDate: world.day.logicalDate,
    target: PLAN_TARGET,
    caloriesIn: world.day.caloriesIn,
    calorieWindow: world.day.calorieWindow,
    slots: PLAN_SLOTS.map(mealSlot => ({ mealSlot, meal: mealById(planned[mealSlot]) ?? null, logged: logged[mealSlot], swapsUsed: used[mealSlot], swapsAllowed: allowed, macroWarning: warning[mealSlot] })),
  };
}
const slotOf = (value: unknown): MealSlot => {
  if (value === undefined || value === null || value === '') stop(422, 'VALIDATION_FAILED', [{ field: 'mealSlot', rule: 'required' }]);
  if (typeof value !== 'string' || !PLAN_SLOTS.includes(value as MealSlot)) stop(422, 'VALIDATION_FAILED', [{ field: 'mealSlot', rule: 'enum' }]);
  return value as MealSlot;
};
/** The first three meals of the ranking the server uses (`rankMeals`), whatever swaps are left. */
function rankedFor(slot: MealSlot): SwapCandidates['candidates'] {
  const { planned, shown } = world.plan;
  const current = mealById(planned[slot])?.kcal ?? 0;
  const planAll = PLAN_SLOTS.flatMap(item => (planned[item] ? [planned[item] as string] : []));
  const { ranked } = rankMeals(MEALS, slotTarget(PLAN_TARGET, slot), slot, { excludeIds: [...shown[slot], ...planAll], excludedTags: world.settings.excludedMealTags });
  return ranked.slice(0, 3).map(item => ({ ...(mealById(item.id) as Meal), kcalDelta: (mealById(item.id) as Meal).kcal - current }));
}
function candidates(query: URLSearchParams) {
  onboarded();
  const slot = slotOf(query.get('mealSlot'));
  ensurePlan();
  const { logged, used, allowed } = world.plan;
  const swapsRemaining = logged[slot] ? 0 : Math.max(0, allowed - used[slot]);
  return respond(200, { mealSlot: slot, swapsRemaining, candidates: swapsRemaining > 0 ? rankedFor(slot) : [] } satisfies SwapCandidates);
}
/** `POST /nutrition/swap`: the body, then the 409s of nutrition_swap (closed day, no plan, logged, limit), then the route's own 422 (not one of the three offered). */
function swapMeal(_id: string, body: Record<string, unknown>) {
  const fields: { field: string; rule: string }[] = [];
  if (body.mealSlot === undefined) fields.push({ field: 'mealSlot', rule: 'required' });
  else if (typeof body.mealSlot !== 'string' || !PLAN_SLOTS.includes(body.mealSlot as MealSlot)) fields.push({ field: 'mealSlot', rule: 'enum' });
  if (body.mealId === undefined) fields.push({ field: 'mealId', rule: 'required' });
  else if (typeof body.mealId !== 'string' || !UUID.test(body.mealId)) fields.push({ field: 'mealId', rule: 'format' });
  if (fields.length > 0) stop(422, 'VALIDATION_FAILED', fields);
  const slot = body.mealSlot as MealSlot;
  const mealId = body.mealId as string;
  const { logged, used, allowed } = world.plan;
  if (dayClosed()) stop(409, 'DAY_CLOSED');
  if (!world.plan.stored) stop(409, 'PLAN_NOT_FOUND');
  if (logged[slot]) stop(409, 'MEAL_ALREADY_LOGGED');
  if (used[slot] >= allowed) stop(409, 'SWAP_LIMIT_REACHED');
  if (!rankedFor(slot).some(item => item.id === mealId)) stop(422, 'SWAP_CANDIDATE_INVALID');
  const meal = mealById(mealId) as Meal;
  const { planned, shown, warning } = world.plan;
  planned[slot] = mealId;
  shown[slot] = [...shown[slot], mealId];
  used[slot] += 1;
  warning[slot] = rankMeals([meal], slotTarget(PLAN_TARGET, slot), slot, { excludeIds: [], excludedTags: [] }).macroWarning;
  return respond(200, planState());
}
const isFlag = (value: unknown) => typeof value === 'boolean';
const REMINDER_WINDOWS: unknown[] = ['MORNING', 'NOON', 'EVENING'];
const MOTIONS: unknown[] = ['SYSTEM', 'REDUCED', 'FULL'];
/** The members of PATCH /settings in the order the route checks them; `soundEnabled` is known and read-only, so sending it at all is refused. */
const SETTINGS_CHECKS: [string, 'format' | 'enum', (value: unknown) => boolean][] = [
  ['nudgesEnabled', 'format', isFlag],
  ['reminderEnabled', 'format', isFlag],
  ['reminderWindow', 'enum', value => REMINDER_WINDOWS.includes(value)],
  ['hideStreak', 'format', isFlag],
  ['soundEnabled', 'format', () => false],
  ['motion', 'enum', value => MOTIONS.includes(value)],
];
/**
 * `PATCH /settings` as server/src/routes/settings.ts: a member that is present must be valid (every wrong one is named, 422),
 * the valid ones replace the saved values, a member the server does not know is ignored, the tags are kept once each in the
 * order of the list of eight.
 */
function patchSettings(_id: string, body: Record<string, unknown>) {
  const problems: { field: string; rule: string }[] = SETTINGS_CHECKS.filter(([field, , valid]) => body[field] !== undefined && !valid(body[field])).map(([field, rule]) => ({ field, rule }));
  const sent = body.excludedMealTags;
  let tags: IngredientTag[] | undefined;
  if (sent !== undefined) {
    if (!Array.isArray(sent)) problems.push({ field: 'excludedMealTags', rule: 'format' });
    else if (!sent.every(tag => (INGREDIENT_TAGS as readonly unknown[]).includes(tag))) problems.push({ field: 'excludedMealTags', rule: 'enum' });
    else tags = INGREDIENT_TAGS.filter(tag => sent.includes(tag));
  }
  if (problems.length > 0) stop(422, 'VALIDATION_FAILED', problems);
  const given = SETTINGS_CHECKS.filter(([field]) => body[field] !== undefined).map(([field]) => [field, body[field]]);
  world.settings = { ...world.settings, ...Object.fromEntries(given), ...(tags && { excludedMealTags: tags }) };
  return respond(200, world.settings);
}

// ---- the shop, the inventory, the perks (server Task 37: server/src/routes/shop.ts, perks.ts, sql/41-shop.sql) ----
// The items are the server's own content (server/content/shopItems.ts). Every route here is for an onboarded user (409
// ONBOARDING_REQUIRED first) and every write is idempotent. The coin sum is `progression.coin`, the points are
// `progression.perkPointsAvailable` (the server derives both; here the profile holds them), the level is `progression.level`.
type Kind = ShopItem['kind'];
const KINDS: Kind[] = ['THEME', 'PET_SKIN', 'BADGE'];

/** What a person has: bought items, the item equipped per kind (null: the default of that kind), perks unlocked. */
export function freshShop() {
  return { owned: [] as string[], equipped: { THEME: null, PET_SKIN: null, BADGE: null } as Record<Kind, string | null>, unlocked: [] as { perk: PerkCode; cost: number }[] };
}
const coinOf = () => world.me.progression?.coin ?? 0;
const levelOf = () => world.me.progression?.level ?? 1;
const itemOf = (code: string) => SHOP_ITEMS.find(item => item.code === code);
const ownsItem = (code: string) => itemOf(code)?.isDefault === true || world.shop.owned.includes(code);
/** Every item in the order of the server: kind, the default first, then level, price and code. */
function allItems(): ShopItem[] {
  const { equipped } = world.shop;
  return [...SHOP_ITEMS]
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || Number(b.isDefault) - Number(a.isDefault) || a.minLevel - b.minLevel || a.priceCoin - b.priceCoin || (a.code < b.code ? -1 : 1))
    .map(item => ({ ...item, owned: ownsItem(item.code), equipped: equipped[item.kind] === item.code || (item.isDefault && equipped[item.kind] === null), locked: levelOf() < item.minLevel }));
}
const shopState = (): Shop => ({ coin: coinOf(), level: levelOf(), items: allItems().filter(item => item.purchasable || item.isDefault) });
const inventoryState = (): Inventory => ({ items: allItems().filter(item => item.owned) });
function perksState(): Perks {
  return {
    pointsAvailable: world.me.progression?.perkPointsAvailable ?? 0,
    perks: (Object.keys(PERKS) as PerkCode[]).map(code => ({ code, cost: PERKS[code].cost, unlocked: world.shop.unlocked.some(item => item.perk === code), repeatable: code === 'THEME_UNLOCK' })),
  };
}
/** `shop_purchase`, in its order: unknown (404), not for sale or a default, level, owned, coins (with its numbers). */
function purchase(code: string) {
  const item = itemOf(code);
  if (!item) stop(404, 'ITEM_NOT_FOUND');
  if (!item.purchasable || item.isDefault) stop(409, 'ITEM_NOT_PURCHASABLE');
  if (levelOf() < item.minLevel) stopWith(409, 'ITEM_LOCKED_LEVEL', { minLevel: item.minLevel });
  if (ownsItem(code)) stop(409, 'ALREADY_OWNED');
  if (coinOf() < item.priceCoin) stopWith(409, 'INSUFFICIENT_COINS', { price: item.priceCoin, coin: coinOf() });
  const progression = world.me.progression;
  if (progression) world.me = { ...world.me, progression: { ...progression, coin: progression.coin - item.priceCoin } };
  world.shop.owned.push(code);
  return respond(200, { coin: coinOf(), item: allItems().find(candidate => candidate.code === code) } as PurchaseResult);
}
/** `inventory_equip`: owned or a default (an unknown code too: ITEM_NOT_OWNED); that kind has one equipped item afterwards (none for a default). */
function equip(code: string) {
  const item = itemOf(code);
  if (!item || !ownsItem(code)) stop(409, 'ITEM_NOT_OWNED');
  world.shop.equipped[item.kind] = item.isDefault ? null : code;
  const { equipped } = world.shop;
  const appearance = { themeCode: equipped.THEME ?? 'THEME_DEFAULT', petSkinCode: equipped.PET_SKIN ?? 'SKIN_DEFAULT', badgeCode: equipped.BADGE };
  world.me = { ...world.me, appearance, pet: world.me.pet && { ...world.me.pet, skinCode: appearance.petSkinCode } };
  return respond(200, inventoryState());
}
/** `POST /perks/unlock`: the body check of the route (422), then `perk_unlock`: the theme (404, owned, level), once only, the points. */
function unlockPerk(body: Record<string, unknown>) {
  const { perkCode, itemCode } = body;
  const fields: { field: string; rule: string }[] = [];
  if (perkCode === undefined) fields.push({ field: 'perkCode', rule: 'required' });
  else if (typeof perkCode !== 'string' || !Object.hasOwn(PERKS, perkCode)) fields.push({ field: 'perkCode', rule: 'enum' });
  // itemCode is THEME_UNLOCK's only: another perk ignores it, whatever it is
  if (perkCode === 'THEME_UNLOCK') {
    if (itemCode === undefined) fields.push({ field: 'itemCode', rule: 'required' });
    else if (typeof itemCode !== 'string') fields.push({ field: 'itemCode', rule: 'format' });
  }
  if (fields.length > 0) stop(422, 'VALIDATION_FAILED', fields);
  const perk = perkCode as PerkCode;
  const cost = PERKS[perk].cost;
  let theme: ShopItem | undefined;
  if (perk === 'THEME_UNLOCK') {
    theme = allItems().find(item => item.code === itemCode && item.kind === 'THEME' && !item.isDefault);
    if (!theme) stop(404, 'ITEM_NOT_FOUND');
    if (theme.owned) stop(409, 'ALREADY_OWNED');
    if (theme.locked) stopWith(409, 'ITEM_LOCKED_LEVEL', { minLevel: theme.minLevel });
  } else if (world.shop.unlocked.some(item => item.perk === perk)) {
    stop(409, 'PERK_ALREADY_UNLOCKED');
  }
  const progression = world.me.progression;
  if (!progression || progression.perkPointsAvailable < cost) stop(409, 'PERK_POINTS_INSUFFICIENT');
  world.me = { ...world.me, progression: { ...progression, perkPointsAvailable: progression.perkPointsAvailable - cost } };
  world.shop.unlocked.push({ perk, cost });
  if (theme) world.shop.owned.push(theme.code);
  return respond(200, perksState());
}

// ---- the guild (server Tasks 39 and 41: routes/guild.ts, sql/50-guild.sql, readModels/guild.ts, sql/52-nudge.sql) ----
// Every route is for an onboarded user (409 ONBOARDING_REQUIRED first) and every write is idempotent. The statuses, the
// order of the refusals and the shape of `GuildState` are the server's; so is the nudge of each member row: the reason
// is worked out from what the member is (muted, done, already nudged) in the order of app._nudge_block_reason, and the
// caller's own row is `{ allowed: false, reason: null }`. Not modelled: a member in another time zone (every member
// shares `world.hour`), a member who joins or leaves on their own, the week and the weekly rewards (a test sets the numbers).
export type Mate = { userId: string; displayName: string; role: GuildRole; level: number; daysCompleted: number; daysCounted: number; storyDone: boolean; muted: boolean; nudgedToday: boolean };
export type Team = { id: string; name: string; motto: string; inviteCode: string; weekCompletion: number; inactiveDays: number; members: Mate[] };
const IDS = '00000000-0000-4000-9000-';
/** The guilds of the stand-in; `world.guild` is reset to this before every test. */
export function freshGuild() {
  return { teams: [] as Team[], nudgesSent: 0, made: 0, sent: [] as { receiverId: string; templateCode: string }[], nudgeCalls: [] as number[], boards: {} as { current?: Board; previous?: Board } };
}
/** A member as the server would read him or her; the facts a nudge depends on are the arguments. */
export const mateOf = (n: number, displayName: string, more: Partial<Mate> = {}): Mate => ({
  userId: `${IDS}${String(n).padStart(12, '0')}`,
  displayName,
  role: 'MEMBER',
  level: 3,
  daysCompleted: 4,
  daysCounted: 7,
  storyDone: false,
  muted: false,
  nudgedToday: false,
  ...more,
});
const myTeam = () => world.guild.teams.find(team => team.members.some(mate => mate.userId === USER));
/** What nudge_send would raise for this receiver, in the order of app._nudge_block_reason (the same guild is known). */
function blockReason(mate: Mate): NudgeBlockReason | null {
  if (mate.muted) return 'NUDGE_RECEIVER_MUTED';
  if (mate.storyDone) return 'NUDGE_NOT_NEEDED';
  if (world.hour < 12 || world.hour >= 20) return 'NUDGE_OUTSIDE_WINDOW';
  if (mate.nudgedToday) return 'NUDGE_RECEIVER_LIMIT';
  if (world.guild.nudgesSent >= 3) return 'NUDGE_SENDER_LIMIT';
  return null;
}
/** `GuildState`: `{ guild: null }` outside a guild. `inactive` is the server's rule on `inactiveDays`. */
function guildState(): GuildState {
  const team = myTeam();
  if (!team) return { guild: null };
  const me = team.members.find(mate => mate.userId === USER) as Mate;
  return {
    guild: {
      id: team.id,
      name: team.name,
      motto: team.motto,
      inviteCode: team.inviteCode,
      myRole: me.role,
      weekCompletion: team.weekCompletion,
      inactive: team.inactiveDays >= GUILD_INACTIVE_DAYS,
      inactiveDays: team.inactiveDays,
      members: team.members.map(mate => {
        const own = mate.userId === USER;
        const reason = own ? null : blockReason(mate);
        return {
          userId: mate.userId,
          displayName: mate.displayName,
          level: mate.level,
          role: mate.role,
          isMe: own,
          daysCompletedThisWeek: mate.daysCompleted,
          daysCountedThisWeek: mate.daysCounted,
          storyDoneToday: mate.storyDone,
          nudge: { allowed: !own && reason === null, reason },
        };
      }),
    },
  };
}
/** The route's `nameOf`: NFC, trimmed, 3 to 30 code points, the format of a display name. */
function guildName(value: unknown, fields: { field: string; rule: string }[]) {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  const length = [...name].length;
  let rule: string | null = null;
  if (typeof value !== 'string') rule = value === undefined ? 'required' : 'format';
  else if (length < LIMITS.guildName.min) rule = 'min';
  else if (length > LIMITS.guildName.max) rule = 'max';
  else if (!isDisplayName(name)) rule = 'format';
  if (rule !== null) fields.push({ field: 'name', rule });
  return name;
}
/** The route's `mottoOf`: optional; NFC, trimmed; at most 80 code points; no unseen character. */
function guildMotto(value: unknown, fields: { field: string; rule: string }[]) {
  if (value === undefined || value === null) return '';
  const motto = typeof value === 'string' ? value.normalize('NFC').trim() : '';
  if (typeof value !== 'string' || stripUnseen(motto) !== motto) fields.push({ field: 'motto', rule: 'format' });
  else if ([...motto].length > LIMITS.guildMotto.max) fields.push({ field: 'motto', rule: 'max' });
  return motto;
}
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** `POST /guilds`: the body (422, every wrong field named), the banned terms (422), then guild_create: ALREADY_IN_GUILD, GUILD_NAME_TAKEN. */
function createGuild(body: Record<string, unknown>) {
  const fields: { field: string; rule: string }[] = [];
  const name = guildName(body.name, fields);
  const motto = guildMotto(body.motto, fields);
  if (fields.length > 0) stop(422, 'VALIDATION_FAILED', fields);
  if (findBannedTerms(name).length > 0 || findBannedTerms(motto).length > 0) stop(422, 'NAME_NOT_ALLOWED');
  if (myTeam()) stop(409, 'ALREADY_IN_GUILD');
  if (world.guild.teams.some(team => team.name.toLowerCase() === name.toLowerCase())) stop(409, 'GUILD_NAME_TAKEN');
  const n = (world.guild.made += 1);
  world.guild.teams.push({
    id: `${IDS}9${String(n).padStart(11, '0')}`,
    name,
    motto,
    inviteCode: `NEW${[...String(n).padStart(5, '0')].map(digit => INVITE_ALPHABET[(+digit % 8) + 24]).join('')}`,
    weekCompletion: 0,
    inactiveDays: 0,
    members: [{ ...mateOf(0, world.me.user.displayName, { role: 'LEADER' }), userId: USER }],
  });
  return respond(200, guildState());
}
/** `POST /guilds/join`: the body (422), then guild_join: INVITE_CODE_INVALID (404), ALREADY_IN_GUILD, GUILD_FULL. */
function joinGuild(body: Record<string, unknown>) {
  const { inviteCode } = body;
  if (typeof inviteCode !== 'string') stop(422, 'VALIDATION_FAILED', [{ field: 'inviteCode', rule: inviteCode === undefined ? 'required' : 'format' }]);
  const code = (inviteCode as string).trim().toUpperCase();
  const team = /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? world.guild.teams.find(candidate => candidate.inviteCode === code) : undefined;
  if (!team) stop(404, 'INVITE_CODE_INVALID');
  if (myTeam()) stop(409, 'ALREADY_IN_GUILD');
  if (team.members.length >= GUILD_MAX_MEMBERS) stop(409, 'GUILD_FULL');
  team.members.push({ ...mateOf(0, world.me.user.displayName), userId: USER });
  return respond(200, guildState());
}
/** `POST /guilds/me/leave` (204): NOT_IN_GUILD, LEADER_MUST_TRANSFER for a leader with other members; a lone leader's guild goes with the leader. */
function leaveGuild() {
  const team = myTeam();
  if (!team) stop(409, 'NOT_IN_GUILD');
  const me = team.members.find(mate => mate.userId === USER) as Mate;
  if (me.role === 'LEADER' && team.members.length > 1) stop(409, 'LEADER_MUST_TRANSFER');
  team.members = team.members.filter(mate => mate !== me);
  if (team.members.length === 0) world.guild.teams = world.guild.teams.filter(candidate => candidate !== team);
  return respond(204);
}
/** `POST /guilds/me/transfer`: the body (422), then guild_transfer: NOT_LEADER (403; in no guild too), TRANSFER_TARGET_INVALID (422; the caller or a stranger). */
function transferGuild(body: Record<string, unknown>) {
  const { userId } = body;
  if (typeof userId !== 'string' || !UUID.test(userId)) stop(422, 'VALIDATION_FAILED', [{ field: 'userId', rule: userId === undefined ? 'required' : 'format' }]);
  const team = myTeam();
  const me = team?.members.find(mate => mate.userId === USER);
  if (!team || me?.role !== 'LEADER') stop(403, 'NOT_LEADER');
  const target = team.members.find(mate => mate.userId === (userId as string).toLowerCase());
  if (!target || target === me) stop(422, 'TRANSFER_TARGET_INVALID');
  me.role = 'MEMBER';
  target.role = 'LEADER';
  return respond(200, guildState());
}

// ---- the weekly ranking, the nudge and the inbox (server Tasks 40, 41 and 22: routes/leaderboard.ts, routes/nudge.ts, routes/inbox.ts) ----
// Every route is for an onboarded user (409 ONBOARDING_REQUIRED first; the nudge is counted by the rate limit before that).
// Not modelled: the computation of a board (a test gives the standings, best first), the cache that refreshes the running week
// every few minutes, the Retry-After header, a nudge to a member in another time zone, a notification a nudge makes for the
// receiver (the caller's own inbox is `world.inbox`).
export type Standing = { guildName: string; avgCompletion: number; activeMembers: number };
/** One week's ranked guilds, best first. `unranked`: the score row of the caller's own guild when it has one but is not among them (a guild without a row that week has none: mine is null for the closed week). */
export type Board = { weekStart?: string; updatedAt?: string; standings: Standing[]; unranked?: { avgCompletion: number; activeMembers: number } };
const BOARD_TOP = 50;
/**
 * `GET /leaderboard?week`: 422 for a week that is not current / previous (required, format). The top 50 as entries, `isMine` on the
 * caller's guild; `mine` is filled for a guild outside the top 50, unranked (rank null) when it is not on the board, null without a
 * guild. The closed week reads the stored scores (`leaderboard_final`): a guild with no score row that week (created after it, say)
 * has mine null, as without a guild. `previous` before the rollover stored it: no entries, mine null, final, as of now.
 */
function leaderboard(query: URLSearchParams) {
  const week = query.get('week');
  if (week !== 'current' && week !== 'previous') stop(422, 'VALIDATION_FAILED', [{ field: 'week', rule: week === null ? 'required' : 'format' }]);
  const monday = weekStartOf(world.day.logicalDate);
  const board = world.guild.boards[week];
  if (week === 'previous' && !board) return respond(200, { weekStart: addDays(monday, -7), final: true, updatedAt: new Date().toISOString(), entries: [], mine: null } satisfies Leaderboard);
  const { standings = [], unranked, weekStart = week === 'current' ? monday : addDays(monday, -7), updatedAt = new Date().toISOString() } = board ?? {};
  const own = myTeam();
  const at = own ? standings.findIndex(standing => standing.guildName === own.name) : -1;
  const mine: Leaderboard['mine'] = !own || (week === 'previous' && at < 0 && !unranked)
    ? null
    : at >= 0
      ? { ranked: true, rank: at + 1, avgCompletion: standings[at].avgCompletion, activeMembers: standings[at].activeMembers }
      : { ranked: false, rank: null, avgCompletion: unranked?.avgCompletion ?? 0, activeMembers: unranked?.activeMembers ?? 0 };
  const entries = standings.slice(0, BOARD_TOP).map((standing, n) => ({ rank: n + 1, ...standing, isMine: n === at }));
  return respond(200, { weekStart, final: week === 'previous', updatedAt, entries, mine } satisfies Leaderboard);
}

/** AR-21: the 11th `POST /guilds/nudge` of one account within a minute is 429 RATE_LIMITED; refused requests count too. */
function limitNudges() {
  const now = Date.now();
  const calls = (world.guild.nudgeCalls = world.guild.nudgeCalls.filter(at => at > now - 60_000));
  if (calls.length >= 10) stop(429, 'RATE_LIMITED');
  calls.push(now);
}
/**
 * `POST /guilds/nudge`: the body (422, every wrong field named: receiverId then templateCode), then nudge_send: NUDGE_TEMPLATE_UNKNOWN
 * (422), NOT_IN_GUILD (409), NUDGE_NOT_SAME_GUILD (403: the caller or a stranger), then the reasons of app._nudge_block_reason (409).
 */
function sendNudge(body: Record<string, unknown>) {
  const { receiverId, templateCode } = body;
  const fields: { field: string; rule: string }[] = [];
  const receiver = typeof receiverId === 'string' && UUID.test(receiverId) ? receiverId.toLowerCase() : null;
  if (receiver === null) fields.push({ field: 'receiverId', rule: receiverId === undefined ? 'required' : 'format' });
  if (typeof templateCode !== 'string') fields.push({ field: 'templateCode', rule: templateCode === undefined ? 'required' : 'format' });
  if (fields.length > 0) stop(422, 'VALIDATION_FAILED', fields);
  if (!NUDGE_TEMPLATES.some(template => template.code === templateCode)) stop(422, 'NUDGE_TEMPLATE_UNKNOWN');
  const team = myTeam();
  if (!team) stop(409, 'NOT_IN_GUILD');
  const mate = team.members.find(candidate => candidate.userId === receiver);
  if (!mate || mate.userId === USER) stop(403, 'NUDGE_NOT_SAME_GUILD');
  const reason = blockReason(mate);
  if (reason) stop(409, reason);
  mate.nudgedToday = true;
  world.guild.nudgesSent += 1;
  world.guild.sent.push({ receiverId: mate.userId, templateCode: templateCode as string });
  return respond(200, { sentAt: new Date().toISOString(), senderRemainingToday: 3 - world.guild.nudgesSent } satisfies NudgeResult);
}

/** An item of the inbox, `n` minutes ago (the id and the time are made from `n`, so that two items never share either). */
export function inboxItem(n: number, kind: InboxItem['kind'], payload: object, more: { minutesAgo?: number; read?: boolean } = {}): InboxItem {
  const at = new Date(Date.UTC(2026, 9, 14, 12, 0, 0) - (more.minutesAgo ?? n) * 60_000).toISOString();
  return { id: `${IDS}7${String(n).padStart(11, '0')}`, kind, payload, createdAt: at, readAt: more.read ? at : null } as InboxItem;
}
/** Puts these notifications on the server; the day's unread count is theirs, as `GET /day` has it. (Celebrations are not modelled here.) */
export function seedInbox(items: InboxItem[]) {
  world.inbox = items;
  world.day = { ...world.day, unreadCount: items.filter(item => item.readAt === null).length };
}
const INBOX_DEFAULT = 20;
const INBOX_MAX = 50;
/** `limit` of a list: absent is 20, else a whole number 1..50 (422 format, min, max); the inbox and the journal share it (limitOf of routes/inbox.ts). */
function pageLimit(asked: string | null) {
  if (asked === null) return INBOX_DEFAULT;
  if (!/^[0-9]+$/.test(asked)) stop(422, 'VALIDATION_FAILED', [{ field: 'limit', rule: 'format' }]);
  const limit = Number(asked);
  if (limit < 1) stop(422, 'VALIDATION_FAILED', [{ field: 'limit', rule: 'min' }]);
  if (limit > INBOX_MAX) stop(422, 'VALIDATION_FAILED', [{ field: 'limit', rule: 'max' }]);
  return limit;
}
/** An instant the way `before` is read: seconds to the microsecond, an offset or Z, a date that exists. Null when it is none. */
function instantAt(value: string) {
  const [, year, month, day, , fraction = ''] = INSTANT.exec(value) ?? [];
  const at = Date.parse(value);
  if (!year || Number.isNaN(at) || new Date(Date.UTC(+year, +month - 1, +day)).getUTCDate() !== +day) return null;
  return { ms: at, micros: Number(fraction.slice(4, 7).padEnd(3, '0')) };
}
/**
 * `GET /inbox?limit&before`: newest first; `limit` 1..50 (default 20; 422 format, min, max), then `before` an instant that exists
 * (422 format); `nextBefore` is the creation time of the last item of the page to the microsecond, null on the last page.
 * `unreadCount` counts every unread item, not only the page.
 */
function inboxPage(query: URLSearchParams) {
  const limit = pageLimit(query.get('limit'));
  const text = query.get('before');
  const before = text === null ? null : instantAt(text);
  if (text !== null && before === null) stop(422, 'VALIDATION_FAILED', [{ field: 'before', rule: 'format' }]);
  const newestFirst = [...world.inbox].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const older = before ? newestFirst.filter(item => Date.parse(item.createdAt) < before.ms || (Date.parse(item.createdAt) === before.ms && before.micros > 0)) : newestFirst;
  const items = older.slice(0, limit);
  const nextBefore = older.length > limit ? `${items[items.length - 1].createdAt.slice(0, 23)}000Z` : null;
  return respond(200, { items, unreadCount: world.inbox.filter(item => item.readAt === null).length, nextBefore } satisfies Inbox);
}

// ---- the journal and the freeze tickets ----
// What server Task 44 answers (routes/journal.ts, routes/tickets.ts, sql/60-journal.sql, readModels/tickets.ts). Every route is for an
// onboarded user (409 ONBOARDING_REQUIRED first, the rate limit of POST /journal before even that). The text of an entry never
// leaves `world.journal`: nothing here logs it. The journal's clock is the machine's (an entry is created "now", a quote is recent
// for 30 days of it); the tickets' clock is the server's wall clock in the user's zone, `world.hour` on the day of `world.day`
// (the ticket window is the hour: yesterday from 03:00 to 15:00). Not modelled: the quote is the first fit, never a random one;
// PET_STAGE_UP in the delta; a stored answer lost for a key that is already an entry (a test can seed that row).
export type JournalRow = {
  id: string;
  createdAt: string;
  body: string;
  quoteCode: string;
  logicalDate: string;
  /** Another account's entry: row level security hides it from the caller (404 for GET one, never in the list). */
  owner?: string;
  /** A blob that does not open: left out of the list, 500 INTERNAL for GET one. */
  corrupt?: boolean;
};
export function freshJournal() {
  return { rows: [] as JournalRow[], calls: [] as number[] };
}
export function freshTickets() {
  return {
    /** Tickets in the order they were granted; `usedFor` is the date one was used for. */
    list: [] as { grantWeek: string; usedFor: string | null }[],
    /** ticket_grant_weeks: the decision of a week (true: a ticket was granted, false: forfeited at the cap). */
    decided: {} as Record<string, boolean>,
    /** progression_state.last_closed_date: the day-close has processed this date and every earlier one (default: yesterday). */
    closed: undefined as string | undefined,
    /** streak_before_break, break_date and missed_run: the break a rescue restores. */
    beforeBreak: null as number | null,
    breakDate: null as string | null,
    missedRun: 0,
    /** Whether all STORY quests were completed on a date other than today (today's come from `world.day`). */
    stories: {} as Record<string, boolean>,
    /** Minutes past `world.hour` on the server's clock. */
    minute: 0,
  };
}
/** Gives the caller `count` unused tickets, each from an earlier week than this one. */
export function giveTickets(count: number) {
  for (let n = 0; n < count; n += 1) world.tickets.list.push({ grantWeek: addDays(weekStartOf(world.day.logicalDate), -7 * (n + 1)), usedFor: null });
}
/** The day-close has broken a streak of `before` days on `date` (default yesterday): the streak is 0 and a rescue is open. */
export function breakStreak(before: number, date = addDays(world.day.logicalDate, -1)) {
  world.tickets.closed = date;
  world.tickets.breakDate = date;
  world.tickets.beforeBreak = before;
  world.tickets.missedRun = 1;
  if (world.me.progression) world.me = { ...world.me, progression: { ...world.me.progression, streakCurrent: 0, lastOutcome: 'MISSED', breakNotice: { previous: before, date } } };
}
export function seedJournal(rows: JournalRow[]) {
  world.journal.rows.push(...rows);
}
const ticketUsedFor = (date: string) => world.tickets.list.some(ticket => ticket.usedFor === date);
const closedOn = () => world.tickets.closed ?? addDays(world.day.logicalDate, -1);
const storyOf = (date: string) => (date === world.day.logicalDate ? storyWhole() : world.tickets.stories[date] === true);
const mine = (row: JournalRow) => (row.owner ?? USER) === USER;
const newestFirst = (a: JournalRow, b: JournalRow) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** AR-21: the 11th `POST /journal` of one account within a minute is 429 RATE_LIMITED; refused requests count too. */
function limitJournal() {
  const now = Date.now();
  const calls = (world.journal.calls = world.journal.calls.filter(at => at > now - 60_000));
  if (calls.length >= 10) stop(429, 'RATE_LIMITED');
  calls.push(now);
}
/** The text of the request: a string of 1 to 5000 code points once trimmed (422 required / format / min / max on `body`). */
function journalText(value: unknown) {
  const refusal = (rule: string): never => stop(422, 'VALIDATION_FAILED', [{ field: 'body', rule }]);
  if (value === undefined || value === null) refusal('required');
  if (typeof value !== 'string') refusal('format');
  const text = (value as string).trim();
  const length = [...text].length;
  if (length < LIMITS.journalBody.min) refusal('min');
  if (length > LIMITS.journalBody.max) refusal('max');
  return text;
}
const MONTH_MS = 30 * 24 * HOUR;
/** The quote of a new entry: one the caller has not received in the last 30 days, else the one received longest ago. */
function pickQuote(): Quote {
  const lastOf = (code: string) => Math.max(0, ...world.journal.rows.filter(row => mine(row) && row.quoteCode === code).map(row => Date.parse(row.createdAt)));
  const ranked = QUOTES.map((quote, n) => ({ quote, n, last: lastOf(quote.code) })).map(item => ({ ...item, recent: item.last > Date.now() - MONTH_MS }));
  ranked.sort((a, b) => Number(a.recent) - Number(b.recent) || (a.recent ? a.last - b.last : 0) || a.n - b.n);
  const { code, text, author } = ranked[0].quote;
  return { code, text, author };
}
const unusedTickets = () => world.tickets.list.filter(ticket => ticket.usedFor === null).length;
/** 2, or 3 with the perk TICKET_CAP_PLUS. */
const ticketCap = () => (world.shop.unlocked.some(item => item.perk === 'TICKET_CAP_PLUS') ? 3 : 2);
/** app._ticket_grant_check: the week has a decision (ALREADY_DECIDED), else a ticket at the cap is forfeited (AT_CAP), else a ticket of that week (GRANTED). */
function grantCheck(week: string): JournalCreateResult['ticket']['outcome'] {
  const { list, decided } = world.tickets;
  if (week in decided) return 'ALREADY_DECIDED';
  const have = list.some(ticket => ticket.grantWeek === week);
  decided[week] = have || unusedTickets() < ticketCap();
  if (!decided[week]) return 'AT_CAP';
  if (!have) list.push({ grantWeek: week, usedFor: null });
  return 'GRANTED';
}

/**
 * `POST /journal`: the text (422), then journal_create in its order: the quote, the entry (an id that is already an entry:
 * 409 IDEMPOTENCY_KEY_REUSED), 15 XP for the first entry of the logical day (0 after it), the week's ticket.
 */
function createEntry(id: string, body: Record<string, unknown>) {
  const text = journalText(body.body);
  const quote = pickQuote();
  if (world.journal.rows.some(row => row.id === id)) stop(409, 'IDEMPOTENCY_KEY_REUSED');
  const logicalDate = world.day.logicalDate;
  const first = !world.journal.rows.some(row => mine(row) && row.logicalDate === logicalDate);
  const createdAt = new Date().toISOString();
  world.journal.rows.push({ id, createdAt, body: text, quoteCode: quote.code, logicalDate });
  const events = first ? pay(JOURNAL_XP, 0) : [];
  const outcome = grantCheck(weekStartOf(logicalDate));
  const xp = first ? JOURNAL_XP : 0;
  return respond(200, { entry: { id, createdAt }, quote, xpAwarded: xp, ticket: { outcome, available: unusedTickets(), cap: ticketCap() }, delta: { xp, coin: 0, events } } satisfies JournalCreateResult);
}
const PREVIEW_CHARS = 80;
/**
 * `GET /journal?limit&before`: newest first (created_at, then id). `limit` 1..50 (default 20), then `before`, the id of the last entry
 * of the previous page (422 format; an id that is not the caller's entry gives an empty page). `nextBefore` is the id of the last
 * row of the page when more rows follow, null on the last: an entry that cannot be opened is left out of `entries` but not of the
 * count, so a page can hold fewer entries than `limit` and still have a cursor.
 */
function journalPage(query: URLSearchParams) {
  const limit = pageLimit(query.get('limit'));
  const before = query.get('before');
  if (before !== null && !UUID.test(before)) stop(422, 'VALIDATION_FAILED', [{ field: 'before', rule: 'format' }]);
  const rows = world.journal.rows.filter(mine).sort(newestFirst);
  const cursor = before === null ? undefined : rows.find(row => row.id === before.toLowerCase());
  const older = before === null ? rows : cursor ? rows.filter(row => newestFirst(cursor, row) < 0) : [];
  const page = older.slice(0, limit);
  const entries = page.filter(row => !row.corrupt).map(row => ({ id: row.id, createdAt: row.createdAt, preview: [...row.body].slice(0, PREVIEW_CHARS).join(''), quoteCode: row.quoteCode }));
  return respond(200, { entries, nextBefore: older.length > limit ? page[page.length - 1].id : null } satisfies JournalList);
}
/** `GET /journal/{id}`: 422 for an id that is not a UUID, 404 NOT_FOUND for one that is not the caller's entry, 500 for a blob that does not open. */
function journalEntry(id: string) {
  if (!UUID.test(id)) stop(422, 'VALIDATION_FAILED', [{ field: 'id', rule: 'format' }]);
  const row = world.journal.rows.find(item => mine(item) && item.id === id.toLowerCase());
  if (!row) stop(404, 'NOT_FOUND');
  if (row.corrupt) stop(500, 'INTERNAL');
  const quote = QUOTES.find(item => item.code === row.quoteCode);
  return respond(200, { id: row.id, createdAt: row.createdAt, body: row.body, quote: { code: row.quoteCode, text: quote?.text ?? '', author: quote?.author ?? null } } satisfies JournalEntry);
}

/** The server's clock: `world.hour` on the logical day of `world.day` (before 03:00 that is already the next calendar day), in Asia/Ho_Chi_Minh (UTC+7). */
const clockMs = () => Date.parse(`${world.hour < 3 ? addDays(world.day.logicalDate, 1) : world.day.logicalDate}T00:00:00Z`) + ((world.hour - 7) * 60 + world.tickets.minute) * 60_000;
const ticketState = (): StreakState => ({
  streakCurrent: world.me.progression?.streakCurrent ?? 0,
  streakBest: world.me.progression?.streakBest ?? 0,
  streakBeforeBreak: world.tickets.beforeBreak,
  breakDate: world.tickets.breakDate,
  missedRun: world.tickets.missedRun,
  lastOutcome: world.me.progression?.lastOutcome ?? null,
});
/** app._ticket_dates: today always, yesterday while the local hour is in [3, 15); newest first. */
function ticketDates(): { day: string; target: 'TODAY' | 'YESTERDAY' }[] {
  const today = world.day.logicalDate;
  return [{ day: today, target: 'TODAY' }, ...(world.hour >= 3 && world.hour < 15 ? [{ day: addDays(today, -1), target: 'YESTERDAY' as const }] : [])];
}
/** app._close_days: the days after the last close through `through`, as the day-close will read them. */
function openDays(through: string): DayInput[] {
  const first = addDays(closedOn(), 1);
  return Array.from({ length: Math.max(0, daysBetween(first, through) + 1) }, (_, n) => addDays(first, n)).map(date => ({ date, storyCompleted: storyOf(date), ticketApplied: ticketUsedFor(date) }));
}
/**
 * app._ticket_needed. A date that is still open: its story is not done and the streak it would freeze is above 0 (the streak the
 * day-close leaves once the open days before it are closed: walking back, the first day that is not frozen decides). A closed date:
 * it is the break date and the streak before the break is kept.
 */
function ticketNeeded(date: string): boolean {
  if (date <= closedOn()) return world.tickets.breakDate === date && world.tickets.beforeBreak !== null;
  const decided = openDays(addDays(date, -1)).reverse().find(day => day.storyCompleted || !day.ticketApplied);
  return (decided ? decided.storyCompleted : ticketState().streakCurrent > 0) && !storyOf(date);
}
/** app._ticket_block_reason: not eligible, already used, no ticket, not needed; null when a ticket may be used. */
function ticketBlock(date: string | null): string | null {
  if (date === null || !ticketDates().some(item => item.day === date)) return 'TICKET_DATE_NOT_ELIGIBLE';
  if (ticketUsedFor(date)) return 'TICKET_ALREADY_USED_FOR_DATE';
  if (unusedTickets() === 0) return 'NO_TICKET';
  return ticketNeeded(date) ? null : 'TICKET_NOT_NEEDED';
}
/** What GET /freeze-tickets and POST /freeze-tickets/use answer. The previews are the domain's (an open date: the state the close will leave; a closed one: the break). */
function ticketsState(): Tickets {
  const state = ticketState();
  return {
    serverTime: new Date(clockMs()).toISOString(),
    available: unusedTickets(),
    cap: ticketCap(),
    eligible: ticketDates().map(({ day, target }) => {
      const open = day > closedOn();
      const { withoutTicket, withTicket } = open ? ticketPreview(closeDays(state, openDays(addDays(day, -1))).state, 'TODAY') : ticketPreview(state, 'YESTERDAY');
      const deadline = new Date(Date.parse(`${addDays(day, 1)}T00:00:00Z`) + (15 - 7) * HOUR).toISOString();
      return { date: day, target, deadline, needed: ticketNeeded(day), withoutTicket, withTicket, alreadyUsed: ticketUsedFor(day) };
    }),
    progression: world.me.progression as NonNullable<Me['progression']>,
  };
}
/**
 * `POST /freeze-tickets/use`: `date` (422: not a string / required / format), then ticket_use: the refusal of app._ticket_block_reason.
 * The oldest unused ticket gets the date; for a closed date the streak before the break comes back (the rescue). The answer is the tickets.
 */
function useTicket(body: Record<string, unknown>) {
  const { date } = body;
  // as routes/tickets.ts: anything but a string (or nothing) is a bad format, even a falsy 0 or false, before dateOf asks for the date
  if (date !== undefined && date !== null && typeof date !== 'string') stop(422, 'VALIDATION_FAILED', [{ field: 'date', rule: 'format' }]);
  const day = dateOf(date as string | null | undefined, 'date');
  const refused = ticketBlock(day);
  if (refused) stop(409, refused);
  const ticket = world.tickets.list.find(item => item.usedFor === null);
  if (ticket) ticket.usedFor = day;
  const { progression } = world.me;
  if (progression && day <= closedOn()) {
    world.me = { ...world.me, progression: { ...progression, streakCurrent: world.tickets.beforeBreak ?? progression.streakCurrent, lastOutcome: 'FROZEN', breakNotice: null } };
    world.tickets.beforeBreak = null;
    world.tickets.breakDate = null;
    world.tickets.missedRun = Math.max(0, world.tickets.missedRun - 1);
  }
  return respond(200, ticketsState());
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
    Object.assign(world, { day: dayOf(), me: meOf(), settings: settingsOf(), down: false, hour: 19, closedDate: undefined, skew: 0, highWater: undefined, minutes: { resistance: 60, cardio: 45 }, history: {}, plan: freshPlan(), shop: freshShop(), guild: freshGuild(), inbox: [], journal: freshJournal(), tickets: freshTickets(), answer: undefined });
    fetchMock.mockImplementation(async (url, init) => {
      const request = `${init.method} ${url.replace(BASE, '')}`;
      const taken = await world.answer?.(request, init);
      return taken ?? serverAnswer(request, init);
    });
  });
  afterEach(() => clearCelebrations());
}
