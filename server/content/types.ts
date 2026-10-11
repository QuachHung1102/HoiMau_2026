// Shape of every seed content table (PLAN P1.4), column for column in camelCase.
import type { ShopItem, WorkoutDetail } from '../../domain/contract/content.ts';
import type {
  Archetype,
  IngredientTag,
  MealSlot,
  Modality,
  QuestCategory,
  SpaceRequirement,
  STYLE_TAGS,
} from '../../domain/types.ts';

export type Equipment = 'tham' | 'ta-tay' | 'day-khang-luc';
export type ShopItemKind = ShopItem['kind'];
export type WorkoutPhase = WorkoutDetail['steps'][number]['phase'];
/** A mistyped tag fails typecheck. */
export type MealTag = (typeof STYLE_TAGS)[number] | IngredientTag;

export type QuestSeed = {
  code: string;
  titleKey: string;
  category: QuestCategory;
  targetCount: number;
  xpReward: number;
  coinReward: number;
  archetypes: Archetype[];
  isActive: boolean;
};

export type ShopItemSeed = {
  code: string;
  name: string;
  kind: ShopItemKind;
  priceCoin: number;
  minLevel: number;
  assetKey: string;
  purchasable: boolean;
  isDefault: boolean;
};

export type NudgeTemplateSeed = { code: string; text: string };

export type MealSeed = {
  code: string;
  name: string;
  mealSlot: MealSlot;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  tags: MealTag[];
  portionText: string;
  description: string;
  imageKey: string | null;
};

export type MoveSeed = {
  code: string;
  name: string;
  demoCode: string | null;
  steps: [string, string, string];
  caution: string;
};

export type WorkoutStepSeed = {
  moveCode: string;
  phase: WorkoutPhase;
  seconds: number;
  repsText: string;
};

export type WorkoutSeed = {
  code: string;
  name: string;
  modality: Modality;
  durationSec: 300 | 900 | 1800 | 2700;
  spaceNeeded: SpaceRequirement;
  /** Empty array = "Không cần". */
  equipment: Equipment[];
  metValue: number;
  sets: number;
  archetypes: Archetype[];
  steps: WorkoutStepSeed[];
};

export type QuoteSeed = { code: string; text: string; author: string | null };
