import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BiometricsInput } from './validation.ts';
import {
  LIMITS,
  ageFrom,
  allowedArchetypes,
  bmi,
  isEmail,
  validateBiometrics,
} from './validation.ts';

const ZONE = 'Asia/Ho_Chi_Minh';
const NOW = Date.parse('2026-06-15T05:00:00Z'); // the year is 2026 in ZONE
const YEAR = 2026;

const valid: BiometricsInput = {
  heightCm: 170,
  weightKg: 65,
  birthYear: YEAR - 30,
  sex: 'FEMALE',
  activityLevel: 'LIGHT',
};
const check = (patch: Record<string, unknown>) =>
  validateBiometrics({ ...valid, ...patch } as BiometricsInput, NOW, ZONE);
const failed = (fields: { field: string; rule: string }[]) => ({
  ok: false,
  code: 'VALIDATION_FAILED',
  fields,
});

test('LIMITS are the plan values', () => {
  assert.deepEqual(LIMITS, {
    heightCm: { min: 120, max: 230 },
    weightKg: { min: 30, max: 250 },
    age: { min: 16, max: 90 },
    displayName: { min: 1, max: 40 },
    password: { min: 8, max: 128 },
    manualKcal: { min: 1, max: 5000 },
    mealLabel: { max: 60 },
    journalBody: { min: 1, max: 5000 },
    guildName: { min: 3, max: 30 },
    guildMotto: { max: 80 },
  });
});

test('ageFrom uses the current year in the user time zone', () => {
  const instant = Date.parse('2026-12-31T17:30:00Z');
  assert.equal(ageFrom(2011, instant, 'Asia/Ho_Chi_Minh'), 16); // already 2027 there
  assert.equal(ageFrom(2011, instant, 'UTC'), 15);
});

test('validateBiometrics accepts a valid input and returns the age', () => {
  assert.deepEqual(check({}), { ok: true, ageYears: 30 });
});

test('validateBiometrics: height limits', () => {
  assert.equal(check({ heightCm: 120 }).ok, true);
  assert.equal(check({ heightCm: 230 }).ok, true);
  assert.deepEqual(
    check({ heightCm: 119.9 }),
    failed([{ field: 'heightCm', rule: 'min' }]),
  );
  assert.deepEqual(
    check({ heightCm: 230.1 }),
    failed([{ field: 'heightCm', rule: 'max' }]),
  );
});

test('validateBiometrics: weight limits', () => {
  assert.equal(check({ weightKg: 30 }).ok, true);
  assert.equal(check({ weightKg: 250 }).ok, true);
  assert.deepEqual(
    check({ weightKg: 29.9 }),
    failed([{ field: 'weightKg', rule: 'min' }]),
  );
  assert.deepEqual(
    check({ weightKg: 250.1 }),
    failed([{ field: 'weightKg', rule: 'max' }]),
  );
});

test('validateBiometrics: age 16 and 90 pass, 15 is AGE_NOT_ALLOWED, 91 fails as birthYear/min', () => {
  assert.deepEqual(check({ birthYear: YEAR - 16 }), { ok: true, ageYears: 16 });
  assert.deepEqual(check({ birthYear: YEAR - 15 }), {
    ok: false,
    code: 'AGE_NOT_ALLOWED',
  });
  assert.deepEqual(check({ birthYear: YEAR - 90 }), { ok: true, ageYears: 90 });
  assert.deepEqual(
    check({ birthYear: YEAR - 91 }),
    failed([{ field: 'birthYear', rule: 'min' }]),
  );
});

test('validateBiometrics: the age follows the time zone year', () => {
  const instant = Date.parse('2026-12-31T17:30:00Z');
  const input = { ...valid, birthYear: 2011 };
  assert.deepEqual(validateBiometrics(input, instant, 'Asia/Ho_Chi_Minh'), {
    ok: true,
    ageYears: 16,
  });
  assert.deepEqual(validateBiometrics(input, instant, 'UTC'), {
    ok: false,
    code: 'AGE_NOT_ALLOWED',
  });
});

test('validateBiometrics: missing and non-finite values are "required"', () => {
  assert.deepEqual(
    check({ heightCm: undefined }),
    failed([{ field: 'heightCm', rule: 'required' }]),
  );
  assert.deepEqual(
    check({ weightKg: Number.NaN }),
    failed([{ field: 'weightKg', rule: 'required' }]),
  );
  assert.deepEqual(
    check({ weightKg: Infinity }),
    failed([{ field: 'weightKg', rule: 'required' }]),
  );
  assert.deepEqual(
    check({ heightCm: '170' }),
    failed([{ field: 'heightCm', rule: 'required' }]),
  );
  assert.deepEqual(
    check({ birthYear: null }),
    failed([{ field: 'birthYear', rule: 'required' }]),
  );
  assert.deepEqual(
    check({ sex: undefined }),
    failed([{ field: 'sex', rule: 'required' }]),
  );
  assert.deepEqual(
    check({ activityLevel: null }),
    failed([{ field: 'activityLevel', rule: 'required' }]),
  );
});

test('validateBiometrics: a fractional birth year is a format error', () => {
  assert.deepEqual(
    check({ birthYear: 1996.5 }),
    failed([{ field: 'birthYear', rule: 'format' }]),
  );
});

test('validateBiometrics: unknown enum values', () => {
  assert.deepEqual(
    check({ sex: 'OTHER' }),
    failed([{ field: 'sex', rule: 'enum' }]),
  );
  assert.deepEqual(
    check({ activityLevel: 'toString' }),
    failed([{ field: 'activityLevel', rule: 'enum' }]),
  );
});

test('validateBiometrics: one error per field, and field errors win over the age gate', () => {
  assert.deepEqual(
    check({
      heightCm: 500,
      weightKg: 1,
      birthYear: YEAR - 15,
      sex: 'X',
      activityLevel: 'Y',
    }),
    failed([
      { field: 'heightCm', rule: 'max' },
      { field: 'weightKg', rule: 'min' },
      { field: 'sex', rule: 'enum' },
      { field: 'activityLevel', rule: 'enum' },
    ]),
  );
});

test('bmi is kg over metres squared', () => {
  assert.equal(bmi(200, 80), 20);
  assert.equal(bmi(100, 18.5), 18.5);
});

test('allowedArchetypes drops ASSASSIN below BMI 18.5', () => {
  // at 200 cm: BMI = weightKg / 4, so 73.9 kg -> 18.475 and 74.1 kg -> 18.525
  assert.deepEqual(allowedArchetypes(200, 73.9), ['TANKER', 'SUPPORTER']);
  assert.deepEqual(allowedArchetypes(200, 74.1), [
    'TANKER',
    'ASSASSIN',
    'SUPPORTER',
  ]);
  assert.deepEqual(allowedArchetypes(200, 74), [
    'TANKER',
    'ASSASSIN',
    'SUPPORTER',
  ]); // exactly 18.5
});

test('isEmail accepts plain addresses and rejects malformed ones', () => {
  assert.equal(isEmail('lan@example.com'), true);
  assert.equal(isEmail('lan.nguyen+quest@mail.example.vn'), true);
  for (const bad of [
    '',
    'lan',
    'lan@',
    '@example.com',
    'lan@example',
    'lan @example.com',
    'a@b@c.com',
  ]) {
    assert.equal(isEmail(bad), false, bad);
  }
  assert.equal(isEmail(`${'a'.repeat(250)}@b.co`), false); // longer than 254
  assert.equal(isEmail(42 as unknown as string), false);
});
