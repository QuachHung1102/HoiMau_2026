import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BiometricsInput } from './validation.ts';
import {
  LIMITS,
  ageFrom,
  allowedArchetypes,
  bmi,
  isDisplayName,
  isEmail,
  normalizeEmail,
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

// Characters below are built from code points so that no invisible character and no escape
// sequence lives in this file.
const cp = String.fromCodePoint;
const UNSEEN: [string, string][] = [
  ['NUL', cp(0x0)],
  ['TAB', cp(0x9)],
  ['newline', cp(0xa)],
  ['unit separator U+001F', cp(0x1f)],
  ['DEL U+007F', cp(0x7f)],
  ['NEL U+0085', cp(0x85)],
  ['U+009F', cp(0x9f)],
  ['zero-width space U+200B', cp(0x200b)],
  ['zero-width joiner U+200D', cp(0x200d)],
  ['right-to-left mark U+200F', cp(0x200f)],
  ['U+202A', cp(0x202a)],
  ['right-to-left override U+202E', cp(0x202e)],
  ['word joiner U+2060', cp(0x2060)],
  ['U+2069', cp(0x2069)],
  ['BOM U+FEFF', cp(0xfeff)],
];

test('isEmail keeps the 254 limit and does not lower-case or trim', () => {
  const longest = `${'a'.repeat(249)}@b.co`;
  assert.equal(longest.length, 254);
  assert.equal(isEmail(longest), true);
  assert.equal(isEmail('Lan@Example.COM'), true);
  assert.equal(isEmail(' lan@example.com'), false);
  assert.equal(isEmail('lan@example.com '), false);
  assert.equal(isEmail(`${cp(0xa0)}lan@example.com`), false); // NBSP in front
});

test('isEmail refuses control, invisible and text-direction characters anywhere', () => {
  for (const [name, ch] of UNSEEN) {
    assert.equal(isEmail(`${ch}lan@example.com`), false, `${name} first`);
    assert.equal(isEmail(`lan${ch}@example.com`), false, `${name} inside`);
    assert.equal(isEmail(`lan@exa${ch}mple.com`), false, `${name} in host`);
    assert.equal(isEmail(`lan@example.com${ch}`), false, `${name} last`);
  }
});

test('isEmail refuses look-alikes: text that is not in NFKC form', () => {
  const composed = `l${cp(0xe2)}n@example.com`; // a with circumflex, one code point
  const decomposed = `la${cp(0x302)}n@example.com`; // a + combining circumflex
  assert.equal(decomposed.normalize('NFC'), composed);
  assert.equal(isEmail(composed), true);
  assert.equal(isEmail(decomposed), false);
  assert.equal(isEmail(`lan${cp(0xff20)}evil.com@example.com`), false); // fullwidth @
  assert.equal(isEmail(`lan@ex${cp(0xfb01)}le.com`), false); // "fi" ligature
  assert.equal(isEmail(`${cp(0x212a)}@example.com`), false); // Kelvin sign
});

test('isEmail refuses what only fails once lower-cased, as the database does', () => {
  // H + combining macron below has no composed form, h + the same mark does
  const mark = `H${cp(0x331)}@example.com`;
  assert.equal(mark.normalize('NFKC'), mark);
  assert.notEqual(mark.toLowerCase().normalize('NFKC'), mark.toLowerCase());
  assert.equal(isEmail(mark), false);
  // capital I with dot above lower-cases to two units: 130 units as typed, 255 lower-cased
  const dotted = `${cp(0x130).repeat(125)}@b.co`;
  assert.equal(dotted.length, 130);
  assert.equal(dotted.toLowerCase().length, 255);
  assert.equal(isEmail(dotted), false);
  assert.equal(isEmail(`${cp(0x130)}@b.co`), true);
});

test('normalizeEmail trims and lower-cases, nothing else', () => {
  assert.equal(normalizeEmail('  Lan@Example.COM \n'), 'lan@example.com');
  assert.equal(normalizeEmail('lan@example.com'), 'lan@example.com');
  assert.equal(isEmail(normalizeEmail(' Lan.Nguyen@Mail.Example.VN ')), true);
  const zeroWidth = `lan${cp(0x200b)}@example.com`;
  assert.equal(normalizeEmail(zeroWidth), zeroWidth); // not repaired, isEmail refuses it
});

test('isDisplayName accepts ordinary names', () => {
  assert.equal(isDisplayName('Nguyễn Thị Lan'), true);
  assert.equal(isDisplayName('Nguyễn Thị Lan'.normalize('NFD')), true);
  assert.equal(isDisplayName('A'), true);
  assert.equal(isDisplayName(`Lan ${cp(0x1f98a)}`), true); // fox emoji
  assert.equal(isDisplayName(`Lan ${cp(0x2764)}${cp(0xfe0f)}`), true); // heart + variation selector
  assert.equal(isDisplayName(`Lan${cp(0xa0)}Anh`), true); // NBSP between words
});

test('isDisplayName counts 1 to 40 code points, not UTF-16 units', () => {
  assert.equal(isDisplayName(''), false);
  assert.equal(isDisplayName('a'.repeat(40)), true);
  assert.equal(isDisplayName('a'.repeat(41)), false);
  const astral = cp(0x1f600).repeat(40);
  assert.equal(astral.length, 80);
  assert.equal(isDisplayName(astral), true);
  assert.equal(isDisplayName(cp(0x1f600).repeat(41)), false);
});

test('isDisplayName refuses whitespace-only names and space at either end', () => {
  for (const blank of [
    ' ',
    '   ',
    cp(0xa0),
    cp(0x3000),
    `${cp(0xa0)} ${cp(0x3000)}`,
  ]) {
    assert.equal(isDisplayName(blank), false, `blank of ${blank.length}`);
  }
  assert.equal(isDisplayName(' Lan'), false);
  assert.equal(isDisplayName('Lan '), false);
  assert.equal(isDisplayName(`Lan${cp(0xa0)}`), false);
  assert.equal(isDisplayName(`${cp(0x3000)}Lan`), false);
});

test('isDisplayName refuses control, invisible and text-direction characters', () => {
  for (const [name, ch] of UNSEEN) {
    assert.equal(isDisplayName(ch), false, `${name} alone`);
    assert.equal(isDisplayName(`La${ch}n`), false, `${name} inside`);
    assert.equal(isDisplayName(`${ch}Lan`), false, `${name} first`);
    assert.equal(isDisplayName(`Lan${ch}`), false, `${name} last`);
  }
  // known limit: an emoji joined with U+200D is refused
  assert.equal(
    isDisplayName(`Lan ${cp(0x1f469)}${cp(0x200d)}${cp(0x1f4bb)}`),
    false,
  );
  assert.equal(isDisplayName(42 as unknown as string), false);
});
