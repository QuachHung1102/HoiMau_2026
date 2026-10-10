import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prescription } from './energy.ts';
import {
  ACTIVITY_FACTOR,
  ARCHETYPE_FACTOR,
  calculatePrescription,
  calorieWindow,
  isCaloriesInRange,
  macroSplit,
} from './energy.ts';

type Input = Parameters<typeof calculatePrescription>[0];

test('activity and archetype factors are the spec values (F-02)', () => {
  assert.deepEqual(ACTIVITY_FACTOR, {
    SEDENTARY: 1.2,
    LIGHT: 1.375,
    MODERATE: 1.55,
    ACTIVE: 1.725,
    VERY_ACTIVE: 1.9,
  });
  assert.deepEqual(ARCHETYPE_FACTOR, {
    TANKER: 0.1,
    ASSASSIN: -0.15,
    SUPPORTER: 0,
  });
});

// Expected values: output of an independent throwaway implementation of the written formula.
// prettier-ignore
const CASES: [string, Input, Prescription][] = [
  [
    'TANKER / MALE',
    { heightCm: 175, weightKg: 70, ageYears: 30, sex: 'MALE', activityLevel: 'MODERATE', archetype: 'TANKER' },
    { bmr: 1648.8, tdee: 2555.6, calorieTarget: 2811, proteinG: 140, carbsG: 387, fatG: 78, waterMl: 2500, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'TANKER / FEMALE',
    { heightCm: 162, weightKg: 55, ageYears: 27, sex: 'FEMALE', activityLevel: 'LIGHT', archetype: 'TANKER' },
    { bmr: 1266.5, tdee: 1741.4, calorieTarget: 1916, proteinG: 110, carbsG: 249, fatG: 53, waterMl: 2000, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'ASSASSIN / MALE',
    { heightCm: 180, weightKg: 88.5, ageYears: 41, sex: 'MALE', activityLevel: 'ACTIVE', archetype: 'ASSASSIN' },
    { bmr: 1810, tdee: 3122.3, calorieTarget: 2654, proteinG: 177, carbsG: 321, fatG: 74, waterMl: 3000, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'ASSASSIN / FEMALE',
    { heightCm: 158.5, weightKg: 62, ageYears: 35, sex: 'FEMALE', activityLevel: 'MODERATE', archetype: 'ASSASSIN' },
    { bmr: 1274.6, tdee: 1975.7, calorieTarget: 1679, proteinG: 124, carbsG: 191, fatG: 47, waterMl: 2250, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'SUPPORTER / MALE',
    { heightCm: 168, weightKg: 64, ageYears: 52, sex: 'MALE', activityLevel: 'SEDENTARY', archetype: 'SUPPORTER' },
    { bmr: 1435, tdee: 1722, calorieTarget: 1722, proteinG: 102, carbsG: 220, fatG: 48, waterMl: 2250, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'SUPPORTER / FEMALE',
    { heightCm: 155, weightKg: 48, ageYears: 19, sex: 'FEMALE', activityLevel: 'VERY_ACTIVE', archetype: 'SUPPORTER' },
    { bmr: 1192.8, tdee: 2266.2, calorieTarget: 2266, proteinG: 77, carbsG: 348, fatG: 63, waterMl: 1750, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'the 1200 kcal floor clamps (female)',
    { heightCm: 150, weightKg: 45, ageYears: 60, sex: 'FEMALE', activityLevel: 'SEDENTARY', archetype: 'ASSASSIN' },
    { bmr: 926.5, tdee: 1111.8, calorieTarget: 1200, proteinG: 90, carbsG: 135, fatG: 33, waterMl: 1500, safetyClamped: true, macroAdjusted: false },
  ],
  [
    'the 1500 kcal floor clamps (male)',
    { heightCm: 160, weightKg: 50, ageYears: 70, sex: 'MALE', activityLevel: 'SEDENTARY', archetype: 'SUPPORTER' },
    { bmr: 1155, tdee: 1386, calorieTarget: 1500, proteinG: 80, carbsG: 201, fatG: 42, waterMl: 1750, safetyClamped: true, macroAdjusted: false },
  ],
  [
    'macro fallback 1: protein lowered to 1.6 g/kg, not flagged as adjusted (AR-14)',
    { heightCm: 120, weightKg: 250, ageYears: 90, sex: 'FEMALE', activityLevel: 'SEDENTARY', archetype: 'ASSASSIN' },
    { bmr: 2639, tdee: 3166.8, calorieTarget: 2692, proteinG: 400, carbsG: 105, fatG: 75, waterMl: 4000, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'water clamps at 1500 ml',
    { heightCm: 150, weightKg: 30, ageYears: 20, sex: 'FEMALE', activityLevel: 'LIGHT', archetype: 'SUPPORTER' },
    { bmr: 976.5, tdee: 1342.7, calorieTarget: 1343, proteinG: 48, carbsG: 204, fatG: 37, waterMl: 1500, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'water clamps at 4000 ml',
    { heightCm: 200, weightKg: 150, ageYears: 30, sex: 'MALE', activityLevel: 'LIGHT', archetype: 'TANKER' },
    { bmr: 2605, tdee: 3581.9, calorieTarget: 3940, proteinG: 300, carbsG: 439, fatG: 109, waterMl: 4000, safetyClamped: false, macroAdjusted: false },
  ],
  [
    'water rounds to 250 ml',
    { heightCm: 170, weightKg: 70.3, ageYears: 30, sex: 'MALE', activityLevel: 'LIGHT', archetype: 'SUPPORTER' },
    { bmr: 1620.5, tdee: 2228.2, calorieTarget: 2228, proteinG: 112, carbsG: 305, fatG: 62, waterMl: 2500, safetyClamped: false, macroAdjusted: false },
  ],
];

for (const [name, input, expected] of CASES) {
  test(`calculatePrescription: ${name}`, () => {
    assert.deepEqual(calculatePrescription(input), expected);
  });
}

test('macroSplit: no fallback', () => {
  assert.deepEqual(macroSplit(2000, 70, 'TANKER'), {
    proteinG: 140,
    carbsG: 235,
    fatG: 56,
    macroAdjusted: false,
  });
  assert.deepEqual(macroSplit(2000, 70, 'SUPPORTER'), {
    proteinG: 112,
    carbsG: 263,
    fatG: 56,
    macroAdjusted: false,
  });
  assert.deepEqual(macroSplit(2000, 140, 'ASSASSIN'), {
    proteinG: 280,
    carbsG: 95,
    fatG: 56,
    macroAdjusted: false,
  });
});

// Fallbacks 2 and 3 cannot be reached through calculatePrescription inside the valid input ranges
// (grid search over 110 139 750 combinations: 0 hits each), so they are covered here directly.
test('macroSplit fallback 2: carbs forced to 50 g, fat takes the remainder', () => {
  assert.deepEqual(macroSplit(1500, 150, 'TANKER'), {
    proteinG: 240,
    carbsG: 50,
    fatG: 38,
    macroAdjusted: true,
  });
});

test('macroSplit fallback 3: protein 1.6 g/kg, fat 20 %, carbs the remainder, never negative', () => {
  assert.deepEqual(macroSplit(1500, 170, 'TANKER'), {
    proteinG: 272,
    carbsG: 28,
    fatG: 33,
    macroAdjusted: true,
  });
  assert.deepEqual(macroSplit(1500, 250, 'SUPPORTER'), {
    proteinG: 400,
    carbsG: 0,
    fatG: 33,
    macroAdjusted: true,
  });
});

test('calorieWindow is the rounded ±10 % band', () => {
  assert.deepEqual(calorieWindow(2000), { min: 1800, max: 2200, target: 2000 });
  assert.deepEqual(calorieWindow(1235), { min: 1112, max: 1359, target: 1235 });
  assert.deepEqual(calorieWindow(1200), { min: 1080, max: 1320, target: 1200 });
});

test('isCaloriesInRange: within 10 % of the target, both ends included', () => {
  assert.equal(isCaloriesInRange(1800, 2000), true);
  assert.equal(isCaloriesInRange(2200, 2000), true);
  assert.equal(isCaloriesInRange(2000, 2000), true);
  assert.equal(isCaloriesInRange(1799, 2000), false);
  assert.equal(isCaloriesInRange(2201, 2000), false);
  assert.equal(isCaloriesInRange(0, 2000), false);
});
