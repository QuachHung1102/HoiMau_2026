import type {
  DateLabel,
  MealSlot,
  Modality,
  SpaceRequirement,
} from '../types.ts';
import type { Delta, IsoDateTime } from './common.ts';
import type { CalorieWindow, DayState } from './core.ts';

// Nutrition

/** Same members as `MacroTarget` of domain/mealPlan.ts. */
export type MacroTarget = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type Meal = {
  id: string;
  code: string;
  name: string;
  mealSlot: MealSlot;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  tags: string[];
  portionText: string;
  description: string;
  imageKey: string | null;
};

export type MealPlanState = {
  logicalDate: DateLabel;
  target: MacroTarget;
  caloriesIn: number;
  calorieWindow: CalorieWindow;
  slots: {
    mealSlot: MealSlot;
    meal: Meal;
    logged: boolean;
    swapsUsed: number;
    swapsAllowed: number;
    macroWarning: boolean;
  }[];
};

/** `kcalDelta` = candidate kcal − kcal of the meal currently planned for the slot. */
export type SwapCandidates = {
  mealSlot: MealSlot;
  swapsRemaining: number;
  candidates: (Meal & { kcalDelta: number })[];
};
export type SwapRequest = { mealSlot: MealSlot; mealId: string };

/** Exactly one of `mealSlot` (the planned meal of that slot) or `kcal` (manual entry, optional `label`). */
export type NutritionLogRequest = {
  mealSlot?: MealSlot;
  kcal?: number;
  label?: string;
  occurredAt?: IsoDateTime;
};

// Workout

export type WorkoutSummary = {
  id: string;
  code: string;
  name: string;
  modality: Modality;
  durationSec: number;
  spaceNeeded: SpaceRequirement;
  equipment: string[];
  recommended: boolean;
  kcalEstimate: number;
};
export type WorkoutCatalog = { items: WorkoutSummary[] };
export type WorkoutDetail = WorkoutSummary & {
  sets: number;
  steps: {
    position: number;
    phase: 'WARMUP' | 'MAIN' | 'COOLDOWN';
    seconds: number;
    repsText: string;
    move: {
      code: string;
      name: string;
      demoCode: string | null;
      steps: [string, string, string];
      caution: string;
    };
  }[];
};
export type WorkoutCompleteRequest = {
  exerciseItemId: string;
  elapsedSec: number;
  occurredAt?: IsoDateTime;
};
export type WorkoutResult = {
  completed: boolean;
  xpAwarded: number;
  coinAwarded: number;
  elapsedSec: number;
  durationSec: number;
  day: DayState;
  delta: Delta;
};

// Shop and inventory

export type ShopItem = {
  code: string;
  name: string;
  kind: 'THEME' | 'PET_SKIN' | 'BADGE';
  priceCoin: number;
  minLevel: number;
  assetKey: string;
  owned: boolean;
  equipped: boolean;
  locked: boolean;
  purchasable: boolean;
  isDefault: boolean;
};
export type Shop = { coin: number; level: number; items: ShopItem[] };
export type PurchaseResult = { coin: number; item: ShopItem };
export type Inventory = { items: ShopItem[] };
