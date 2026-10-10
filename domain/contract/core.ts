import type { Prescription } from '../energy.ts';
import type {
  ActivityLevel,
  Archetype,
  DateLabel,
  DayOutcome,
  IngredientTag,
  PetMood,
  PetStage,
  QuestCategory,
  Sex,
} from '../types.ts';
import type { IsoDateTime, TitleKey } from './common.ts';

// Auth

export type RegisterRequest = {
  email: string;
  password: string;
  displayName: string;
  acceptedTerms: true;
};
export type LoginRequest = { email: string; password: string };
export type AuthSession = { token: string; userId: string; onboarded: boolean };
export type ForgotRequest = { email: string };
export type ResetRequest = { email: string; code: string; newPassword: string };

// Profile

export type OnboardingRequest = {
  timezone: string;
  archetype: Archetype;
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: Sex;
  activityLevel: ActivityLevel;
};
export type BiometricsRequest = {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  archetype?: Archetype;
};
export type ArchetypeRequest = { archetype: Archetype };
export type MePatch = { displayName?: string; timezone?: string };
export type PrescriptionResponse = Prescription & {
  computedAt: IsoDateTime;
  archetype: Archetype;
};
export type DeleteAccountRequest = { password: string };

/** Before onboarding the two archetype fields and the four parts after `user` are null. */
export type Me = {
  user: {
    id: string;
    email: string;
    displayName: string;
    timezone: string;
    archetype: Archetype | null;
    archetypeChangeAvailableAt: IsoDateTime | null;
    onboarded: boolean;
  };
  progression: Progression | null;
  /** Integers 0–100. */
  stats: { hp: number; en: number; str: number; spd: number } | null;
  pet: Pet | null;
  appearance: {
    themeCode: string;
    petSkinCode: string;
    badgeCode: string | null;
  } | null;
};

export type Progression = {
  xp: number;
  level: number;
  titleKey: TitleKey;
  xpIntoLevel: number;
  xpForNextLevel: number;
  coin: number;
  streakCurrent: number;
  streakBest: number;
  perkPointsAvailable: number;
  milestones: { days: 7 | 30 | 100; achieved: boolean }[];
  lastOutcome: DayOutcome | null;
  breakNotice: { previous: number; date: DateLabel } | null;
};

export type Pet = {
  stage: PetStage;
  stageIndex: number;
  growthPercent: number;
  mood: PetMood;
  skinCode: string;
  nextStage: PetStage | null;
};

// Settings

export type Settings = {
  nudgesEnabled: boolean;
  reminderEnabled: boolean;
  reminderWindow: 'MORNING' | 'NOON' | 'EVENING';
  hideStreak: boolean;
  soundEnabled: boolean;
  motion: 'SYSTEM' | 'REDUCED' | 'FULL';
  excludedMealTags: IngredientTag[];
};
export type SettingsPatch = Partial<Omit<Settings, 'soundEnabled'>>;

// Day

/** Same shape as the result of `calorieWindow` in domain/energy.ts. */
export type CalorieWindow = { min: number; max: number; target: number };

export type QuestState = {
  code: string;
  category: QuestCategory;
  titleKey: string;
  progress: number;
  targetCount: number;
  completed: boolean;
  xpReward: number;
  coinReward: number;
  locked: boolean;
  /** Latest live tick of a DAILY quest, for undo. */
  lastTick: { id: string; at: IsoDateTime } | null;
};

export type DayState = {
  logicalDate: DateLabel;
  serverTime: IsoDateTime;
  closesAt: IsoDateTime;
  caloriesIn: number;
  waterMl: number;
  waterTargetMl: number;
  bedtimeMarkedAt: IsoDateTime | null;
  calorieWindow: CalorieWindow;
  quests: QuestState[];
  story: { done: number; total: number };
  streak: { current: number; best: number };
  unreadCount: number;
  /** Unread `STREAK_MILESTONE` items. */
  celebrations: InboxItem[];
};

/** `occurredAt`: sent only when the write leaves the device more than 60 s after the action (AR-08). */
export type ProgressRequest = { occurredAt?: IsoDateTime };
export type UndoRequest = { tickId: string };
export type BedtimeRequest = { occurredAt?: IsoDateTime };

export type DaySummary = {
  logicalDate: DateLabel;
  /** `OPEN` = not closed yet; `NONE` = before the user's first day. */
  outcome: DayOutcome | 'OPEN' | 'NONE';
  storyDone: number;
  storyTotal: number;
  waterMl: number;
  caloriesIn: number;
  workoutMinutes: number;
};
export type DayHistory = { days: DaySummary[] };
export type DayDetail = {
  summary: DaySummary;
  /** Newest first. */
  actions: {
    id: string;
    kind: 'TICK' | 'NUTRITION' | 'WORKOUT' | 'BEDTIME';
    at: IsoDateTime;
    /** TICK: quest code. NUTRITION: meal name, or the label of a manual entry. WORKOUT: its name. Else null. */
    label: string | null;
    /** NUTRITION: kcal; WORKOUT: elapsed seconds; else null. */
    value: number | null;
    /** True only for a tick that was undone. */
    undone: boolean;
  }[];
};

// Perks

/** Same members as the keys of `PERKS` in domain/economy.ts. */
export type PerkCode = 'MEAL_SWAP_PLUS' | 'TICKET_CAP_PLUS' | 'THEME_UNLOCK';
export type Perks = {
  pointsAvailable: number;
  perks: {
    code: PerkCode;
    cost: number;
    unlocked: boolean;
    repeatable: boolean;
  }[];
};
/** `itemCode`: the theme to unlock, required for `THEME_UNLOCK` only. */
export type PerkUnlockRequest = { perkCode: PerkCode; itemCode?: string };

// Inbox

export type InboxItem = {
  id: string;
  kind:
    | 'NUDGE'
    | 'STREAK_MILESTONE'
    | 'PET_TIRED'
    | 'GUILD_WEEKLY_RESULT'
    | 'QUEST_REMINDER';
  payload: Record<string, unknown>;
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
};
/** `nextBefore`: pass as `before` to get the next page; null on the last page. */
export type Inbox = {
  items: InboxItem[];
  unreadCount: number;
  nextBefore: string | null;
};
/** Without `ids`: every unread item. */
export type InboxReadRequest = { ids?: string[] };
export type InboxReadResult = { unreadCount: number };

// Service

export type Health = {
  ok: boolean;
  db: boolean;
  jobs: { job: string; lastRunAt: IsoDateTime; ok: boolean }[];
};
export type TimezoneList = { zones: string[] };
