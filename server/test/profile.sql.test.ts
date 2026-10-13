// 21-profile.sql at the SQL level: the three profile_* functions called as app_auth straight
// through app_conn, the way a caller that skipped the Node validation would. The admin pool only
// arranges fixtures and reads results back.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DatabaseError, PoolClient } from 'pg';
import {
  ACTIVITY_FACTOR,
  ARCHETYPE_FACTOR,
  calculatePrescription,
} from '../../domain/energy.ts';
import type { Prescription } from '../../domain/energy.ts';
import { logicalDateOf } from '../../domain/logicalDate.ts';
import { INGREDIENT_TAGS } from '../../domain/types.ts';
import type { ActivityLevel, Archetype, Sex } from '../../domain/types.ts';
import { LIMITS, ageFrom, allowedArchetypes } from '../../domain/validation.ts';
import {
  asAnon,
  asJob,
  asUser,
  expectPgError,
  setTestClock,
} from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await setTestClock(db.admin, null);
  await db.drop();
});

const DENIED = '42501';
const CHECK = '23514';
/** What the functions raise on purpose: MESSAGE is the error code of the API contract. */
const HM = 'HM000';
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const T0 = Date.parse('2027-01-10T00:00:00Z');
const instant = (offsetMs: number) => new Date(T0 + offsetMs);
const clock = (offsetMs: number) =>
  setTestClock(db.admin, instant(offsetMs).toISOString());

/** Runs with app.now() frozen at T0 (move it with `clock`), then returns to real time. */
async function frozen(work: () => Promise<void>): Promise<void> {
  try {
    await clock(0);
    await work();
  } finally {
    await setTestClock(db.admin, null);
  }
}

type Input = {
  timezone: string;
  archetype: Archetype;
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: Sex;
  activityLevel: ActivityLevel;
};
/** BMI 22.5: every archetype is allowed. 31 years old at T0. */
const BASE: Input = {
  timezone: 'Asia/Ho_Chi_Minh',
  archetype: 'SUPPORTER',
  heightCm: 170,
  weightKg: 65,
  birthYear: 1996,
  sex: 'FEMALE',
  activityLevel: 'LIGHT',
};
/** 170 cm and 50 kg: BMI 17.3, no ASSASSIN. */
const LIGHT_KG = 50;

const prescriptionOf = (input: Input, nowMs = T0): Prescription =>
  calculatePrescription({
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    ageYears: ageFrom(input.birthYear, nowMs, input.timezone),
    sex: input.sex,
    activityLevel: input.activityLevel,
    archetype: input.archetype,
  });
/** Valid for either sex whatever else the test sends: the refusal under test is not about it. */
const ANY_PRESCRIPTION: Prescription = {
  ...prescriptionOf(BASE),
  calorieTarget: 2000,
};

type Loose<T> = { [K in keyof T]?: unknown };
type Work = (client: PoolClient) => Promise<unknown>;

async function register(): Promise<string> {
  const { rows } = await asAnon(db.app, c =>
    c.query<{ id: string }>('SELECT auth_register($1, $2, $3, $4, $5) AS id', [
      `p${randomBytes(6).toString('hex')}@example.com`,
      'Mầm',
      randomBytes(16),
      randomBytes(32),
      randomBytes(32),
    ]),
  );
  return rows[0].id;
}

/** `prescription`: an object is sent as JSON, null as SQL NULL; left out = computed for the input. */
async function onboard(
  user: string,
  over: Loose<Input> = {},
  prescription?: unknown,
): Promise<boolean> {
  const input = { ...BASE, ...over };
  const sent =
    prescription === undefined ? prescriptionOf(input as Input) : prescription;
  const { rows } = await asUser(db.app, user, c =>
    c.query('SELECT profile_onboard($1, $2, $3, $4, $5, $6, $7, $8) AS v', [
      input.timezone,
      input.archetype,
      input.heightCm,
      input.weightKg,
      input.birthYear,
      input.sex,
      input.activityLevel,
      sent === null ? null : JSON.stringify(sent),
    ]),
  );
  return rows[0].v;
}

type Bio = Omit<Input, 'timezone' | 'archetype'>;
const BIO: Bio = {
  heightCm: BASE.heightCm,
  weightKg: BASE.weightKg,
  birthYear: BASE.birthYear,
  sex: BASE.sex,
  activityLevel: BASE.activityLevel,
};

async function addBiometrics(
  user: string,
  over: Loose<Bio> = {},
  archetype: unknown = null,
  prescription: unknown = ANY_PRESCRIPTION,
): Promise<void> {
  const input = { ...BIO, ...over };
  await asUser(db.app, user, c =>
    c.query('SELECT profile_add_biometrics($1, $2, $3, $4, $5, $6, $7)', [
      input.heightCm,
      input.weightKg,
      input.birthYear,
      input.sex,
      input.activityLevel,
      prescription === null ? null : JSON.stringify(prescription),
      archetype,
    ]),
  );
}

async function setArchetype(
  user: string,
  archetype: unknown,
  prescription: unknown = ANY_PRESCRIPTION,
): Promise<void> {
  await asUser(db.app, user, c =>
    c.query('SELECT profile_set_archetype($1, $2)', [
      archetype,
      prescription === null ? null : JSON.stringify(prescription),
    ]),
  );
}

/** Passes only for a refusal one of our functions raised: HM000, this code, these details. */
async function refused(
  promise: Promise<unknown>,
  code: string,
  details: unknown = {},
): Promise<void> {
  await assert.rejects(promise, (e: unknown) => {
    const error = e as DatabaseError;
    assert.deepEqual(
      [error.code, error.message, JSON.parse(String(error.detail))],
      [HM, code, details],
    );
    return true;
  });
}
const fields = (...pairs: [string, string][]) => ({
  fields: pairs.map(([field, rule]) => ({ field, rule })),
});

