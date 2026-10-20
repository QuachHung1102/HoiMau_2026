import { daysBetween, weekStartOf } from '../../../domain/logicalDate.ts';
import type { DateLabel } from '../../../domain/types.ts';
import * as vi from '../../shared/i18n/vi/journal';

const HOUR = 3_600_000;

/** Whole hours from the server's clock to the deadline, both of the same answer; never below 0 (a floor, so no more time is promised than there is). */
export const hoursLeft = (deadline: string, serverTime: string) => Math.max(0, Math.floor((Date.parse(deadline) - Date.parse(serverTime)) / HOUR));

/** "Thứ Năm, 24/9" for a date label. */
export const dateText = (date: DateLabel) => vi.dateWords(daysBetween(weekStartOf(date), date), Number(date.slice(8, 10)), Number(date.slice(5, 7)));

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Hôm nay", "Hôm qua", else "Thứ Năm, 24/9": the day of an instant on this device's calendar. */
export function dayWord(instant: string, now: Date = new Date()): string {
  const at = new Date(instant);
  if (sameDay(at, now)) return vi.todayWord;
  if (sameDay(at, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return vi.yesterdayWord;
  return vi.dateWords((at.getDay() + 6) % 7, at.getDate(), at.getMonth() + 1);
}
