// What a write tells the client it changed: the `Delta` of an `ActionResult`, made from the
// results of app._grant that the SQL functions hand back, and the ledger lines of those grants.
import type { Delta, GameEvent } from '../../../domain/contract/common.ts';
import { petProgress } from '../../../domain/pet.ts';
import { levelForXp, titleKeyForLevel } from '../../../domain/progression.ts';
import type { Ctx } from '../app.ts';

/**
 * The result of `app._grant`, with the `reason` and `ref` it was called with (the functions of
 * 30-day.sql add both). The ledger rows the call wrote are `xpAfter - xpBefore` XP and
 * `coinAfter - coinBefore` coins under that reason and ref; none when `applied` is false.
 */
export type Grant = {
  xpBefore: number;
  xpAfter: number;
  coinBefore: number;
  coinAfter: number;
  highWaterBefore: number;
  highWaterAfter: number;
  applied: boolean;
  reason: string;
  ref: string;
};

/**
 * The signed sums of the grants, then `events` (what the route knows: a quest completed, the
 * story all done), then what the XP high-water mark crossed between the lowest mark before and
 * the highest after: `LEVEL_UP` (once, to the level reached) and `PET_STAGE_UP`. An undo lowers
 * the sums and never the mark, so neither event is repeated after one.
 */
export function buildDelta(grants: Grant[], events: GameEvent[]): Delta {
  const delta: Delta = {
    xp: grants.reduce((sum, g) => sum + g.xpAfter - g.xpBefore, 0),
    coin: grants.reduce((sum, g) => sum + g.coinAfter - g.coinBefore, 0),
    events: [...events],
  };
  if (grants.length > 0) {
    const before = Math.min(...grants.map(g => g.highWaterBefore));
    const after = Math.max(...grants.map(g => g.highWaterAfter));
    const from = levelForXp(before).level;
    const level = levelForXp(after).level;
    if (level > from) {
      delta.events.push({
        type: 'LEVEL_UP',
        level,
        titleKey: titleKeyForLevel(level),
        perkPointsGained: level - from,
      });
    }
    const { stage } = petProgress(after);
    if (stage !== petProgress(before).stage) {
      delta.events.push({ type: 'PET_STAGE_UP', stage });
    }
  }
  return delta;
}

/** One `log.ledger` line for every ledger row the grants wrote. */
export function logGrants(
  { log, userId }: Pick<Ctx, 'log' | 'userId'>,
  grants: Grant[],
): void {
  for (const g of grants) {
    const rows = [
      ['xp', g.xpAfter - g.xpBefore],
      ['coin', g.coinAfter - g.coinBefore],
    ] as const;
    for (const [kind, amount] of rows) {
      if (amount !== 0) {
        log.ledger({
          kind,
          userId: userId as string,
          amount,
          reason: g.reason,
          refId: g.ref,
        });
      }
    }
  }
}
