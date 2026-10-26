import type { PetStage } from '../types.ts';
import type { DayState } from './core.ts';

export type { DateLabel } from '../types.ts';

/** ISO 8601 instant (RFC 3339 date-time). */
export type IsoDateTime = string;

/** Every `error.code` the API can return; docs/api/openapi.yaml lists the same set. */
export type ErrorCode =
  // any endpoint
  | 'BAD_JSON'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'SESSION_INVALID'
  | 'NOT_FOUND'
  | 'ONBOARDING_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'PAYLOAD_TOO_LARGE'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  // writes that map to a logical day
  | 'DAY_CLOSED'
  | 'OCCURRED_AT_INVALID'
  // auth, profile
  | 'REGISTRATION_UNAVAILABLE'
  | 'NAME_NOT_ALLOWED'
  | 'INVALID_CREDENTIALS'
  | 'RESET_CODE_INVALID'
  | 'AGE_NOT_ALLOWED'
  | 'ARCHETYPE_NOT_ALLOWED'
  | 'ARCHETYPE_COOLDOWN'
  // day
  | 'QUEST_NOT_FOUND'
  | 'QUEST_NOT_TICKABLE'
  | 'QUEST_ALREADY_COMPLETE'
  | 'TICK_NOT_FOUND'
  | 'UNDO_NOT_LATEST'
  | 'UNDO_WINDOW_EXPIRED'
  | 'UNDO_COINS_SPENT'
  | 'BEDTIME_TOO_EARLY'
  // nutrition
  | 'SWAP_LIMIT_REACHED'
  | 'SWAP_CANDIDATE_INVALID'
  | 'MEAL_ALREADY_LOGGED'
  | 'PLAN_NOT_FOUND'
  // perks, shop, inventory
  | 'PERK_POINTS_INSUFFICIENT'
  | 'PERK_ALREADY_UNLOCKED'
  | 'ITEM_NOT_FOUND'
  | 'ALREADY_OWNED'
  | 'ITEM_LOCKED_LEVEL'
  | 'ITEM_NOT_PURCHASABLE'
  | 'INSUFFICIENT_COINS'
  | 'ITEM_NOT_OWNED'
  // guild, nudge
  | 'ALREADY_IN_GUILD'
  | 'GUILD_NAME_TAKEN'
  | 'INVITE_CODE_INVALID'
  | 'GUILD_FULL'
  | 'NOT_IN_GUILD'
  | 'LEADER_MUST_TRANSFER'
  | 'NOT_LEADER'
  | 'TRANSFER_TARGET_INVALID'
  | 'NUDGE_NOT_SAME_GUILD'
  | 'NUDGE_OUTSIDE_WINDOW'
  | 'NUDGE_RECEIVER_LIMIT'
  | 'NUDGE_SENDER_LIMIT'
  | 'NUDGE_RECEIVER_MUTED'
  | 'NUDGE_NOT_NEEDED'
  | 'NUDGE_TEMPLATE_UNKNOWN'
  // freeze tickets
  | 'NO_TICKET'
  | 'TICKET_DATE_NOT_ELIGIBLE'
  | 'TICKET_ALREADY_USED_FOR_DATE'
  | 'TICKET_NOT_NEEDED';

/** `message` is an English diagnostic, never shown to the user. */
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

/**
 * `error.details` of `VALIDATION_FAILED`; one element has the members of `FieldError` in
 * domain/validation.ts. `field` is the body property, the query or path parameter name, or
 * `Idempotency-Key` for that header.
 */
export type ValidationDetails = {
  fields: {
    field: string;
    rule: 'required' | 'min' | 'max' | 'format' | 'enum';
  }[];
};

/** Same members as `TitleKey` of domain/progression.ts. */
export type TitleKey =
  | 'TAN_BINH'
  | 'NGUOI_KIEN_TRI'
  | 'CHIEN_BINH_KY_LUAT'
  | 'KIEN_TUONG'
  | 'HUYEN_THOAI_THE_HINH';

/** `LEVEL_UP` and `PET_STAGE_UP` fire only when the XP high-water mark crosses a threshold. */
export type GameEvent =
  | { type: 'QUEST_COMPLETED'; questCode: string }
  | {
      type: 'LEVEL_UP';
      level: number;
      titleKey: TitleKey;
      perkPointsGained: number;
    }
  | { type: 'PET_STAGE_UP'; stage: PetStage }
  | { type: 'STORY_ALL_DONE' };

/** Signed changes caused by this request. */
export type Delta = { xp: number; coin: number; events: GameEvent[] };

/**
 * `actionId` is always the `Idempotency-Key` of this request. For a tick and a nutrition log it is
 * also the id of the row created; an undo and a bedtime mark (first or repeated) create no row
 * under it.
 */
export type ActionResult = { actionId: string; day: DayState; delta: Delta };
