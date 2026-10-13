// The profile routes over HTTP, on the real database: onboarding, /me, biometrics, archetype,
// prescription. app.now() is frozen at T0 for the whole file; a test that moves it puts it back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type {
  Me,
  OnboardingRequest,
  PrescriptionResponse,
} from '../../../domain/contract/core.ts';
import { calculatePrescription } from '../../../domain/energy.ts';
import type { Archetype } from '../../../domain/types.ts';
import { ageFrom } from '../../../domain/validation.ts';
import { setTestClock } from '../../test/helpers.ts';
import {
  ONBOARDING_INPUT,
  newOnboardedUser,
  newUser,
  startTestApp,
} from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const T0 = Date.parse('2027-01-10T00:00:00Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const clock = (offsetMs: number) => setTestClock(db.admin, at(offsetMs));

const NBSP = String.fromCharCode(0xa0);
const SOFT_HYPHEN = String.fromCharCode(0xad);

/** 170 cm and 50 kg: BMI 17.3, no ASSASSIN. */
const LIGHT_KG = 50;

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await clock(0);
});
after(async () => {
  try {
    // what a log line may hold: never a body, a measurement, a target, an email
    for (const line of app.logs) {
      assert.deepEqual(
        Object.keys(line).filter(
          key => !['ts', 'level', 'method', 'route', 'status', 'ms', 'userId'].includes(key),
        ),
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

const key = () => randomUUID();
const post = (path: string, token: string, body: unknown, k = key()) =>
  app.call('POST', path, { token, body, key: k });
const patch = (path: string, token: string, body: unknown, k = key()) =>
  app.call('PATCH', path, { token, body, key: k });
const get = (path: string, token: string) => app.call('GET', path, { token });

function refusal(result: CallResult, status: number, code: string, details?: unknown) {
  assert.deepEqual(
    [result.status, result.body?.error?.code, result.body?.error?.details],
    [status, code, details],
    JSON.stringify(result.body),
  );
}
const fields = (...pairs: [string, string][]) => ({
  fields: pairs.map(([field, rule]) => ({ field, rule })),
});

const prescriptionOf = (input: OnboardingRequest, nowMs = T0) =>
  calculatePrescription({
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    ageYears: ageFrom(input.birthYear, nowMs, input.timezone),
    sex: input.sex,
    activityLevel: input.activityLevel,
    archetype: input.archetype,
  });
const prescriptionResponse = (
  input: OnboardingRequest,
  computedAtMs = 0,
): PrescriptionResponse => ({
  ...prescriptionOf(input, T0 + computedAtMs),
  computedAt: at(computedAtMs),
  archetype: input.archetype,
  biometrics: {
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    birthYear: input.birthYear,
    sex: input.sex,
    activityLevel: input.activityLevel,
  },
});

/** `Me` right after onboarding at T0 + setAtMs: level 1, nothing earned, the egg, the defaults. */
const freshMe = (
  user: { userId: string; email: string },
  input: { timezone: string; archetype: Archetype },
  setAtMs = 0,
): Me => ({
  user: {
    id: user.userId,
    email: user.email,
    displayName: 'Người thử',
    timezone: input.timezone,
    archetype: input.archetype,
    archetypeChangeAvailableAt: at(setAtMs + 14 * DAY),
    onboarded: true,
  },
  progression: {
    xp: 0,
    level: 1,
    titleKey: 'TAN_BINH',
    xpIntoLevel: 0,
    xpForNextLevel: 100,
    coin: 0,
    streakCurrent: 0,
    streakBest: 0,
    perkPointsAvailable: 0,
    milestones: [
      { days: 7, achieved: false },
      { days: 30, achieved: false },
      { days: 100, achieved: false },
    ],
    lastOutcome: null,
    breakNotice: null,
  },
  stats: { hp: 0, en: 0, str: 0, spd: 0 },
  pet: {
    stage: 'EGG',
    stageIndex: 0,
    growthPercent: 0,
    mood: 'NEUTRAL',
    skinCode: 'SKIN_DEFAULT',
    nextStage: 'HATCHLING',
  },
  appearance: {
    themeCode: 'THEME_DEFAULT',
    petSkinCode: 'SKIN_DEFAULT',
    badgeCode: null,
  },
});

/** What the database holds of one user's profile, read by the owner. */
async function stored(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT u.display_name, u.timezone, u.archetype, u.archetype_set_at, u.onboarded_at IS NOT NULL AS onboarded,
            (SELECT count(*)::int FROM biometric_snapshots s WHERE s.user_id = u.id) AS snapshots,
            (SELECT s.weight_kg::float8 FROM biometric_snapshots s WHERE s.user_id = u.id
              ORDER BY s.recorded_at DESC LIMIT 1) AS weight,
            (SELECT p.calorie_target::int FROM prescriptions p WHERE p.user_id = u.id) AS target,
            (SELECT to_jsonb(g) FROM progression_state g WHERE g.user_id = u.id) AS progression,
            (SELECT to_jsonb(t) FROM user_settings t WHERE t.user_id = u.id) AS settings,
            (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]') FROM xp_ledger l WHERE l.user_id = u.id) AS xp,
            (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]') FROM coin_ledger l WHERE l.user_id = u.id) AS coin
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  return rows[0];
}

// ---------------------------------------------------------------- onboarding

test('GET /me before onboarding: the account, and four null parts', async () => {
  const user = await newUser(db);
  const me = await get('/me', user.token);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, {
    user: {
      id: user.userId,
      email: user.email,
      displayName: 'Người thử',
      timezone: 'Asia/Ho_Chi_Minh',
      archetype: null,
      archetypeChangeAvailableAt: null,
      onboarded: false,
    },
    progression: null,
    stats: null,
    pet: null,
    appearance: null,
  });
});

test('POST /onboarding for each archetype: Me at level 1 with the egg, and the prescription the domain computes', async () => {
  for (const archetype of ['TANKER', 'ASSASSIN', 'SUPPORTER'] as const) {
    const user = await newUser(db);
    const body: OnboardingRequest = {
      ...ONBOARDING_INPUT,
      archetype,
      timezone: 'Europe/Berlin',
      heightCm: 172.5,
      weightKg: 68.4,
      sex: 'MALE',
      activityLevel: 'MODERATE',
    };
    const done = await post('/onboarding', user.token, body);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual(done.body, freshMe(user, body));

    const me = await get('/me', user.token);
    assert.deepEqual([me.status, me.body], [200, freshMe(user, body)]);
    const prescription = await get('/me/prescription', user.token);
    assert.deepEqual(
      [prescription.status, prescription.body],
      [200, prescriptionResponse(body)],
    );
    assert.equal((await stored(user.userId)).snapshots, 1);
  }
});

test('POST /onboarding again: 200 with the current Me, nothing changes, still one snapshot', async () => {
  const user = await newUser(db);
  const first = key();
  const done = await post('/onboarding', user.token, ONBOARDING_INPUT, first);
  assert.equal(done.status, 200);
  const earlier = await stored(user.userId);

  // another key, other numbers: the user is onboarded, that is the whole answer
  const again = await post('/onboarding', user.token, {
    ...ONBOARDING_INPUT,
    archetype: 'TANKER',
    weightKg: 99,
    timezone: 'UTC',
  });
  assert.deepEqual([again.status, again.body], [200, done.body]);
  // also for a body that would have been refused
  const invalid = await post('/onboarding', user.token, { heightCm: 1 });
  assert.deepEqual([invalid.status, invalid.body], [200, done.body]);
  // and the first key replays the first answer
  const replay = await post('/onboarding', user.token, ONBOARDING_INPUT, first);
  assert.deepEqual([replay.status, replay.body], [200, done.body]);

  assert.deepEqual(await stored(user.userId), earlier);
  assert.equal(earlier.snapshots, 1);
});

// ---------------------------------------------------------------- one user, several requests at once
//
// A race needs requests that really overlap: with one pooled connection open, the second request
// only waits for a connection and the two run one after the other. Every test below opens all
// ten connections of the pool first (an idle one is closed again after ten seconds).

const warmPool = () =>
  Promise.all(Array.from({ length: 10 }, () => db.app.query('SELECT 1')));
const serverErrors = (from: number) =>
  app.logs.slice(from).filter(line => Number(line.status) >= 500);

async function rowCounts(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT (SELECT count(*)::int FROM biometric_snapshots WHERE user_id = $1) AS snapshots,
            (SELECT count(*)::int FROM prescriptions WHERE user_id = $1) AS prescriptions,
            (SELECT count(*)::int FROM user_settings WHERE user_id = $1) AS settings,
            (SELECT count(*)::int FROM progression_state WHERE user_id = $1) AS progression`,
    [userId],
  );
  return rows[0];
}

/** The targets an answer carries are the ones the domain computes for the numbers it carries. */
function assertOwnTargets(body: PrescriptionResponse, timezone: string, label: string) {
  assert.deepEqual(
    body,
    prescriptionResponse({ ...body.biometrics, archetype: body.archetype, timezone }),
    label,
  );
}

test('ten POST /onboarding at the same moment with ten keys: all 200 with one Me, one onboarding', async () => {
  for (let round = 0; round < 3; round++) {
    const user = await newUser(db);
    await warmPool();
    const from = app.logs.length;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post('/onboarding', user.token, { ...ONBOARDING_INPUT, weightKg: 60 + i }),
      ),
    );
    assert.deepEqual(results.map(r => r.status), Array(10).fill(200), `round ${round}`);
    assert.deepEqual(serverErrors(from), []);
    for (const result of results) {
      assert.deepEqual(result.body, freshMe(user, ONBOARDING_INPUT));
    }
    assert.deepEqual(await rowCounts(user.userId), {
      snapshots: 1,
      prescriptions: 1,
      settings: 1,
      progression: 1,
    });
    // whichever request won: the targets belong to the numbers that were stored
    assertOwnTargets((await get('/me/prescription', user.token)).body, 'Asia/Ho_Chi_Minh', `round ${round}`);
  }
});

test('ten POST /me/biometrics at the same moment: all 200, ten more snapshots, every answer consistent', async () => {
  for (let round = 0; round < 3; round++) {
    const user = await newOnboardedUser(db);
    await warmPool();
    const from = app.logs.length;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post('/me/biometrics', user.token, {
          heightCm: 170,
          weightKg: 66 + i * 4,
          birthYear: 1996,
          sex: 'FEMALE',
          activityLevel: i % 2 ? 'VERY_ACTIVE' : 'SEDENTARY',
        }),
      ),
    );
    assert.deepEqual(results.map(r => r.status), Array(10).fill(200), `round ${round}`);
    assert.deepEqual(serverErrors(from), []);
    results.forEach((result, i) => assertOwnTargets(result.body, user.input.timezone, `answer ${i}`));
    assert.deepEqual(
      results.map(r => r.body.biometrics.weightKg).sort((x, y) => x - y),
      Array.from({ length: 10 }, (_, i) => 66 + i * 4),
    );
    assert.equal((await rowCounts(user.userId)).snapshots, 11);
    assertOwnTargets((await get('/me/prescription', user.token)).body, user.input.timezone, 'what is stored');
  }
});

test('POST /me/biometrics against PATCH /me/archetype, forty rounds: never a 5xx, and the targets always belong to the stored numbers', async () => {
  const user = await newOnboardedUser(db, { archetype: 'SUPPORTER' });
  await warmPool();
  const from = app.logs.length;
  for (let round = 0; round < 40; round++) {
    const pair = await Promise.all([
      post('/me/biometrics', user.token, {
        heightCm: 170,
        weightKg: round % 2 ? 110 : 60,
        birthYear: 1996,
        sex: 'FEMALE',
        activityLevel: round % 2 ? 'VERY_ACTIVE' : 'SEDENTARY',
      }),
      // the archetype in effect: no cooldown applies, the prescription is computed again
      patch('/me/archetype', user.token, { archetype: 'SUPPORTER' }),
    ]);
    assert.deepEqual(pair.map(r => r.status), [200, 200], `round ${round}`);
    // a route that computed from what it read before the other request wrote would leave the
    // targets of the previous weight beside the new one
    assertOwnTargets((await get('/me/prescription', user.token)).body, user.input.timezone, `round ${round}`);
  }
  assert.deepEqual(serverErrors(from), []);
  assert.equal((await rowCounts(user.userId)).snapshots, 41);
});

test('POST /onboarding refusals: fields first, then the age, then the archetype; nothing is written', async () => {
  const user = await newUser(db);
  // a zone JavaScript knows and the timezones table does not hold: 422, never the foreign key
  await db.admin.query("DELETE FROM timezones WHERE name = 'Pacific/Kiritimati'");
  const every = fields(
    ['timezone', 'required'],
    ['archetype', 'required'],
    ['heightCm', 'required'],
    ['weightKg', 'required'],
    ['birthYear', 'required'],
    ['sex', 'required'],
    ['activityLevel', 'required'],
  );
  const cases: [unknown, number, string, unknown?][] = [
    // the year in the time zone is 2027: born 2012 is 15, 1936 is 91
    [{ birthYear: 2012 }, 422, 'AGE_NOT_ALLOWED'],
    [{ birthYear: 1936 }, 422, 'VALIDATION_FAILED', fields(['birthYear', 'min'])],
    [{ birthYear: 1996.5 }, 422, 'VALIDATION_FAILED', fields(['birthYear', 'format'])],
    [{ birthYear: '1996' }, 422, 'VALIDATION_FAILED', fields(['birthYear', 'required'])],
    [{ birthYear: 1e300 }, 422, 'AGE_NOT_ALLOWED'],
    [{ birthYear: -1e300 }, 422, 'VALIDATION_FAILED', fields(['birthYear', 'min'])],
    [{ heightCm: 119.9 }, 422, 'VALIDATION_FAILED', fields(['heightCm', 'min'])],
    [{ heightCm: 230.1 }, 422, 'VALIDATION_FAILED', fields(['heightCm', 'max'])],
    [{ heightCm: '170' }, 422, 'VALIDATION_FAILED', fields(['heightCm', 'required'])],
    [{ weightKg: 29.9 }, 422, 'VALIDATION_FAILED', fields(['weightKg', 'min'])],
    [{ weightKg: 250.1 }, 422, 'VALIDATION_FAILED', fields(['weightKg', 'max'])],
    [{ weightKg: null }, 422, 'VALIDATION_FAILED', fields(['weightKg', 'required'])],
    [{ sex: 'OTHER' }, 422, 'VALIDATION_FAILED', fields(['sex', 'enum'])],
    [{ activityLevel: 'LAZY' }, 422, 'VALIDATION_FAILED', fields(['activityLevel', 'enum'])],
    [{ archetype: 'MAGE' }, 422, 'VALIDATION_FAILED', fields(['archetype', 'enum'])],
    [{ archetype: 7 }, 422, 'VALIDATION_FAILED', fields(['archetype', 'enum'])],
    [{ timezone: 'Mars/Olympus_Mons' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: 'Pacific/Kiritimati' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: 'CET' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: '+07:00' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: 'asia/ho_chi_minh' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: 7 }, 422, 'VALIDATION_FAILED', fields(['timezone', 'required'])],
    [{ timezone: '' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'required'])],
    [
      { timezone: 'Nowhere', archetype: 'MAGE', heightCm: 10, weightKg: 900, birthYear: null, sex: 'X', activityLevel: 'Y' },
      422,
      'VALIDATION_FAILED',
      fields(
        ['timezone', 'format'],
        ['archetype', 'enum'],
        ['heightCm', 'min'],
        ['weightKg', 'max'],
        ['birthYear', 'required'],
        ['sex', 'enum'],
        ['activityLevel', 'enum'],
      ),
    ],
    // the order the onboarding screens rely on
    [{ birthYear: 2012, heightCm: 119.9 }, 422, 'VALIDATION_FAILED', fields(['heightCm', 'min'])],
    [{ birthYear: 2012, timezone: 'Nowhere' }, 422, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ birthYear: 2012, archetype: 'ASSASSIN', weightKg: LIGHT_KG }, 422, 'AGE_NOT_ALLOWED'],
    [
      { archetype: 'ASSASSIN', weightKg: LIGHT_KG },
      422,
      'ARCHETYPE_NOT_ALLOWED',
      { allowed: ['TANKER', 'SUPPORTER'] },
    ],
  ];
  for (const [over, status, code, details] of cases) {
    const result = await post('/onboarding', user.token, {
      ...ONBOARDING_INPUT,
      ...(over as object),
    });
    refusal(result, status, code, details);
  }
  // a body that is no object is a body without any member
  for (const body of [[ONBOARDING_INPUT], 'text', 7, null, {}]) {
    refusal(await post('/onboarding', user.token, body), 422, 'VALIDATION_FAILED', every);
  }
  refusal(
    await app.call('POST', '/onboarding', { token: user.token, key: key() }),
    422,
    'VALIDATION_FAILED',
    every,
  );
  refusal(
    await app.call('POST', '/onboarding', { token: user.token, body: ONBOARDING_INPUT }),
    400,
    'IDEMPOTENCY_KEY_REQUIRED',
  );
  assert.equal((await app.call('POST', '/onboarding', { body: ONBOARDING_INPUT, key: key() })).status, 401);

  const nothing = await stored(user.userId);
  assert.deepEqual(
    [nothing.onboarded, nothing.archetype, nothing.snapshots, nothing.target, nothing.progression, nothing.settings],
    [false, null, 0, null, null, null],
  );

  // a refusal is not remembered: the same key with the corrected body goes through;
  // a member the server does not know is ignored
  const k = key();
  refusal(
    await post('/onboarding', user.token, { ...ONBOARDING_INPUT, heightCm: 500 }, k),
    422,
    'VALIDATION_FAILED',
    fields(['heightCm', 'max']),
  );
  const done = await post('/onboarding', user.token, { ...ONBOARDING_INPUT, favouriteColour: 'green' }, k);
  assert.deepEqual([done.status, done.body], [200, freshMe(user, ONBOARDING_INPUT)]);
});

test('the age is counted in the year of the chosen time zone, by route and database alike', async () => {
  try {
    // 18:00Z on 31 December 2026: already 2027 in Ho Chi Minh City, still 2026 in UTC
    await setTestClock(db.admin, '2026-12-31T18:00:00Z');
    const user = await newUser(db);
    refusal(
      await post('/onboarding', user.token, { ...ONBOARDING_INPUT, birthYear: 2011, timezone: 'UTC' }),
      422,
      'AGE_NOT_ALLOWED',
    );
    const done = await post('/onboarding', user.token, { ...ONBOARDING_INPUT, birthYear: 2011 });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const prescription = await get('/me/prescription', user.token);
    assert.deepEqual(
      { ...prescription.body, computedAt: null },
      {
        ...prescriptionOf({ ...ONBOARDING_INPUT, birthYear: 2011 }, Date.parse('2026-12-31T18:00:00Z')),
        computedAt: null,
        archetype: 'SUPPORTER',
        biometrics: { heightCm: 170, weightKg: 65, birthYear: 2011, sex: 'FEMALE', activityLevel: 'LIGHT' },
      },
    );
  } finally {
    await clock(0);
  }
});

// ---------------------------------------------------------------- routes that need onboarding

test('every route for an onboarded user answers 409 ONBOARDING_REQUIRED to a fresh account, and 401 without a session', async () => {
  const fresh = await newUser(db);
  const userRoutes: [string, string, unknown?][] = [
    ['PATCH', '/me', { displayName: 'Lan' }],
    ['POST', '/me/biometrics', ONBOARDING_INPUT],
    ['PATCH', '/me/archetype', { archetype: 'TANKER' }],
    ['GET', '/me/prescription'],
    ['GET', '/settings'],
    ['PATCH', '/settings', { hideStreak: true }],
    ['GET', '/progression'],
    ['GET', '/pet'],
  ];
  for (const [method, path, body] of userRoutes) {
    const options = method === 'GET' ? {} : { body, key: key() };
    refusal(
      await app.call(method, path, { token: fresh.token, ...options }),
      409,
      'ONBOARDING_REQUIRED',
    );
    refusal(await app.call(method, path, options), 401, 'SESSION_INVALID');
  }
  refusal(await app.call('GET', '/me'), 401, 'SESSION_INVALID');
  const nothing = await stored(fresh.userId);
  assert.deepEqual(
    [nothing.display_name, nothing.onboarded, nothing.snapshots, nothing.settings],
    ['Người thử', false, 0, null],
  );
});

// ---------------------------------------------------------------- biometrics

test('POST /me/biometrics twice: two more snapshots, the prescription replaced each time', async () => {
  const user = await newOnboardedUser(db, { archetype: 'TANKER' });
  const second = { heightCm: 170, weightKg: 66.5, birthYear: 1996, sex: 'FEMALE', activityLevel: 'ACTIVE' } as const;
  const one = await post('/me/biometrics', user.token, second);
  assert.deepEqual(
    [one.status, one.body],
    [200, prescriptionResponse({ ...user.input, ...second })],
  );
  const third = { ...second, weightKg: 71.25, sex: 'MALE' } as const;
  const two = await post('/me/biometrics', user.token, third);
  assert.deepEqual(
    [two.status, two.body],
    [200, prescriptionResponse({ ...user.input, ...third })],
  );
  assert.notDeepEqual(two.body, one.body);

  const read = await get('/me/prescription', user.token);
  assert.deepEqual([read.status, read.body], [200, two.body]);
  const now = await stored(user.userId);
  assert.deepEqual([now.snapshots, now.weight, now.target], [3, 71.25, two.body.calorieTarget]);
  // the archetype and its cooldown did not move
  assert.deepEqual((await get('/me', user.token)).body, freshMe(user, user.input));
});

test('POST /me/biometrics refusals run in the same order as onboarding and write nothing', async () => {
  const user = await newOnboardedUser(db);
  const earlier = await stored(user.userId);
  const bio = { heightCm: 170, weightKg: 65, birthYear: 1996, sex: 'FEMALE', activityLevel: 'LIGHT' };
  const cases: [unknown, string, unknown?][] = [
    [{ birthYear: 2012 }, 'AGE_NOT_ALLOWED'],
    [{ birthYear: 1936 }, 'VALIDATION_FAILED', fields(['birthYear', 'min'])],
    [{ heightCm: 119.9 }, 'VALIDATION_FAILED', fields(['heightCm', 'min'])],
    [{ weightKg: 250.1 }, 'VALIDATION_FAILED', fields(['weightKg', 'max'])],
    [{ sex: 'OTHER' }, 'VALIDATION_FAILED', fields(['sex', 'enum'])],
    [{ activityLevel: undefined }, 'VALIDATION_FAILED', fields(['activityLevel', 'required'])],
    [{ archetype: 'MAGE' }, 'VALIDATION_FAILED', fields(['archetype', 'enum'])],
    [{ archetype: 'MAGE', birthYear: 2012, heightCm: 500 }, 'VALIDATION_FAILED', fields(['archetype', 'enum'], ['heightCm', 'max'])],
    [{ birthYear: 2012, archetype: 'ASSASSIN', weightKg: LIGHT_KG }, 'AGE_NOT_ALLOWED'],
    [{ archetype: 'ASSASSIN', weightKg: LIGHT_KG }, 'ARCHETYPE_NOT_ALLOWED', { allowed: ['TANKER', 'SUPPORTER'] }],
  ];
  for (const [over, code, details] of cases) {
    refusal(
      await post('/me/biometrics', user.token, { ...bio, ...(over as object) }),
      422,
      code,
      details,
    );
  }
  refusal(
    await post('/me/biometrics', user.token, [bio]),
    422,
    'VALIDATION_FAILED',
    fields(
      ['heightCm', 'required'],
      ['weightKg', 'required'],
      ['birthYear', 'required'],
      ['sex', 'required'],
      ['activityLevel', 'required'],
    ),
  );
  assert.deepEqual(await stored(user.userId), earlier);
});

test('a weight that makes ASSASSIN unsafe: 422 with what is allowed, then accepted with a replacement inside the cooldown', async () => {
  try {
    const user = await newOnboardedUser(db, { archetype: 'ASSASSIN' });
    const earlier = await stored(user.userId);
    await clock(DAY);
    const lighter = { heightCm: 170, weightKg: LIGHT_KG, birthYear: 1996, sex: 'FEMALE', activityLevel: 'LIGHT' } as const;

    refusal(
      await post('/me/biometrics', user.token, lighter),
      422,
      'ARCHETYPE_NOT_ALLOWED',
      { allowed: ['TANKER', 'SUPPORTER'] },
    );
    assert.deepEqual(await stored(user.userId), earlier);

    // one day after onboarding: far inside the 14 days, and still accepted
    const done = await post('/me/biometrics', user.token, { ...lighter, archetype: 'SUPPORTER' });
    assert.deepEqual(
      [done.status, done.body],
      [200, prescriptionResponse({ ...user.input, ...lighter, archetype: 'SUPPORTER' }, DAY)],
    );
    // the forced change counts as the last change: the free choice opens 14 days after it
    assert.deepEqual(
      (await get('/me', user.token)).body,
      freshMe(user, { ...user.input, archetype: 'SUPPORTER' }, DAY),
    );
    refusal(
      await patch('/me/archetype', user.token, { archetype: 'TANKER' }),
      409,
      'ARCHETYPE_COOLDOWN',
      { availableAt: at(15 * DAY) },
    );
  } finally {
    await clock(0);
  }
});

test('an archetype sent with numbers that still allow the current one is not applied: the cooldown cannot be walked around', async () => {
  const user = await newOnboardedUser(db, { archetype: 'ASSASSIN' });
  const heavier = { heightCm: 170, weightKg: 66, birthYear: 1996, sex: 'FEMALE', activityLevel: 'LIGHT' } as const;
  const done = await post('/me/biometrics', user.token, { ...heavier, archetype: 'TANKER' });
  // the answer names the archetype in effect, and the targets are those of that archetype
  assert.deepEqual(
    [done.status, done.body],
    [200, prescriptionResponse({ ...user.input, ...heavier })],
  );
  assert.equal(done.body.archetype, 'ASSASSIN');
  assert.deepEqual((await get('/me', user.token)).body, freshMe(user, user.input));
});

// ---------------------------------------------------------------- archetype

test('PATCH /me/archetype: 409 with availableAt for 14 days, then 200; XP, coins, streak and ledgers are untouched', async () => {
  try {
    const user = await newOnboardedUser(db, { archetype: 'SUPPORTER' });
    await db.admin.query("SELECT app._grant($1, 420, 65, 'TEST', 'seed')", [user.userId]);
    await db.admin.query(
      `UPDATE progression_state SET streak_current = 4, streak_best = 9, last_outcome = 'COMPLETED',
              last_closed_date = '2027-01-09' WHERE user_id = $1`,
      [user.userId],
    );
    const earlier = await stored(user.userId);
    const meBefore: Me = (await get('/me', user.token)).body;
    assert.equal(meBefore.user.archetypeChangeAvailableAt, at(14 * DAY));
    assert.deepEqual(
      [meBefore.progression?.xp, meBefore.progression?.coin, meBefore.progression?.streakCurrent],
      [420, 65, 4],
    );

    for (const offset of [0, DAY, 14 * DAY - SECOND]) {
      await clock(offset);
      refusal(
        await patch('/me/archetype', user.token, { archetype: 'TANKER' }),
        409,
        'ARCHETYPE_COOLDOWN',
        { availableAt: meBefore.user.archetypeChangeAvailableAt },
      );
    }
    assert.deepEqual(await stored(user.userId), earlier);

    await clock(14 * DAY);
    const done = await patch('/me/archetype', user.token, { archetype: 'TANKER' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const expected: Me = {
      ...meBefore,
      user: {
        ...meBefore.user,
        archetype: 'TANKER',
        archetypeChangeAvailableAt: at(28 * DAY),
      },
    };
    assert.deepEqual(done.body, expected);
    assert.deepEqual((await get('/me', user.token)).body, expected);
    const prescription = await get('/me/prescription', user.token);
    assert.deepEqual(
      prescription.body,
      prescriptionResponse({ ...user.input, archetype: 'TANKER' }, 14 * DAY),
    );

    const now = await stored(user.userId);
    assert.deepEqual(
      { ...now, archetype: null, archetype_set_at: null, target: null },
      { ...earlier, archetype: null, archetype_set_at: null, target: null },
    );
    assert.deepEqual([now.xp, now.coin, now.progression], [earlier.xp, earlier.coin, earlier.progression]);
    assert.notEqual(now.target, earlier.target);
    assert.equal(now.snapshots, 1);
  } finally {
    await clock(0);
  }
});

test('PATCH /me/archetype refusals: the member, the BMI rule; the archetype in effect is accepted and starts no cooldown', async () => {
  try {
    const user = await newOnboardedUser(db, { archetype: 'TANKER', weightKg: LIGHT_KG });
    const earlier = await stored(user.userId);
    for (const [body, rule] of [
      [{}, 'required'],
      [{ archetype: null }, 'required'],
      [{ archetype: 'MAGE' }, 'enum'],
      [{ archetype: ['TANKER'] }, 'enum'],
      [['TANKER'], 'required'],
    ] as const) {
      refusal(
        await patch('/me/archetype', user.token, body),
        422,
        'VALIDATION_FAILED',
        fields(['archetype', rule]),
      );
    }
    // said inside the cooldown as well as after it: it will not become true by waiting
    for (const offset of [0, 20 * DAY]) {
      await clock(offset);
      refusal(
        await patch('/me/archetype', user.token, { archetype: 'ASSASSIN' }),
        422,
        'ARCHETYPE_NOT_ALLOWED',
        { allowed: ['TANKER', 'SUPPORTER'] },
      );
    }
    await clock(DAY);
    const same = await patch('/me/archetype', user.token, { archetype: 'TANKER' });
    assert.deepEqual([same.status, same.body], [200, freshMe(user, user.input)]);
    assert.deepEqual(await stored(user.userId), earlier);
  } finally {
    await clock(0);
  }
});

// ---------------------------------------------------------------- PATCH /me

test('PATCH /me changes the display name and the time zone, each alone or both, and nothing else', async () => {
  const user = await newOnboardedUser(db);
  const base = freshMe(user, user.input);
  const named = (displayName: string, timezone = user.input.timezone): Me => ({
    ...base,
    user: { ...base.user, displayName, timezone },
  });

  const one = await patch('/me', user.token, { displayName: '  Lan Anh  ' });
  assert.deepEqual([one.status, one.body], [200, named('Lan Anh')]);
  const two = await patch('/me', user.token, { timezone: 'America/New_York' });
  assert.deepEqual([two.status, two.body], [200, named('Lan Anh', 'America/New_York')]);
  const both = await patch('/me', user.token, { displayName: 'Minh', timezone: 'UTC' });
  assert.deepEqual([both.status, both.body], [200, named('Minh', 'UTC')]);
  // nothing to change, and members this route does not know: 200, as it was
  const none = await patch('/me', user.token, {});
  assert.deepEqual([none.status, none.body], [200, named('Minh', 'UTC')]);
  const unknown = await patch('/me', user.token, {
    email: 'someone@else.example',
    archetype: 'ASSASSIN',
    onboarded: false,
    xp: 100000,
    id: randomUUID(),
  });
  assert.deepEqual([unknown.status, unknown.body], [200, named('Minh', 'UTC')]);
  assert.deepEqual((await get('/me', user.token)).body, named('Minh', 'UTC'));
});

test('PATCH /me refusals: the rules of a display name, banned wording, an unknown time zone', async () => {
  const user = await newOnboardedUser(db);
  const earlier = await stored(user.userId);
  const name = (rule: string) => fields(['displayName', rule]);
  const cases: [unknown, string, unknown?][] = [
    [{ displayName: '' }, 'VALIDATION_FAILED', name('required')],
    [{ displayName: '   ' }, 'VALIDATION_FAILED', name('required')],
    [{ displayName: NBSP + NBSP }, 'VALIDATION_FAILED', name('required')],
    [{ displayName: null }, 'VALIDATION_FAILED', name('required')],
    [{ displayName: 7 }, 'VALIDATION_FAILED', name('required')],
    [{ displayName: 'x'.repeat(41) }, 'VALIDATION_FAILED', name('max')],
    [{ displayName: `Lan${SOFT_HYPHEN}Anh` }, 'VALIDATION_FAILED', name('format')],
    // at least one letter or digit: a name of emoji only is refused
    [{ displayName: '🦊'.repeat(40) }, 'VALIDATION_FAILED', name('format')],
    [{ displayName: '🦊' }, 'VALIDATION_FAILED', name('format')],
    [{ displayName: 'Kẻ lười' }, 'NAME_NOT_ALLOWED'],
    [{ displayName: 'ke   LUOI' }, 'NAME_NOT_ALLOWED'],
    [{ timezone: 'Mars/Olympus_Mons' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: 'CET' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [{ timezone: '' }, 'VALIDATION_FAILED', fields(['timezone', 'required'])],
    [{ timezone: null }, 'VALIDATION_FAILED', fields(['timezone', 'required'])],
    // banned wording is judged only once every field is well-formed
    [{ displayName: 'Kẻ lười', timezone: 'Nowhere' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
    [
      { displayName: '', timezone: 'Nowhere' },
      'VALIDATION_FAILED',
      fields(['displayName', 'required'], ['timezone', 'format']),
    ],
    // one good member does not carry a bad one through
    [{ displayName: 'Lan', timezone: 'Nowhere' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
  ];
  for (const [body, code, details] of cases) {
    refusal(await patch('/me', user.token, body), 422, code, details);
  }
  assert.deepEqual(await stored(user.userId), earlier);
  // 40 characters counted as the database counts them: a letter and 39 emoji are 79 UTF-16 units
  const longest = `A${'🦊'.repeat(39)}`;
  const long = await patch('/me', user.token, { displayName: longest });
  assert.equal(long.status, 200, JSON.stringify(long.body));
  assert.equal(long.body.user.displayName, longest);
  refusal(
    await patch('/me', user.token, { displayName: `${longest}🦊` }),
    422,
    'VALIDATION_FAILED',
    name('max'),
  );
});

test('PATCH /me: a name the database constraint refuses is 422 VALIDATION_FAILED, not a 500', async () => {
  const user = await newOnboardedUser(db);
  // the constraint is stricter than the route for once (as after a rule was tightened in SQL only)
  await db.admin.query(
    `ALTER TABLE users DROP CONSTRAINT users_display_name_check;
     ALTER TABLE users ADD CONSTRAINT users_display_name_check CHECK (display_name <> 'Cấm')`,
  );
  try {
    refusal(
      await patch('/me', user.token, { displayName: 'Cấm', timezone: 'UTC' }),
      422,
      'VALIDATION_FAILED',
      fields(['displayName', 'format']),
    );
    const now = await stored(user.userId);
    assert.deepEqual([now.display_name, now.timezone], ['Người thử', 'Asia/Ho_Chi_Minh']);
    assert.equal(app.logs.at(-1)?.status, 422);
  } finally {
    await db.admin.query('ALTER TABLE users DROP CONSTRAINT users_display_name_check');
  }
});

// ---------------------------------------------------------------- isolation

test('one user never sees or changes what belongs to another, through any of these routes', async () => {
  try {
    const a = await newOnboardedUser(db, { archetype: 'TANKER', heightCm: 181.3, weightKg: 77.7 });
    const b = await newOnboardedUser(db, {
      archetype: 'ASSASSIN',
      heightCm: 158.6,
      weightKg: 111.5,
      birthYear: 1984,
      sex: 'MALE',
      activityLevel: 'VERY_ACTIVE',
      timezone: 'Europe/Paris',
    });
    await patch('/me', b.token, { displayName: 'Bí Mật B' });
    await patch('/settings', b.token, { hideStreak: true, excludedMealTags: ['co:sua'], motion: 'REDUCED' });
    await db.admin.query("SELECT app._grant($1, 777, 333, 'TEST', 'seed')", [b.userId]);
    const bBefore = await stored(b.userId);
    const bPrescription = prescriptionResponse(b.input);

    const reads = [];
    for (const path of ['/me', '/me/prescription', '/settings', '/progression', '/pet']) {
      const result = await get(path, a.token);
      assert.equal(result.status, 200, path);
      reads.push(result.body);
    }
    assert.deepEqual(reads[0], freshMe(a, a.input));
    assert.deepEqual(reads[1], prescriptionResponse(a.input));
    assert.equal(reads[2].hideStreak, false);
    assert.deepEqual(reads[2].excludedMealTags, []);
    assert.deepEqual(reads[3], freshMe(a, a.input).progression);

    // every write of A, with B's values where a body has room for them
    await clock(15 * DAY);
    const writes = [
      await patch('/me', a.token, { displayName: 'A', id: b.userId, userId: b.userId }),
      await post('/me/biometrics', a.token, { heightCm: 181.3, weightKg: 78, birthYear: 1996, sex: 'FEMALE', activityLevel: 'LIGHT', userId: b.userId }),
      await patch('/me/archetype', a.token, { archetype: 'SUPPORTER', userId: b.userId }),
      await patch('/settings', a.token, { nudgesEnabled: false, userId: b.userId }),
      await post('/onboarding', a.token, { ...b.input, userId: b.userId }),
    ];
    assert.deepEqual(writes.map(w => w.status), [200, 200, 200, 200, 200]);
    assert.deepEqual(await stored(b.userId), bBefore);
    assert.deepEqual((await get('/me/prescription', b.token)).body, bPrescription);

    // nothing of B in anything A was ever answered
    const seen = JSON.stringify([reads, writes.map(w => w.body)]);
    for (const secret of [
      b.userId,
      b.email,
      'Bí Mật B',
      '111.5',
      '158.6',
      'Europe/Paris',
      'VERY_ACTIVE',
      'co:sua',
    ]) {
      assert.ok(!seen.includes(secret), `${secret} of the other user in an answer`);
    }
  } finally {
    await clock(0);
  }
});
