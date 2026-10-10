import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAY_START_HOUR,
  RESCUE_DEADLINE_HOUR,
  addDays,
  daysBetween,
  isValidTimeZone,
  localParts,
  logicalDateOf,
  ticketEligibleDates,
  weekStartOf,
} from './logicalDate.ts';

// Every expected value in this file comes from a throwaway oracle that uses fixed UTC offsets
// and civil-date arithmetic, never Intl time zones.
const at = (iso: string) => Date.parse(iso);

test('the day starts at 03:00 and a rescue ends at 15:00', () => {
  assert.equal(DAY_START_HOUR, 3);
  assert.equal(RESCUE_DEADLINE_HOUR, 15);
});

test('isValidTimeZone returns false instead of throwing', () => {
  assert.equal(isValidTimeZone('Asia/Ho_Chi_Minh'), true);
  assert.equal(isValidTimeZone('Australia/Lord_Howe'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(undefined as unknown as string), false);
});

test('localParts gives the wall clock of the zone', () => {
  assert.deepEqual(localParts(at('2026-09-09T18:30:00Z'), 'Asia/Ho_Chi_Minh'), {
    date: '2026-09-10',
    hour: 1,
    minute: 30,
    weekday: 4,
  });
  // local midnight is hour 0, never 24
  assert.deepEqual(localParts(at('2026-09-09T17:00:00Z'), 'Asia/Ho_Chi_Minh'), {
    date: '2026-09-10',
    hour: 0,
    minute: 0,
    weekday: 4,
  });
  assert.deepEqual(localParts(at('2026-09-09T12:00:00Z'), 'Asia/Kathmandu'), {
    date: '2026-09-09',
    hour: 17,
    minute: 45,
    weekday: 3,
  });
  assert.deepEqual(localParts(at('2026-12-31T17:30:00Z'), 'Asia/Ho_Chi_Minh'), {
    date: '2027-01-01',
    hour: 0,
    minute: 30,
    weekday: 5,
  });
});

test('localParts throws on an unknown zone', () => {
  assert.throws(() => localParts(0, 'Mars/Olympus_Mons'), RangeError);
});

test('logicalDateOf: 01:30 on 10/09 belongs to 09/09 (spec 6.1)', () => {
  assert.equal(
    logicalDateOf(at('2026-09-09T18:30:00Z'), 'Asia/Ho_Chi_Minh'),
    '2026-09-09',
  );
});

test('logicalDateOf: one second before and exactly at 03:00 local', () => {
  // prettier-ignore
  const pairs: [string, string, string, string, string][] = [
    ['Asia/Ho_Chi_Minh', '2026-09-09T19:59:59Z', '2026-09-09', '2026-09-09T20:00:00Z', '2026-09-10'],
    ['Asia/Kathmandu', '2026-09-09T21:14:59Z', '2026-09-09', '2026-09-09T21:15:00Z', '2026-09-10'],
    ['Pacific/Apia', '2026-09-09T13:59:59Z', '2026-09-09', '2026-09-09T14:00:00Z', '2026-09-10'],
    ['Australia/Lord_Howe', '2026-09-09T16:29:59Z', '2026-09-09', '2026-09-09T16:30:00Z', '2026-09-10'],
    ['Australia/Lord_Howe', '2026-01-14T15:59:59Z', '2026-01-14', '2026-01-14T16:00:00Z', '2026-01-15'],
  ];
  for (const [zone, before, beforeLabel, exact, exactLabel] of pairs) {
    assert.equal(
      logicalDateOf(at(before), zone),
      beforeLabel,
      `${zone} ${before}`,
    );
    assert.equal(
      logicalDateOf(at(exact), zone),
      exactLabel,
      `${zone} ${exact}`,
    );
  }
});

// Every 30 real minutes from 00:00 to 05:00 local on a DST change day: [instant, expected label].
const DST_DAYS: Record<string, [string, string][]> = {
  'America/New_York spring forward 2026-03-08': [
    ['2026-03-08T05:00:00Z', '2026-03-07'],
    ['2026-03-08T05:30:00Z', '2026-03-07'],
    ['2026-03-08T06:00:00Z', '2026-03-07'],
    ['2026-03-08T06:30:00Z', '2026-03-07'],
    ['2026-03-08T07:00:00Z', '2026-03-08'],
    ['2026-03-08T07:30:00Z', '2026-03-08'],
    ['2026-03-08T08:00:00Z', '2026-03-08'],
    ['2026-03-08T08:30:00Z', '2026-03-08'],
    ['2026-03-08T09:00:00Z', '2026-03-08'],
  ],
  'America/New_York fall back 2026-11-01': [
    ['2026-11-01T04:00:00Z', '2026-10-31'],
    ['2026-11-01T04:30:00Z', '2026-10-31'],
    ['2026-11-01T05:00:00Z', '2026-10-31'],
    ['2026-11-01T05:30:00Z', '2026-10-31'],
    ['2026-11-01T06:00:00Z', '2026-10-31'],
    ['2026-11-01T06:30:00Z', '2026-10-31'],
    ['2026-11-01T07:00:00Z', '2026-10-31'],
    ['2026-11-01T07:30:00Z', '2026-10-31'],
    ['2026-11-01T08:00:00Z', '2026-11-01'],
    ['2026-11-01T08:30:00Z', '2026-11-01'],
    ['2026-11-01T09:00:00Z', '2026-11-01'],
    ['2026-11-01T09:30:00Z', '2026-11-01'],
    ['2026-11-01T10:00:00Z', '2026-11-01'],
  ],
  'Europe/Berlin spring forward 2026-03-29': [
    ['2026-03-28T23:00:00Z', '2026-03-28'],
    ['2026-03-28T23:30:00Z', '2026-03-28'],
    ['2026-03-29T00:00:00Z', '2026-03-28'],
    ['2026-03-29T00:30:00Z', '2026-03-28'],
    ['2026-03-29T01:00:00Z', '2026-03-29'],
    ['2026-03-29T01:30:00Z', '2026-03-29'],
    ['2026-03-29T02:00:00Z', '2026-03-29'],
    ['2026-03-29T02:30:00Z', '2026-03-29'],
    ['2026-03-29T03:00:00Z', '2026-03-29'],
  ],
  'Europe/Berlin fall back 2026-10-25': [
    ['2026-10-24T22:00:00Z', '2026-10-24'],
    ['2026-10-24T22:30:00Z', '2026-10-24'],
    ['2026-10-24T23:00:00Z', '2026-10-24'],
    ['2026-10-24T23:30:00Z', '2026-10-24'],
    ['2026-10-25T00:00:00Z', '2026-10-24'],
    ['2026-10-25T00:30:00Z', '2026-10-24'],
    ['2026-10-25T01:00:00Z', '2026-10-24'],
    ['2026-10-25T01:30:00Z', '2026-10-24'],
    ['2026-10-25T02:00:00Z', '2026-10-25'],
    ['2026-10-25T02:30:00Z', '2026-10-25'],
    ['2026-10-25T03:00:00Z', '2026-10-25'],
    ['2026-10-25T03:30:00Z', '2026-10-25'],
    ['2026-10-25T04:00:00Z', '2026-10-25'],
  ],
};

for (const [name, rows] of Object.entries(DST_DAYS)) {
  test(`logicalDateOf follows the wall clock: ${name}`, () => {
    const zone = name.split(' ')[0];
    for (const [instant, expected] of rows) {
      assert.equal(logicalDateOf(at(instant), zone), expected, instant);
    }
  });
}

test('addDays crosses month ends, year ends and 29 February 2028', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-09-10', 0), '2026-09-10');
  assert.equal(addDays('2026-09-10', 365), '2027-09-10');
});

