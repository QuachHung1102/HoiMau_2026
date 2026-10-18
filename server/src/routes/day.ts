// Day routes: the day, a tick of a DAILY quest, its undo, the bedtime mark, the history.
//
// The three writes hand the user's intent to a function of 30-day.sql, which decides everything
// (the day the write lands on, the progress, the reward) and reports the grant it made. Every
// refusal here is THROWN (AppError, or HM000 raised by the function): a refused write leaves no
// tick, no progress, no ledger row and no daily log, so the request transaction rolls back.
// The answer of a write carries today (`buildDay`), also when the write landed on an earlier day.
import type { GameEvent } from '../../../domain/contract/common.ts';
import { addDays, daysBetween } from '../../../domain/logicalDate.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { FieldError } from '../../../domain/validation.ts';
import type { Ctx, Route, RouteResponse } from '../app.ts';
import { AppError } from '../errors.ts';
import { idempotencyKey } from '../idempotency.ts';
import {
  buildDay,
  buildDayDetail,
  buildDaySummaries,
} from '../readModels/day.ts';
import { buildDelta, logGrants } from '../readModels/delta.ts';
import type { Grant } from '../readModels/delta.ts';

/** `GET /day/history` answers at most this many dates. */
const HISTORY_MAX_DATES = 92;

// RFC 3339 with a zone: date, hour, minute, second, an optional fraction, then Z or an offset.
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** The fraction of seconds of an RFC 3339 text, digits only. */
const FRACTION = /\.(\d+)/;

/** The last instant written with a four-digit year: PostgreSQL reads no later spelling. */
const LAST_INSTANT = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export const refuse = (field: string, rule: FieldError['rule']) =>
  new AppError('VALIDATION_FAILED', { fields: [{ field, rule }] });

/**
 * The body of a write, which the contract has as a JSON object: without one the refusal is
 * `body` / `required`; for anything else (null, an array, a number, a string) `body` / `format`.
 * Also for the writes of routes/nutrition.ts and routes/workout.ts.
 */
export function objectBody(body: unknown): Record<string, unknown> {
  if (body === undefined) {
    throw refuse('body', 'required');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw refuse('body', 'format');
  }
  return body as Record<string, unknown>;
}

/** YYYY-MM-DD that names a day of the calendar: 2027-02-30 is none. */
function isCalendarDate(value: string): boolean {
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
  } catch {
    // not a date at all: the label could not be printed back
    return false;
  }
}

/**
 * The instant an RFC 3339 text names, in milliseconds, or NaN: the date must exist, the hour be
 * 00 to 23, minute and second 00 to 59, and a zone be given. JavaScript alone reads 30 February
 * as 2 March and 24:00 as the next midnight.
 */
export function instantOf(value: unknown): number {
  return instantParts(value)?.ms ?? NaN;
}

/** The instant (whole milliseconds) and the digits of the fraction it was written with. */
function instantParts(value: unknown): { ms: number; fraction: string } | null {
  const parts = typeof value === 'string' ? DATE_TIME.exec(value) : null;
  if (parts === null) {
    return null;
  }
  const [, date, hour, minute, second, offsetHour = '00', offsetMinute = '00'] =
    parts;
  const inRange =
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    Number(offsetHour) <= 23 &&
    Number(offsetMinute) <= 59;
  if (!inRange || !isCalendarDate(date)) {
    return null;
  }
  const fraction = FRACTION.exec(parts[0])?.[1] ?? '';
  // parsed with three digits of fraction at most: what JavaScript reads for sure
  const ms = Date.parse(parts[0].replace(FRACTION, `.${fraction.slice(0, 3).padEnd(3, '0')}`));
  return { ms, fraction };
}

/**
 * The one spelling SQL is given for an instant the client wrote (`occurredAt`, the inbox cursor
 * `before`): UTC, `YYYY-MM-DDTHH:MM:SS.ffffffZ`, keeping the fraction it was written with up to
 * microseconds (PostgreSQL's precision; further digits are dropped). Null when it is no instant
 * (instantOf) or one PostgreSQL cannot read: after 9999 (an offset can push 9999-12-31 into the
 * year 10000). Before 1970 it is 1970-01-01 (PostgreSQL has no year 0000, and nothing of ours is
 * that old). Never hand SQL the text as written: RFC 3339 allows offsets up to ±23:59, PostgreSQL
 * reads them only up to ±15:59.
 */
export function instantText(value: unknown): string | null {
  const parts = instantParts(value);
  if (parts === null || parts.ms > LAST_INSTANT) {
    return null;
  }
  if (parts.ms < 0) {
    return '1970-01-01T00:00:00.000000Z';
  }
  const micros = parts.fraction.slice(3, 6).padEnd(3, '0');
  return `${new Date(parts.ms).toISOString().slice(0, 23)}${micros}Z`;
}

