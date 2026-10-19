// The ticket-grant job (job_ticket_grant, AR-10): the safety net that finds the week decided by
// journal_create, recreates a lost decision once, and never races journal_create into a second
// decision. Decisions are deleted through the owner connection; entries are written over HTTP;
// the clock is the test clock. 2027-03-10 is a Wednesday; Asia/Ho_Chi_Minh (UTC+7).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { PoolClient } from 'pg';
import { setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { createLogger } from '../log.ts';
import { runJob } from './scheduler.ts';
import ticketGrant from './ticketGrant.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;
const NOW = '2027-03-10T05:20:00.000Z'; // 12:20 local
const quiet = createLogger(() => {});
const run = async (iso = NOW) => ((await runJob('ticket-grant', db.app, new Date(iso), quiet)) as { decided: number }).decided;
const write = (user: User) => app.call('POST', '/journal', { token: user.token, key: randomUUID(), body: { body: 'Một dòng.' } });
const decisions = async (user: User) =>
  (
    await db.admin.query(
      `SELECT (SELECT jsonb_agg(jsonb_build_array(to_char(week_start, 'YYYY-MM-DD'), granted) ORDER BY week_start)
                 FROM ticket_grant_weeks WHERE user_id = $1) AS weeks,
              (SELECT count(*)::int FROM freeze_tickets WHERE user_id = $1) AS tickets`,
      [user.userId],
    )
  ).rows[0];

test('nothing to do: 0; after a week decided by the journal: 0; a deleted decision is recreated once (the ticket stays one), the next run 0', async () => {
  await setTestClock(db.admin, NOW);
  assert.equal(await run(), 0);
  const user = await newOnboardedUser(db);
  assert.equal((await write(user)).body.ticket.outcome, 'GRANTED');
  assert.equal(await run(), 0);
  await db.admin.query('DELETE FROM ticket_grant_weeks WHERE user_id = $1', [user.userId]);
  assert.equal(await run(), 1);
  assert.deepEqual(await decisions(user), { weeks: [['2027-03-08', true]], tickets: 1 });
  assert.equal(await run(), 0);
  // the decision and the ticket both lost: the run grants the week's ticket again
  await db.admin.query('DELETE FROM ticket_grant_weeks WHERE user_id = $1', [user.userId]);
  await db.admin.query('DELETE FROM freeze_tickets WHERE user_id = $1', [user.userId]);
  assert.equal(await run(), 1);
  assert.deepEqual(await decisions(user), { weeks: [['2027-03-08', true]], tickets: 1 });
});

test("only the week of the user's logical date at the run counts: an entry of last week only and a deleted account give 0; Monday 02:00 local still belongs to the week before", async () => {
  await setTestClock(db.admin, NOW);
  const lastWeek = await newOnboardedUser(db);
  await setTestClock(db.admin, '2027-03-05T05:00:00.000Z');
  assert.equal((await write(lastWeek)).status, 200);
  await db.admin.query('DELETE FROM ticket_grant_weeks WHERE user_id = $1', [lastWeek.userId]);
  await setTestClock(db.admin, NOW);
  const gone = await newOnboardedUser(db);
  assert.equal((await write(gone)).status, 200);
  await db.admin.query('DELETE FROM ticket_grant_weeks WHERE user_id = $1', [gone.userId]);
  await db.admin.query('UPDATE users SET deleted_at = app.now() WHERE id = $1', [gone.userId]);
  assert.equal(await run(), 0);
  assert.deepEqual(await decisions(lastWeek), { weeks: null, tickets: 1 });
  // the logical week: Monday 03:00 local starts a new one, Monday 02:00 local is still last Sunday's
  assert.equal(await run('2027-03-07T20:00:00.000Z'), 0); // Monday 03-08 03:00 local: no entry in this week
  assert.equal(await run('2027-03-07T19:00:00.000Z'), 1); // Monday 03-08 02:00 local: the week of 03-01
  assert.deepEqual(await decisions(lastWeek), { weeks: [['2027-03-01', true]], tickets: 1 });
});

/** How many backends of this database wait for a lock. */
const waiting = async () =>
  (
    await db.admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    )
  ).rows[0].n;
async function until(n: number) {
  for (let i = 0; i < 500 && (await waiting()) < n; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await waiting(), n, 'the transactions did not line up behind the lock');
}

test('journal_create against the job for the same user and week, both orders and free rounds: exactly one decision and one ticket', async () => {
  await setTestClock(db.admin, NOW);
  const round = async (order: 'job first' | 'journal first' | 'free') => {
    const user = await newOnboardedUser(db);
    assert.equal((await write(user)).status, 200);
    // the week undecided again, with an entry in it: the job has work
    await db.admin.query('DELETE FROM ticket_grant_weeks WHERE user_id = $1', [user.userId]);
    await db.admin.query('DELETE FROM freeze_tickets WHERE user_id = $1', [user.userId]);
    let job: Promise<number>;
    let entry: ReturnType<typeof write>;
    if (order === 'free') {
      [job, entry] = [run(), write(user)];
    } else {
      const hold: PoolClient = await db.admin.connect();
      try {
        await hold.query('BEGIN');
        // the owner holds progression_state: the first to start takes the users row and waits here, the
        // second waits for that users row. (Held on the users row instead, an HTTP request that already
        // holds a key-share lock on it from its idempotency row would not queue behind the job.)
        await hold.query('SELECT 1 FROM progression_state WHERE user_id = $1 FOR UPDATE', [user.userId]);
        if (order === 'job first') {
          job = run();
          await until(1);
          entry = write(user);
        } else {
          entry = write(user);
          await until(1);
          job = run();
        }
        await until(2);
      } finally {
        // COMMIT of a failed transaction rolls it back; the client goes back to the pool either way
        await hold.query('COMMIT').finally(() => hold.release());
      }
    }
    const [decided, written] = await Promise.all([job, entry]);
    assert.equal(written.status, 200, JSON.stringify(written.body));
    const granted = written.body.ticket.outcome === 'GRANTED' ? 1 : 0;
    assert.equal(decided + granted, 1, `${order}: job ${decided}, journal ${written.body.ticket.outcome}`);
    if (order === 'job first') assert.equal(decided, 1);
    if (order === 'journal first') assert.equal(granted, 1);
    assert.deepEqual(await decisions(user), { weeks: [['2027-03-08', true]], tickets: 1 });
  };
  await round('job first');
  await round('journal first');
  for (let i = 0; i < 5; i++) {
    await round('free');
  }
});

test('due once an hour from minute 20', () => {
  const t = (iso: string) => new Date(iso);
  assert.equal(ticketGrant.due(t('2027-03-10T10:19:00Z'), null), true);
  assert.equal(ticketGrant.due(t('2027-03-10T10:19:00Z'), t('2027-03-10T09:20:00Z')), false);
  assert.equal(ticketGrant.due(t('2027-03-10T10:20:00Z'), t('2027-03-10T09:20:00Z')), true);
  assert.equal(ticketGrant.due(t('2027-03-10T10:59:00Z'), t('2027-03-10T10:20:00Z')), false);
  assert.equal(ticketGrant.due(t('2027-03-10T11:20:00Z'), t('2027-03-10T10:20:00Z')), true);
});
