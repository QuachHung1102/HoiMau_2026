// The day routes over HTTP, on the real database: the day, ticks, undo, bedtime, history.
// Time is the test clock. Every expected number comes from the domain functions or from the
// content file, never from the code under test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import type { GameEvent } from '../../../domain/contract/common.ts';
import type {
  DayState,
  OnboardingRequest,
  QuestState,
} from '../../../domain/contract/core.ts';
import { calculatePrescription, calorieWindow } from '../../../domain/energy.ts';
import { addDays, localParts, logicalDateOf } from '../../../domain/logicalDate.ts';
import { cumulativeXpForLevel } from '../../../domain/progression.ts';
import { mapStats } from '../../../domain/stats.ts';
import { ageFrom } from '../../../domain/validation.ts';
import { QUESTS } from '../../content/quests.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { withRole } from '../db.ts';
import { buildDay, buildDayDetail } from '../readModels/day.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const HCM = 'Asia/Ho_Chi_Minh';
/** Noon in Ho Chi Minh City (UTC+7, no summer time). */
const NOON = '2027-03-10T05:00:00.000Z';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  try {
    // what a log line may hold: a request line or a ledger line, never a body or a calorie number
    for (const line of app.logs) {
      const allowed =
        line.evt === 'ledger'
          ? ['ts', 'evt', 'kind', 'userId', 'amount', 'reason', 'refId']
          : ['ts', 'level', 'method', 'route', 'status', 'ms', 'userId'];
      assert.deepEqual(
        Object.keys(line).filter(name => !allowed.includes(name)),
        [],
        JSON.stringify(line),
      );
    }
  } finally {
    await setTestClock(db.admin, null);
    await app.close();
    await db.drop();
  }
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;

const iso = (ms: number) => new Date(ms).toISOString();
const plus = (from: string, ms: number) => iso(Date.parse(from) + ms);
const clock = (at: string) => setTestClock(db.admin, at);
const key = () => randomUUID();

const tick = (user: User, code: string, more: { k?: string; occurredAt?: unknown } = {}) =>
  app.call('POST', `/day/quests/${code}/progress`, {
    token: user.token,
    key: more.k ?? key(),
    body: 'occurredAt' in more ? { occurredAt: more.occurredAt } : {},
  });
const undo = (user: User, code: string, tickId: unknown, k = key()) =>
  app.call('POST', `/day/quests/${code}/undo`, { token: user.token, key: k, body: { tickId } });
const bedtime = (user: User, more: { k?: string; occurredAt?: string } = {}) =>
  app.call('POST', '/day/bedtime', {
    token: user.token,
    key: more.k ?? key(),
    body: 'occurredAt' in more ? { occurredAt: more.occurredAt } : {},
  });
const get = (user: { token: string }, path: string) => app.call('GET', path, { token: user.token });

function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
function refusal(result: CallResult, status: number, code: string, details?: unknown) {
  assert.deepEqual(
    [result.status, result.body?.error?.code, result.body?.error?.details],
    [status, code, details],
    JSON.stringify(result.body),
  );
}
const fields = (field: string, rule: string) => ({ fields: [{ field, rule }] });
const questOf = (day: DayState, code: string) =>
  day.quests.find(quest => quest.code === code) as QuestState;

const prescriptionOf = (input: OnboardingRequest, at: string) =>
  calculatePrescription({
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    ageYears: ageFrom(input.birthYear, Date.parse(at), input.timezone),
    sex: input.sex,
    activityLevel: input.activityLevel,
    archetype: input.archetype,
  });

/** A day on which nothing was done, as `GET /day` must show it at `at`; `closesAt` is given. */
function emptyDay(user: User, at: string, closesAt: string): DayState {
  const { hour } = localParts(Date.parse(at), user.input.timezone);
  const prescription = prescriptionOf(user.input, at);
  return {
    logicalDate: logicalDateOf(Date.parse(at), user.input.timezone),
    serverTime: at,
    closesAt,
    caloriesIn: 0,
    waterMl: 0,
    waterTargetMl: prescription.waterMl,
    bedtimeMarkedAt: null,
    calorieWindow: calorieWindow(prescription.calorieTarget),
    quests: QUESTS.map(quest => ({
      code: quest.code,
      category: quest.category,
      titleKey: quest.titleKey,
      progress: 0,
      targetCount: quest.targetCount,
      completed: false,
      xpReward: quest.xpReward,
      coinReward: quest.coinReward,
      locked: quest.category === 'HIDDEN' && hour >= 3 && hour < 18,
      lastTick: null,
    })),
    story: { done: 0, total: 2 },
    streak: { current: 0, best: 0 },
    unreadCount: 0,
    celebrations: [],
  };
}

