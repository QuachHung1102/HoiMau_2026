import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemberWeek } from './guild.ts';
import {
  GUILD_INACTIVE_DAYS,
  GUILD_MAX_MEMBERS,
  GUILD_MIN_ACTIVE,
  memberWeek,
  rankGuilds,
  scoreGuildWeek,
} from './guild.ts';

// Every expected number in this file comes from a throwaway oracle that walks the seven dates of
// the week one by one and never imports this module.
const MON = '2026-10-05';
const WED = '2026-10-07';
const SUN = '2026-10-11';
const OLD = '2026-09-01';
const WEEK = [
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
  '2026-10-11',
];

const day = (
  date: string,
  storyDone: number,
  storyTotal = 2,
  frozen = false,
) => ({
  date,
  storyDone,
  storyTotal,
  frozen,
});
const member = (
  userId: string,
  joinedDate: string,
  days: MemberWeek['days'],
): MemberWeek => ({ userId, joinedDate, days });

// prettier-ignore
const M = {
  fullWeek: member('fullWeek', OLD, WEEK.map(d => day(d, 2))),
  threeOfSeven: member('threeOfSeven', OLD, [day('2026-10-05', 1), day('2026-10-07', 1), day('2026-10-10', 1)]),
  frozenDay: member('frozenDay', OLD, WEEK.map(d => (d === '2026-10-08' ? day(d, 1, 2, true) : day(d, 2)))),
  joinedThursday: member('joinedThursday', '2026-10-08', [day('2026-10-05', 2), day('2026-10-06', 2), day('2026-10-08', 2), day('2026-10-09', 1)]),
  joinedNextMonday: member('joinedNextMonday', '2026-10-12', [day('2026-10-06', 2), day('2026-10-12', 2)]),
  logsBeforeJoin: member('logsBeforeJoin', '2026-10-08', [day('2026-10-05', 2), day('2026-10-06', 1)]),
  midWeek: member('midWeek', OLD, [day('2026-10-05', 2), day('2026-10-06', 1), day('2026-10-08', 2)]),
  onlyFriday: member('onlyFriday', OLD, [day('2026-10-09', 2)]),
  outsideWeek: member('outsideWeek', OLD, [day('2026-10-04', 2), day('2026-10-12', 2)]),
  zeroTotal: member('zeroTotal', OLD, [day('2026-10-05', 0, 0), day('2026-10-06', 2)]),
  joinedSunday: member('joinedSunday', SUN, [day(SUN, 1)]),
  noLogs: member('noLogs', OLD, []),
};

const near = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `expected ${expected}, got ${actual}`,
  );

// prettier-ignore
const MEMBER_CASES: [string, MemberWeek, string, ReturnType<typeof memberWeek>][] = [
  ['full week, all STORY done every day', M.fullWeek, SUN, { active: true, countedDays: 7, average: 1 }],
  ['log on 3 of 7 days with 1 of 2 quests each', M.threeOfSeven, SUN, { active: true, countedDays: 7, average: 0.21428571428571427 }],
  ['a frozen day counts 0', M.frozenDay, SUN, { active: true, countedDays: 7, average: 0.8571428571428571 }],
  ['joined on Thursday: averaged over Thursday–Sunday only', M.joinedThursday, SUN, { active: true, countedDays: 4, average: 0.375 }],
  ['joined after throughDate: nothing counted, not active', M.joinedNextMonday, SUN, { active: false, countedDays: 0, average: 0 }],
  ['joined after a mid-week throughDate: nothing counted, not active', M.joinedThursday, WED, { active: false, countedDays: 0, average: 0 }],
  ['logs only before the join date: active, average 0', M.logsBeforeJoin, SUN, { active: true, countedDays: 4, average: 0 }],
  ['mid-week throughDate ignores later logs', M.midWeek, WED, { active: true, countedDays: 3, average: 0.5 }],
  ['only log is after a mid-week throughDate: not active', M.onlyFriday, WED, { active: false, countedDays: 3, average: 0 }],
  ['logs of the neighbouring weeks are ignored', M.outsideWeek, SUN, { active: false, countedDays: 7, average: 0 }],
  ['a day with no STORY quest counts 0 instead of dividing by zero', M.zeroTotal, SUN, { active: true, countedDays: 7, average: 0.14285714285714285 }],
  ['joined on throughDate: one counted day', M.joinedSunday, SUN, { active: true, countedDays: 1, average: 0.5 }],
  ['no log at all: not active', M.noLogs, SUN, { active: false, countedDays: 7, average: 0 }],
];

for (const [name, input, through, expected] of MEMBER_CASES) {
  test(`memberWeek: ${name}`, () => {
    const actual = memberWeek(input, MON, through);
    assert.equal(actual.active, expected.active);
    assert.equal(actual.countedDays, expected.countedDays);
    near(actual.average, expected.average);
  });
}

test('guild limits are the spec values (F-11, D-08)', () => {
  assert.equal(GUILD_MIN_ACTIVE, 3);
  assert.equal(GUILD_MAX_MEMBERS, 8);
  assert.equal(GUILD_INACTIVE_DAYS, 14);
});

