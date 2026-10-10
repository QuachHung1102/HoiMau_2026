import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SEEDED_LEVEL,
  cumulativeXpForLevel,
  levelForXp,
  perkPointsEarned,
  titleKeyForLevel,
  xpRequiredForLevel,
} from './progression.ts';

test('MAX_SEEDED_LEVEL is 200', () => {
  assert.equal(MAX_SEEDED_LEVEL, 200);
});

test('xpRequiredForLevel matches the spec table (F-07)', () => {
  assert.equal(xpRequiredForLevel(1), 100);
  assert.equal(xpRequiredForLevel(2), 283);
  assert.equal(xpRequiredForLevel(3), 520);
  assert.equal(xpRequiredForLevel(5), 1118);
  assert.equal(xpRequiredForLevel(10), 3162);
  assert.equal(xpRequiredForLevel(20), 8944);
});

// Expected values below: output of an independent throwaway script using exact integer arithmetic.
test('cumulativeXpForLevel is the running sum of the level sizes, level 1 → 0', () => {
  assert.equal(cumulativeXpForLevel(1), 0);
  assert.equal(cumulativeXpForLevel(2), 100);
  assert.equal(cumulativeXpForLevel(3), 383);
  assert.equal(cumulativeXpForLevel(5), 1703);
  assert.equal(cumulativeXpForLevel(10), 11106);
  assert.equal(cumulativeXpForLevel(MAX_SEEDED_LEVEL), 22486171);
});

test('levelForXp at and around the first thresholds', () => {
  // prettier-ignore
  const cases: [number, ReturnType<typeof levelForXp>][] = [
    [0, { level: 1, xpIntoLevel: 0, xpForNextLevel: 100 }],
    [99, { level: 1, xpIntoLevel: 99, xpForNextLevel: 100 }],
    [100, { level: 2, xpIntoLevel: 0, xpForNextLevel: 283 }],
    [100 + 283 - 1, { level: 2, xpIntoLevel: 282, xpForNextLevel: 283 }],
    [100 + 283, { level: 3, xpIntoLevel: 0, xpForNextLevel: 520 }],
    [22486170, { level: 199, xpIntoLevel: 280723, xpForNextLevel: 280724 }],
    [22486171, { level: 200, xpIntoLevel: 0, xpForNextLevel: 282843 }],
  ];
  for (const [xp, expected] of cases) {
    assert.deepEqual(levelForXp(xp), expected, `xp ${xp}`);
  }
});

test('levelForXp treats negative XP as 0', () => {
  assert.deepEqual(levelForXp(-5), levelForXp(0));
});

test('levelForXp inverts cumulativeXpForLevel for every seeded level', () => {
  for (let level = 1; level <= MAX_SEEDED_LEVEL; level++) {
    const start = cumulativeXpForLevel(level);
    assert.deepEqual(
      levelForXp(start),
      { level, xpIntoLevel: 0, xpForNextLevel: xpRequiredForLevel(level) },
      `start of level ${level}`,
    );
    if (level > 1) {
      assert.equal(levelForXp(start - 1).level, level - 1, `below ${level}`);
    }
  }
});

test('titleKeyForLevel changes at levels 5, 10, 20 and 35', () => {
  // prettier-ignore
  const cases: [number, string][] = [
    [1, 'TAN_BINH'], [4, 'TAN_BINH'],
    [5, 'NGUOI_KIEN_TRI'], [9, 'NGUOI_KIEN_TRI'],
    [10, 'CHIEN_BINH_KY_LUAT'], [19, 'CHIEN_BINH_KY_LUAT'],
    [20, 'KIEN_TUONG'], [34, 'KIEN_TUONG'],
    [35, 'HUYEN_THOAI_THE_HINH'], [200, 'HUYEN_THOAI_THE_HINH'],
  ];
  for (const [level, title] of cases) {
    assert.equal(titleKeyForLevel(level), title, `level ${level}`);
  }
});

test('perkPointsEarned is the level reached minus one', () => {
  assert.equal(perkPointsEarned(0), 0);
  assert.equal(perkPointsEarned(99), 0);
  assert.equal(perkPointsEarned(100), 1); // exactly at level 2
  assert.equal(perkPointsEarned(383), 2);
  assert.equal(perkPointsEarned(11106), 9); // start of level 10
});
