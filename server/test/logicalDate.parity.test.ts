// The SQL helpers and the TypeScript domain must agree on every boundary the domain is tested on.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  isValidTimeZone,
  localParts,
  logicalDateOf,
  weekStartOf,
} from '../../domain/logicalDate.ts';
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

// A fixed list of IANA Area/City names: every offset family, both hemispheres' DST rules,
// the 30- and 45-minute zones, both sides of the date line.
const ZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Tehran',
  'Asia/Dubai',
  'Australia/Sydney',
  'Australia/Adelaide',
  'Australia/Lord_Howe',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Apia',
  'Pacific/Kiritimati',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Sao_Paulo',
  'America/St_Johns',
];

test('the wall clock and the logical date agree in every listed zone across 2026', async () => {
  for (const zone of ZONES) {
    assert.match(zone, /^[A-Za-z]+\/[A-Za-z_]+$/);
  }
  // Every 18 hours: the wall clock is compared at each instant, so a zone whose offset or DST
  // dates differ between PostgreSQL and Intl shows up whatever the hour of the sample.
  const instants: number[] = [];
  for (
    let ms = Date.UTC(2026, 0, 1);
    ms < Date.UTC(2027, 0, 1);
    ms += 18 * 3_600_000
  ) {
    instants.push(ms);
  }
  const { rows } = await asAnon(db.app, c =>
    c.query(
      `SELECT z.zone,
              array_agg(to_char(i.ts AT TIME ZONE z.zone, 'YYYY-MM-DD HH24:MI') || ' ' ||
                        app.logical_date(i.ts, z.zone)::text ORDER BY i.n) AS seen
         FROM unnest($1::text[]) AS z (zone)
        CROSS JOIN unnest($2::timestamptz[]) WITH ORDINALITY AS i (ts, n)
        GROUP BY z.zone`,
      [ZONES, instants.map(ms => new Date(ms).toISOString())],
    ),
  );
  const two = (n: number) => String(n).padStart(2, '0');
  const mismatches: string[] = [];
  let compared = 0;
  for (const { zone, seen } of rows as { zone: string; seen: string[] }[]) {
    instants.forEach((ms, i) => {
      const { date, hour, minute } = localParts(ms, zone);
      const expected = `${date} ${two(hour)}:${two(minute)} ${logicalDateOf(
        ms,
        zone,
      )}`;
      compared++;
      if (seen[i] !== expected) {
        mismatches.push(
          `${zone} ${new Date(ms).toISOString()}: sql ${
            seen[i]
          }, domain ${expected}`,
        );
      }
    });
  }
  assert.equal(compared, ZONES.length * instants.length);
  assert.deepEqual(mismatches.slice(0, 5), []);
});

// Not a bug to fix here. An offset or an abbreviation is not a zone name, and the two sides
// read them differently: PostgreSQL takes '+07:00' as a POSIX zone, seven hours WEST of
// Greenwich, where Intl takes it as UTC+7. users.timezone may therefore only ever hold an
// IANA Area/City name that both sides know; that is enforced where the column is written.
test('an offset spelling means opposite things to PostgreSQL and to the domain', async () => {
  const instant = '2026-09-09T22:00:00Z';
  const sql = async (zone: string): Promise<string> =>
    (
      await asAnon(db.app, c =>
        c.query('SELECT app.logical_date($1::timestamptz, $2)::text AS label', [
          instant,
          zone,
        ]),
      )
    ).rows[0].label;
  const domain = (zone: string) => logicalDateOf(Date.parse(instant), zone);

  // both sides agree on the two real zones, seven hours either side of Greenwich
  const east = domain('Asia/Ho_Chi_Minh');
  const west = domain('America/Phoenix');
  assert.equal(await sql('Asia/Ho_Chi_Minh'), east);
  assert.equal(await sql('America/Phoenix'), west);
  assert.notEqual(east, west);

  assert.equal(domain('+07:00'), east);
  assert.equal(await sql('+07:00'), west);

  // spellings only PostgreSQL accepts, each with its own reading
  for (const [zone, label] of [
    ['ICT', east],
    ['UTC+7', west],
  ]) {
    assert.equal(isValidTimeZone(zone), false);
    assert.throws(() => domain(zone), RangeError);
    assert.equal(await sql(zone), label);
  }
});