/** A timestamptz as UTC text with microseconds, whatever zone the session runs in. */
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Everything the profile functions write for one user, read by the owner. */
async function profile(user: string) {
  const { rows } = await db.admin.query(
    `SELECT (SELECT jsonb_build_object('timezone', u.timezone, 'archetype', u.archetype,
                      'setAt', ${iso('u.archetype_set_at')}, 'onboardedAt', ${iso('u.onboarded_at')})
               FROM users u WHERE u.id = $1) AS "user",
            (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'id' - 'created_at'
                               || jsonb_build_object('recorded_at', ${iso('s.recorded_at')})
                             ORDER BY s.recorded_at), '[]')
               FROM biometric_snapshots s WHERE s.user_id = $1) AS snapshots,
            (SELECT to_jsonb(p) - 'created_at' || jsonb_build_object('computed_at', ${iso('p.computed_at')})
               FROM prescriptions p WHERE p.user_id = $1) AS prescription,
            (SELECT to_jsonb(t) - 'created_at' FROM user_settings t WHERE t.user_id = $1) AS settings,
            (SELECT to_jsonb(g) - 'created_at' FROM progression_state g WHERE g.user_id = $1) AS progression,
            (SELECT count(*)::int FROM xp_ledger l WHERE l.user_id = $1) AS xp_rows,
            (SELECT count(*)::int FROM coin_ledger l WHERE l.user_id = $1) AS coin_rows`,
    [user],
  );
  return rows[0];
}

/** `iso` of T0 + offset, plus that many microseconds. */
const jsonTime = (offsetMs: number, micros = 0) =>
  instant(offsetMs)
    .toISOString()
    .replace('Z', `${String(micros).padStart(3, '0')}Z`);
const storedPrescription = (user: string, p: Prescription, at: number) => ({
  user_id: user,
  bmr: p.bmr,
  tdee: p.tdee,
  calorie_target: p.calorieTarget,
  protein_g: p.proteinG,
  carbs_g: p.carbsG,
  fat_g: p.fatG,
  water_ml: p.waterMl,
  safety_clamped: p.safetyClamped,
  macro_adjusted: p.macroAdjusted,
  computed_at: jsonTime(at),
});
const storedSnapshot = (user: string, bio: Bio, at: string) => ({
  user_id: user,
  height_cm: bio.heightCm,
  weight_kg: bio.weightKg,
  birth_year: bio.birthYear,
  sex: bio.sex,
  activity_level: bio.activityLevel,
  recorded_at: at,
});

// ---------------------------------------------------------------- profile_onboard

test('profile_onboard writes the profile, one snapshot, the prescription, default settings and the progression row', async () => {
  await frozen(async () => {
    for (const archetype of ['TANKER', 'ASSASSIN', 'SUPPORTER'] as const) {
      const user = await register();
      // 2027-01-10T00:00Z is 19:00 on the 9th in New York: the logical day is the 9th
      const input: Input = { ...BASE, archetype, timezone: 'America/New_York' };
      assert.equal(await onboard(user, input), true);
      assert.deepEqual(await profile(user), {
        user: {
          timezone: 'America/New_York',
          archetype,
          setAt: jsonTime(0),
          onboardedAt: jsonTime(0),
        },
        snapshots: [storedSnapshot(user, BIO, jsonTime(0))],
        prescription: storedPrescription(user, prescriptionOf(input), 0),
        settings: {
          user_id: user,
          nudges_enabled: true,
          reminder_enabled: false,
          reminder_window: 'EVENING',
          hide_streak: false,
          sound_enabled: false,
          motion: 'SYSTEM',
          excluded_meal_tags: [],
        },
        progression: {
          user_id: user,
          xp_high_water: 0,
          streak_current: 0,
          streak_best: 0,
          streak_before_break: null,
          break_date: null,
          missed_run: 0,
          last_outcome: null,
          last_closed_date: null,
          onboard_date: logicalDateOf(T0, 'America/New_York'),
        },
        xp_rows: 0,
        coin_rows: 0,
      });
      assert.equal(logicalDateOf(T0, 'America/New_York'), '2027-01-09');
    }
  });
});

test('profile_onboard a second time returns false and changes nothing, whatever it is given', async () => {
  await frozen(async () => {
    const user = await register();
    assert.equal(await onboard(user), true);
    const first = await profile(user);
    await clock(DAY);
    assert.equal(
      await onboard(user, { archetype: 'TANKER', weightKg: 90, timezone: 'UTC' }),
      false,
    );
    // not even judged: the caller is onboarded, that is the whole answer
    assert.equal(await onboard(user, { heightCm: 1, birthYear: 2026 }, null), false);
    assert.deepEqual(await profile(user), first);
  });
});

