export type StatInput = {
  waterMl: number;
  waterTargetMl: number;
  bedtimeMarked: boolean;
  streakCurrent: number;
  caloriesIn: number;
  calorieTarget: number;
  resistanceMinutes7d: number;
  /** CARDIO + HIIT minutes. */
  cardioMinutes7d: number;
};

/** Integers 0–100. */
export type Stats = { hp: number; en: number; str: number; spd: number };

/** value / cap limited to 0–1; a missing (zero) cap counts as nothing done instead of NaN. */
const ratio = (value: number, cap: number) =>
  cap > 0 ? Math.min(Math.max(value / cap, 0), 1) : 0;

/** The four read-only character stats (F-03). */
export function mapStats(input: StatInput): Stats {
  const { caloriesIn, calorieTarget } = input;
  const hp =
    40 * ratio(input.waterMl, input.waterTargetMl) +
    (input.bedtimeMarked ? 40 : 0) +
    20 * ratio(input.streakCurrent, 7);
  // 100 − the distance from the target in percent; no target yet counts as 0.
  const en =
    calorieTarget > 0
      ? 100 - (Math.abs(caloriesIn - calorieTarget) / calorieTarget) * 100
      : 0;
  return {
    hp: Math.round(hp),
    en: Math.round(Math.min(Math.max(en, 0), 100)),
    str: Math.round(100 * ratio(input.resistanceMinutes7d, 150)),
    spd: Math.round(100 * ratio(input.cardioMinutes7d, 150)),
  };
}
