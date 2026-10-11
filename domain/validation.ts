import { ACTIVITY_FACTOR } from './energy.ts';
import { localParts } from './logicalDate.ts';
import type { ActivityLevel, Archetype, Sex } from './types.ts';

export const LIMITS = {
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
} as const;

export type FieldError = {
  field: string;
  rule: 'required' | 'min' | 'max' | 'format' | 'enum';
};

export type BiometricsInput = {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: Sex;
  activityLevel: ActivityLevel;
};

/** Current year in the user's time zone minus birthYear (R-D06). */
export function ageFrom(
  birthYear: number,
  nowMs: number,
  timeZone: string,
): number {
  return Number(localParts(nowMs, timeZone).date.slice(0, 4)) - birthYear;
}

export function bmi(heightCm: number, weightKg: number): number {
  return weightKg / (heightCm / 100) ** 2;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function rangeRule(
  value: unknown,
  limit: { min: number; max: number },
): FieldError['rule'] | null {
  if (!isNumber(value)) {
    return 'required';
  }
  if (value < limit.min) {
    return 'min';
  }
  return value > limit.max ? 'max' : null;
}

function enumRule(
  value: unknown,
  allowed: readonly string[],
): FieldError['rule'] | null {
  if (value === undefined || value === null) {
    return 'required';
  }
  return allowed.includes(value as string) ? null : 'enum';
}

/** Field errors are reported before the age gate; the input is untrusted at runtime. */
export function validateBiometrics(
  input: BiometricsInput,
  nowMs: number,
  timeZone: string,
):
  | { ok: true; ageYears: number }
  | { ok: false; code: 'VALIDATION_FAILED'; fields: FieldError[] }
  | { ok: false; code: 'AGE_NOT_ALLOWED' } {
  const ageYears = ageFrom(input.birthYear, nowMs, timeZone);
  let birthYearRule: FieldError['rule'] | null = null;
  if (!isNumber(input.birthYear)) {
    birthYearRule = 'required';
  } else if (!Number.isInteger(input.birthYear)) {
    birthYearRule = 'format';
  } else if (ageYears > LIMITS.age.max) {
    birthYearRule = 'min';
  }

  const rules: [string, FieldError['rule'] | null][] = [
    ['heightCm', rangeRule(input.heightCm, LIMITS.heightCm)],
    ['weightKg', rangeRule(input.weightKg, LIMITS.weightKg)],
    ['birthYear', birthYearRule],
    ['sex', enumRule(input.sex, ['MALE', 'FEMALE'])],
    [
      'activityLevel',
      enumRule(input.activityLevel, Object.keys(ACTIVITY_FACTOR)),
    ],
  ];
  const fields: FieldError[] = [];
  for (const [field, rule] of rules) {
    if (rule) {
      fields.push({ field, rule });
    }
  }
  if (fields.length > 0) {
    return { ok: false, code: 'VALIDATION_FAILED', fields };
  }
  if (ageYears < LIMITS.age.min) {
    return { ok: false, code: 'AGE_NOT_ALLOWED' };
  }
  return { ok: true, ageYears };
}

/** No ASSASSIN (fat-loss profile) when BMI < 18.5 (spec 9.1, S43). */
export function allowedArchetypes(
  heightCm: number,
  weightKg: number,
): Archetype[] {
  return bmi(heightCm, weightKg) < 18.5
    ? ['TANKER', 'SUPPORTER']
    : ['TANKER', 'ASSASSIN', 'SUPPORTER'];
}

// What a reader cannot see: C0 and C1 controls, zero-width and text-direction formatting, BOM.
// Same class as users_display_name_check and app._email in server/sql/10-auth.sql, plus NUL
// (PostgreSQL text cannot hold it). Kept as escapes: this file must stay ASCII.
const UNSEEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

const isNfkc = (text: string) => text === text.normalize('NFKC');

/** The caller's spelling of an email before isEmail and before sending it: trim + lower-case. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Judges the value as given: it never trims or lower-cases (normalizeEmail does). Refuses
 * everything app._email in server/sql/10-auth.sql refuses: more than 254 characters, an unseen
 * character, and look-alikes of a real address, i.e. text that is not in NFKC form as typed or
 * once lower-cased (a decomposed letter, a fullwidth "@", a ligature).
 */
export function isEmail(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const lower = value.toLowerCase();
  return (
    value.length <= 254 &&
    lower.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !UNSEEN.test(value) &&
    isNfkc(value) &&
    isNfkc(lower)
  );
}

/**
 * 1 to 40 code points (the database counts with char_length), no whitespace at either end (so
 * never whitespace-only, NBSP and U+3000 included) and no unseen character. Stricter than
 * users_display_name_check, which only trims plain spaces. Known limit: an emoji sequence joined
 * with U+200D (zero-width joiner) is refused; a single emoji is accepted.
 */
export function isDisplayName(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    UNSEEN.test(value)
  ) {
    return false;
  }
  const length = [...value].length;
  return length >= LIMITS.displayName.min && length <= LIMITS.displayName.max;
}
