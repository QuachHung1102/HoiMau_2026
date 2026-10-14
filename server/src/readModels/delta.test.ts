// buildDelta and logGrants: no database. The thresholds come from the domain.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PET_STAGES } from '../../../domain/pet.ts';
import { cumulativeXpForLevel } from '../../../domain/progression.ts';
import type { LedgerEntry } from '../log.ts';
import { buildDelta, logGrants } from './delta.ts';
import type { Grant } from './delta.ts';

/** A grant of `xp` and `coin` on top of `from` XP, with the high-water mark at `mark` before it. */
const grant = (from: number, xp: number, coin: number, mark = from): Grant => ({
  xpBefore: from,
  xpAfter: from + xp,
  coinBefore: 100,
  coinAfter: 100 + coin,
  highWaterBefore: mark,
  highWaterAfter: Math.max(mark, from + xp),
  applied: xp !== 0 || coin !== 0,
  reason: 'QUEST_TICK',
  ref: 'ref-1',
});

test('the sums of the grants, signed, and the events of the route in front', () => {
  assert.deepEqual(buildDelta([], []), { xp: 0, coin: 0, events: [] });
  assert.deepEqual(buildDelta([grant(0, 10, 5), grant(10, 30, 15)], [{ type: 'STORY_ALL_DONE' }]), {
    xp: 40,
    coin: 20,
    events: [{ type: 'STORY_ALL_DONE' }],
  });
  assert.deepEqual(buildDelta([grant(40, -10, -5)], []), { xp: -10, coin: -5, events: [] });
  // a grant of nothing (a repeat): nothing changed
  assert.deepEqual(buildDelta([grant(40, 0, 0)], []), { xp: 0, coin: 0, events: [] });
});

test('LEVEL_UP once, to the level reached, with one perk point per level crossed', () => {
  const two = cumulativeXpForLevel(2);
  const four = cumulativeXpForLevel(4);
  assert.deepEqual(buildDelta([grant(two - 10, 10, 0)], []).events, [
    { type: 'LEVEL_UP', level: 2, titleKey: 'TAN_BINH', perkPointsGained: 1 },
  ]);
  assert.deepEqual(buildDelta([grant(two - 10, 9, 0)], []).events, []);
  // three levels in one grant (which also hatches the egg: the level event comes first)
  assert.deepEqual(buildDelta([grant(two - 10, four - two + 10, 0)], []).events, [
    { type: 'LEVEL_UP', level: 4, titleKey: 'TAN_BINH', perkPointsGained: 3 },
    { type: 'PET_STAGE_UP', stage: 'HATCHLING' },
  ]);
  // two grants of one request that cross the level together: one event
  assert.deepEqual(buildDelta([grant(two - 10, 5, 0), grant(two - 5, 5, 0)], []).events, [
    { type: 'LEVEL_UP', level: 2, titleKey: 'TAN_BINH', perkPointsGained: 1 },
  ]);
  const five = cumulativeXpForLevel(5);
  assert.deepEqual(buildDelta([grant(five - 1, 1, 0)], [{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }]).events, [
    { type: 'QUEST_COMPLETED', questCode: 'WATER_8' },
    { type: 'LEVEL_UP', level: 5, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 },
  ]);
});

test('the events follow the high-water mark, not the sum: nothing after an undo, nothing when the level is reached again', () => {
  const two = cumulativeXpForLevel(2);
  // the undo takes the sum below the level; the mark stays
  assert.deepEqual(buildDelta([grant(two, -10, -5, two)], []).events, []);
  // the tick after it reaches the level again, under a mark that was there already
  assert.deepEqual(buildDelta([grant(two - 10, 10, 5, two)], []).events, []);
});

test('PET_STAGE_UP when the mark completes a stage', () => {
  const egg = PET_STAGES[0].sizeXp as number;
  assert.deepEqual(
    buildDelta([grant(egg - 10, 10, 0)], []).events.filter(event => event.type === 'PET_STAGE_UP'),
    [{ type: 'PET_STAGE_UP', stage: 'HATCHLING' }],
  );
  assert.deepEqual(
    buildDelta([grant(egg - 10, 9, 0)], []).events.filter(event => event.type === 'PET_STAGE_UP'),
    [],
  );
});

test('logGrants writes one ledger line per row a grant wrote, and none for an amount of zero', () => {
  const lines: LedgerEntry[] = [];
  const ctx = { userId: 'user-1', log: { line() {}, ledger: (entry: LedgerEntry) => lines.push(entry) } };
  logGrants(ctx, [grant(0, 10, 5), grant(10, 0, 0), { ...grant(10, -10, 0), reason: 'QUEST_TICK_UNDO' }]);
  assert.deepEqual(lines, [
    { kind: 'xp', userId: 'user-1', amount: 10, reason: 'QUEST_TICK', refId: 'ref-1' },
    { kind: 'coin', userId: 'user-1', amount: 5, reason: 'QUEST_TICK', refId: 'ref-1' },
    { kind: 'xp', userId: 'user-1', amount: -10, reason: 'QUEST_TICK_UNDO', refId: 'ref-1' },
  ]);
});
