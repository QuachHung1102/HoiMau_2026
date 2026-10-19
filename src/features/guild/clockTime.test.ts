/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Jest cannot change the time zone of its own process, and this machine's zone is the product's own (Asia/Ho_Chi_Minh), so a
// formatter that quietly used that zone would pass every test run here. The function is run by a Node of its own per zone.
const file = pathToFileURL(path.join(__dirname, 'clockTime.ts')).href;
const INSTANTS = ['2026-10-14T02:40:00.000Z', '2026-10-14T23:59:00.000Z', '2026-10-15T00:05:00.000Z'];
const runUnder = (zone: string) =>
  execFileSync(process.execPath, ['--input-type=module', '-e', `import { clockTime } from ${JSON.stringify(file)}; console.log(${JSON.stringify(INSTANTS)}.map(clockTime).join(' '))`], {
    env: { ...process.env, TZ: zone },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .trim()
    .split(' ');
// The platform's own formatter, asked for that zone by name: another way of getting the same answer.
const expected = (zone: string) => INSTANTS.map(instant => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant)));

test.each(['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Chatham'])('HH:mm is the time on the clock of this device in %s', zone => {
  expect(runUnder(zone)).toEqual(expected(zone));
});

test('the zones differ from each other, so the test above can tell the device\'s zone from any fixed one', () => {
  expect(new Set(['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Asia/Kolkata'].map(zone => expected(zone)[0])).size).toBe(4);
});