test('profile_onboard refuses what the route refuses: ranges, age, enums, time zone', async () => {
  await frozen(async () => {
    const user = await register();
    const blank = await profile(user);
    const cases: [Loose<Input>, string, unknown][] = [
      // the year in the time zone is 2027: born 2012 is 15, 2011 is 16, 1937 is 90, 1936 is 91
      [{ birthYear: 2012 }, 'AGE_NOT_ALLOWED', {}],
      [{ birthYear: 2030 }, 'AGE_NOT_ALLOWED', {}],
      [{ birthYear: 1936 }, 'VALIDATION_FAILED', fields(['birthYear', 'min'])],
      [{ birthYear: -2147483648 }, 'VALIDATION_FAILED', fields(['birthYear', 'min'])],
      [{ birthYear: null }, 'VALIDATION_FAILED', fields(['birthYear', 'required'])],
      [{ heightCm: 119.9 }, 'VALIDATION_FAILED', fields(['heightCm', 'min'])],
      [{ heightCm: 230.1 }, 'VALIDATION_FAILED', fields(['heightCm', 'max'])],
      [{ heightCm: null }, 'VALIDATION_FAILED', fields(['heightCm', 'required'])],
      [{ weightKg: 29.9 }, 'VALIDATION_FAILED', fields(['weightKg', 'min'])],
      [{ weightKg: 250.1 }, 'VALIDATION_FAILED', fields(['weightKg', 'max'])],
      [{ weightKg: null }, 'VALIDATION_FAILED', fields(['weightKg', 'required'])],
      [{ sex: 'OTHER' }, 'VALIDATION_FAILED', fields(['sex', 'enum'])],
      [{ sex: null }, 'VALIDATION_FAILED', fields(['sex', 'required'])],
      [{ activityLevel: 'LAZY' }, 'VALIDATION_FAILED', fields(['activityLevel', 'enum'])],
      [{ activityLevel: null }, 'VALIDATION_FAILED', fields(['activityLevel', 'required'])],
      [{ archetype: 'MAGE' }, 'VALIDATION_FAILED', fields(['archetype', 'enum'])],
      [{ archetype: null }, 'VALIDATION_FAILED', fields(['archetype', 'required'])],
      [{ timezone: 'Mars/Olympus_Mons' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
      [{ timezone: 'CET' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
      [{ timezone: '+07:00' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
      [{ timezone: 'asia/ho_chi_minh' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
      [{ timezone: '' }, 'VALIDATION_FAILED', fields(['timezone', 'format'])],
      [{ timezone: null }, 'VALIDATION_FAILED', fields(['timezone', 'required'])],
      // every wrong field at once, in the order of the request body
      [
        { timezone: 'Nowhere', archetype: 'MAGE', heightCm: 10, weightKg: 900, birthYear: null, sex: 'X', activityLevel: 'Y' },
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
      // a wrong field is reported before the age, the age before the archetype
      [{ birthYear: 2012, heightCm: 119.9 }, 'VALIDATION_FAILED', fields(['heightCm', 'min'])],
      [{ birthYear: 2012, archetype: 'ASSASSIN', weightKg: LIGHT_KG }, 'AGE_NOT_ALLOWED', {}],
      [
        { archetype: 'ASSASSIN', weightKg: LIGHT_KG },
        'ARCHETYPE_NOT_ALLOWED',
        { allowed: ['TANKER', 'SUPPORTER'] },
      ],
    ];
    for (const [over, code, details] of cases) {
      await refused(onboard(user, over, ANY_PRESCRIPTION), code, details);
    }
    assert.deepEqual(await profile(user), blank, 'a refusal leaves nothing');
    assert.equal(blank.user.onboardedAt, null);

    // the edges that are inside
    for (const over of [
      { birthYear: 2011 },
      { birthYear: 1937 },
      { heightCm: 120, weightKg: 30 },
      { heightCm: 230, weightKg: 250 },
      // 74 kg at 200 cm is exactly 18.5: allowed
      { archetype: 'ASSASSIN', heightCm: 200, weightKg: 74 },
      { archetype: 'TANKER', weightKg: LIGHT_KG },
      { timezone: 'UTC' },
    ] satisfies Loose<Input>[]) {
      assert.equal(await onboard(await register(), over, ANY_PRESCRIPTION), true);
    }
  });
});

test('profile_onboard counts the age in the year of the given time zone', async () => {
  try {
    // 18:00Z on 31 December 2026: already 2027 in Ho Chi Minh City, still 2026 in UTC
    await setTestClock(db.admin, '2026-12-31T18:00:00Z');
    await refused(
      onboard(await register(), { birthYear: 2011, timezone: 'UTC' }, ANY_PRESCRIPTION),
      'AGE_NOT_ALLOWED',
    );
    assert.equal(
      await onboard(await register(), { birthYear: 2011, timezone: 'Asia/Ho_Chi_Minh' }, ANY_PRESCRIPTION),
      true,
    );
    await refused(
      onboard(await register(), { birthYear: 1936, timezone: 'Asia/Ho_Chi_Minh' }, ANY_PRESCRIPTION),
      'VALIDATION_FAILED',
      fields(['birthYear', 'min']),
    );
    assert.equal(
      await onboard(await register(), { birthYear: 1936, timezone: 'UTC' }, ANY_PRESCRIPTION),
      true,
    );
  } finally {
    await setTestClock(db.admin, null);
  }
});

test('a prescription below the calorie floor, with a fractional target or out of shape is refused', async () => {
  await frozen(async () => {
    const user = await register();
    const blank = await profile(user);
    const P = ANY_PRESCRIPTION;
    const shape = fields(['prescription', 'format']);
    const without = (key: keyof Prescription) =>
      Object.fromEntries(Object.entries(P).filter(([name]) => name !== key));
    const cases: [Loose<Input>, unknown, unknown][] = [
      [{ sex: 'FEMALE' }, { ...P, calorieTarget: 1199 }, fields(['calorieTarget', 'min'])],
      [{ sex: 'MALE' }, { ...P, calorieTarget: 1499 }, fields(['calorieTarget', 'min'])],
      [{}, { ...P, calorieTarget: 1800.5 }, fields(['calorieTarget', 'format'])],
      [{}, { ...P, calorieTarget: '1800' }, shape],
      [{}, { ...P, calorieTarget: -1 }, fields(['calorieTarget', 'min'])],
      [{}, without('calorieTarget'), shape],
      [{}, without('bmr'), shape],
      [{}, without('tdee'), shape],
      [{}, without('proteinG'), shape],
      [{}, without('carbsG'), shape],
      [{}, without('fatG'), shape],
      [{}, without('waterMl'), shape],
      [{}, without('safetyClamped'), shape],
      [{}, without('macroAdjusted'), shape],
      [{}, { ...P, safetyClamped: 'no' }, shape],
      [{}, { ...P, proteinG: -1 }, shape],
      [{}, { ...P, carbsG: -1 }, shape],
      [{}, { ...P, fatG: -1 }, shape],
      [{}, { ...P, waterMl: 1499 }, shape],
      [{}, { ...P, waterMl: 4001 }, shape],
      [{}, { ...P, waterMl: 2000.5 }, shape],
      [{}, { ...P, bmr: 0 }, shape],
      [{}, { ...P, tdee: 0 }, shape],
      [{}, [P], shape],
      [{}, 'text', shape],
      [{}, null, shape],
    ];
    for (const [over, prescription, details] of cases) {
      await refused(onboard(user, over, prescription), 'VALIDATION_FAILED', details);
    }
    assert.deepEqual(await profile(user), blank);

    // exactly on the floor is accepted, for each sex
    assert.equal(
      await onboard(await register(), { sex: 'FEMALE' }, { ...P, calorieTarget: 1200 }),
      true,
    );
    assert.equal(
      await onboard(await register(), { sex: 'MALE' }, { ...P, calorieTarget: 1500 }),
      true,
    );
  });
});

test('the profile functions answer nobody but a signed-in, live user', async () => {
  const calls: [string, string, unknown[]][] = [
    ['profile_onboard', 'SELECT profile_onboard($1, $2, $3, $4, $5, $6, $7, $8)', ['UTC', 'TANKER', 170, 65, 1996, 'FEMALE', 'LIGHT', JSON.stringify(ANY_PRESCRIPTION)]],
    ['profile_add_biometrics', 'SELECT profile_add_biometrics($1, $2, $3, $4, $5, $6)', [170, 65, 1996, 'FEMALE', 'LIGHT', JSON.stringify(ANY_PRESCRIPTION)]],
    ['profile_set_archetype', 'SELECT profile_set_archetype($1, $2)', ['TANKER', JSON.stringify(ANY_PRESCRIPTION)]],
  ];
  const deleted = await register();
  assert.equal(await onboard(deleted), true);
  await db.admin.query('UPDATE users SET deleted_at = app.now() WHERE id = $1', [deleted]);
  const fresh = await register();
  for (const [name, sql, args] of calls) {
    for (const as of [asAnon, asJob]) {
      await expectPgError(
        as(db.app, c => c.query(sql, args)),
        { code: DENIED, messagePrefix: `permission denied for function ${name}` },
      );
    }
    // app_auth with an id that is no user, with the id of a deleted user
    const expected = name === 'profile_onboard' ? 'SESSION_INVALID' : 'ONBOARDING_REQUIRED';
    await refused(asUser(db.app, randomUUID(), c => c.query(sql, args)), expected);
    await refused(asUser(db.app, deleted, c => c.query(sql, args)), expected);
  }
  // a registered user who has not onboarded has nothing to add to
  await refused(addBiometrics(fresh), 'ONBOARDING_REQUIRED');
  await refused(setArchetype(fresh, 'TANKER'), 'ONBOARDING_REQUIRED');
  assert.equal((await profile(fresh)).user.onboardedAt, null);
  // the internal helpers are closed to every request role
  for (const [name, sql] of [
    ['_profile_check', "SELECT app._profile_check('UTC', 170, 65, 1996, 'FEMALE', 'LIGHT', 'TANKER', true)"],
    ['_archetypes_allowed', 'SELECT app._archetypes_allowed(170, 65)'],
    ['_prescription_put', `SELECT app._prescription_put('${fresh}', 'FEMALE', '{}')`],
  ]) {
    for (const as of [
      (work: Work) => asUser(db.app, fresh, work),
      (work: Work) => asAnon(db.app, work),
      (work: Work) => asJob(db.app, work),
    ]) {
      await expectPgError(
        as(c => c.query(sql)),
        { code: DENIED, messagePrefix: `permission denied for function ${name}` },
      );
    }
  }
});

// ---------------------------------------------------------------- profile_add_biometrics

test('profile_add_biometrics appends a snapshot, never rewrites one, and replaces the prescription', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user);
    const earlier = await profile(user);

    await clock(DAY);
    const second: Bio = { ...BIO, weightKg: 66.5, activityLevel: 'ACTIVE' };
    const p2 = prescriptionOf({ ...BASE, ...second }, T0 + DAY);
    await addBiometrics(user, second, null, p2);
    // and once more inside the same instant: still a new row, still in order
    const third: Bio = { ...BIO, weightKg: 67 };
    const p3 = prescriptionOf({ ...BASE, ...third }, T0 + DAY);
    await addBiometrics(user, third, null, p3);

    const now = await profile(user);
    assert.deepEqual(now.snapshots, [
      earlier.snapshots[0],
      storedSnapshot(user, second, jsonTime(DAY)),
      storedSnapshot(user, third, jsonTime(DAY, 1)),
    ]);
    assert.deepEqual(now.prescription, storedPrescription(user, p3, DAY));
    // nothing else moved: same archetype, same cooldown start, no ledger, same settings
    assert.deepEqual(
      { ...now, snapshots: null, prescription: null },
      { ...earlier, snapshots: null, prescription: null },
    );
  });
});

test('profile_add_biometrics runs the same checks as onboarding', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user);
    const earlier = await profile(user);
    const cases: [Loose<Bio>, unknown, string, unknown][] = [
      [{ birthYear: 2012 }, null, 'AGE_NOT_ALLOWED', {}],
      [{ birthYear: 1936 }, null, 'VALIDATION_FAILED', fields(['birthYear', 'min'])],
      [{ heightCm: 119.9 }, null, 'VALIDATION_FAILED', fields(['heightCm', 'min'])],
      [{ weightKg: 250.1 }, null, 'VALIDATION_FAILED', fields(['weightKg', 'max'])],
      [{ sex: 'OTHER' }, null, 'VALIDATION_FAILED', fields(['sex', 'enum'])],
      [{ activityLevel: null }, null, 'VALIDATION_FAILED', fields(['activityLevel', 'required'])],
      [{}, 'MAGE', 'VALIDATION_FAILED', fields(['archetype', 'enum'])],
      [{ birthYear: 2012, heightCm: 500 }, 'MAGE', 'VALIDATION_FAILED', fields(['archetype', 'enum'], ['heightCm', 'max'])],
      // an archetype that is given must itself be allowed for the new numbers
      [{ weightKg: LIGHT_KG }, 'ASSASSIN', 'ARCHETYPE_NOT_ALLOWED', { allowed: ['TANKER', 'SUPPORTER'] }],
    ];
    for (const [over, archetype, code, details] of cases) {
      await refused(addBiometrics(user, over, archetype), code, details);
    }
    await refused(
      addBiometrics(user, {}, null, { ...ANY_PRESCRIPTION, calorieTarget: 1199 }),
      'VALIDATION_FAILED',
      fields(['calorieTarget', 'min']),
    );
    await refused(
      addBiometrics(user, {}, null, { ...ANY_PRESCRIPTION, calorieTarget: 1650.25 }),
      'VALIDATION_FAILED',
      fields(['calorieTarget', 'format']),
    );
    assert.deepEqual(await profile(user), earlier);
  });
});

test('new numbers that rule out the current archetype need a replacement, which skips the cooldown', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user, { archetype: 'ASSASSIN' });
    const earlier = await profile(user);

    await clock(DAY);
    await refused(
      addBiometrics(user, { weightKg: LIGHT_KG }),
      'ARCHETYPE_NOT_ALLOWED',
      { allowed: ['TANKER', 'SUPPORTER'] },
    );
    assert.deepEqual(await profile(user), earlier);

    // one day after onboarding, far inside the 14 days
    await addBiometrics(user, { weightKg: LIGHT_KG }, 'SUPPORTER');
    const now = await profile(user);
    assert.deepEqual(now.user, {
      ...earlier.user,
      archetype: 'SUPPORTER',
      setAt: jsonTime(DAY),
    });
    assert.equal(now.snapshots.length, 2);
    // the forced change started a new cooldown for the free choice
    await refused(setArchetype(user, 'TANKER'), 'ARCHETYPE_COOLDOWN', {
      availableAt: instant(15 * DAY).toISOString(),
    });
  });
});

