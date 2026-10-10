export const MAX_SEEDED_LEVEL = 200;

/** XP needed to go from `level` to `level + 1` (F-07). */
export function xpRequiredForLevel(level: number): number {
  return Math.round(100 * level ** 1.5);
}

/** Total XP at which `level` starts; level 1 → 0. */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let below = 1; below < level; below++) {
    total += xpRequiredForLevel(below);
  }
  return total;
}

/**
 * Inverse of cumulativeXpForLevel; negative XP counts as 0. `xpForNextLevel` is the size of the
 * current level, so `xpIntoLevel / xpForNextLevel` is the progress toward the next one.
 */
export function levelForXp(totalXp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
} {
  // ponytail: linear walk, O(level) and not capped at MAX_SEEDED_LEVEL (~22.5 M XP);
  // binary search over a precomputed table if this ever shows in a profile.
  let level = 1;
  let xpIntoLevel = Math.max(totalXp, 0);
  let xpForNextLevel = xpRequiredForLevel(level);
  while (xpIntoLevel >= xpForNextLevel) {
    xpIntoLevel -= xpForNextLevel;
    level += 1;
    xpForNextLevel = xpRequiredForLevel(level);
  }
  return { level, xpIntoLevel, xpForNextLevel };
}

export type TitleKey =
  | 'TAN_BINH'
  | 'NGUOI_KIEN_TRI'
  | 'CHIEN_BINH_KY_LUAT'
  | 'KIEN_TUONG'
  | 'HUYEN_THOAI_THE_HINH';

export function titleKeyForLevel(level: number): TitleKey {
  if (level >= 35) {
    return 'HUYEN_THOAI_THE_HINH';
  }
  if (level >= 20) {
    return 'KIEN_TUONG';
  }
  if (level >= 10) {
    return 'CHIEN_BINH_KY_LUAT';
  }
  return level >= 5 ? 'NGUOI_KIEN_TRI' : 'TAN_BINH';
}

/** One perk point per level-up, counted on the XP high-water mark so it is never revoked. */
export function perkPointsEarned(xpHighWater: number): number {
  return levelForXp(xpHighWater).level - 1;
}