test('daysBetween is to minus from', () => {
  assert.equal(daysBetween('2026-01-31', '2026-02-01'), 1);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
  assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1);
  assert.equal(daysBetween('2028-03-01', '2028-02-28'), -2);
  assert.equal(daysBetween('2028-01-01', '2029-01-01'), 366);
  assert.equal(daysBetween('2026-09-10', '2026-09-10'), 0);
});

test('weekStartOf returns the Monday of the week', () => {
  assert.equal(weekStartOf('2026-09-07'), '2026-09-07'); // a Monday
  assert.equal(weekStartOf('2026-09-13'), '2026-09-07'); // a Sunday
  assert.equal(weekStartOf('2027-01-01'), '2026-12-28'); // week spans the year end
  assert.equal(weekStartOf('2028-02-29'), '2028-02-28');
});

test('ticketEligibleDates: yesterday only while the local hour is in [3, 15)', () => {
  const zone = 'Asia/Ho_Chi_Minh';
  const eligible = (iso: string) => ticketEligibleDates(at(iso), zone);
  assert.deepEqual(eligible('2026-09-09T19:59:59Z'), {
    today: '2026-09-09',
    yesterday: null,
  }); // 02:59:59
  assert.deepEqual(eligible('2026-09-09T20:00:00Z'), {
    today: '2026-09-10',
    yesterday: '2026-09-09',
  }); // 03:00
  assert.deepEqual(eligible('2026-09-10T07:59:59Z'), {
    today: '2026-09-10',
    yesterday: '2026-09-09',
  }); // 14:59:59
  assert.deepEqual(eligible('2026-09-10T08:00:00Z'), {
    today: '2026-09-10',
    yesterday: null,
  }); // 15:00
  assert.deepEqual(eligible('2026-09-10T16:00:00Z'), {
    today: '2026-09-10',
    yesterday: null,
  }); // 23:00
});