test('while the current archetype stays allowed, an archetype sent with new numbers is not applied: no way around the cooldown', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user, { archetype: 'ASSASSIN' });
    const earlier = await profile(user);
    await clock(DAY);
    await addBiometrics(user, { weightKg: 66 }, 'TANKER');
    const now = await profile(user);
    assert.deepEqual(now.user, earlier.user);
    assert.equal(now.snapshots.length, 2);
  });
});

// ---------------------------------------------------------------- profile_set_archetype

test('profile_set_archetype: refused for 14 days with the instant it opens, then it changes archetype and prescription only', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user, { archetype: 'SUPPORTER' });
    // something to lose: XP, coins, a streak, an owned item
    await db.admin.query("SELECT app._grant($1, 420, 65, 'TEST', 'seed')", [user]);
    await db.admin.query(
      `UPDATE progression_state SET streak_current = 4, streak_best = 9, missed_run = 0,
              last_outcome = 'COMPLETED', last_closed_date = '2027-01-09' WHERE user_id = $1`,
      [user],
    );
    const earlier = await profile(user);
    const ledgers = () =>
      db.admin.query(
        `SELECT 'xp' AS k, to_jsonb(l) AS row FROM xp_ledger l WHERE user_id = $1
         UNION ALL SELECT 'coin', to_jsonb(l) FROM coin_ledger l WHERE user_id = $1 ORDER BY 1`,
        [user],
      );
    const ledgersBefore = (await ledgers()).rows;
    assert.equal(ledgersBefore.length, 2);

    const availableAt = instant(14 * DAY).toISOString();
    for (const at of [0, DAY, 14 * DAY - SECOND]) {
      await clock(at);
      await refused(setArchetype(user, 'TANKER'), 'ARCHETYPE_COOLDOWN', { availableAt });
    }
    assert.deepEqual(await profile(user), earlier);

    await clock(14 * DAY);
    const tanker = prescriptionOf({ ...BASE, archetype: 'TANKER' }, T0 + 14 * DAY);
    await setArchetype(user, 'TANKER', tanker);
    const now = await profile(user);
    assert.deepEqual(now, {
      ...earlier,
      user: { ...earlier.user, archetype: 'TANKER', setAt: jsonTime(14 * DAY) },
      prescription: storedPrescription(user, tanker, 14 * DAY),
    });
    assert.notDeepEqual(now.prescription, earlier.prescription);
    assert.deepEqual((await ledgers()).rows, ledgersBefore);

    // and the next change waits again
    await refused(setArchetype(user, 'SUPPORTER'), 'ARCHETYPE_COOLDOWN', {
      availableAt: instant(28 * DAY).toISOString(),
    });
  });
});

