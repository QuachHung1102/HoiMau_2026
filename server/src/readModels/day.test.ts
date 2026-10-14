// logicalDayEnd: no database. The end of a logical day is judged by the domain's own
// logicalDateOf, one millisecond either side.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, logicalDateOf } from '../../../domain/logicalDate.ts';
import { logicalDayEnd } from './day.ts';

test('logicalDayEnd is 03:00 local as an instant where the zone has one such instant', () => {
  assert.equal(logicalDayEnd('2027-03-10', 'Asia/Ho_Chi_Minh'), Date.parse('2027-03-11T03:00:00+07:00'));
  assert.equal(logicalDayEnd('2027-03-10', 'UTC'), Date.parse('2027-03-11T03:00:00Z'));
  assert.equal(logicalDayEnd('2027-03-10', 'Pacific/Kiritimati'), Date.parse('2027-03-11T03:00:00+14:00'));
  assert.equal(logicalDayEnd('2027-03-10', 'Pacific/Pago_Pago'), Date.parse('2027-03-11T03:00:00-11:00'));
  assert.equal(logicalDayEnd('2027-03-10', 'Asia/Kathmandu'), Date.parse('2027-03-11T03:00:00+05:45'));
  // New York, the two DST days of 2026: 03:00 EDT on 8 March, 03:00 EST on 1 November
  assert.equal(logicalDayEnd('2026-03-07', 'America/New_York'), Date.parse('2026-03-08T07:00:00Z'));
  assert.equal(logicalDayEnd('2026-10-31', 'America/New_York'), Date.parse('2026-11-01T08:00:00Z'));
});

test('where 03:00 local comes twice the day ends at the first, where it does not exist at the jump over it', () => {
  // Athens, 25 October 2026: 04:00 EEST becomes 03:00 EET at 01:00 UTC; the first 03:00 is 00:00 UTC
  assert.equal(logicalDayEnd('2026-10-24', 'Europe/Athens'), Date.parse('2026-10-25T00:00:00Z'));
  // Athens, 29 March 2026: 03:00 EET becomes 04:00 EEST at 01:00 UTC
  assert.equal(logicalDayEnd('2026-03-28', 'Europe/Athens'), Date.parse('2026-03-29T01:00:00Z'));
});

test('one millisecond before the end is still that day, the end itself is the next, for every day of 2026 in every zone listed', () => {
  const zones = [
    'Asia/Ho_Chi_Minh', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Athens',
    'Australia/Lord_Howe', 'Africa/Cairo',
  ];
  let checked = 0;
  for (const zone of zones) {
    for (let date = '2026-01-01'; date < '2027-01-01'; date = addDays(date, 1)) {
      const end = logicalDayEnd(date, zone);
      assert.equal(logicalDateOf(end - 1, zone), date, `${zone} ${date}`);
      assert.equal(logicalDateOf(end, zone), addDays(date, 1), `${zone} ${date}`);
      checked++;
    }
  }
  assert.equal(checked, zones.length * 365);
});