// member i logs on the first min(i, 7) days of the week with i % 3 of 2 STORY quests done
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map(i =>
  member(
    `m${i}`,
    OLD,
    WEEK.slice(0, Math.min(i, 7)).map(d => day(d, i % 3)),
  ),
);

// `k` half-weeks of STORY quests: full days first, then the remainder
const halves = (userId: string, k: number) =>
  member(
    userId,
    OLD,
    WEEK.map((d, i) => day(d, Math.min(2, Math.max(0, k - 2 * i)))),
  );

// prettier-ignore
const GUILD_CASES: [string, MemberWeek[], string, ReturnType<typeof scoreGuildWeek>][] = [
  ['3 active members: the mean of their averages', [M.fullWeek, M.threeOfSeven, M.joinedThursday], SUN, { avgCompletion: 0.529761905, activeMembers: 3, ranked: true }],
  ['2 active + 1 member without any log: unranked', [M.fullWeek, M.threeOfSeven, M.noLogs], SUN, { avgCompletion: 0.607142857, activeMembers: 2, ranked: false }],
  ['8 members', EIGHT, SUN, { avgCompletion: 0.357142857, activeMembers: 8, ranked: true }],
  ['empty guild', [], SUN, { avgCompletion: 0, activeMembers: 0, ranked: false }],
  ['a member who joined after throughDate is left out even with logs in the week', [M.fullWeek, M.threeOfSeven, M.joinedNextMonday], SUN, { avgCompletion: 0.607142857, activeMembers: 2, ranked: false }],
  ['mid-week throughDate', [M.fullWeek, M.threeOfSeven, M.midWeek], WED, { avgCompletion: 0.611111111, activeMembers: 3, ranked: true }],
  // Both are 5/42 exactly; the raw float means differ in the last bit (…905 against …903).
  ['equal exact means are equal numbers (a)', [halves('a1', 0), halves('a2', 0), halves('a3', 5)], SUN, { avgCompletion: 0.119047619, activeMembers: 3, ranked: true }],
  ['equal exact means are equal numbers (b)', [halves('b1', 0), halves('b2', 1), halves('b3', 4)], SUN, { avgCompletion: 0.119047619, activeMembers: 3, ranked: true }],
];

for (const [name, members, through, expected] of GUILD_CASES) {
  test(`scoreGuildWeek: ${name}`, () => {
    assert.deepEqual(scoreGuildWeek(members, MON, through), expected);
  });
}

// prettier-ignore
const ROWS = Object.freeze([
  { id: 'g1', avgCompletion: 0.5, activeMembers: 3, createdAt: '2026-09-01T00:00:00Z', ranked: true },
  { id: 'g2', avgCompletion: 0.9, activeMembers: 2, createdAt: '2026-08-01T00:00:00Z', ranked: false },
  { id: 'g3', avgCompletion: 0.5, activeMembers: 5, createdAt: '2026-09-15T00:00:00Z', ranked: true },
  { id: 'g4', avgCompletion: 0.75, activeMembers: 3, createdAt: '2026-09-20T00:00:00Z', ranked: true },
  { id: 'g5', avgCompletion: 0.5, activeMembers: 5, createdAt: '2026-09-10T00:00:00.500Z', ranked: true },
  { id: 'g6', avgCompletion: 0.5, activeMembers: 5, createdAt: '2026-09-10T00:00:00Z', ranked: true },
  { id: 'g7', avgCompletion: 0, activeMembers: 0, createdAt: '2026-07-01T00:00:00Z', ranked: false },
  { id: 'g8', avgCompletion: 1, activeMembers: 3, createdAt: '2026-10-01T00:00:00Z', ranked: true },
].map(row => Object.freeze(row))) as {
  id: string; avgCompletion: number; activeMembers: number; createdAt: string; ranked: boolean;
}[];

test('rankGuilds: avgCompletion desc, then activeMembers desc, then createdAt asc; unranked rows keep rank null', () => {
  assert.deepEqual(
    rankGuilds(ROWS).map(row => [row.id, row.rank]),
    [
      ['g8', 1],
      ['g4', 2],
      ['g6', 3], // 500 ms older than g5: createdAt is compared as an instant, not as text
      ['g5', 4],
      ['g3', 5],
      ['g1', 6],
      ['g2', null], // highest average, but not ranked
      ['g7', null],
    ],
  );
});

test('rankGuilds: ranks are 1…n without gaps or duplicates, whatever the input order', () => {
  const ranks = rankGuilds([...ROWS].reverse())
    .filter(row => row.ranked)
    .map(row => row.rank);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    rankGuilds([...ROWS].reverse()).map(row => row.id),
    ['g8', 'g4', 'g6', 'g5', 'g3', 'g1', 'g7', 'g2'],
  );
});

test('rankGuilds: keeps the other fields of a row and handles an empty board', () => {
  const [first] = rankGuilds([{ ...ROWS[0], name: 'Đội Sáng' }]);
  assert.deepEqual(first, { ...ROWS[0], name: 'Đội Sáng', rank: 1 });
  assert.deepEqual(rankGuilds([]), []);
});
