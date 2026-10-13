import type { DayState } from '../../../domain/contract/core.ts';
import type { PendingAction } from '../../shared/storage/pendingActions';
import { WATER } from '../quests/api';

/** A day with this device's unsent records laid over it; `pending` says what was laid over. */
export type PendingDay = DayState & {
  pending: {
    /** Per quest code: how many of the shown ticks the server has not confirmed. */
    ticks: Record<string, number>;
    /** `bedtimeMarkedAt` is this device's mark, not yet the server's. */
    bedtime: boolean;
    /** How much of `caloriesIn` comes from manual logs still waiting. */
    kcal: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the screens show while records wait in the queue (`usePendingActions`): each waiting tick fills its quest up
 * to the target, a waiting bedtime mark counts as marked, waiting manual kcal are added. Nothing the server grants
 * is added: no completion, no XP, no coins, no streak. Only records made inside this logical day count.
 * A planned-meal log (`{ mealSlot }`) carries no kcal, so it changes nothing here.
 */
export function applyPending(day: DayState, pending: readonly PendingAction[]): PendingDay {
  const closes = Date.parse(day.closesAt);
  const waiting: Record<string, number> = {};
  let bedtimeAt: string | null = null;
  let kcal = 0;
  for (const { path, body, createdAt } of pending) {
    const at = Date.parse(createdAt);
    // ponytail: the logical day is taken as the 24 h before `closesAt`, an hour off on a daylight-saving change day;
    // map `createdAt` with domain/logicalDate and the user's zone if that hour ever matters.
    if (!(at >= closes - DAY_MS && at < closes)) continue;
    const [, area, group, code, verb, extra] = path.split('/');
    if (area === 'day' && group === 'quests' && verb === 'progress' && extra === undefined) waiting[code] = (waiting[code] ?? 0) + 1;
    else if (path === '/day/bedtime') bedtimeAt ??= createdAt;
    else if (path === '/nutrition/log' && typeof body.kcal === 'number') kcal += body.kcal;
  }

  const ticks: Record<string, number> = {};
  let waterMl = day.waterMl;
  const quests = day.quests.map(quest => {
    const added = Math.min(waiting[quest.code] ?? 0, Math.max(0, quest.targetCount - quest.progress));
    if (!added) return quest;
    ticks[quest.code] = added;
    const progress = quest.progress + added;
    // AR-12: the server's own rule for water in ml.
    if (quest.code === WATER) waterMl = Math.round((day.waterTargetMl * progress) / quest.targetCount);
    return { ...quest, progress };
  });
  const bedtime = day.bedtimeMarkedAt === null && bedtimeAt !== null;
  return {
    ...day,
    quests,
    waterMl,
    caloriesIn: day.caloriesIn + kcal,
    bedtimeMarkedAt: day.bedtimeMarkedAt ?? bedtimeAt,
    pending: { ticks, bedtime, kcal },
  };
}
