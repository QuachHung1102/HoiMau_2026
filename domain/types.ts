export type Archetype = 'TANKER' | 'ASSASSIN' | 'SUPPORTER';
export type Sex = 'MALE' | 'FEMALE';
export type ActivityLevel =
  | 'SEDENTARY'
  | 'LIGHT'
  | 'MODERATE'
  | 'ACTIVE'
  | 'VERY_ACTIVE';
export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
export type Modality =
  | 'RESISTANCE'
  | 'CARDIO'
  | 'HIIT'
  | 'MOBILITY'
  | 'BREATHING';
export type SpaceRequirement = 'DESK_SIDE' | 'ROOM' | 'GYM' | 'OUTDOOR';
export type QuestCategory = 'STORY' | 'DAILY' | 'HIDDEN';
export type PetStage = 'EGG' | 'HATCHLING' | 'JUVENILE' | 'ADULT' | 'MYTHIC';
export type PetMood = 'HAPPY' | 'NEUTRAL' | 'TIRED';
export type DayOutcome = 'COMPLETED' | 'FROZEN' | 'MISSED';
/** 'YYYY-MM-DD' */
export type DateLabel = string;

export const STYLE_TAGS = [
  'chay',
  'khong-thit',
  'it-nau',
  'ngoai-hang',
] as const;
/** The tags a user may exclude (S15). */
export const INGREDIENT_TAGS = [
  'co:thit-do',
  'co:gia-cam',
  'co:hai-san',
  'co:trung',
  'co:sua',
  'co:dau-phong',
  'co:gluten',
  'co:dau-nanh',
] as const;
export type IngredientTag = (typeof INGREDIENT_TAGS)[number];