/**
 * `occurredAt` of a write, as the instant it names in one spelling (instantText), or null when
 * the member is absent. What the instant may be (not ahead, not older than 48 h, on an open day)
 * is judged by the function.
 */
export function occurredAtOf(body: unknown): string | null {
  const { occurredAt } = objectBody(body);
  if (occurredAt === undefined) {
    return null;
  }
  const text = instantText(occurredAt);
  if (text === null) {
    throw refuse('occurredAt', 'format');
  }
  return text;
}

/** A date label that names a real date, or the refusal of `field`. */
export function dateOf(value: string | null | undefined, field: string): DateLabel {
  if (value === null || value === undefined || value === '') {
    throw refuse(field, 'required');
  }
  // year 0000 is a date to JavaScript and none to PostgreSQL
  if (!isCalendarDate(value) || value.startsWith('0000')) {
    throw refuse(field, 'format');
  }
  return value;
}

/** The answer of a write: the ledger lines of its grants, then today and what changed. */
export async function actionResult(
  ctx: Ctx,
  grants: Grant[],
  events: GameEvent[],
): Promise<RouteResponse> {
  logGrants(ctx, grants);
  return {
    status: 200,
    body: {
      actionId: ctx.actionId,
      day: await buildDay(ctx),
      delta: buildDelta(grants, events),
    },
  };
}

type QuestResult = Grant & { progress: number; completed: boolean };

async function tick(ctx: Ctx): Promise<RouteResponse> {
  const { questCode } = ctx.params;
  const { rows } = await ctx.db.query<{ result: QuestResult }>(
    'SELECT quest_tick($1, $2, $3) AS result',
    [questCode, ctx.actionId, occurredAtOf(ctx.body)],
  );
  const { result } = rows[0];
  // `applied` is false for a tick that was there already: it completes nothing a second time
  return actionResult(
    ctx,
    [result],
    result.applied && result.completed
      ? [{ type: 'QUEST_COMPLETED', questCode }]
      : [],
  );
}

async function undo(ctx: Ctx): Promise<RouteResponse> {
  const { tickId } = objectBody(ctx.body);
  if (tickId === undefined || tickId === null) {
    throw refuse('tickId', 'required');
  }
  const id = idempotencyKey(tickId as string);
  if (id === null) {
    throw refuse('tickId', 'format');
  }
  const { rows } = await ctx.db.query<{ result: QuestResult }>(
    'SELECT quest_undo($1, $2) AS result',
    [ctx.params.questCode, id],
  );
  return actionResult(ctx, [rows[0].result], []);
}

async function bedtime(ctx: Ctx): Promise<RouteResponse> {
  const { rows } = await ctx.db.query<{
    result: Grant & { completed: boolean };
  }>('SELECT day_bedtime($1, $2) AS result', [
    ctx.actionId,
    occurredAtOf(ctx.body),
  ]);
  const { result } = rows[0];
  return actionResult(
    ctx,
    [result],
    result.completed
      ? [{ type: 'QUEST_COMPLETED', questCode: 'BEDTIME_BEFORE_23' }]
      : [],
  );
}

async function history(ctx: Ctx): Promise<RouteResponse> {
  const from = dateOf(ctx.query.get('from'), 'from');
  const to = dateOf(ctx.query.get('to'), 'to');
  const dates = daysBetween(from, to) + 1;
  if (dates < 1) {
    throw refuse('to', 'min');
  }
  if (dates > HISTORY_MAX_DATES) {
    throw refuse('to', 'max');
  }
  return {
    status: 200,
    body: { days: await buildDaySummaries(ctx, from, to) },
  };
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/day',
    auth: 'user',
    handler: async ctx => ({ status: 200, body: await buildDay(ctx) }),
  },
  {
    method: 'POST',
    path: '/day/quests/:questCode/progress',
    auth: 'user',
    idempotent: true,
    handler: tick,
  },
  {
    method: 'POST',
    path: '/day/quests/:questCode/undo',
    auth: 'user',
    idempotent: true,
    handler: undo,
  },
  {
    method: 'POST',
    path: '/day/bedtime',
    auth: 'user',
    idempotent: true,
    handler: bedtime,
  },
  { method: 'GET', path: '/day/history', auth: 'user', handler: history },
  {
    method: 'GET',
    path: '/day/history/:date',
    auth: 'user',
    handler: async ctx => ({
      status: 200,
      body: await buildDayDetail(ctx, dateOf(ctx.params.date, 'date')),
    }),
  },
];

export default routes;
