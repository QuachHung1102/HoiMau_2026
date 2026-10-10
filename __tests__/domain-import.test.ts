// Import proof: the app's Jest runtime loads a domain/ module by its explicit .ts path.
import { ACTIVITY_FACTOR, calorieWindow } from '../domain/energy.ts';
import { findBannedTerms } from '../domain/language.ts';
import { logicalDateOf } from '../domain/logicalDate.ts';
import { INGREDIENT_TAGS } from '../domain/types.ts';
import { validateBiometrics } from '../domain/validation.ts';

test('a domain module loads and runs under Jest', () => {
  expect(ACTIVITY_FACTOR.SEDENTARY).toBe(1.2);
  expect(calorieWindow(2000).target).toBe(2000);
});

test('domain modules that import each other by .ts path load under Jest', () => {
  // validation.ts imports values from ./energy.ts and ./logicalDate.ts
  const now = Date.parse('2026-06-15T05:00:00Z');
  expect(
    validateBiometrics(
      {
        heightCm: 170,
        weightKg: 65,
        birthYear: 1996,
        sex: 'FEMALE',
        activityLevel: 'LIGHT',
      },
      now,
      'Asia/Ho_Chi_Minh',
    ),
  ).toEqual({ ok: true, ageYears: 30 });
  // spec 6.1: 01:30 on 10/09 belongs to 09/09
  expect(
    logicalDateOf(Date.parse('2026-09-09T18:30:00Z'), 'Asia/Ho_Chi_Minh'),
  ).toBe('2026-09-09');
  expect(findBannedTerms('chất béo')).toEqual([]);
  expect(INGREDIENT_TAGS).toContain('co:gluten');
});
