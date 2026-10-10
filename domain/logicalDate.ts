import type { DateLabel } from './types.ts';

export const DAY_START_HOUR = 3;
export const RESCUE_DEADLINE_HOUR = 15;

const DAY_MS = 86400000;

const toMs = (date: DateLabel) => Date.parse(`${date}T00:00:00Z`);
const toLabel = (ms: number): DateLabel =>
  new Date(ms).toISOString().slice(0, 10);
/** 1 = Monday … 7 = Sunday */
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const weekdayOf = (date: DateLabel) =>
  (((new Date(toMs(date)).getUTCDay() + 6) % 7) + 1) as Weekday;

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string') {
    return false;
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall clock of `timeZone` at the instant. Throws RangeError on an unknown zone. */
export function localParts(
  instantMs: number,
  timeZone: string,
): { date: DateLabel; hour: number; minute: number; weekday: Weekday } {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instantMs)) {
    parts[part.type] = part.value;
  }
  const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
  return {
    date,
    hour: Number(parts.hour) % 24, // some engines print midnight as 24
    minute: Number(parts.minute),
    weekday: weekdayOf(date),
  };
}

/** The logical day runs 03:00 → 02:59:59 on the zone's wall clock (spec 6.1). */
export function logicalDateOf(instantMs: number, timeZone: string): DateLabel {
  const { date, hour } = localParts(instantMs, timeZone);
  return hour < DAY_START_HOUR ? addDays(date, -1) : date;
}

export function addDays(date: DateLabel, days: number): DateLabel {
  return toLabel(toMs(date) + days * DAY_MS);
}

/** to − from */
export function daysBetween(from: DateLabel, to: DateLabel): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/** Monday of that week */
export function weekStartOf(date: DateLabel): DateLabel {
  return addDays(date, 1 - weekdayOf(date));
}

/** `yesterday` can still be rescued only while the local hour is in [3, 15). */
export function ticketEligibleDates(
  nowMs: number,
  timeZone: string,
): { today: DateLabel; yesterday: DateLabel | null } {
  const { hour } = localParts(nowMs, timeZone);
  const today = logicalDateOf(nowMs, timeZone);
  const open = hour >= DAY_START_HOUR && hour < RESCUE_DEADLINE_HOUR;
  return { today, yesterday: open ? addDays(today, -1) : null };
}