/** Everything a write may leave behind for a user, read as the owner. */
async function stored(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT (SELECT count(*)::int FROM daily_logs WHERE user_id = $1) AS logs,
            (SELECT count(*)::int FROM quest_completions WHERE user_id = $1) AS completions,
            (SELECT coalesce(sum(progress), 0)::int FROM quest_completions WHERE user_id = $1) AS progress,
            (SELECT count(*)::int FROM quest_ticks WHERE user_id = $1) AS ticks,
            (SELECT count(*)::int FROM quest_ticks WHERE user_id = $1 AND undone_at IS NULL) AS live,
            (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows,
            (SELECT count(*)::int FROM coin_ledger WHERE user_id = $1) AS coin_rows,
            (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
            (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin,
            (SELECT xp_high_water FROM progression_state WHERE user_id = $1) AS high_water`,
    [userId],
  );
  return rows[0] as Record<
    'logs' | 'completions' | 'progress' | 'ticks' | 'live' | 'xp_rows' | 'coin_rows' | 'xp' | 'coin' | 'high_water',
    number
  >;
}
const NOTHING = {
  logs: 0,
  completions: 0,
  progress: 0,
  ticks: 0,
  live: 0,
  xp_rows: 0,
  coin_rows: 0,
  xp: 0,
  coin: 0,
  high_water: 0,
};
const logsOf = async (userId: string) =>
  (
    await db.admin.query(
      `SELECT d.logical_date::text AS date, d.water_ml,
              (SELECT count(*)::int FROM quest_ticks t WHERE t.daily_log_id = d.id) AS ticks
         FROM daily_logs d WHERE d.user_id = $1 ORDER BY d.logical_date`,
      [userId],
    )
  ).rows as { date: string; water_ml: number; ticks: number }[];
const ledgerLines = (from: number, userId: string) =>
  app.logs
    .slice(from)
    .filter(line => line.evt === 'ledger' && line.userId === userId)
    .map(({ kind, amount, reason, refId }) => ({ kind, amount, reason, refId }));
const serverErrors = (from: number) =>
  app.logs.slice(from).filter(line => Number(line.status) >= 500);
/** A race needs requests that really overlap: all ten connections of the pool are opened first. */
const warmPool = () => Promise.all(Array.from({ length: 10 }, () => db.app.query('SELECT 1')));

// ---------------------------------------------------------------- reading the day

test('GET /day on a day without any action: the whole day with nothing done, and no row is created', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const day = ok(await get(user, '/day'));
  assert.deepEqual(day, emptyDay(user, NOON, '2027-03-10T20:00:00.000Z'));
  assert.equal(day.logicalDate, '2027-03-10');
  // the other reads create nothing either
  ok(await get(user, '/me'));
  ok(await get(user, '/day/history?from=2027-03-01&to=2027-03-10'));
  ok(await get(user, '/day/history/2027-03-10'));
  assert.deepEqual(await stored(user.userId), NOTHING);
});

test('GET /day right after 03:00: a fresh day, nothing of yesterday on it, no row for it', async () => {
  await clock('2027-03-10T19:59:59.000Z'); // 02:59:59 local on the 11th: still the 10th
  const user = await newOnboardedUser(db);
  const made = ok(await tick(user, 'WATER_8'));
  assert.equal(made.day.logicalDate, '2027-03-10');
  assert.equal(made.day.closesAt, '2027-03-10T20:00:00.000Z');
  assert.equal(questOf(made.day, 'WATER_8').progress, 1);

  await clock('2027-03-10T20:00:00.000Z'); // 03:00:00 local: the 11th
  const day = ok(await get(user, '/day'));
  assert.deepEqual(day, emptyDay(user, '2027-03-10T20:00:00.000Z', '2027-03-11T20:00:00.000Z'));
  assert.equal(day.logicalDate, '2027-03-11');
  assert.deepEqual(await logsOf(user.userId), [
    { date: '2027-03-10', water_ml: Math.round(day.waterTargetMl / 8), ticks: 1 },
  ]);
});

test('closesAt is the instant the logical date changes, in every zone and across the DST changes of 2026', async () => {
  const hours = (from: string, count: number, step = HOUR) =>
    Array.from({ length: count }, (_, i) => plus(from, i * step));
  // [zone, instants]: a plain zone, both DST changes of New York, the two ends of the date line,
  // a zone whose clocks go back from 04:00 to 03:00 (03:00 local comes twice) and forward from
  // 03:00 to 04:00 (03:00 local does not exist), and a half-hour change
  const grid: [string, string[]][] = [
    [HCM, hours('2026-06-01T00:00:00.000Z', 25)],
    ['America/New_York', hours('2026-03-07T00:00:00.000Z', 60)],
    ['America/New_York', hours('2026-10-31T00:00:00.000Z', 60)],
    ['America/New_York', hours('2026-03-08T06:30:00.000Z', 8, 15 * MINUTE)],
    ['America/New_York', hours('2026-11-01T05:30:00.000Z', 14, 15 * MINUTE)],
    ['Pacific/Kiritimati', hours('2026-06-01T00:00:00.000Z', 25)],
    ['Pacific/Pago_Pago', hours('2026-06-01T00:00:00.000Z', 25)],
    ['Europe/Athens', hours('2026-10-24T12:00:00.000Z', 30)],
    ['Europe/Athens', hours('2026-03-28T12:00:00.000Z', 30)],
    ['Australia/Lord_Howe', hours('2026-04-04T00:00:00.000Z', 30)],
  ];
  let checked = 0;
  for (const [zone, instants] of grid) {
    // a user of that zone, made at the first instant (a session lives 30 days)
    await clock(instants[0]);
    const user = await newOnboardedUser(db, { timezone: zone });
    for (const at of instants) {
      await clock(at);
      const day = ok(await get(user, '/day'));
      const closes = Date.parse(day.closesAt);
      const label = `${zone} at ${at}: closesAt ${day.closesAt}`;
      assert.equal(day.logicalDate, logicalDateOf(Date.parse(at), zone), label);
      assert.ok(closes > Date.parse(at), label);
      assert.ok(closes - Date.parse(at) <= 25 * HOUR, label);
      assert.equal(logicalDateOf(closes - 1, zone), day.logicalDate, label);
      assert.equal(logicalDateOf(closes, zone), addDays(day.logicalDate, 1), label);
      checked++;
    }
  }
  assert.equal(checked, grid.reduce((sum, [, instants]) => sum + instants.length, 0));
});

test('a tick one millisecond before closesAt lands on the day GET /day shows, one at closesAt on the next: at eight day boundaries, and in the four zones Node reads differently', async () => {
  // [zone, an instant inside the day, the day, the instant it ends]
  const cases: [string, string, string, string][] = [
    ['America/New_York', '2026-03-07T20:00:00.000Z', '2026-03-07', '2026-03-08T07:00:00.000Z'], // 03:00 EDT, an hour after the change
    ['America/New_York', '2026-10-31T20:00:00.000Z', '2026-10-31', '2026-11-01T08:00:00.000Z'], // 03:00 EST, on the change day
    ['Asia/Kolkata', '2026-06-01T10:00:00.000Z', '2026-06-01', '2026-06-01T21:30:00.000Z'],
    ['Asia/Kathmandu', '2026-06-01T10:00:00.000Z', '2026-06-01', '2026-06-01T21:15:00.000Z'],
    ['Australia/Lord_Howe', '2026-04-04T03:00:00.000Z', '2026-04-04', '2026-04-04T16:30:00.000Z'], // the 30-minute change
    ['Europe/Athens', '2026-10-24T12:00:00.000Z', '2026-10-24', '2026-10-25T00:00:00.000Z'], // the first of two 03:00
    ['Pacific/Kiritimati', '2026-06-01T00:00:00.000Z', '2026-06-01', '2026-06-01T13:00:00.000Z'],
    ['Pacific/Pago_Pago', '2026-06-01T20:00:00.000Z', '2026-06-01', '2026-06-02T14:00:00.000Z'],
    // PostgreSQL's zone database, where this Node's says otherwise (see the parity test in
    // server/test/day.sql.test.ts): British Columbia stays on UTC-7 after 1 November 2026, and
    // Moldova changes its clocks at 01:00 UTC
    ['America/Vancouver', '2026-11-10T20:00:00.000Z', '2026-11-10', '2026-11-11T10:00:00.000Z'],
    ['Canada/Pacific', '2026-11-10T20:00:00.000Z', '2026-11-10', '2026-11-11T10:00:00.000Z'],
    ['Europe/Chisinau', '2026-03-28T12:00:00.000Z', '2026-03-28', '2026-03-29T01:00:00.000Z'],
    ['Europe/Tiraspol', '2026-03-28T12:00:00.000Z', '2026-03-28', '2026-03-29T01:00:00.000Z'],
  ];
  for (const [zone, inside, date, ends] of cases) {
    await clock(inside);
    const user = await newOnboardedUser(db, { timezone: zone });
    const shown = ok(await get(user, '/day'));
    assert.deepEqual([shown.logicalDate, shown.closesAt], [date, ends], zone);

    await clock(plus(ends, -1));
    const last = ok(await tick(user, 'STAND_UP'));
    assert.deepEqual([last.day.logicalDate, last.day.closesAt], [date, ends], zone);
    await clock(ends);
    const first = ok(await tick(user, 'STAND_UP'));
    assert.equal(first.day.logicalDate, addDays(date, 1), zone);
    assert.ok(Date.parse(first.day.closesAt) > Date.parse(ends), zone);
    // each tick is on the day its answer showed
    assert.deepEqual(
      await logsOf(user.userId),
      [
        { date, water_ml: 0, ticks: 1 },
        { date: addDays(date, 1), water_ml: 0, ticks: 1 },
      ],
      zone,
    );
    assert.equal(questOf(last.day, 'STAND_UP').progress, 1, zone);
    assert.equal(questOf(first.day, 'STAND_UP').progress, 1, zone);
  }
});

test('where the label goes back for a while, closesAt is still the next instant it changes (Pacific/Chatham, 4 April 2026)', async () => {
  // 03:45 CHADT becomes 02:45 CHAST at 14:00 UTC: the 5th starts at 13:15 UTC (03:00), the label
  // is the 4th again from 14:00 to 14:15 UTC, and the 5th from then on
  const steps: [at: string, date: string, ends: string][] = [
    ['2026-04-04T13:00:00.000Z', '2026-04-04', '2026-04-04T13:15:00.000Z'],
    ['2026-04-04T13:30:00.000Z', '2026-04-05', '2026-04-04T14:00:00.000Z'],
    ['2026-04-04T14:05:00.000Z', '2026-04-04', '2026-04-04T14:15:00.000Z'],
    ['2026-04-04T14:15:00.000Z', '2026-04-05', '2026-04-05T14:15:00.000Z'],
  ];
  await clock(steps[0][0]);
  const user = await newOnboardedUser(db, { timezone: 'Pacific/Chatham' });
  for (const [at, date, ends] of steps) {
    await clock(at);
    const day = ok(await tick(user, 'STAND_UP')).day;
    assert.deepEqual([day.logicalDate, day.closesAt], [date, ends], at);
  }
  // the writes landed where the answers said: two on each date
  assert.deepEqual(await logsOf(user.userId), [
    { date: '2026-04-04', water_ml: 0, ticks: 2 },
    { date: '2026-04-05', water_ml: 0, ticks: 2 },
  ]);
});

test('buildDay with a date shows that day; without one, today', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const first = key();
  ok(await tick(user, 'WATER_8', { k: first }));
  await clock(plus(NOON, 24 * HOUR));
  const read = (date?: string) =>
    withRole(db.app, 'app_auth', user.userId, c => buildDay({ db: c }, date));
  const today = await read();
  assert.equal(today.logicalDate, '2027-03-11');
  assert.equal(questOf(today, 'WATER_8').progress, 0);
  const yesterday = await read('2027-03-10');
  assert.equal(yesterday.logicalDate, '2027-03-10');
  assert.equal(yesterday.closesAt, '2027-03-10T20:00:00.000Z');
  assert.equal(yesterday.serverTime, plus(NOON, 24 * HOUR));
  assert.deepEqual(questOf(yesterday, 'WATER_8').lastTick, { id: first, at: NOON });
  // the hidden quest is locked on the day the wall clock belongs to, on no other
  assert.equal(questOf(today, 'BEDTIME_BEFORE_23').locked, true);
  assert.equal(questOf(yesterday, 'BEDTIME_BEFORE_23').locked, false);
});

// ---------------------------------------------------------------- ticks

test('eight WATER_8 ticks with eight keys: progress 8, completed, the water target, 80 XP and 40 coins; the ninth is 409', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const target = prescriptionOf(user.input, NOON).waterMl;
  const from = app.logs.length;
  const keys = Array.from({ length: 8 }, key);
  let last: DayState | undefined;
  for (const [i, k] of keys.entries()) {
    const body = ok(await tick(user, 'WATER_8', { k }));
    const done = i === 7;
    assert.equal(body.actionId, k);
    assert.deepEqual(body.delta, {
      xp: 10,
      coin: 5,
      events: done ? [{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }] : [],
    });
    last = body.day as DayState;
    assert.deepEqual(last, {
      ...emptyDay(user, NOON, '2027-03-10T20:00:00.000Z'),
      waterMl: Math.round((target * (i + 1)) / 8),
      quests: last.quests,
    });
    assert.deepEqual(
      last.quests.map(quest => [quest.code, quest.progress, quest.completed, quest.lastTick?.id ?? null]),
      QUESTS.map(quest => (quest.code === 'WATER_8' ? [quest.code, i + 1, done, k] : [quest.code, 0, false, null])),
    );
    // recorded at the frozen instant, each tick strictly after the one before
    assert.equal(questOf(last, 'WATER_8').lastTick?.at, NOON);
  }
  assert.equal(last?.waterMl, target);
  assert.deepEqual(ok(await get(user, '/day')), last);
  const full = { ...NOTHING, logs: 1, completions: 1, progress: 8, ticks: 8, live: 8, xp_rows: 8, coin_rows: 8, xp: 80, coin: 40, high_water: 80 };
  assert.deepEqual(await stored(user.userId), full);
  const ledger = await db.admin.query(
    `SELECT 'xp' AS kind, amount, reason, ref_id FROM xp_ledger WHERE user_id = $1
     UNION ALL SELECT 'coin', amount, reason, ref_id FROM coin_ledger WHERE user_id = $1`,
    [user.userId],
  );
  const expectedRows = keys.flatMap(k => [
    { kind: 'xp', amount: 10, reason: 'QUEST_TICK', refId: k },
    { kind: 'coin', amount: 5, reason: 'QUEST_TICK', refId: k },
  ]);
  const byRef = (a: { refId: unknown; kind: unknown }, b: { refId: unknown; kind: unknown }) =>
    `${a.refId}${a.kind}`.localeCompare(`${b.refId}${b.kind}`);
  assert.deepEqual(
    ledger.rows.map(row => ({ kind: row.kind, amount: row.amount, reason: row.reason, refId: row.ref_id })).sort(byRef),
    [...expectedRows].sort(byRef),
  );
  // one log line per ledger row
  assert.deepEqual(ledgerLines(from, user.userId), expectedRows);

  refusal(await tick(user, 'WATER_8'), 409, 'QUEST_ALREADY_COMPLETE');
  assert.deepEqual(await stored(user.userId), full);
  assert.deepEqual(ledgerLines(from, user.userId), expectedRows);
});

test('STAND_UP reaches 6 and stops, and moves no water', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  for (let i = 1; i <= 6; i++) {
    const body = ok(await tick(user, 'STAND_UP'));
    assert.deepEqual(
      [questOf(body.day, 'STAND_UP').progress, questOf(body.day, 'STAND_UP').completed, body.day.waterMl],
      [i, i === 6, 0],
    );
    assert.deepEqual(body.delta.events, i === 6 ? [{ type: 'QUEST_COMPLETED', questCode: 'STAND_UP' }] : []);
  }
  refusal(await tick(user, 'STAND_UP'), 409, 'QUEST_ALREADY_COMPLETE');
  assert.deepEqual(await stored(user.userId), {
    ...NOTHING, logs: 1, completions: 1, progress: 6, ticks: 6, live: 6, xp_rows: 6, coin_rows: 6, xp: 60, coin: 30, high_water: 60,
  });
});

test('a quest that is not DAILY is 409 QUEST_NOT_TICKABLE, an unknown code 404 QUEST_NOT_FOUND; nothing is written', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  for (const code of ['WORKOUT_MAIN', 'NUTRITION_TARGET', 'BEDTIME_BEFORE_23']) {
    refusal(await tick(user, code), 409, 'QUEST_NOT_TICKABLE');
  }
  const odd = ['NO_SUCH_QUEST', 'water_8', 'WATER_8 ', "WATER_8'; DROP TABLE quests; --", 'nước', '%', '.hidden', 'a'.repeat(3000)];
  for (const code of odd) {
    refusal(await tick(user, encodeURIComponent(code)), 404, 'QUEST_NOT_FOUND');
    refusal(await undo(user, encodeURIComponent(code), randomUUID()), 404, 'TICK_NOT_FOUND');
  }
  // a quest the user's archetype does not have is not one of the user's quests
  await db.admin.query("UPDATE quests SET archetypes = '{TANKER}' WHERE code = 'STAND_UP'");
  try {
    refusal(await tick(user, 'STAND_UP'), 404, 'QUEST_NOT_FOUND');
    assert.deepEqual(
      ok(await get(user, '/day')).quests.map((quest: QuestState) => quest.code),
      QUESTS.filter(quest => quest.code !== 'STAND_UP').map(quest => quest.code),
    );
  } finally {
    await db.admin.query("UPDATE quests SET archetypes = '{TANKER,ASSASSIN,SUPPORTER}' WHERE code = 'STAND_UP'");
  }
  assert.deepEqual(await stored(user.userId), NOTHING);
});

test('the same key twice: one tick and the same answer; the same key with another body is 409 IDEMPOTENCY_KEY_REUSED', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const k = key();
  const first = await tick(user, 'WATER_8', { k });
  ok(first);
  await clock(plus(NOON, 90 * SECOND));
  const again = await tick(user, 'WATER_8', { k });
  assert.deepEqual([again.status, again.body], [first.status, first.body]);
  const once = { ...NOTHING, logs: 1, completions: 1, progress: 1, ticks: 1, live: 1, xp_rows: 1, coin_rows: 1, xp: 10, coin: 5, high_water: 10 };
  assert.deepEqual(await stored(user.userId), once);

  // what the offline queue does when it sends a record again more than 60 s after making it
  refusal(await tick(user, 'WATER_8', { k, occurredAt: NOON }), 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await stored(user.userId), once);

  // ten sends of one new key at the same moment: one tick, ten times the same answer
  await warmPool();
  const from = app.logs.length;
  const shared = key();
  const results = await Promise.all(Array.from({ length: 10 }, () => tick(user, 'WATER_8', { k: shared })));
  assert.deepEqual(serverErrors(from), []);
  for (const result of results) {
    assert.deepEqual([result.status, result.body], [200, results[0].body]);
  }
  assert.deepEqual(await stored(user.userId), {
    ...once, progress: 2, ticks: 2, live: 2, xp_rows: 2, coin_rows: 2, xp: 20, coin: 10, high_water: 20,
  });
});

test('an action id that is the tick of another user is 409 IDEMPOTENCY_KEY_REUSED and touches neither', async () => {
  await clock(NOON);
  const owner = await newOnboardedUser(db);
  const other = await newOnboardedUser(db);
  const k = key();
  ok(await tick(owner, 'WATER_8', { k }));
  const kept = await stored(owner.userId);
  refusal(await tick(other, 'WATER_8', { k }), 409, 'IDEMPOTENCY_KEY_REUSED');
  refusal(await tick(other, 'STAND_UP', { k }), 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await stored(other.userId), NOTHING);
  assert.deepEqual(await stored(owner.userId), kept);
});

test('twenty WATER_8 ticks at the same moment with twenty keys: exactly eight succeed, never a 5xx', async () => {
  await clock(NOON);
  for (let round = 0; round < 3; round++) {
    const user = await newOnboardedUser(db);
    await warmPool();
    const from = app.logs.length;
    const results = await Promise.all(Array.from({ length: 20 }, () => tick(user, 'WATER_8')));
    assert.deepEqual(serverErrors(from), [], `round ${round}`);
    assert.deepEqual(
      results.map(result => result.status).sort(),
      [...Array(8).fill(200), ...Array(12).fill(409)],
      `round ${round}`,
    );
    for (const result of results.filter(r => r.status === 409)) {
      refusal(result, 409, 'QUEST_ALREADY_COMPLETE');
    }
    // the eight answers are the eight steps, each seen once
    assert.deepEqual(
      results.filter(r => r.status === 200).map(r => questOf(r.body.day, 'WATER_8').progress).sort(),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.deepEqual(await stored(user.userId), {
      ...NOTHING, logs: 1, completions: 1, progress: 8, ticks: 8, live: 8, xp_rows: 8, coin_rows: 8, xp: 80, coin: 40, high_water: 80,
    });
    assert.equal(ok(await get(user, '/day')).waterMl, prescriptionOf(user.input, NOON).waterMl);
  }
});

// ---------------------------------------------------------------- undo

test('undo: within 10 s the tick is taken back with its reward; later 409 UNDO_WINDOW_EXPIRED; only the latest; once', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const target = prescriptionOf(user.input, NOON).waterMl;
  const from = app.logs.length;

  const a = key();
  ok(await tick(user, 'WATER_8', { k: a }));
  await clock(plus(NOON, 9 * SECOND));
  const undoKey = key();
  const undone = await undo(user, 'WATER_8', a, undoKey);
  const body = ok(undone);
  assert.equal(body.actionId, undoKey);
  assert.deepEqual(body.delta, { xp: -10, coin: -5, events: [] });
  assert.deepEqual(body.day, emptyDay(user, plus(NOON, 9 * SECOND), '2027-03-10T20:00:00.000Z'));
  const back = { ...NOTHING, logs: 1, completions: 1, ticks: 1, xp_rows: 2, coin_rows: 2, high_water: 10 };
  assert.deepEqual(await stored(user.userId), back);
  assert.deepEqual(ledgerLines(from, user.userId), [
    { kind: 'xp', amount: 10, reason: 'QUEST_TICK', refId: a },
    { kind: 'coin', amount: 5, reason: 'QUEST_TICK', refId: a },
    { kind: 'xp', amount: -10, reason: 'QUEST_TICK_UNDO', refId: a },
    { kind: 'coin', amount: -5, reason: 'QUEST_TICK_UNDO', refId: a },
  ]);
  // the same undo again: the stored answer; a new undo of that tick: it is gone
  const replay = await undo(user, 'WATER_8', a, undoKey);
  assert.deepEqual([replay.status, replay.body], [undone.status, undone.body]);
  refusal(await undo(user, 'WATER_8', a), 404, 'TICK_NOT_FOUND');
  assert.deepEqual(await stored(user.userId), back);

  // 11 s after the tick the window is closed; at exactly 10 s it is still open
  const b = key();
  ok(await tick(user, 'WATER_8', { k: b }));
  await clock(plus(NOON, 20 * SECOND));
  refusal(await undo(user, 'WATER_8', b), 409, 'UNDO_WINDOW_EXPIRED');
  const c = key();
  ok(await tick(user, 'WATER_8', { k: c }));
  await clock(plus(NOON, 30 * SECOND));
  assert.equal(questOf(ok(await undo(user, 'WATER_8', c)).day, 'WATER_8').progress, 1);

  // two ticks: the first cannot be undone while the second stands
  const [d, e] = [key(), key()];
  ok(await tick(user, 'WATER_8', { k: d }));
  ok(await tick(user, 'WATER_8', { k: e }));
  refusal(await undo(user, 'WATER_8', d), 409, 'UNDO_NOT_LATEST');
  const afterE = ok(await undo(user, 'WATER_8', e));
  assert.equal(afterE.day.waterMl, Math.round((target * 2) / 8));
  // the tick before it is the latest again, also for the app after a reload
  assert.equal(questOf(afterE.day, 'WATER_8').lastTick?.id, d);
  assert.equal(questOf(ok(await undo(user, 'WATER_8', d)).day, 'WATER_8').lastTick?.id, b);
  assert.deepEqual(await stored(user.userId), {
    ...NOTHING, logs: 1, completions: 1, progress: 1, ticks: 5, live: 1, xp_rows: 9, coin_rows: 9, xp: 10, coin: 5, high_water: 30,
  });
});

test('undo refusals: the tick of another user, of another quest, a malformed id; each leaves everything as it was', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const victim = await newOnboardedUser(db);
  const theirs = key();
  ok(await tick(victim, 'WATER_8', { k: theirs }));
  const mine = key();
  ok(await tick(user, 'STAND_UP', { k: mine }));
  const [userBefore, victimBefore] = [await stored(user.userId), await stored(victim.userId)];

  refusal(await undo(user, 'WATER_8', theirs), 404, 'TICK_NOT_FOUND');
  refusal(await undo(user, 'WATER_8', mine), 404, 'TICK_NOT_FOUND');
  refusal(await undo(user, 'WATER_8', randomUUID()), 404, 'TICK_NOT_FOUND');
  for (const tickId of ['', 'not-a-uuid', 7, { id: mine }, [mine]]) {
    refusal(await undo(user, 'STAND_UP', tickId), 422, 'VALIDATION_FAILED', fields('tickId', 'format'));
  }
  for (const body of [{}, { tickId: null }, undefined]) {
    refusal(
      await app.call('POST', '/day/quests/STAND_UP/undo', { token: user.token, key: key(), body }),
      422,
      'VALIDATION_FAILED',
      fields('tickId', 'required'),
    );
  }
  assert.deepEqual(await stored(user.userId), userBefore);
  assert.deepEqual(await stored(victim.userId), victimBefore);
  const tickRow = await db.admin.query('SELECT undone_at FROM quest_ticks WHERE id = $1', [theirs]);
  assert.deepEqual(tickRow.rows, [{ undone_at: null }]);
  // and the owner still can
  assert.equal(questOf(ok(await undo(victim, 'WATER_8', theirs)).day, 'WATER_8').progress, 0);
});

test('undo of the eighth tick: the quest is open again, and the tick after it completes it again', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  let last = '';
  for (let i = 0; i < 8; i++) {
    last = key();
    ok(await tick(user, 'WATER_8', { k: last }));
  }
  const reopened = ok(await undo(user, 'WATER_8', last));
  assert.deepEqual(
    [questOf(reopened.day, 'WATER_8').progress, questOf(reopened.day, 'WATER_8').completed],
    [7, false],
  );
  const again = ok(await tick(user, 'WATER_8'));
  assert.deepEqual(again.delta, { xp: 10, coin: 5, events: [{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }] });
  assert.deepEqual(await stored(user.userId), {
    ...NOTHING, logs: 1, completions: 1, progress: 8, ticks: 9, live: 8, xp_rows: 10, coin_rows: 10, xp: 80, coin: 40, high_water: 80,
  });
});

test('undo on a closed day is 409 DAY_CLOSED; an undo that would take a sum below zero is refused', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const a = key();
  ok(await tick(user, 'WATER_8', { k: a }));
  const kept = await stored(user.userId);
  await db.admin.query("UPDATE progression_state SET last_closed_date = '2027-03-10' WHERE user_id = $1", [user.userId]);
  refusal(await undo(user, 'WATER_8', a), 409, 'DAY_CLOSED');
  await db.admin.query('UPDATE progression_state SET last_closed_date = NULL WHERE user_id = $1', [user.userId]);
  assert.deepEqual(await stored(user.userId), kept);

  // the five coins of the tick are spent before the undo arrives
  await db.admin.query(
    "INSERT INTO coin_ledger (user_id, amount, reason, ref_id) VALUES ($1, -5, 'TEST_SPEND', 'undo-test')",
    [user.userId],
  );
  refusal(await undo(user, 'WATER_8', a), 409, 'UNDO_WINDOW_EXPIRED');
  assert.deepEqual(await stored(user.userId), { ...kept, coin_rows: 2, coin: 0 });
});

test('tick, undo and tick at the same moment, with a tick of another quest and a bedtime mark: never a 5xx, the sums are those of the live ticks', async () => {
  await clock('2027-03-10T13:00:00.000Z'); // 20:00 local: bedtime is accepted and rewarded
  for (let round = 0; round < 25; round++) {
    const user = await newOnboardedUser(db);
    const target = prescriptionOf(user.input, NOON).waterMl;
    const first = key();
    ok(await tick(user, 'WATER_8', { k: first }));
    await warmPool();
    const from = app.logs.length;
    const results = await Promise.all([
      undo(user, 'WATER_8', first),
      tick(user, 'WATER_8'),
      tick(user, 'STAND_UP'),
      bedtime(user),
      tick(user, 'WATER_8'),
      undo(user, 'WATER_8', first),
    ]);
    assert.deepEqual(serverErrors(from), [], `round ${round}`);
    const label = `round ${round}: ${results.map(r => r.body?.error?.code ?? r.status).join(', ')}`;
    // the ticks and the mark always go through; an undo does when it came first, and only once
    assert.deepEqual([1, 2, 3, 4].map(i => results[i].status), [200, 200, 200, 200], label);
    const undos = [results[0], results[5]];
    for (const result of undos.filter(r => r.status !== 200)) {
      assert.ok(
        ['UNDO_NOT_LATEST', 'TICK_NOT_FOUND'].includes(result.body.error.code) && [404, 409].includes(result.status),
        label,
      );
    }
    const wentBack = undos.filter(r => r.status === 200).length;
    assert.ok(wentBack <= 1, label);

    const water = 3 - wentBack;
    const rows = await stored(user.userId);
    assert.deepEqual(
      { live: rows.live, progress: rows.progress, xp: rows.xp, coin: rows.coin },
      // live ticks: water + one STAND_UP; progress adds the hidden quest; the mark pays 30 / 15
      { live: water + 1, progress: water + 2, xp: 10 * (water + 1) + 30, coin: 5 * (water + 1) + 15 },
      label,
    );
    assert.ok(rows.xp >= 0 && rows.coin >= 0 && rows.high_water >= rows.xp, label);
    // the mark never drops: it is the highest sum any order of these requests can have reached
    assert.ok(rows.high_water <= 10 * 4 + 30, label);
    const day = ok(await get(user, '/day'));
    assert.deepEqual(
      [questOf(day, 'WATER_8').progress, day.waterMl, questOf(day, 'STAND_UP').progress, questOf(day, 'BEDTIME_BEFORE_23').completed],
      [water, Math.round((target * water) / 8), 1, true],
      label,
    );
  }
});

test('xp_high_water never drops: a tick, its undo and a tick again leave the mark where the first tick put it', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const marks: number[] = [];
  for (let i = 0; i < 6; i++) {
    const k = key();
    ok(await tick(user, 'STAND_UP', { k }));
    marks.push((await stored(user.userId)).high_water);
    if (i % 2 === 0) {
      ok(await undo(user, 'STAND_UP', k));
      marks.push((await stored(user.userId)).high_water);
    }
  }
  assert.deepEqual(marks, [...marks].sort((x, y) => x - y));
  const rows = await stored(user.userId);
  assert.deepEqual([rows.live, rows.xp, rows.coin, rows.high_water], [3, 30, 15, 30]);
});

// ---------------------------------------------------------------- events

test('LEVEL_UP when the high-water mark crosses the level; not again after an undo and a new tick', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const below = cumulativeXpForLevel(2) - 10;
  await db.admin.query(
    "INSERT INTO xp_ledger (user_id, amount, reason, ref_id) VALUES ($1, $2, 'TEST', 'arrange')",
    [user.userId, below],
  );
  await db.admin.query('UPDATE progression_state SET xp_high_water = $2 WHERE user_id = $1', [user.userId, below]);
  const levelUp: GameEvent = { type: 'LEVEL_UP', level: 2, titleKey: 'TAN_BINH', perkPointsGained: 1 };
  const k = key();
  assert.deepEqual(ok(await tick(user, 'WATER_8', { k })).delta, { xp: 10, coin: 5, events: [levelUp] });
  const progression = async () => {
    const { level, perkPointsAvailable, xp } = ok(await get(user, '/progression'));
    return { level, perkPointsAvailable, xp };
  };
  assert.deepEqual(await progression(), { level: 2, perkPointsAvailable: 1, xp: below + 10 });

  assert.deepEqual(ok(await undo(user, 'WATER_8', k)).delta, { xp: -10, coin: -5, events: [] });
  // the level follows the sum; the point, once given, stays
  assert.deepEqual(await progression(), { level: 1, perkPointsAvailable: 1, xp: below });
  assert.deepEqual(ok(await tick(user, 'WATER_8')).delta, { xp: 10, coin: 5, events: [] });
  assert.deepEqual(await progression(), { level: 2, perkPointsAvailable: 1, xp: below + 10 });
});

test('PET_STAGE_UP when the high-water mark completes the egg', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  await db.admin.query(
    "INSERT INTO xp_ledger (user_id, amount, reason, ref_id) VALUES ($1, 290, 'TEST', 'arrange')",
    [user.userId],
  );
  await db.admin.query('UPDATE progression_state SET xp_high_water = 290 WHERE user_id = $1', [user.userId]);
  assert.deepEqual(ok(await tick(user, 'STAND_UP')).delta, {
    xp: 10,
    coin: 5,
    events: [{ type: 'PET_STAGE_UP', stage: 'HATCHLING' }],
  });
  assert.equal(ok(await get(user, '/pet')).stage, 'HATCHLING');
});

// ---------------------------------------------------------------- occurredAt and the open day

test('occurredAt: 47 h 59 min old lands on its own day; 48 h 1 min is 409 DAY_CLOSED; 60 s ahead counts as now; 121 s ahead is 422', async () => {
  await clock('2027-03-07T05:00:00.000Z');
  const user = await newOnboardedUser(db);
  const now = '2027-03-12T05:00:00.000Z';
  await clock(now);

  const late = plus(now, -(47 * HOUR + 59 * MINUTE));
  const lateKey = key();
  const body = ok(await tick(user, 'WATER_8', { k: lateKey, occurredAt: late }));
  // the answer carries today, which that tick is not part of
  assert.deepEqual(body.day, emptyDay(user, now, '2027-03-12T20:00:00.000Z'));
  assert.deepEqual(body.delta, { xp: 10, coin: 5, events: [] });
  assert.deepEqual(await logsOf(user.userId), [
    { date: logicalDateOf(Date.parse(late), HCM), water_ml: Math.round(body.day.waterTargetMl / 8), ticks: 1 },
  ]);
  assert.equal(logicalDateOf(Date.parse(late), HCM), '2027-03-10');
  // an offset spelling names the same instant
  assert.deepEqual(ok(await get(user, '/day/history/2027-03-10')).actions, [
    { id: lateKey, kind: 'TICK', at: late, mealSlot: null, label: 'WATER_8', value: null, undone: false },
  ]);

  refusal(await tick(user, 'WATER_8', { occurredAt: plus(now, -(48 * HOUR + MINUTE)) }), 409, 'DAY_CLOSED');
  refusal(await tick(user, 'WATER_8', { occurredAt: '0000-01-01T00:00:00Z' }), 409, 'DAY_CLOSED');
  refusal(await bedtime(user, { occurredAt: plus(now, -(48 * HOUR + MINUTE)) }), 409, 'DAY_CLOSED');

  const aheadKey = key();
  const ahead = ok(await tick(user, 'WATER_8', { k: aheadKey, occurredAt: plus(now, 60 * SECOND) }));
  assert.equal(questOf(ahead.day, 'WATER_8').progress, 1);
  const recorded = await db.admin.query('SELECT occurred_at FROM quest_ticks WHERE id = $1', [aheadKey]);
  assert.equal(recorded.rows[0].occurred_at.toISOString(), now);
  // with an offset: the same instant, 120 s ahead, still accepted
  ok(await tick(user, 'WATER_8', { occurredAt: '2027-03-12T12:02:00+07:00' }));

  const kept = await stored(user.userId);
  refusal(await tick(user, 'WATER_8', { occurredAt: plus(now, 121 * SECOND) }), 422, 'OCCURRED_AT_INVALID');
  refusal(await bedtime(user, { occurredAt: plus(now, 121 * SECOND) }), 422, 'OCCURRED_AT_INVALID');
  refusal(await tick(user, 'WATER_8', { occurredAt: '9999-12-31T23:59:59Z' }), 422, 'OCCURRED_AT_INVALID');
  for (const occurredAt of ['yesterday', '2027-03-12', '2027-03-12T05:00:00', '2027-02-31T05:00:00+99:99', 1789000000000, null, '']) {
    refusal(await tick(user, 'WATER_8', { occurredAt }), 422, 'VALIDATION_FAILED', fields('occurredAt', 'format'));
  }
  assert.deepEqual(await stored(user.userId), kept);
});

test('a day at or before last_closed_date takes no write: 409 DAY_CLOSED, while the open day does', async () => {
  await clock('2027-03-07T05:00:00.000Z');
  const user = await newOnboardedUser(db);
  const now = '2027-03-12T05:00:00.000Z';
  await clock(now);
  await db.admin.query("UPDATE progression_state SET last_closed_date = '2027-03-11' WHERE user_id = $1", [user.userId]);
  refusal(await tick(user, 'WATER_8', { occurredAt: plus(now, -24 * HOUR) }), 409, 'DAY_CLOSED');
  refusal(await tick(user, 'WATER_8', { occurredAt: plus(now, -40 * HOUR) }), 409, 'DAY_CLOSED');
  // 02:59 local on the 12th still belongs to the 11th
  refusal(await tick(user, 'WATER_8', { occurredAt: '2027-03-11T19:59:59.000Z' }), 409, 'DAY_CLOSED');
  assert.deepEqual(await stored(user.userId), NOTHING);
  ok(await tick(user, 'WATER_8', { occurredAt: '2027-03-11T20:00:00.000Z' }));
  ok(await tick(user, 'WATER_8'));
  assert.deepEqual(await logsOf(user.userId), [
    { date: '2027-03-12', water_ml: Math.round((prescriptionOf(user.input, now).waterMl * 2) / 8), ticks: 2 },
  ]);

  // today closed as well (the job ran): nothing goes in any more
  await db.admin.query("UPDATE progression_state SET last_closed_date = '2027-03-12' WHERE user_id = $1", [user.userId]);
  refusal(await tick(user, 'WATER_8'), 409, 'DAY_CLOSED');
  refusal(await bedtime(user), 409, 'DAY_CLOSED');
});

test('the day boundary: 23:50 and 00:30 share a row, 03:00:00 starts the next; in New York on both sides of 03:00 on the two DST days', async () => {
  const cases: [zone: string, onboardAt: string, instants: string[], rows: number[]][] = [
    // 23:50 on the 10th, 00:30 and 02:59:59 on the 11th, then 03:00:00
    [HCM, '2027-03-09T05:00:00.000Z', ['2027-03-10T16:50:00.000Z', '2027-03-10T17:30:00.000Z', '2027-03-10T19:59:59.000Z', '2027-03-10T20:00:00.000Z'], [3, 1]],
    // 8 March 2026: 02:00 EST becomes 03:00 EDT at 07:00 UTC, so 03:00 local is that instant
    ['America/New_York', '2026-03-06T17:00:00.000Z', ['2026-03-08T04:50:00.000Z', '2026-03-08T06:59:59.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z'], [2, 2]],
    // 1 November 2026: 02:00 EDT becomes 01:00 EST at 06:00 UTC, so 03:00 local is 08:00 UTC
    ['America/New_York', '2026-10-30T17:00:00.000Z', ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z', '2026-11-01T07:59:59.000Z', '2026-11-01T08:00:00.000Z'], [3, 1]],
  ];
  for (const [zone, onboardAt, instants, rows] of cases) {
    await clock(onboardAt);
    const user = await newOnboardedUser(db, { timezone: zone });
    for (const at of instants) {
      await clock(at);
      const body = ok(await tick(user, 'STAND_UP'));
      assert.equal(body.day.logicalDate, logicalDateOf(Date.parse(at), zone), `${zone} ${at}`);
    }
    const logs = await logsOf(user.userId);
    assert.deepEqual(logs.map(log => log.ticks), rows, zone);
    // every row carries the date the domain gives its instants
    assert.deepEqual(
      logs.map(log => log.date),
      [...new Set(instants.map(at => logicalDateOf(Date.parse(at), zone)))],
      zone,
    );
    assert.equal(logs.length, 2, zone);
    assert.equal(logs[1].date, addDays(logs[0].date, 1), zone);
  }
});

test('a move to a zone where today is a closed day: writes are 409 DAY_CLOSED, and the old rows keep their labels', async () => {
  // 14:00 UTC on the 9th is 04:00 on the 10th in Kiritimati (UTC+14)
  await clock('2027-03-09T14:00:00.000Z');
  const user = await newOnboardedUser(db, { timezone: 'Pacific/Kiritimati' });
  ok(await tick(user, 'WATER_8'));
  await clock('2027-03-10T14:00:00.000Z'); // the 11th there; the job has closed the 10th
  await db.admin.query("UPDATE progression_state SET last_closed_date = '2027-03-10' WHERE user_id = $1", [user.userId]);
  ok(await tick(user, 'WATER_8'));
  const labels = (await logsOf(user.userId)).map(log => log.date);
  assert.deepEqual(labels, ['2027-03-10', '2027-03-11']);

  // in Pago Pago (UTC-11) the same instant is 03:00 on the 10th: a day that is closed
  ok(await app.call('PATCH', '/me', { token: user.token, key: key(), body: { timezone: 'Pacific/Pago_Pago' } }));
  const kept = await stored(user.userId);
  refusal(await tick(user, 'WATER_8'), 409, 'DAY_CLOSED');
  refusal(await tick(user, 'STAND_UP'), 409, 'DAY_CLOSED');
  refusal(await bedtime(user), 409, 'DAY_CLOSED');
  assert.deepEqual(await stored(user.userId), kept);
  assert.deepEqual((await logsOf(user.userId)).map(log => log.date), labels);
  // the day is still readable: it is the row that was written under that label
  const day = ok(await get(user, '/day'));
  assert.deepEqual([day.logicalDate, questOf(day, 'WATER_8').progress], ['2027-03-10', 1]);

  // a day before the user's first day does not exist: the 9th in Pago Pago, for a user whose
  // first day is the 10th
  await db.admin.query('UPDATE progression_state SET last_closed_date = NULL WHERE user_id = $1', [user.userId]);
  refusal(await tick(user, 'STAND_UP', { occurredAt: '2027-03-10T13:00:00.000Z' }), 409, 'DAY_CLOSED');
  ok(await tick(user, 'STAND_UP'));
});

// ---------------------------------------------------------------- bedtime

test('bedtime at 17:59 is 409 BEDTIME_TOO_EARLY with the hidden quest locked; at 18:00 it is marked and rewarded, once', async () => {
  const at1759 = '2027-03-10T10:59:00.000Z';
  const at1800 = '2027-03-10T11:00:00.000Z';
  await clock(at1759);
  const user = await newOnboardedUser(db);
  assert.equal(questOf(ok(await get(user, '/day')), 'BEDTIME_BEFORE_23').locked, true);
  refusal(await bedtime(user), 409, 'BEDTIME_TOO_EARLY');
  assert.deepEqual(await stored(user.userId), NOTHING);

  await clock(at1800);
  assert.equal(questOf(ok(await get(user, '/day')), 'BEDTIME_BEFORE_23').locked, false);
  const from = app.logs.length;
  const k = key();
  const body = ok(await bedtime(user, { k }));
  assert.equal(body.actionId, k);
  assert.deepEqual(body.delta, {
    xp: 30,
    coin: 15,
    events: [{ type: 'QUEST_COMPLETED', questCode: 'BEDTIME_BEFORE_23' }],
  });
  const marked: DayState = body.day;
  assert.deepEqual(marked, {
    ...emptyDay(user, at1800, '2027-03-10T20:00:00.000Z'),
    bedtimeMarkedAt: at1800,
    quests: emptyDay(user, at1800, '').quests.map(quest =>
      quest.code === 'BEDTIME_BEFORE_23' ? { ...quest, progress: 1, completed: true } : quest,
    ),
  });
  const once = { ...NOTHING, logs: 1, completions: 1, progress: 1, xp_rows: 1, coin_rows: 1, xp: 30, coin: 15, high_water: 30 };
  assert.deepEqual(await stored(user.userId), once);
  const reward = [
    { kind: 'xp', amount: 30, reason: 'QUEST_COMPLETE', refId: 'BEDTIME_BEFORE_23:2027-03-10' },
    { kind: 'coin', amount: 15, reason: 'QUEST_COMPLETE', refId: 'BEDTIME_BEFORE_23:2027-03-10' },
  ];
  assert.deepEqual(ledgerLines(from, user.userId), reward);
  const ledger = await db.admin.query(
    `SELECT 'xp' AS kind, amount, reason, ref_id AS "refId" FROM xp_ledger WHERE user_id = $1
     UNION ALL SELECT 'coin', amount, reason, ref_id FROM coin_ledger WHERE user_id = $1`,
    [user.userId],
  );
  assert.deepEqual(ledger.rows, reward);

  // again, later in the window, with a new key: 200, the first mark stays, nothing is earned
  await clock('2027-03-10T15:00:00.000Z');
  const second = key();
  const repeat = ok(await bedtime(user, { k: second }));
  assert.equal(repeat.actionId, second);
  assert.deepEqual(repeat.delta, { xp: 0, coin: 0, events: [] });
  assert.equal(repeat.day.bedtimeMarkedAt, at1800);
  assert.deepEqual(await stored(user.userId), once);
  assert.deepEqual(ledgerLines(from, user.userId), reward);
  // the mark is an action of the day, under the id of the day's log
  const log = await db.admin.query('SELECT id FROM daily_logs WHERE user_id = $1', [user.userId]);
  assert.deepEqual(ok(await get(user, '/day/history/2027-03-10')).actions, [
    { id: log.rows[0].id, kind: 'BEDTIME', at: at1800, mealSlot: null, label: null, value: null, undone: false },
  ]);
});

test('bedtime at 22:59 is rewarded; at 23:00 and at 02:30 it is marked without a reward', async () => {
  const cases: [at: string, date: string, rewarded: boolean][] = [
    ['2027-03-10T15:59:59.000Z', '2027-03-10', true], // 22:59:59
    ['2027-03-10T16:00:00.000Z', '2027-03-10', false], // 23:00
    ['2027-03-10T19:30:00.000Z', '2027-03-10', false], // 02:30 on the 11th: still the 10th
  ];
  for (const [at, date, rewarded] of cases) {
    await clock(at);
    const user = await newOnboardedUser(db);
    const body = ok(await bedtime(user));
    assert.deepEqual(
      body.delta,
      rewarded
        ? { xp: 30, coin: 15, events: [{ type: 'QUEST_COMPLETED', questCode: 'BEDTIME_BEFORE_23' }] }
        : { xp: 0, coin: 0, events: [] },
      at,
    );
    assert.deepEqual(
      [body.day.logicalDate, body.day.bedtimeMarkedAt, questOf(body.day, 'BEDTIME_BEFORE_23').completed],
      [date, at, rewarded],
      at,
    );
    assert.deepEqual(
      await stored(user.userId),
      rewarded
        ? { ...NOTHING, logs: 1, completions: 1, progress: 1, xp_rows: 1, coin_rows: 1, xp: 30, coin: 15, high_water: 30 }
        : { ...NOTHING, logs: 1 },
      at,
    );
    assert.deepEqual(ok(await bedtime(user)).delta, { xp: 0, coin: 0, events: [] }, at);
    assert.equal((await stored(user.userId)).xp, rewarded ? 30 : 0, at);
  }
});

test('a bedtime mark sent late counts for the instant it was made: 22:55 sent at 23:05 is rewarded', async () => {
  await clock('2027-03-10T16:05:00.000Z'); // 23:05
  const user = await newOnboardedUser(db);
  const pressed = '2027-03-10T15:55:00.000Z'; // 22:55
  const body = ok(await bedtime(user, { occurredAt: pressed }));
  assert.equal(body.day.bedtimeMarkedAt, pressed);
  assert.deepEqual(body.delta, {
    xp: 30,
    coin: 15,
    events: [{ type: 'QUEST_COMPLETED', questCode: 'BEDTIME_BEFORE_23' }],
  });
  // and one made in the afternoon is too early whenever it arrives
  const other = await newOnboardedUser(db);
  refusal(await bedtime(other, { occurredAt: '2027-03-10T10:00:00.000Z' }), 409, 'BEDTIME_TOO_EARLY');
  assert.deepEqual(await stored(other.userId), NOTHING);
});

// ---------------------------------------------------------------- history

test('GET /day/history: 92 dates are answered, 93 are 422; from and to must be dates in order', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const history = (query: string) => get(user, `/day/history${query}`);
  const days = ok(await history('?from=2027-01-01&to=2027-04-02')).days;
  assert.equal(days.length, 92);
  assert.deepEqual(
    days.map((day: { logicalDate: string }) => day.logicalDate),
    Array.from({ length: 92 }, (_, i) => addDays('2027-01-01', i)),
  );
  refusal(await history('?from=2027-01-01&to=2027-04-03'), 422, 'VALIDATION_FAILED', fields('to', 'max'));
  refusal(await history('?from=2027-01-02&to=2027-01-01'), 422, 'VALIDATION_FAILED', fields('to', 'min'));
  refusal(await history('?to=2027-01-01'), 422, 'VALIDATION_FAILED', fields('from', 'required'));
  refusal(await history('?from=2027-01-01'), 422, 'VALIDATION_FAILED', fields('to', 'required'));
  refusal(await history(''), 422, 'VALIDATION_FAILED', fields('from', 'required'));
  for (const bad of ['2027-02-30', '2027-13-01', '27-01-01', '2027-1-1', 'today', '0000-01-01', '2027-01-01T00:00:00Z']) {
    refusal(await history(`?from=${bad}&to=2027-01-01`), 422, 'VALIDATION_FAILED', fields('from', 'format'));
    refusal(await history(`?from=2027-01-01&to=${bad}`), 422, 'VALIDATION_FAILED', fields('to', 'format'));
    refusal(await get(user, `/day/history/${bad}`), 422, 'VALIDATION_FAILED', fields('date', 'format'));
  }
  assert.equal(ok(await history('?from=9999-12-31&to=9999-12-31')).days[0].outcome, 'OPEN');
  assert.equal(ok(await get(user, '/day/history/0001-01-01')).summary.outcome, 'NONE');
});

test('GET /day/history: NONE before the first day, COMPLETED and MISSED for closed days, OPEN after the last close', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const target = prescriptionOf(user.input, NOON).waterMl;
  // the first day is the 4th; the 4th to the 7th are closed; the 8th to the 10th are open
  await db.admin.query(
    "UPDATE progression_state SET onboard_date = '2027-03-04', last_closed_date = '2027-03-07' WHERE user_id = $1",
    [user.userId],
  );
  // the 4th: story done. The 5th: no log at all. The 6th: a log, story not done. The 7th: story done.
  await db.admin.query(
    `INSERT INTO daily_logs (user_id, logical_date, calories_in, water_ml, story_completed, closed_at)
     VALUES ($1, '2027-03-04', 1850.5, 2000, true, '2027-03-04T20:00:00Z'),
            ($1, '2027-03-06', 900, 250, false, '2027-03-06T20:00:00Z'),
            ($1, '2027-03-07', 0, 0, true, '2027-03-07T20:00:00Z')`,
    [user.userId],
  );
  await db.admin.query(
    `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
     SELECT d.user_id, d.id, q.id, 1, d.closed_at
       FROM daily_logs d, quests q
      WHERE d.user_id = $1 AND q.category = 'STORY'
        AND (d.logical_date IN ('2027-03-04', '2027-03-07')
             OR (d.logical_date = '2027-03-06' AND q.code = 'WORKOUT_MAIN'))`,
    [user.userId],
  );
  ok(await tick(user, 'WATER_8', { occurredAt: plus(NOON, -30 * HOUR) })); // the 9th
  ok(await tick(user, 'WATER_8'));
  ok(await tick(user, 'WATER_8'));

  const summary = (logicalDate: string, outcome: string, more: object = {}) => ({
    logicalDate, outcome, storyDone: 0, storyTotal: 2, waterMl: 0, caloriesIn: 0, workoutMinutes: 0, ...more,
  });
  const expected = [
    summary('2027-03-02', 'NONE'),
    summary('2027-03-03', 'NONE'),
    summary('2027-03-04', 'COMPLETED', { storyDone: 2, waterMl: 2000, caloriesIn: 1850.5 }),
    summary('2027-03-05', 'MISSED'),
    summary('2027-03-06', 'MISSED', { storyDone: 1, waterMl: 250, caloriesIn: 900 }),
    summary('2027-03-07', 'COMPLETED', { storyDone: 2 }),
    summary('2027-03-08', 'OPEN'),
    summary('2027-03-09', 'OPEN', { waterMl: Math.round(target / 8) }),
    summary('2027-03-10', 'OPEN', { waterMl: Math.round((target * 2) / 8) }),
    summary('2027-03-11', 'OPEN'),
  ];
  assert.deepEqual(ok(await get(user, '/day/history?from=2027-03-02&to=2027-03-11')).days, expected);
  for (const day of expected) {
    assert.deepEqual(ok(await get(user, `/day/history/${day.logicalDate}`)).summary, day);
  }
  assert.deepEqual(ok(await get(user, '/day/history/2027-03-05')).actions, []);
});

test('GET /day/history/{date}: the ticks and the mark of that day, newest first, an undone tick marked', async () => {
  const at2000 = '2027-03-10T13:00:00.000Z';
  await clock(at2000);
  const user = await newOnboardedUser(db);
  const [a, b, c] = [key(), key(), key()];
  ok(await tick(user, 'WATER_8', { k: a, occurredAt: plus(at2000, -3 * HOUR) }));
  ok(await tick(user, 'STAND_UP', { k: b, occurredAt: plus(at2000, -2 * HOUR) }));
  ok(await tick(user, 'WATER_8', { k: c }));
  ok(await undo(user, 'WATER_8', c));
  await clock(plus(at2000, HOUR));
  ok(await bedtime(user));
  const log = await db.admin.query('SELECT id FROM daily_logs WHERE user_id = $1', [user.userId]);
  const action = (id: string, kind: string, at: string, label: string | null, undone = false) => ({
    id, kind, at, mealSlot: null, label, value: null, undone,
  });
  const detail = ok(await get(user, '/day/history/2027-03-10'));
  assert.deepEqual(detail.actions, [
    action(log.rows[0].id, 'BEDTIME', plus(at2000, HOUR), null),
    action(c, 'TICK', at2000, 'WATER_8', true),
    action(b, 'TICK', plus(at2000, -2 * HOUR), 'STAND_UP'),
    action(a, 'TICK', plus(at2000, -3 * HOUR), 'WATER_8'),
  ]);
  assert.equal(detail.summary.waterMl, Math.round(prescriptionOf(user.input, at2000).waterMl / 8));
});

test('GET /day/history/{date}: the summary and the actions come from one statement, so from one snapshot', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  ok(await tick(user, 'WATER_8'));
  let statements = 0;
  const detail = await withRole(db.app, 'app_auth', user.userId, c =>
    buildDayDetail(
      {
        db: {
          query: (...args: unknown[]) => {
            statements++;
            return (c.query as (...all: unknown[]) => unknown)(...args);
          },
        } as unknown as PoolClient,
      },
      '2027-03-10',
    ),
  );
  assert.equal(statements, 1);
  assert.equal(detail.actions.length, 1);
  assert.deepEqual(detail, ok(await get(user, '/day/history/2027-03-10')));
});

// ---------------------------------------------------------------- Me, isolation, access

test('GET /me: the stats count the water, the bedtime mark and the calories of today, and of no other day', async () => {
  const at2000 = '2027-03-10T13:00:00.000Z';
  await clock(at2000);
  const user = await newOnboardedUser(db);
  const prescription = prescriptionOf(user.input, at2000);
  const statsOf = (day: { waterMl: number; bedtimeMarked: boolean; caloriesIn: number }) =>
    mapStats({
      ...day,
      waterTargetMl: prescription.waterMl,
      streakCurrent: 0,
      calorieTarget: prescription.calorieTarget,
      resistanceMinutes7d: 0,
      cardioMinutes7d: 0,
    });
  const nothing = statsOf({ waterMl: 0, bedtimeMarked: false, caloriesIn: 0 });
  assert.deepEqual(ok(await get(user, '/me')).stats, nothing);
  for (let i = 0; i < 4; i++) {
    ok(await tick(user, 'WATER_8'));
  }
  ok(await bedtime(user));
  await db.admin.query('UPDATE daily_logs SET calories_in = 1500 WHERE user_id = $1', [user.userId]);
  const today = statsOf({ waterMl: Math.round((prescription.waterMl * 4) / 8), bedtimeMarked: true, caloriesIn: 1500 });
  assert.notDeepEqual(today, nothing);
  assert.deepEqual(ok(await get(user, '/me')).stats, today);
  // the next day starts from nothing
  await clock(plus(at2000, 24 * HOUR));
  assert.deepEqual(ok(await get(user, '/me')).stats, nothing);
});

test('one user never sees or changes the day of another, through any of these routes', async () => {
  await clock(NOON);
  const a = await newOnboardedUser(db);
  const b = await newOnboardedUser(db);
  for (let i = 0; i < 3; i++) {
    ok(await tick(a, 'WATER_8'));
  }
  const aRows = await stored(a.userId);
  assert.deepEqual(ok(await get(b, '/day')), emptyDay(b, NOON, '2027-03-10T20:00:00.000Z'));
  assert.deepEqual(ok(await get(b, '/day/history/2027-03-10')).actions, []);
  assert.deepEqual(
    ok(await get(b, '/day/history?from=2027-03-10&to=2027-03-10')).days,
    [{ logicalDate: '2027-03-10', outcome: 'OPEN', storyDone: 0, storyTotal: 2, waterMl: 0, caloriesIn: 0, workoutMinutes: 0 }],
  );
  // b's own tick starts b's own count
  assert.equal(questOf(ok(await tick(b, 'WATER_8')).day, 'WATER_8').progress, 1);
  assert.deepEqual(await stored(a.userId), aRows);
});

test('every day route answers 401 without a session and 409 ONBOARDING_REQUIRED to a fresh account', async () => {
  await clock(NOON);
  const fresh = await newUser(db);
  const all: [string, string, unknown?][] = [
    ['GET', '/day'],
    ['POST', '/day/quests/WATER_8/progress', {}],
    ['POST', '/day/quests/WATER_8/undo', { tickId: randomUUID() }],
    ['POST', '/day/bedtime', {}],
    ['GET', '/day/history?from=2027-03-01&to=2027-03-10'],
    ['GET', '/day/history/2027-03-10'],
  ];
  for (const [method, path, body] of all) {
    const options = method === 'GET' ? {} : { body, key: key() };
    refusal(await app.call(method, path, { token: fresh.token, ...options }), 409, 'ONBOARDING_REQUIRED');
    refusal(await app.call(method, path, options), 401, 'SESSION_INVALID');
  }
  refusal(await app.call('POST', '/day/bedtime', { token: fresh.token, body: {} }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.deepEqual(await stored(fresh.userId), { ...NOTHING, high_water: null });
});
