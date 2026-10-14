// The workout routes over HTTP, on the real database: the catalog and its filters, one workout,
// a recorded session and the XP rules of AR-11; with the calorie log, STORY_ALL_DONE and the
// races of the two STORY writes against each other, a tick and bedtime. Time is the test clock.
// Expected values come from the content file and the domain functions, never from the code
// under test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { WorkoutSummary } from '../../../domain/contract/content.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { mapStats } from '../../../domain/stats.ts';
import type { Archetype } from '../../../domain/types.ts';
import { MOVES, WORKOUTS } from '../../content/exercises.ts';
import { QUESTS } from '../../content/quests.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh
const EVENING = '2027-03-10T13:00:00.000Z'; // 20:00 there: bedtime is accepted and rewarded
const DAY_MS = 24 * 3600_000;
const WORKOUT = QUESTS.find(quest => quest.code === 'WORKOUT_MAIN')!;

let db: TestDb;
let app: TestApp;
let ids: Record<string, string>;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  ids = Object.fromEntries(
    (await db.admin.query('SELECT code, id FROM exercise_items')).rows.map(row => [row.code, row.id]),
  );
});
after(async () => {
  try {
    for (const line of app.logs) {
      const allowed =
        line.evt === 'ledger'
          ? ['ts', 'evt', 'kind', 'userId', 'amount', 'reason', 'refId']
          : ['ts', 'level', 'method', 'route', 'status', 'ms', 'userId'];
      assert.deepEqual(Object.keys(line).filter(name => !allowed.includes(name)), [], JSON.stringify(line));
    }
  } finally {
    await setTestClock(db.admin, null);
    await app.close();
    await db.drop();
  }
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;
const clock = (at: string) => setTestClock(db.admin, at);
const plus = (from: string, ms: number) => new Date(Date.parse(from) + ms).toISOString();
const get = (user: { token: string }, path: string) => app.call('GET', path, { token: user.token });
const complete = (user: { token: string }, body: unknown, key = randomUUID()) =>
  app.call('POST', '/workout/complete', { token: user.token, key, body });
const session = (user: User, code: string, elapsedSec: number, key = randomUUID()) =>
  complete(user, { exerciseItemId: ids[code], elapsedSec }, key);
const meal = (user: User, kcal: number, key = randomUUID()) =>
  app.call('POST', '/nutrition/log', { token: user.token, key, body: { kcal } });

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
const questOf = (day: any, code: string) => day.quests.find((quest: any) => quest.code === code);
const warmPool = () => Promise.all(Array.from({ length: 10 }, () => db.app.query('SELECT 1')));

/** The XP, coins and sessions of a user, read as the owner. */
async function stored(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
            (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin,
            (SELECT count(*)::int FROM coin_ledger WHERE user_id = $1) AS coin_rows,
            (SELECT count(*)::int FROM workout_sessions WHERE user_id = $1) AS sessions,
            (SELECT xp_high_water FROM progression_state WHERE user_id = $1) AS high_water`,
    [userId],
  );
  return rows[0];
}

// ---------------------------------------------------------------- the catalog

const collator = new Intl.Collator('vi');
/** What the catalog must answer to a user of that archetype and weight: from the content file. */
function expectedCatalog(
  archetype: Archetype,
  weightKg: number,
  keep: (workout: (typeof WORKOUTS)[number]) => boolean,
): WorkoutSummary[] {
  return WORKOUTS.filter(keep)
    .map(workout => ({
      id: ids[workout.code],
      code: workout.code,
      name: workout.name,
      modality: workout.modality,
      durationSec: workout.durationSec,
      spaceNeeded: workout.spaceNeeded,
      equipment: workout.equipment,
      recommended: workout.archetypes.includes(archetype),
      kcalEstimate: Math.round((workout.metValue * weightKg * workout.durationSec) / 3600 / 10) * 10,
    }))
    .sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        collator.compare(a.name, b.name) ||
        (a.code < b.code ? -1 : 1),
    );
}

test('the catalog: each filter alone and together, equipment absent, empty, a mat, everything; no match is an empty list; recommended first for each archetype', async () => {
  await clock(NOON);
  let compared = 0;
  for (const archetype of ['TANKER', 'ASSASSIN', 'SUPPORTER'] as const) {
    const user = await newOnboardedUser(db, { archetype, weightKg: 65 });
    const cases: [query: string, keep: (w: (typeof WORKOUTS)[number]) => boolean][] = [
      ['', () => true],
      ['?duration=5', w => w.durationSec === 300],
      ['?duration=45', w => w.durationSec === 2700],
      ['?space=GYM', w => w.spaceNeeded === 'GYM'],
      ['?equipment=', w => w.equipment.length === 0],
      ['?equipment=tham', w => w.equipment.length === 0],
      ['?equipment=ta-tay', w => w.equipment.every(e => e === 'ta-tay')],
      ['?equipment=tham,ta-tay,day-khang-luc', () => true],
      ['?duration=15&space=ROOM&equipment=', w => w.durationSec === 900 && w.spaceNeeded === 'ROOM' && w.equipment.length === 0],
      ['?duration=30&space=GYM&equipment=ta-tay', w => w.durationSec === 1800 && w.spaceNeeded === 'GYM' && w.equipment.every(e => e === 'ta-tay')],
    ];
    for (const [query, keep] of cases) {
      const { items } = ok(await get(user, `/workout/catalog${query}`));
      assert.deepEqual(items, expectedCatalog(archetype, 65, keep), `${archetype} ${query}`);
      // recommended ones first
      const firstOther = items.findIndex((item: WorkoutSummary) => !item.recommended);
      assert.ok(firstOther === -1 || items.slice(firstOther).every((item: WorkoutSummary) => !item.recommended));
      compared += items.length;
    }
  }
  // the facts the cases rely on: dumbbell workouts exist and the mat leaves them out
  assert.ok(WORKOUTS.some(w => w.equipment.includes('ta-tay')));
  const user = await newOnboardedUser(db);
  const mat = ok(await get(user, '/workout/catalog?equipment=tham')).items.map((item: WorkoutSummary) => item.code);
  assert.ok(WORKOUTS.filter(w => w.equipment.includes('ta-tay')).every(w => !mat.includes(w.code)));
  // no workout of 5 minutes at the gym with dumbbells: an empty list, not an error
  assert.equal(WORKOUTS.filter(w => w.durationSec === 300 && w.spaceNeeded === 'GYM' && w.equipment.includes('ta-tay')).length, 0);
  assert.deepEqual(ok(await get(user, '/workout/catalog?duration=5&space=GYM&equipment=ta-tay')), { items: [] });
  // only content: the whole catalog is the content file, nothing else (no decoy, no other row)
  assert.deepEqual(
    ok(await get(user, '/workout/catalog')).items.map((item: WorkoutSummary) => item.code).sort(),
    WORKOUTS.map(w => w.code).sort(),
  );
  assert.ok(compared > WORKOUTS.length * 3);
});

test('the catalog refuses a filter value it does not know: 422, never a 500', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  for (const [query, field] of [
    ['duration=7', 'duration'], ['duration=', 'duration'], ['duration=15.0', 'duration'], ['duration=900', 'duration'],
    ['space=room', 'space'], ['space=', 'space'], ['equipment=xa-don', 'equipment'], ['equipment=tham,', 'equipment'],
    ['equipment=TA-TAY', 'equipment'],
  ]) {
    refusal(await get(user, `/workout/catalog?${query}`), 422, 'VALIDATION_FAILED', fields(field, 'enum'));
  }
});

test('kcalEstimate is MET x the caller’s latest weight x hours, to the nearest 10: another user’s weight never counts', async () => {
  await clock(NOON);
  const light = await newOnboardedUser(db, { weightKg: 50 });
  const heavy = await newOnboardedUser(db, { weightKg: 120 });
  const estimates = async (user: User) =>
    Object.fromEntries(
      ok(await get(user, '/workout/catalog')).items.map((item: WorkoutSummary) => [item.code, item.kcalEstimate]),
    );
  const of = (weight: number) =>
    Object.fromEntries(expectedCatalog('SUPPORTER', weight, () => true).map(item => [item.code, item.kcalEstimate]));
  assert.deepEqual(await estimates(light), of(50));
  assert.deepEqual(await estimates(heavy), of(120));
  // a later snapshot of the light user moves only the light user's estimates
  await db.admin.query(
    `INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level, recorded_at)
     SELECT user_id, height_cm, 80, birth_year, sex, activity_level, recorded_at + interval '1 day'
       FROM biometric_snapshots WHERE user_id = $1`,
    [light.userId],
  );
  assert.deepEqual(await estimates(light), of(80));
  assert.deepEqual(await estimates(heavy), of(120));
  assert.equal(ok(await get(light, `/workout/items/${ids.FULL_BODY_EASY}`)).kcalEstimate, of(80).FULL_BODY_EASY);
});

// ---------------------------------------------------------------- one workout

test('GET /workout/items/{id}: the workout with its sets and its steps joined to their moves, by position; a malformed id is 422, an unknown one 404', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db, { archetype: 'TANKER', weightKg: 65 });
  for (const workout of WORKOUTS) {
    const [summary] = expectedCatalog('TANKER', 65, w => w.code === workout.code);
    assert.deepEqual(ok(await get(user, `/workout/items/${ids[workout.code]}`)), {
      ...summary,
      sets: workout.sets,
      steps: workout.steps.map((step, i) => {
        const move = MOVES.find(m => m.code === step.moveCode)!;
        return {
          position: i + 1,
          phase: step.phase,
          seconds: step.seconds,
          repsText: step.repsText,
          move: { code: move.code, name: move.name, demoCode: move.demoCode, steps: move.steps, caution: move.caution },
        };
      }),
    });
  }
  refusal(await get(user, '/workout/items/abc'), 422, 'VALIDATION_FAILED', fields('id', 'format'));
  refusal(await get(user, `/workout/items/${randomUUID()}`), 404, 'NOT_FOUND');
  const quest = (await db.admin.query("SELECT id FROM quests WHERE code = 'WORKOUT_MAIN'")).rows[0].id;
  refusal(await get(user, `/workout/items/${quest}`), 404, 'NOT_FOUND');
});

// ---------------------------------------------------------------- a session (AR-11)

test('a session of 449 s of 900 earns its share and no coins; 450 s completes the quest: 50 XP for the day and 20 coins', async () => {
  await clock(NOON);
  const short = await newOnboardedUser(db);
  const partial = ok(await session(short, 'FULL_BODY_EASY', 449));
  const share = Math.floor((WORKOUT.xpReward * 449) / 900);
  assert.deepEqual(
    [partial.completed, partial.xpAwarded, partial.coinAwarded, partial.elapsedSec, partial.durationSec, partial.delta],
    [false, share, 0, 449, 900, { xp: share, coin: 0, events: [] }],
  );
  assert.equal(questOf(partial.day, 'WORKOUT_MAIN').completed, false);

  const full = await newOnboardedUser(db);
  const done = ok(await session(full, 'FULL_BODY_EASY', 450));
  assert.deepEqual(
    [done.completed, done.xpAwarded, done.coinAwarded, done.delta],
    [true, 50, 20, { xp: 50, coin: 20, events: [{ type: 'QUEST_COMPLETED', questCode: 'WORKOUT_MAIN' }] }],
  );
  assert.equal(questOf(done.day, 'WORKOUT_MAIN').completed, true);
  // after completion: recorded, earns nothing
  const later = ok(await session(full, 'FULL_BODY_EASY', 900));
  assert.deepEqual([later.completed, later.xpAwarded, later.coinAwarded, later.delta], [true, 0, 0, { xp: 0, coin: 0, events: [] }]);
  assert.deepEqual(await stored(full.userId), { xp: 50, coin: 20, coin_rows: 1, sessions: 2, high_water: 50 });
});

test('AR-11 for any sequence of sessions in a day: the quest never pays more than its XP, the coins once, nothing after completion', async () => {
  await clock(NOON);
  // [workout, elapsed seconds] in the order they are recorded
  const sequences: [string, number][][] = [
    [['FULL_BODY_EASY', 1]],
    [['FULL_BODY_EASY', 450]],
    [['FULL_BODY_EASY', 449]],
    [['FULL_BODY_EASY', 1800]],
    [['FULL_BODY_EASY', 449], ['FULL_BODY_EASY', 450]],
    [['FULL_BODY_EASY', 449], ['FULL_BODY_EASY', 449], ['FULL_BODY_EASY', 449], ['FULL_BODY_EASY', 450]],
    [['FULL_BODY_EASY', 100], ['FULL_BODY_EASY', 200], ['FULL_BODY_EASY', 300], ['FULL_BODY_EASY', 800]],
    [['FULL_BODY_EASY', 450], ['FULL_BODY_EASY', 449], ['DESK_STRETCH', 300]],
    [['DESK_STRETCH', 100], ['FULL_BODY_EASY', 449], ['DESK_STRETCH', 149], ['DESK_STRETCH', 150]],
    [['DESK_STRETCH', 1], ['DESK_STRETCH', 149], ['DESK_STRETCH', 149], ['DESK_STRETCH', 149], ['DESK_STRETCH', 600]],
  ];
  const duration = (code: string) => WORKOUTS.find(w => w.code === code)!.durationSec;
  for (const sequence of sequences) {
    const user = await newOnboardedUser(db);
    // the rule of AR-11, applied here on its own
    let given = 0;
    let completed = false;
    let highWater = 0;
    for (const [code, elapsed] of sequence) {
      const d = duration(code);
      const half = elapsed * 2 >= d;
      const xp: number = completed ? 0 : half ? WORKOUT.xpReward - given : Math.min(Math.floor((WORKOUT.xpReward * elapsed) / d), WORKOUT.xpReward - given);
      const coin: number = !completed && half ? WORKOUT.coinReward : 0;
      completed ||= half;
      given += xp;
      const answer = ok(await session(user, code, elapsed));
      const label = `${JSON.stringify(sequence)} at ${code} ${elapsed}`;
      assert.deepEqual([answer.completed, answer.xpAwarded, answer.coinAwarded], [half, xp, coin], label);
      assert.deepEqual([answer.delta.xp, answer.delta.coin], [xp, coin], label);
      const now = await stored(user.userId);
      assert.ok(now.xp <= WORKOUT.xpReward && now.xp === given, label);
      assert.ok(now.high_water >= highWater, label);
      highWater = now.high_water;
    }
    const end = await stored(user.userId);
    assert.deepEqual([end.xp, end.coin, end.coin_rows, end.sessions], [given, completed ? 20 : 0, completed ? 1 : 0, sequence.length]);
  }
  // the three partial sessions that pass the reward together paid exactly 50
  assert.equal(24 + 24 + 2, WORKOUT.xpReward);
});

test('a session body: every odd input is 422, an unknown workout 404, more than twice the duration 422; nothing is written', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const quest = (await db.admin.query("SELECT id FROM quests WHERE code = 'WORKOUT_MAIN'")).rows[0].id;
  const cases: [unknown, number, string, unknown?][] = [
    [{ elapsedSec: 10 }, 422, 'VALIDATION_FAILED', fields('exerciseItemId', 'required')],
    [{ exerciseItemId: 'abc', elapsedSec: 10 }, 422, 'VALIDATION_FAILED', fields('exerciseItemId', 'format')],
    [{ exerciseItemId: 5, elapsedSec: 10 }, 422, 'VALIDATION_FAILED', fields('exerciseItemId', 'format')],
    [{ exerciseItemId: ids.FULL_BODY_EASY }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'required')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: '450' }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'format')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 450.5 }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'format')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 0 }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'min')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: -1 }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'min')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 2 ** 31 }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'max')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 1801 }, 422, 'VALIDATION_FAILED', fields('elapsedSec', 'max')],
    [{ exerciseItemId: randomUUID(), elapsedSec: 10 }, 404, 'NOT_FOUND'],
    [{ exerciseItemId: quest, elapsedSec: 10 }, 404, 'NOT_FOUND'],
    [null, 422, 'VALIDATION_FAILED', fields('body', 'format')],
    [[], 422, 'VALIDATION_FAILED', fields('body', 'format')],
    [{ exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 10, occurredAt: 'now' }, 422, 'VALIDATION_FAILED', fields('occurredAt', 'format')],
  ];
  for (const [body, status, code, details] of cases) {
    refusal(await complete(user, body), status, code, details);
  }
  refusal(
    await app.call('POST', '/workout/complete', { token: user.token, key: randomUUID(), rawBody: `{"exerciseItemId":"${ids.FULL_BODY_EASY}","elapsedSec":1e400}`, headers: { 'content-type': 'application/json' } }),
    422, 'VALIDATION_FAILED', fields('elapsedSec', 'format'),
  );
  assert.deepEqual(await stored(user.userId), { xp: 0, coin: 0, coin_rows: 0, sessions: 0, high_water: 0 });
  assert.equal((await db.admin.query('SELECT count(*)::int AS n FROM daily_logs WHERE user_id = $1', [user.userId])).rows[0].n, 0);
});

test('one session is one action however often it is sent: the same key and body is the same answer; with occurredAt added 409; a refused key is free', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const key = randomUUID();
  const first = ok(await session(user, 'FULL_BODY_EASY', 300, key));
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(ok(await session(user, 'FULL_BODY_EASY', 300, key)), first);
  }
  refusal(await complete(user, { exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 300, occurredAt: NOON }, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  // ten sends of one key at once
  const burst = randomUUID();
  await warmPool();
  const answers = await Promise.all(Array.from({ length: 10 }, () => session(user, 'DESK_STRETCH', 60, burst)));
  assert.ok(answers.every(answer => answer.status === 200));
  const refused = randomUUID();
  refusal(await session(user, 'FULL_BODY_EASY', 1801, refused), 422, 'VALIDATION_FAILED', fields('elapsedSec', 'max'));
  ok(await session(user, 'FULL_BODY_EASY', 100, refused));
  assert.equal((await stored(user.userId)).sessions, 3);
  // somebody else's session id
  const other = await newOnboardedUser(db);
  refusal(await session(other, 'FULL_BODY_EASY', 300, key), 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await stored(other.userId)).sessions, 0);
});

// ---------------------------------------------------------------- both STORY quests

test('STORY_ALL_DONE: once on the write that completes the second STORY quest, in either order; never again for a replay, a second workout, a later meal', async () => {
  for (const order of ['workout first', 'meal first'] as const) {
    await clock(NOON);
    const user = await newOnboardedUser(db);
    const { min } = calorieWindow(ok(await get(user, '/day')).calorieWindow.target);
    const mealKey = randomUUID();
    const workoutKey = randomUUID();
    const first = order === 'workout first' ? ok(await session(user, 'FULL_BODY_EASY', 450, workoutKey)) : ok(await meal(user, min, mealKey));
    assert.ok(!first.delta.events.some((event: { type: string }) => event.type === 'STORY_ALL_DONE'), order);
    const second = order === 'workout first' ? ok(await meal(user, min, mealKey)) : ok(await session(user, 'FULL_BODY_EASY', 450, workoutKey));
    const quest = order === 'workout first' ? 'NUTRITION_TARGET' : 'WORKOUT_MAIN';
    // (100 XP also crosses level 2: LEVEL_UP follows, from the high-water mark)
    assert.deepEqual(
      second.delta.events.filter((event: { type: string }) => event.type !== 'LEVEL_UP'),
      [{ type: 'QUEST_COMPLETED', questCode: quest }, { type: 'STORY_ALL_DONE' }],
      order,
    );
    assert.deepEqual(second.day.story, { done: 2, total: 2 });
    assert.equal(
      (await db.admin.query('SELECT story_completed FROM daily_logs WHERE user_id = $1', [user.userId])).rows[0].story_completed,
      true,
    );
    // the stored answer of that action comes back as it was: one action, one event
    const replay = order === 'workout first' ? await meal(user, min, mealKey) : await session(user, 'FULL_BODY_EASY', 450, workoutKey);
    assert.deepEqual(ok(replay), second);
    // the same action once its stored answer is gone (purged): nothing is announced again
    await db.admin.query('DELETE FROM idempotency_keys WHERE user_id = $1', [user.userId]);
    const bare = order === 'workout first' ? ok(await meal(user, min, mealKey)) : ok(await session(user, 'FULL_BODY_EASY', 450, workoutKey));
    assert.deepEqual(bare.delta, { xp: 0, coin: 0, events: [] }, order);
    // later writes of the same day
    for (const later of [await session(user, 'FULL_BODY_EASY', 900), await meal(user, 100), await session(user, 'DESK_STRETCH', 10)]) {
      assert.deepEqual(ok(later).delta.events, [], order);
    }
  }
});

test('races on a warmed pool: calorie logs, sessions, a tick and bedtime of one user at the same moment: never a 5xx, each quest completes once, STORY_ALL_DONE once, the sums hold', async () => {
  let rounds = 0;
  for (let round = 0; round < 12; round++) {
    await clock(EVENING);
    const user = await newOnboardedUser(db);
    const { min } = calorieWindow(ok(await get(user, '/day')).calorieWindow.target);
    const from = app.logs.length;
    await warmPool();
    const answers = await Promise.all([
      meal(user, min), // nutrition x nutrition: either can be the one that reaches the window
      meal(user, 1),
      session(user, 'FULL_BODY_EASY', 450), // workout x workout: two that could complete
      session(user, 'FULL_BODY_EASY', 600),
      session(user, 'FULL_BODY_EASY', 449),
      app.call('POST', '/day/quests/WATER_8/progress', { token: user.token, key: randomUUID(), body: {} }),
      app.call('POST', '/day/bedtime', { token: user.token, key: randomUUID(), body: {} }),
    ]);
    assert.deepEqual(answers.map(answer => answer.status), [200, 200, 200, 200, 200, 200, 200], JSON.stringify(answers.map(a => a.body)));
    assert.deepEqual(app.logs.slice(from).filter(line => Number(line.status) >= 500), []);
    const events = answers.flatMap(answer => answer.body.delta.events.map((event: any) => event.type + (event.questCode ? `:${event.questCode}` : '')));
    assert.deepEqual(
      events.filter(event => event !== 'LEVEL_UP' && event !== 'PET_STAGE_UP').sort(),
      ['QUEST_COMPLETED:BEDTIME_BEFORE_23', 'QUEST_COMPLETED:NUTRITION_TARGET', 'QUEST_COMPLETED:WORKOUT_MAIN', 'STORY_ALL_DONE'],
    );
    const sessionsXp = answers.slice(2, 5).reduce((sum, answer) => sum + answer.body.xpAwarded, 0);
    assert.equal(sessionsXp, WORKOUT.xpReward);
    const end = await stored(user.userId);
    // nutrition 50/20, workout 50/20, one tick 10/5, bedtime 30/15
    assert.deepEqual([end.xp, end.coin, end.sessions], [140, 60, 3]);
    assert.ok(end.high_water >= end.xp && end.xp >= 0 && end.coin >= 0);
    rounds++;
  }
  assert.equal(rounds, 12);
});

// ---------------------------------------------------------------- what the user reads back

test('GET /me: one RESISTANCE session of 900 s is STR of 15 minutes, still on the sixth day after, gone on the seventh; CARDIO and HIIT make SPD', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const day = ok(await get(user, '/day'));
  const statsWith = (resistanceMinutes7d: number, cardioMinutes7d: number) =>
    mapStats({
      waterMl: 0,
      waterTargetMl: day.waterTargetMl,
      bedtimeMarked: false,
      streakCurrent: 0,
      caloriesIn: 0,
      calorieTarget: day.calorieWindow.target,
      resistanceMinutes7d,
      cardioMinutes7d,
    });
  ok(await session(user, 'FULL_BODY_EASY', 900));
  assert.equal(WORKOUTS.find(w => w.code === 'FULL_BODY_EASY')!.modality, 'RESISTANCE');
  // the session's day has calories 0 and no water: the stats of that day are those of 15 minutes
  assert.deepEqual(ok(await get(user, '/me')).stats, statsWith(15, 0));
  assert.ok(statsWith(15, 0).str > 0);
  await clock(plus(NOON, 6 * DAY_MS));
  assert.equal(ok(await get(user, '/me')).stats.str, statsWith(15, 0).str);
  await clock(plus(NOON, 7 * DAY_MS));
  assert.deepEqual(ok(await get(user, '/me')).stats, statsWith(0, 0));

  const cardio = WORKOUTS.find(w => w.modality === 'CARDIO')!;
  const hiit = WORKOUTS.find(w => w.modality === 'HIIT')!;
  ok(await session(user, cardio.code, cardio.durationSec));
  ok(await session(user, hiit.code, 60));
  assert.deepEqual(ok(await get(user, '/me')).stats, statsWith(0, cardio.durationSec / 60 + 1));
});

test('GET /day/history: workoutMinutes of a date; its detail lists each session with the workout name and the seconds spent', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const first = randomUUID();
  const second = randomUUID();
  ok(await session(user, 'FULL_BODY_EASY', 449, first));
  await clock(plus(NOON, 60_000));
  ok(await session(user, 'DESK_STRETCH', 300, second));
  const { days } = ok(await get(user, '/day/history?from=2027-03-09&to=2027-03-10'));
  assert.deepEqual(days.map((d: any) => d.workoutMinutes), [0, (449 + 300) / 60]);
  const detail = ok(await get(user, '/day/history/2027-03-10'));
  const name = (code: string) => WORKOUTS.find(w => w.code === code)!.name;
  assert.deepEqual(detail.actions, [
    { id: second, kind: 'WORKOUT', at: plus(NOON, 60_000), mealSlot: null, label: name('DESK_STRETCH'), value: 300, undone: false },
    { id: first, kind: 'WORKOUT', at: NOON, mealSlot: null, label: name('FULL_BODY_EASY'), value: 449, undone: false },
  ]);
});

// ---------------------------------------------------------------- occurredAt that PostgreSQL cannot read

test('occurredAt whose instant falls after the year 9999 is 422 occurredAt / format on a tick, on bedtime and on both STORY writes, never a 500', async () => {
  await clock(NOON);
  const user = await newOnboardedUser(db);
  const from = app.logs.length;
  const writes = (occurredAt: string) => [
    app.call('POST', '/day/quests/WATER_8/progress', { token: user.token, key: randomUUID(), body: { occurredAt } }),
    app.call('POST', '/day/bedtime', { token: user.token, key: randomUUID(), body: { occurredAt } }),
    app.call('POST', '/nutrition/log', { token: user.token, key: randomUUID(), body: { kcal: 10, occurredAt } }),
    complete(user, { exerciseItemId: ids.FULL_BODY_EASY, elapsedSec: 10, occurredAt }),
  ];
  for (const occurredAt of ['9999-12-31T23:59:59-23:59', '9999-12-31T23:59:59-00:01', '9999-12-31T23:59:59.9999-00:00']) {
    for (const answer of await Promise.all(writes(occurredAt))) {
      if (occurredAt.endsWith('-00:00')) {
        // still in 9999: an instant that exists, only far ahead
        refusal(answer, 422, 'OCCURRED_AT_INVALID');
      } else {
        refusal(answer, 422, 'VALIDATION_FAILED', fields('occurredAt', 'format'));
      }
    }
  }
  assert.deepEqual(app.logs.slice(from).filter(line => Number(line.status) >= 500), []);
  assert.deepEqual(await stored(user.userId), { xp: 0, coin: 0, coin_rows: 0, sessions: 0, high_water: 0 });
});

test('the three workout routes answer 401 without a session and 409 ONBOARDING_REQUIRED to a fresh account', async () => {
  const fresh = await newUser(db);
  for (const [method, path] of [['GET', '/workout/catalog'], ['GET', `/workout/items/${randomUUID()}`], ['POST', '/workout/complete']]) {
    const key = method === 'POST' ? randomUUID() : undefined;
    const body = method === 'POST' ? { exerciseItemId: randomUUID(), elapsedSec: 10 } : undefined;
    refusal(await app.call(method, path, { key, body }), 401, 'SESSION_INVALID');
    refusal(await app.call(method, path, { token: fresh.token, key, body }), 409, 'ONBOARDING_REQUIRED');
  }
});
