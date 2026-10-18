// The reminder-dispatch job on the real database: who gets a QUEST_REMINDER, in which window of
// their own wall clock, once per logical day; and when the job is due. Every test first turns
// reminders off for everyone, so a count is the count of the users the test arranged.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { asJob, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { createLogger } from '../log.ts';
import reminderDispatch from './reminderDispatch.ts';
import { runJob } from './scheduler.ts';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(async () => {
  await setTestClock(db.admin, null);
  await db.drop();
});
beforeEach(async () => {
  await db.admin.query('UPDATE user_settings SET reminder_enabled = false');
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;

/** An onboarded user in `timezone` with reminders on in `window`. */
async function reminded(window: 'MORNING' | 'NOON' | 'EVENING', timezone = 'Asia/Ho_Chi_Minh'): Promise<User> {
  const user = await newOnboardedUser(db, { timezone });
  await db.admin.query('UPDATE user_settings SET reminder_enabled = true, reminder_window = $2 WHERE user_id = $1', [
    user.userId,
    window,
  ]);
  return user;
}

/** One run of the job at `iso` through the scheduler's runJob (app_job): how many it created. */
const run = async (iso: string) => {
  await setTestClock(db.admin, iso);
  return (await runJob('reminder-dispatch', db.app, new Date(iso), createLogger(() => {}))).created;
};
/** job_reminder_dispatch called directly as app_job, at any instant. */
const dispatch = (iso: string) =>
  asJob(db.app, async c => (await c.query<{ n: number }>('SELECT job_reminder_dispatch($1) AS n', [iso])).rows[0].n);

const remindersOf = async (user: User) =>
  (
    await db.admin.query(
      "SELECT payload, dedupe_key FROM notifications WHERE user_id = $1 AND kind = 'QUEST_REMINDER' ORDER BY created_at",
      [user.userId],
    )
  ).rows;

test('enabled, inside the window, STORY incomplete: one item {} keyed by the logical date; a second run creates none', async () => {
  const user = await reminded('EVENING');
  assert.equal(await run('2027-01-13T11:00:00.000Z'), 1); // 18:00 Asia/Ho_Chi_Minh
  assert.equal(await run('2027-01-13T11:15:00.000Z'), 0);
  assert.equal(await run('2027-01-13T12:45:00.000Z'), 0); // 19:45, still the window
  assert.deepEqual(await remindersOf(user), [{ payload: {}, dedupe_key: '2027-01-13' }]);
  assert.equal(await run('2027-01-14T11:00:00.000Z'), 1); // the next day: once more
});

test('outside the window: none; at 18:00 STORY complete, reminders off and a deleted account: none, while the control is reminded', async () => {
  const control = await reminded('EVENING');
  const done = await reminded('EVENING');
  const off = await reminded('EVENING');
  const deleted = await reminded('EVENING');
  await db.admin.query('UPDATE user_settings SET reminder_enabled = false WHERE user_id = $1', [off.userId]);
  await db.admin.query('UPDATE users SET deleted_at = now() WHERE id = $1', [deleted.userId]);
  await db.admin.query("INSERT INTO daily_logs (user_id, logical_date, story_completed) VALUES ($1, '2027-01-20', true)", [
    done.userId,
  ]);
  assert.equal(await run('2027-01-20T13:00:00.000Z'), 0); // 20:00: outside, also for the control
  assert.equal(await run('2027-01-20T11:00:00.000Z'), 1); // 18:00
  assert.deepEqual(
    await Promise.all([control, done, off, deleted].map(async u => (await remindersOf(u)).length)),
    [1, 0, 0, 0],
  );
});

test('the presets, start included and end excluded: MORNING 07:00–09:00, NOON 11:30–13:30, EVENING 18:00–20:00', async () => {
  const cases: [string, string, number][] = [
    ['MORNING', '2027-02-01T23:59:00.000Z', 0], // 06:59
    ['MORNING', '2027-02-02T00:00:00.000Z', 1], // 07:00
    ['MORNING', '2027-02-02T02:00:00.000Z', 0], // 09:00
    ['NOON', '2027-02-03T04:29:00.000Z', 0], // 11:29
    ['NOON', '2027-02-03T04:30:00.000Z', 1], // 11:30
    ['NOON', '2027-02-03T06:30:00.000Z', 0], // 13:30
    ['EVENING', '2027-02-04T10:59:00.000Z', 0], // 17:59
    ['EVENING', '2027-02-04T11:00:00.000Z', 1], // 18:00
    ['EVENING', '2027-02-04T13:00:00.000Z', 0], // 20:00
  ];
  const got: number[] = [];
  for (const [window, iso] of cases) {
    await db.admin.query('UPDATE user_settings SET reminder_enabled = false');
    await reminded(window as 'MORNING');
    got.push(await dispatch(iso));
  }
  assert.deepEqual(got, cases.map(([, , n]) => n));
});

test('a user in America/New_York with EVENING is reminded at 18:00 there, not at 18:00 Asia/Ho_Chi_Minh', async () => {
  const user = await reminded('EVENING', 'America/New_York');
  assert.equal(await run('2027-01-27T11:00:00.000Z'), 0); // 18:00 ICT, 06:00 New York
  assert.equal(await run('2027-01-27T23:00:00.000Z'), 1); // 18:00 New York (EST), 06:00 ICT the 28th
  assert.deepEqual(await remindersOf(user), [{ payload: {}, dedupe_key: '2027-01-27' }]);
});

test('due at minutes 0, 15, 30 and 45: once per quarter hour, from its first minute', () => {
  const at = (hm: string) => new Date(`2027-01-13T${hm}:00.000Z`);
  assert.deepEqual(
    [
      reminderDispatch.due(at('10:07'), null),
      reminderDispatch.due(at('10:14'), at('10:00')),
      reminderDispatch.due(at('10:15'), at('10:00')),
      reminderDispatch.due(at('10:16'), at('10:15')),
      reminderDispatch.due(at('10:29'), at('10:15')),
      reminderDispatch.due(at('10:30'), at('10:15')),
      reminderDispatch.due(at('11:00'), at('10:45')),
    ],
    [true, false, true, false, false, true, true],
  );
});
