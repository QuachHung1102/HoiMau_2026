import type { ApiErrorBody, ErrorCode } from '../../domain/contract/common.ts';

/** The one HTTP status of each error code: the statuses of docs/api/openapi.yaml (a test compares). */
export const STATUS: Record<ErrorCode, number> = {
  BAD_JSON: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  SESSION_INVALID: 401,
  NOT_FOUND: 404,
  ONBOARDING_REQUIRED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DAY_CLOSED: 409,
  OCCURRED_AT_INVALID: 422,
  REGISTRATION_UNAVAILABLE: 409,
  NAME_NOT_ALLOWED: 422,
  INVALID_CREDENTIALS: 401,
  RESET_CODE_INVALID: 400,
  AGE_NOT_ALLOWED: 422,
  ARCHETYPE_NOT_ALLOWED: 422,
  ARCHETYPE_COOLDOWN: 409,
  QUEST_NOT_FOUND: 404,
  QUEST_NOT_TICKABLE: 409,
  QUEST_ALREADY_COMPLETE: 409,
  TICK_NOT_FOUND: 404,
  UNDO_NOT_LATEST: 409,
  UNDO_WINDOW_EXPIRED: 409,
  UNDO_COINS_SPENT: 409,
  BEDTIME_TOO_EARLY: 409,
  SWAP_LIMIT_REACHED: 409,
  SWAP_CANDIDATE_INVALID: 422,
  MEAL_ALREADY_LOGGED: 409,
  PLAN_NOT_FOUND: 409,
  PERK_POINTS_INSUFFICIENT: 409,
  PERK_ALREADY_UNLOCKED: 409,
  ITEM_NOT_FOUND: 404,
  ALREADY_OWNED: 409,
  ITEM_LOCKED_LEVEL: 409,
  ITEM_NOT_PURCHASABLE: 409,
  INSUFFICIENT_COINS: 409,
  ITEM_NOT_OWNED: 409,
  ALREADY_IN_GUILD: 409,
  GUILD_NAME_TAKEN: 409,
  INVITE_CODE_INVALID: 404,
  GUILD_FULL: 409,
  NOT_IN_GUILD: 409,
  LEADER_MUST_TRANSFER: 409,
  NOT_LEADER: 403,
  TRANSFER_TARGET_INVALID: 422,
  NUDGE_NOT_SAME_GUILD: 403,
  NUDGE_OUTSIDE_WINDOW: 409,
  NUDGE_RECEIVER_LIMIT: 409,
  NUDGE_SENDER_LIMIT: 409,
  NUDGE_RECEIVER_MUTED: 409,
  NUDGE_NOT_NEEDED: 409,
  NUDGE_TEMPLATE_UNKNOWN: 422,
  NO_TICKET: 409,
  TICKET_DATE_NOT_ELIGIBLE: 409,
  TICKET_ALREADY_USED_FOR_DATE: 409,
  TICKET_NOT_NEEDED: 409,
};

export type Details = Record<string, unknown>;
export type ErrorResponse = { status: number; body: ApiErrorBody };

/**
 * The response of an error code. `error.message` is an English diagnostic made from the code,
 * never from request data. A handler RETURNS this when what it wrote before must be kept (a
 * counted failed login): returning commits the request transaction, throwing `AppError` rolls
 * it back.
 */
export function errorResponse(
  code: ErrorCode,
  details?: Details,
): ErrorResponse {
  const message = code.toLowerCase().replaceAll('_', ' ');
  const withDetails = details !== undefined && Object.keys(details).length > 0;
  return {
    status: STATUS[code],
    body: { error: { code, message, ...(withDetails ? { details } : {}) } },
  };
}

/** Thrown to refuse a request: the request transaction is rolled back. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Details | undefined;

  constructor(code: ErrorCode, details?: Details) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.hasOwn(STATUS, value);

/**
 * What a thrown value means to the client. An `AppError` and a PostgreSQL error raised by one of
 * our functions with SQLSTATE HM000 (MESSAGE = error code, DETAIL = JSON details) name their own
 * code; null for everything else, which is a bug: 500 INTERNAL, logged.
 */
export function refusalOf(thrown: unknown): ErrorResponse | null {
  if (thrown instanceof AppError) {
    return errorResponse(thrown.code, thrown.details);
  }
  const { code, message, detail } = (thrown ?? {}) as {
    code?: unknown;
    message?: unknown;
    detail?: unknown;
  };
  if (code !== 'HM000' || !isErrorCode(message)) {
    return null;
  }
  let details: Details | undefined;
  try {
    const parsed: unknown = JSON.parse(String(detail));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      details = parsed as Details;
    }
  } catch {
    // a function that raised no DETAIL, or not JSON: the code alone is the answer
  }
  return errorResponse(message, details);
}
