import type { DayState } from '../../../domain/contract/core.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The day that is open at `now`, built from a day that is over, for when the server cannot be asked: the same quests
 * and targets with nothing done, closing at the next close after `now`. It exists so that the first record of a
 * morning without a network can be made and shown as waiting (`applyPending` lays it over this like over any day).
 * It is a guess, never the server's word: never cache it, never show a reward or a streak from it.
 * ponytail: a logical day is taken as 24 h, as in `applyPending`.
 */
export function provisionalDay(kept: DayState, now: number): DayState {
  const days = Math.max(0, Math.floor((now - Date.parse(kept.closesAt)) / DAY_MS) + 1);
  return {
    ...kept,
    logicalDate: new Date(Date.parse(`${kept.logicalDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10),
    serverTime: new Date(now).toISOString(),
    closesAt: new Date(Date.parse(kept.closesAt) + days * DAY_MS).toISOString(),
    caloriesIn: 0,
    waterMl: 0,
    bedtimeMarkedAt: null,
    quests: kept.quests.map(quest => ({ ...quest, progress: 0, completed: false, lastTick: null })),
    story: { ...kept.story, done: 0 },
    celebrations: [],
  };
}
