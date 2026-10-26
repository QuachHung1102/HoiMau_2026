import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PET_STAGES, petMood, petProgress } from './pet.ts';

test('PET_STAGES are the D-07 sizes, MYTHIC terminal', () => {
  assert.deepEqual(PET_STAGES, [
    { stage: 'EGG', sizeXp: 300 },
    { stage: 'HATCHLING', sizeXp: 1200 },
    { stage: 'JUVENILE', sizeXp: 4000 },
    { stage: 'ADULT', sizeXp: 12000 },
    { stage: 'MYTHIC', sizeXp: null },
  ]);
});

// Expected values: output of an independent throwaway script (cumulative boundaries, BigInt percent).
test('petProgress at and around every stage boundary', () => {
  // prettier-ignore
  const cases: [number, ReturnType<typeof petProgress>][] = [
    [0, { stage: 'EGG', stageIndex: 0, growthPercent: 0, nextStage: 'HATCHLING' }],
    [2, { stage: 'EGG', stageIndex: 0, growthPercent: 0, nextStage: 'HATCHLING' }],
    [3, { stage: 'EGG', stageIndex: 0, growthPercent: 1, nextStage: 'HATCHLING' }],
    [299, { stage: 'EGG', stageIndex: 0, growthPercent: 99, nextStage: 'HATCHLING' }],
    [300, { stage: 'HATCHLING', stageIndex: 1, growthPercent: 0, nextStage: 'JUVENILE' }],
    [300 + 1200 - 1, { stage: 'HATCHLING', stageIndex: 1, growthPercent: 99, nextStage: 'JUVENILE' }],
    [300 + 1200, { stage: 'JUVENILE', stageIndex: 2, growthPercent: 0, nextStage: 'ADULT' }],
    [5499, { stage: 'JUVENILE', stageIndex: 2, growthPercent: 99, nextStage: 'ADULT' }],
    [5500, { stage: 'ADULT', stageIndex: 3, growthPercent: 0, nextStage: 'MYTHIC' }],
    [17499, { stage: 'ADULT', stageIndex: 3, growthPercent: 99, nextStage: 'MYTHIC' }],
    [300 + 1200 + 4000 + 12000, { stage: 'MYTHIC', stageIndex: 4, growthPercent: 100, nextStage: null }],
    [10_000_000, { stage: 'MYTHIC', stageIndex: 4, growthPercent: 100, nextStage: null }],
  ];
  for (const [xp, expected] of cases) {
    assert.deepEqual(petProgress(xp), expected, `xp ${xp}`);
  }
});

test('petProgress treats negative XP as 0', () => {
  assert.deepEqual(petProgress(-1), petProgress(0));
});

test('growthPercent is always an integer 0–100 and the stage never goes back', () => {
  let previousIndex = 0;
  for (let xp = 0; xp <= 18000; xp++) {
    const { growthPercent, stageIndex } = petProgress(xp);
    assert.ok(Number.isInteger(growthPercent), `xp ${xp}`);
    assert.ok(growthPercent >= 0 && growthPercent <= 100, `xp ${xp}`);
    assert.ok(stageIndex >= previousIndex, `xp ${xp}`);
    previousIndex = stageIndex;
  }
});

test('petMood: three missed days in a row win over everything', () => {
  assert.equal(
    petMood({ streakCurrent: 9, lastOutcome: 'COMPLETED', missedRun: 3 }),
    'TIRED',
  );
  assert.equal(
    petMood({ streakCurrent: 0, lastOutcome: 'MISSED', missedRun: 4 }),
    'TIRED',
  );
});

test('petMood: HAPPY needs streak ≥ 3 and a completed last day', () => {
  // prettier-ignore
  const cases: [Parameters<typeof petMood>[0], string][] = [
    [{ streakCurrent: 3, lastOutcome: 'COMPLETED', missedRun: 0 }, 'HAPPY'],
    [{ streakCurrent: 3, lastOutcome: 'FROZEN', missedRun: 0 }, 'NEUTRAL'],
    [{ streakCurrent: 2, lastOutcome: 'COMPLETED', missedRun: 0 }, 'NEUTRAL'],
    [{ streakCurrent: 0, lastOutcome: 'MISSED', missedRun: 2 }, 'NEUTRAL'],
    [{ streakCurrent: 0, lastOutcome: null, missedRun: 0 }, 'NEUTRAL'],
  ];
  for (const [input, mood] of cases) {
    assert.equal(petMood(input), mood, JSON.stringify(input));
  }
});
