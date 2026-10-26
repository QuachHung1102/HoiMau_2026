import type { Prescription } from '../energy.ts';
import type {
  ActivityLevel,
  Archetype,
  DateLabel,
  DayOutcome,
  IngredientTag,
  MealSlot,
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

/** Same members as `BiometricsInput` of domain/validation.ts. */
export type Biometrics = {
  heightCm: number;
  weightKg: number;
  birthYear: number;
  sex: Sex;
  activityLevel: ActivityLevel;
};
export type OnboardingRequest = Biometrics & {
  timezone: string;
  archetype: Archetype;
};
export type BiometricsRequest = Biometrics & { archetype?: Archetype };
export type ArchetypeRequest = { archetype: Archetype };
export type MePatch = { displayName?: string; timezone?: string };
export type PrescriptionResponse = Prescription & {
  computedAt: IsoDateTime;
  archetype: Archetype;
  /**
   * The caller's latest snapshot, to pre-fill the edit form (S37). Never cached to disk by the
   * app; no other response carries these values, and no social response ever does.
   */
  biometrics: Biometrics;
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
  /** The unread `STREAK_MILESTONE` inbox items. */
  celebrations: InboxItemStreakMilestone[];
};

/** `occurredAt`: only when the write leaves the device more than 60 s after the action. */
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
    /** The tick, nutrition log or workout session id; for BEDTIME the id of the day's daily log. */
    id: string;
    kind: 'TICK' | 'NUTRITION' | 'WORKOUT' | 'BEDTIME';
    at: IsoDateTime;
    /** NUTRITION log of a planned meal: its slot. Manual entry and every other kind: null. */
    mealSlot: MealSlot | null;
    /** TICK: quest code. NUTRITION: meal name or manual label. WORKOUT: its name. Else null. */
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
    /** Repeatable perk: true once it was used at least once; it can still be unlocked again. */
    unlocked: boolean;
    /** True only for `THEME_UNLOCK`. */
    repeatable: boolean;
  }[];
};
/** `itemCode`: the theme to unlock, required for `THEME_UNLOCK` only. */
export type PerkUnlockRequest = { perkCode: PerkCode; itemCode?: string };

// Inbox

type InboxItemBase = {
  id: string;
  createdAt: IsoDateTime;
  readAt: IsoDateTime | null;
};
export type InboxItemNudge = InboxItemBase & {
  kind: 'NUDGE';
  payload: { senderName: string; templateCode: string; text: string };
};
export type InboxItemStreakMilestone = InboxItemBase & {
  kind: 'STREAK_MILESTONE';
  payload: { days: 7 | 30 | 100; coins: number; badgeCode: string };
};
export type InboxItemPetTired = InboxItemBase & {
  kind: 'PET_TIRED';
  payload: Record<string, never>;
};
export type InboxItemGuildWeeklyResult = InboxItemBase & {
  kind: 'GUILD_WEEKLY_RESULT';
  payload: { rank: number; coins: number; weekStart: DateLabel };
};
export type InboxItemQuestReminder = InboxItemBase & {
  kind: 'QUEST_REMINDER';
  payload: Record<string, never>;
};
/** Discriminated on `kind`; the payload of `PET_TIRED` and `QUEST_REMINDER` is an empty object. */
export type InboxItem =
  | InboxItemNudge
  | InboxItemStreakMilestone
  | InboxItemPetTired
  | InboxItemGuildWeeklyResult
  | InboxItemQuestReminder;
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

/** `ok` is false exactly when `db` is false; a failed job shows only in its own `jobs[].ok`. */
export type Health = {
  ok: boolean;
  db: boolean;
  jobs: { job: string; lastRunAt: IsoDateTime; ok: boolean }[];
};
export type TimezoneList = { zones: string[] };
