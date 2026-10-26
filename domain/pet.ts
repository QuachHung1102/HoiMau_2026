import type { DayOutcome, PetMood, PetStage } from './types.ts';

/** One-way stages; `sizeXp` is the XP earned inside the stage that completes it (D-07). */
export const PET_STAGES: readonly { stage: PetStage; sizeXp: number | null }[] =
  [
    { stage: 'EGG', sizeXp: 300 },
    { stage: 'HATCHLING', sizeXp: 1200 },
    { stage: 'JUVENILE', sizeXp: 4000 },
    { stage: 'ADULT', sizeXp: 12000 },
    { stage: 'MYTHIC', sizeXp: null },
  ];

/** Stage and growth from the XP high-water mark, so the pet never goes back; negative counts as 0. */
export function petProgress(xpHighWater: number): {
  stage: PetStage;
  stageIndex: number;
  growthPercent: number;
  nextStage: PetStage | null;
} {
  let xpIntoStage = Math.max(xpHighWater, 0);
  let stageIndex = 0;
  let sizeXp = PET_STAGES[0].sizeXp;
  while (sizeXp !== null && xpIntoStage >= sizeXp) {
    xpIntoStage -= sizeXp;
    stageIndex += 1;
    sizeXp = PET_STAGES[stageIndex].sizeXp;
  }
  return {
    stage: PET_STAGES[stageIndex].stage,
    stageIndex,
    growthPercent:
      sizeXp === null ? 100 : Math.floor((100 * xpIntoStage) / sizeXp),
    nextStage: sizeXp === null ? null : PET_STAGES[stageIndex + 1].stage,
  };
}

/** TIRED is the floor: three missed days in a row win over everything (F-09). */
export function petMood(input: {
  streakCurrent: number;
  lastOutcome: DayOutcome | null;
  missedRun: number;
}): PetMood {
  if (input.missedRun >= 3) {
    return 'TIRED';
  }
  return input.streakCurrent >= 3 && input.lastOutcome === 'COMPLETED'
    ? 'HAPPY'
    : 'NEUTRAL';
}
