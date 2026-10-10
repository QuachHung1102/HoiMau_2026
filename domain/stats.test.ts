import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StatInput, Stats } from './stats.ts';
import { mapStats } from './stats.ts';

// Nothing logged, real targets.
const idle: StatInput = {
  waterMl: 0,
  waterTargetMl: 2500,
  bedtimeMarked: false,
  streakCurrent: 0,
  caloriesIn: 0,
  calorieTarget: 2000,
  resistanceMinutes7d: 0,
  cardioMinutes7d: 0,
};
const none: Stats = { hp: 0, en: 0, str: 0, spd: 0 };

// Expected values: output of an independent throwaway implementation of the spec table (F-03).
// prettier-ignore
const CASES: [string, StatInput, Stats][] = [
  ['all zeros, targets included', { ...idle, waterTargetMl: 0, calorieTarget: 0 }, none],
  ['nothing logged', idle, none],
  [
    'every input at its cap',
    { waterMl: 2500, waterTargetMl: 2500, bedtimeMarked: true, streakCurrent: 7, caloriesIn: 2000, calorieTarget: 2000, resistanceMinutes7d: 150, cardioMinutes7d: 150 },
    { hp: 100, en: 100, str: 100, spd: 100 },
  ],
  ['water above target: ratio capped at 1', { ...idle, waterMl: 4000 }, { ...none, hp: 40 }],
  ['water at half the target', { ...idle, waterMl: 1250 }, { ...none, hp: 20 }],
  ['bedtime marked', { ...idle, bedtimeMarked: true }, { ...none, hp: 40 }],
  ['calories at target', { ...idle, caloriesIn: 2000 }, { ...none, en: 100 }],
  ['calories 10 % under', { ...idle, caloriesIn: 1800 }, { ...none, en: 90 }],
  ['calories 10 % over', { ...idle, caloriesIn: 2200 }, { ...none, en: 90 }],
  ['calories 100 % off', { ...idle, caloriesIn: 4000 }, none],
  ['calories 250 % off: clamped to 0', { ...idle, caloriesIn: 7000 }, none],
  ['calories 1 kcal off rounds to 100', { ...idle, caloriesIn: 2000, calorieTarget: 1999 }, { ...none, en: 100 }],
  ['calories 0.5 % off: the half rounds up', { ...idle, caloriesIn: 1990 }, { ...none, en: 100 }],
  ['water at 1/80 of the target: the half rounds up', { ...idle, waterMl: 25, waterTargetMl: 2000 }, { ...none, hp: 1 }],
  ['negative amounts count as 0', { ...idle, waterMl: -100, streakCurrent: -1, resistanceMinutes7d: -5, cardioMinutes7d: -5 }, none],
  ['streak 3', { ...idle, streakCurrent: 3 }, { ...none, hp: 9 }],
  ['streak 7', { ...idle, streakCurrent: 7 }, { ...none, hp: 20 }],
  ['streak 30: ratio capped at 1', { ...idle, streakCurrent: 30 }, { ...none, hp: 20 }],
  ['minutes 75 and 150', { ...idle, resistanceMinutes7d: 75, cardioMinutes7d: 150 }, { ...none, str: 50, spd: 100 }],
  ['minutes 300 and 75', { ...idle, resistanceMinutes7d: 300, cardioMinutes7d: 75 }, { ...none, str: 100, spd: 50 }],
  ['minutes 1 and 149', { ...idle, resistanceMinutes7d: 1, cardioMinutes7d: 149 }, { ...none, str: 1, spd: 99 }],
];

for (const [name, input, expected] of CASES) {
  test(`mapStats: ${name}`, () => {
    assert.deepEqual(mapStats(input), expected);
  });
}