test('profile_set_archetype: the archetype in effect again is no change, and starts no cooldown', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user, { archetype: 'SUPPORTER' });
    const earlier = await profile(user);
    await clock(DAY);
    // a retry of a change that already went through must not answer "cooldown"
    await setArchetype(user, 'SUPPORTER');
    assert.deepEqual((await profile(user)).user, earlier.user);
    await clock(14 * DAY);
    await setArchetype(user, 'SUPPORTER');
    assert.deepEqual((await profile(user)).user, earlier.user);
    await setArchetype(user, 'TANKER');
    assert.equal((await profile(user)).user.archetype, 'TANKER');
  });
});

test('profile_set_archetype runs the checks on the latest snapshot: enum, BMI rule, calorie floor', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user, { archetype: 'TANKER', weightKg: LIGHT_KG });
    const earlier = await profile(user);
    await clock(20 * DAY);
    await refused(setArchetype(user, 'MAGE'), 'VALIDATION_FAILED', fields(['archetype', 'enum']));
    await refused(setArchetype(user, null), 'VALIDATION_FAILED', fields(['archetype', 'required']));
    await refused(setArchetype(user, 'ASSASSIN'), 'ARCHETYPE_NOT_ALLOWED', {
      allowed: ['TANKER', 'SUPPORTER'],
    });
    await refused(
      setArchetype(user, 'SUPPORTER', { ...ANY_PRESCRIPTION, calorieTarget: 1199 }),
      'VALIDATION_FAILED',
      fields(['calorieTarget', 'min']),
    );
    assert.deepEqual(await profile(user), earlier);

    // "not allowed" is said before "wait": it will still be true when the wait is over
    await clock(DAY);
    await refused(setArchetype(user, 'ASSASSIN'), 'ARCHETYPE_NOT_ALLOWED', {
      allowed: ['TANKER', 'SUPPORTER'],
    });
    // the BMI is read from the LATEST snapshot: heavier now, ASSASSIN opens
    await addBiometrics(user, { weightKg: 65 });
    await clock(20 * DAY);
    await setArchetype(user, 'ASSASSIN');
    assert.equal((await profile(user)).user.archetype, 'ASSASSIN');
  });
});

