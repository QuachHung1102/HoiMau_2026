import type { ActivityLevel, Archetype, Sex } from './types.ts';

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

export const ARCHETYPE_FACTOR: Record<Archetype, number> = {
  TANKER: 0.1,
  ASSASSIN: -0.15,
  SUPPORTER: 0,
};

export type Prescription = {
  bmr: number;
  tdee: number;
  calorieTarget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
  safetyClamped: boolean;
  macroAdjusted: boolean;
};

const MIN_CARBS_G = 50;

/**
 * Macro split for a calorie target (F-02, R-D06), grams rounded to integers. Never rejects.
 * Exported for tests: the last two fallbacks cannot be reached through calculatePrescription
 * with inputs inside the valid ranges.
 */
export function macroSplit(
  calorieTarget: number,
  weightKg: number,
  archetype: Archetype,
): { proteinG: number; carbsG: number; fatG: number; macroAdjusted: boolean } {
  const carbsFor = (protein: number, fat: number) =>
    (calorieTarget - protein * 4 - fat) / 4;
  let proteinG = weightKg * (archetype === 'SUPPORTER' ? 1.6 : 2.0);
  let fatKcal = calorieTarget * 0.25;
  let carbsG = carbsFor(proteinG, fatKcal);
  let macroAdjusted = false;
  if (carbsG < MIN_CARBS_G) {
    proteinG = weightKg * 1.6;
    carbsG = carbsFor(proteinG, fatKcal);
  }
  if (carbsG < MIN_CARBS_G) {
    macroAdjusted = true;
    carbsG = MIN_CARBS_G;
    fatKcal = calorieTarget - proteinG * 4 - MIN_CARBS_G * 4;
    if (fatKcal < calorieTarget * 0.2) {
      fatKcal = calorieTarget * 0.2;
      carbsG = Math.max(carbsFor(proteinG, fatKcal), 0);
    }
  }
  return {
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatKcal / 9),
    macroAdjusted,
  };
}

export function calculatePrescription(input: {
  heightCm: number;
  weightKg: number;
  ageYears: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  archetype: Archetype;
}): Prescription {
  const { heightCm, weightKg, ageYears, sex, activityLevel, archetype } = input;
  const bmr =
    10 * weightKg +
    6.25 * heightCm -
    5 * ageYears +
    (sex === 'MALE' ? 5 : -161);
  const tdee = bmr * ACTIVITY_FACTOR[activityLevel];
  const raw = tdee * (1 + ARCHETYPE_FACTOR[archetype]);
  // Deficit cap (at most 20 % under TDEE) first, then the absolute floor (AR-14).
  const capped = Math.max(raw, 0.8 * tdee);
  const target = Math.max(capped, sex === 'FEMALE' ? 1200 : 1500, bmr);
  const waterMl =
    Math.round(Math.min(Math.max(weightKg * 35, 1500), 4000) / 250) * 250;
  return {
    bmr: Math.round(bmr * 10) / 10,
    tdee: Math.round(tdee * 10) / 10,
    calorieTarget: Math.round(target),
    ...macroSplit(target, weightKg, archetype),
    waterMl,
    safetyClamped: target > raw,
  };
}

export function calorieWindow(calorieTarget: number): {
  min: number;
  max: number;
  target: number;
} {
  return {
    min: Math.round(0.9 * calorieTarget),
    max: Math.round(1.1 * calorieTarget),
    target: calorieTarget,
  };
}

/** Inside the calorieWindow band, ends included: one source for the shown band and the quest latch. */
export function isCaloriesInRange(
  caloriesIn: number,
  calorieTarget: number,
): boolean {
  const { min, max } = calorieWindow(calorieTarget);
  return caloriesIn >= min && caloriesIn <= max;
}
