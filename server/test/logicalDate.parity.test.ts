// The SQL helpers and the TypeScript domain must agree on every boundary the domain is tested on.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { logicalDateOf, weekStartOf } from '../../domain/logicalDate.ts';
import { asAnon } from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(() => db.drop());

/** Every 30 real minutes from `fromIso`, `count` instants. */
const halfHours = (fromIso: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(fromIso) + i * 1_800_000).toISOString(),
  );

// The zones and instants of domain/logicalDate.test.ts.
const CASES: [zone: string, instants: string[]][] = [
  [
    'Asia/Ho_Chi_Minh',
    [
      '2026-09-09T18:30:00Z', // 01:30 on the 10th belongs to the 9th (spec 6.1)
      '2026-09-09T17:00:00Z',
      '2026-12-31T17:30:00Z',
      '2026-09-09T19:59:59Z',
      '2026-09-09T20:00:00Z',
    ],
  ],
  ['Asia/Kathmandu', ['2026-09-09T21:14:59Z', '2026-09-09T21:15:00Z']],
  ['Pacific/Apia', ['2026-09-09T13:59:59Z', '2026-09-09T14:00:00Z']],
  [
    'Australia/Lord_Howe',
    [
      '2026-09-09T16:29:59Z',
      '2026-09-09T16:30:00Z',
      '2026-01-14T15:59:59Z',
      '2026-01-14T16:00:00Z',
    ],
  ],
  // 00:00 to 05:00 local on the four DST change days
  ['America/New_York', halfHours('2026-03-08T05:00:00Z', 9)],
  ['America/New_York', halfHours('2026-11-01T04:00:00Z', 13)],
  ['Europe/Berlin', halfHours('2026-03-28T23:00:00Z', 9)],
  ['Europe/Berlin', halfHours('2026-10-24T22:00:00Z', 13)],
];

test('app.logical_date equals logicalDateOf', async () => {
  const pairs = CASES.flatMap(([zone, instants]) =>
    instants.map(instant => ({ zone, instant })),
  );
  const { rows } = await asAnon(db.app, c =>
    c.query(
      `SELECT app.logical_date(instant::timestamptz, zone)::text AS label
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(zone, instant, n)
        ORDER BY n`,
      [pairs.map(pair => pair.zone), pairs.map(pair => pair.instant)],
    ),
  );
  assert.deepEqual(
    rows.map((row, i) => ({ ...pairs[i], label: row.label })),
    pairs.map(pair => ({
      ...pair,
      label: logicalDateOf(Date.parse(pair.instant), pair.zone),
    })),
  );
});

test('app.week_start equals weekStartOf', async () => {
  // the four dates of the domain test, then every day of two weeks around a year end
  const dates = ['2026-09-07', '2026-09-13', '2027-01-01', '2028-02-29'].concat(
    Array.from({ length: 14 }, (_, i) =>
      new Date(Date.UTC(2026, 11, 25 + i)).toISOString().slice(0, 10),
    ),
  );
  const { rows } = await asAnon(db.app, c =>
    c.query(
      `SELECT app.week_start(d::date)::text AS monday
         FROM unnest($1::text[]) WITH ORDINALITY AS t(d, n) ORDER BY n`,
      [dates],
    ),
  );
  assert.deepEqual(
    rows.map((row, i) => [dates[i], row.monday]),
    dates.map(date => [date, weekStartOf(date)]),
  );
});