// ---------------------------------------------------------------- fences, policies, constraints

test('a signed-in user reads the own snapshot, prescription and settings, and writes only the six settings', async () => {
  await frozen(async () => {
    const [a, b] = [await register(), await register()];
    await onboard(a);
    await onboard(b, { weightKg: 80 });
    const earlier = [await profile(a), await profile(b)];

    for (const table of ['biometric_snapshots', 'prescriptions', 'user_settings']) {
      const all = await asUser(db.app, a, c => c.query(`SELECT user_id FROM ${table}`));
      assert.deepEqual(all.rows, [{ user_id: a }], table);
      const theirs = await asUser(db.app, a, c =>
        c.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [b]),
      );
      assert.equal(theirs.rowCount, 0, table);
    }

    const denied: [string, string][] = [
      ['biometric_snapshots', "INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level) VALUES ($1, 170, 65, 1996, 'FEMALE', 'LIGHT')"],
      ['biometric_snapshots', 'UPDATE biometric_snapshots SET weight_kg = 60 WHERE user_id = $1'],
      ['biometric_snapshots', 'DELETE FROM biometric_snapshots WHERE user_id = $1'],
      ['prescriptions', 'UPDATE prescriptions SET calorie_target = 800 WHERE user_id = $1'],
      ['prescriptions', 'DELETE FROM prescriptions WHERE user_id = $1'],
      ['user_settings', 'UPDATE user_settings SET sound_enabled = true WHERE user_id = $1'],
      ['user_settings', 'UPDATE user_settings SET user_id = $1 WHERE user_id = $1'],
      ['user_settings', 'INSERT INTO user_settings (user_id) VALUES ($1)'],
      ['user_settings', 'DELETE FROM user_settings WHERE user_id = $1'],
      ['users', "UPDATE users SET archetype = 'ASSASSIN' WHERE id = $1"],
      ['users', 'UPDATE users SET archetype_set_at = NULL WHERE id = $1'],
      ['users', 'UPDATE users SET onboarded_at = NULL WHERE id = $1'],
    ];
    for (const [table, sql] of denied) {
      await expectPgError(
        asUser(db.app, a, c => c.query(sql, [a])),
        { code: DENIED, messagePrefix: `permission denied for table ${table}` },
      );
    }
    for (const table of ['biometric_snapshots', 'prescriptions', 'user_settings']) {
      await expectPgError(
        asAnon(db.app, c => c.query(`SELECT * FROM ${table}`)),
        { code: DENIED, messagePrefix: `permission denied for table ${table}` },
      );
    }

    // the six columns of the own row, every allowed value
    const own = await asUser(db.app, a, c =>
      c.query(
        `UPDATE user_settings SET nudges_enabled = false, reminder_enabled = true, reminder_window = 'NOON',
                hide_streak = true, motion = 'REDUCED', excluded_meal_tags = $1`,
        [[...INGREDIENT_TAGS]],
      ),
    );
    assert.equal(own.rowCount, 1, 'the policy leaves one row to update: the own one');
    const aimed = await asUser(db.app, a, c =>
      c.query('UPDATE user_settings SET hide_streak = true WHERE user_id = $1', [b]),
    );
    assert.equal(aimed.rowCount, 0);
    for (const [constraint, sql] of [
      ['user_settings_reminder_window_check', "UPDATE user_settings SET reminder_window = 'NIGHT'"],
      ['user_settings_motion_check', "UPDATE user_settings SET motion = 'NONE'"],
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = '{co:sua,co:ca-heo}'"],
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = '{chay}'"],
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = ARRAY[NULL]::text[]"],
      // a set: no tag twice, however often; one dimension; so never more than there are tags
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = '{co:sua,co:sua}'"],
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = array_fill('co:sua'::text, ARRAY[100000])"],
      ['user_settings_excluded_meal_tags_check', `UPDATE user_settings SET excluded_meal_tags = '{${[...INGREDIENT_TAGS, INGREDIENT_TAGS[0]].join(',')}}'`],
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = '{{co:sua},{co:trung}}'"],
      ['user_settings_excluded_meal_tags_check', "UPDATE user_settings SET excluded_meal_tags = '{{co:sua,co:trung}}'"],
    ]) {
      await assert.rejects(
        asUser(db.app, a, c => c.query(sql)),
        (e: unknown) => {
          assert.deepEqual(
            [(e as DatabaseError).code, (e as DatabaseError).constraint],
            [CHECK, constraint],
            sql,
          );
          return true;
        },
      );
    }
    assert.deepEqual(await profile(b), earlier[1]);
    assert.deepEqual(await profile(a), {
      ...earlier[0],
      settings: {
        user_id: a,
        nudges_enabled: false,
        reminder_enabled: true,
        reminder_window: 'NOON',
        hide_streak: true,
        sound_enabled: false,
        motion: 'REDUCED',
        excluded_meal_tags: [...INGREDIENT_TAGS],
      },
    });
  });
});

