// Entry for `npm run domain:bundle-check`: proves Metro bundles domain/ modules
// imported by their explicit .ts path. Never shipped.
import { ACTIVITY_FACTOR, calorieWindow } from '../domain/energy.ts';
import { findBannedTerms } from '../domain/language.ts';
import { logicalDateOf } from '../domain/logicalDate.ts';
import { INGREDIENT_TAGS } from '../domain/types.ts';
import { validateBiometrics } from '../domain/validation.ts';

globalThis.__domainBundleCheck = {
  window: calorieWindow(ACTIVITY_FACTOR.SEDENTARY),
  findBannedTerms,
  logicalDateOf,
  validateBiometrics,
  tags: INGREDIENT_TAGS,
};