test('one user calling the functions never touches another user', async () => {
  await frozen(async () => {
    const [a, b] = [await register(), await register()];
    await onboard(a);
    await onboard(b, { archetype: 'ASSASSIN' });
    const earlier = await profile(b);
    await clock(15 * DAY);
    await addBiometrics(a, { weightKg: 70 });
    await setArchetype(a, 'TANKER');
    assert.deepEqual(await profile(b), earlier);
  });
});

test('the table constraints hold whoever writes: ranges, enums, one prescription and one settings row per user', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user);
    const refusedBy: [string, string, string][] = [
      [CHECK, 'biometric_snapshots_height_cm_check', "INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level) VALUES ($1, 119.9, 65, 1996, 'FEMALE', 'LIGHT')"],
      [CHECK, 'biometric_snapshots_weight_kg_check', "INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level) VALUES ($1, 170, 250.1, 1996, 'FEMALE', 'LIGHT')"],
      [CHECK, 'biometric_snapshots_sex_check', "INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level) VALUES ($1, 170, 65, 1996, 'OTHER', 'LIGHT')"],
      [CHECK, 'biometric_snapshots_activity_level_check', "INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level) VALUES ($1, 170, 65, 1996, 'FEMALE', 'LAZY')"],
      ['23505', 'biometric_snapshots_user_recorded_idx', "INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level, recorded_at) SELECT $1, 170, 65, 1996, 'FEMALE', 'LIGHT', recorded_at FROM biometric_snapshots WHERE user_id = $1"],
      [CHECK, 'prescriptions_calorie_target_check', 'UPDATE prescriptions SET calorie_target = 1199 WHERE user_id = $1'],
      [CHECK, 'prescriptions_calorie_target_check', 'UPDATE prescriptions SET calorie_target = 1800.5 WHERE user_id = $1'],
      [CHECK, 'prescriptions_protein_g_check', 'UPDATE prescriptions SET protein_g = -1 WHERE user_id = $1'],
      [CHECK, 'prescriptions_carbs_g_check', 'UPDATE prescriptions SET carbs_g = -1 WHERE user_id = $1'],
      [CHECK, 'prescriptions_fat_g_check', 'UPDATE prescriptions SET fat_g = -1 WHERE user_id = $1'],
      [CHECK, 'prescriptions_water_ml_check', 'UPDATE prescriptions SET water_ml = 1499 WHERE user_id = $1'],
      [CHECK, 'prescriptions_water_ml_check', 'UPDATE prescriptions SET water_ml = 4001 WHERE user_id = $1'],
      ['23505', 'prescriptions_pkey', 'INSERT INTO prescriptions SELECT * FROM prescriptions WHERE user_id = $1'],
      ['23505', 'user_settings_pkey', 'INSERT INTO user_settings (user_id) VALUES ($1)'],
      [CHECK, 'user_settings_sound_enabled_check', 'UPDATE user_settings SET sound_enabled = true WHERE user_id = $1'],
    ];
    for (const [code, constraint, sql] of refusedBy) {
      await assert.rejects(db.admin.query(sql, [user]), (e: unknown) => {
        assert.deepEqual(
          [(e as DatabaseError).code, (e as DatabaseError).constraint],
          [code, constraint],
          sql,
        );
        return true;
      });
    }
    await db.admin.query('DELETE FROM users WHERE id = $1', [user]);
    assert.deepEqual(await profile(user), {
      user: null,
      snapshots: [],
      prescription: null,
      settings: null,
      progression: null,
      xp_rows: 0,
      coin_rows: 0,
    });
  });
});

test('app._archetypes_allowed is allowedArchetypes of the domain, also right at BMI 18.5', async () => {
  // around the weight that gives exactly 18.5 for each height, in steps a float can and cannot hold
  const pairs: [number, number][] = [];
  for (let heightCm = 120; heightCm <= 230; heightCm += 2.5) {
    const edge = 18.5 * (heightCm / 100) ** 2;
    for (const weightKg of [
      edge,
      edge - 1e-9,
      edge + 1e-9,
      Math.round(edge * 10) / 10,
      Math.round(edge * 100) / 100,
      Math.floor(edge),
      Math.ceil(edge),
      30,
      250,
    ]) {
      pairs.push([heightCm, weightKg]);
    }
  }
  const { rows } = await db.admin.query<{ h: string; w: string; allowed: string[] }>(
    `SELECT h::text, w::text, app._archetypes_allowed(h, w) AS allowed
       FROM unnest($1::numeric[], $2::numeric[]) WITH ORDINALITY AS x (h, w, n) ORDER BY n`,
    [pairs.map(([h]) => h), pairs.map(([, w]) => w)],
  );
  assert.equal(rows.length, pairs.length);
  const differing = rows
    .map((row, i) => ({ pair: pairs[i], sql: row.allowed, js: allowedArchetypes(...pairs[i]) }))
    .filter(({ sql, js }) => JSON.stringify(sql) !== JSON.stringify(js));
  assert.deepEqual(differing, []);
  // both answers occur in the sample, on both sides of the edge
  assert.ok(rows.some(row => row.allowed.length === 2) && rows.some(row => row.allowed.length === 3));
  assert.deepEqual(allowedArchetypes(200, 74), ['TANKER', 'ASSASSIN', 'SUPPORTER']);
});

test('excluded_meal_tags holds every tag of INGREDIENT_TAGS, alone and all together, written by its owner', async () => {
  await frozen(async () => {
    const user = await register();
    await onboard(user);
    const write = (tags: string[]) =>
      asUser(db.app, user, c =>
        c.query('UPDATE user_settings SET excluded_meal_tags = $1 RETURNING excluded_meal_tags', [tags]),
      );
    for (const tags of [
      ...INGREDIENT_TAGS.map(tag => [tag]),
      [...INGREDIENT_TAGS],
      [...INGREDIENT_TAGS].reverse(),
      [],
    ]) {
      assert.deepEqual((await write(tags)).rows, [{ excluded_meal_tags: tags }]);
    }
  });
});

// ---------------------------------------------------------------- ceilings of the last fence

/** What 21-profile.sql refuses above, per stored number: its JSON member, its column. */
const CEILINGS = [
  { member: 'bmr', column: 'bmr', ceiling: 5000 },
  { member: 'tdee', column: 'tdee', ceiling: 10000 },
  { member: 'calorieTarget', column: 'calorie_target', ceiling: 10000 },
  { member: 'proteinG', column: 'protein_g', ceiling: 1000 },
  { member: 'carbsG', column: 'carbs_g', ceiling: 2000 },
  { member: 'fatG', column: 'fat_g', ceiling: 500 },
  { member: 'waterMl', column: 'water_ml', ceiling: 4000 },
] as const;

test('every prescription the domain can compute passes the SQL fence, and each ceiling is the first number it refuses above', async () => {
  await frozen(async () => {
    // The corners of the valid ranges: every output is a maximum of sums that rise or fall
    // steadily in height, weight and age, so its largest value sits on a corner.
    const grid: { sex: Sex; p: Prescription }[] = [];
    for (const heightCm of [LIMITS.heightCm.min, LIMITS.heightCm.max]) {
      for (const weightKg of [LIMITS.weightKg.min, LIMITS.weightKg.max]) {
        for (const ageYears of [LIMITS.age.min, LIMITS.age.max]) {
          for (const sex of ['MALE', 'FEMALE'] as const) {
            for (const activityLevel of Object.keys(ACTIVITY_FACTOR) as ActivityLevel[]) {
              for (const archetype of Object.keys(ARCHETYPE_FACTOR) as Archetype[]) {
                grid.push({
                  sex,
                  p: calculatePrescription({ heightCm, weightKg, ageYears, sex, activityLevel, archetype }),
                });
              }
            }
          }
        }
      }
    }
    assert.equal(grid.length, 240);
    const largest = Object.fromEntries(
      CEILINGS.map(({ member }) => [member, Math.max(...grid.map(({ p }) => p[member]))]),
    );
    for (const { member, ceiling } of CEILINGS) {
      assert.ok(largest[member] <= ceiling, `${member}: the domain reaches ${largest[member]}, the ceiling is ${ceiling}`);
      // round, and not far off: a ceiling ten times the largest value would fence nothing
      assert.ok(ceiling < 2.5 * largest[member], `${member}: ${ceiling} is far above ${largest[member]}`);
    }

    const user = await register();
    await onboard(user);
    // all 240 through the fence itself, as the owner (no request role may call it)
    await db.admin.query(
      `SELECT app._prescription_put($1, x ->> 'sex', x -> 'p') FROM jsonb_array_elements($2::jsonb) x`,
      [user, JSON.stringify(grid)],
    );

    // through a function a client can call: exactly the ceiling is stored, one above is refused
    const put = (prescription: string) =>
      asUser(db.app, user, c =>
        c.query('SELECT profile_add_biometrics($1, $2, $3, $4, $5, $6)', [170, 65, 1996, 'FEMALE', 'LIGHT', prescription]),
      );
    const withMember = (member: string, value: string) =>
      JSON.stringify({ ...ANY_PRESCRIPTION, [member]: 'VALUE' }).replace('"VALUE"', value);
    const earlier = await profile(user);
    for (const { member, column, ceiling } of CEILINGS) {
      const expected =
        member === 'calorieTarget' ? fields(['calorieTarget', 'max']) : fields(['prescription', 'format']);
      // 1e400 does not fit a double: it is written into the JSON text as the client would have to
      for (const tooMuch of [String(ceiling + 1), '1e9', '1e400']) {
        await refused(put(withMember(member, tooMuch)), 'VALIDATION_FAILED', expected);
      }
      // and the column refuses it whoever writes
      await assert.rejects(
        db.admin.query(`UPDATE prescriptions SET ${column} = $2 WHERE user_id = $1`, [user, ceiling + 1]),
        (e: unknown) => {
          assert.deepEqual(
            [(e as DatabaseError).code, (e as DatabaseError).constraint],
            [CHECK, `prescriptions_${column}_check`],
          );
          return true;
        },
      );
    }
    assert.deepEqual((await profile(user)).snapshots, earlier.snapshots, 'a refusal leaves nothing');
    for (const { member, column, ceiling } of CEILINGS) {
      await put(withMember(member, String(ceiling)));
      const { rows } = await db.admin.query(
        `SELECT ${column}::float8 AS value FROM prescriptions WHERE user_id = $1`,
        [user],
      );
      assert.deepEqual(rows, [{ value: ceiling }], member);
    }
    // not a number at all for a numeric column: as far from the fence as a value can be
    for (const column of ['bmr', 'tdee', 'calorie_target', 'protein_g', 'carbs_g', 'fat_g']) {
      await assert.rejects(
        db.admin.query(`UPDATE prescriptions SET ${column} = 'NaN' WHERE user_id = $1`, [user]),
        (e: unknown) => (e as DatabaseError).code === CHECK,
        column,
      );
    }
  });
});
