// The day-close job against the user's own writes, at the same moment, on a warmed pool: a tick,
// a meal, a workout, a bedtime mark and a change of time zone, each raced against the close of
// the very day the write names (25 rounds each, a fresh user per round). Real time, no test
// clock: the instant a row was written must be the instant it was written.
//
// What must hold whichever side wins: no 5xx; a write is accepted (it landed before the close,
// and the close then stamped its day) or refused with DAY_CLOSED; no daily log of a closed date
// is left without closed_at (a write that slipped in after the close would leave one); a second
// run reopens nothing; the ledgers stay sound.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { createLogger } from '../log.ts';
import { runJob } from './scheduler.ts';

let db: TestDb;
let app: TestApp;
let desk: { id: string; duration: number };
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  desk = (
    await db.admin.query("SELECT id, duration_sec AS duration FROM exercise_items WHERE code = 'DESK_STRETCH'")
  ).rows[0];
});
after(async () => {
  await app.close();
  await db.drop();
});

const ROUNDS = 25;
const ZONE = 'Asia/Ho_Chi_Minh';
const log = createLogger(() => {});
type User = Awaited<ReturnType<typeof newOnboardedUser>>;
type Write = (user: User, key: string, at: string) => Promise<CallResult>;

const post = (user: User, path: string, key: string, body: unknown) =>
  app.call('POST', path, { token: user.token, key, body });

/** Each write names 20:00 local of yesterday, the day the job closes. */
const WRITES: Record<string, { write: Write; row: string | null }> = {
  tick: {
    write: (user, key, at) => post(user, '/day/quests/WATER_8/progress', key, { occurredAt: at }),
    row: 'quest_ticks',
  },
  meal: {
    write: (user, key, at) => post(user, '/nutrition/log', key, { kcal: 300, occurredAt: at }),
    row: 'nutrition_logs',
  },
  workout: {
    write: (user, key, at) =>
      post(user, '/workout/complete', key, { exerciseItemId: desk.id, elapsedSec: desk.duration, occurredAt: at }),
    row: 'workout_sessions',
  },
  bedtime: {
    write: (user, key, at) => post(user, '/day/bedtime', key, { occurredAt: at }),
    row: null,
  },
  timezone: {
    write: (user, key) =>
      app.call('PATCH', '/me', { token: user.token, key, body: { timezone: 'Pacific/Kiritimati' } }),
    row: null,
  },
};

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const [kind, { write, row }] of Object.entries(WRITES)) {
  test(`the close of a day and a ${kind} that names that day, at the same moment: ${ROUNDS} rounds`, async t => {
    const seen = { accepted: 0, closed: 0 };
    for (let round = 0; round < ROUNDS; round++) {
      const user = await newOnboardedUser(db);
      // two open days behind today: the day before yesterday and yesterday
      await db.admin.query('UPDATE progression_state SET onboard_date = onboard_date - 2 WHERE user_id = $1', [
        user.userId,
      ]);
      const { rows } = await db.admin.query(
        `SELECT app.now() AS now, to_char(app.logical_date(app.now(), $1) - 1, 'YYYY-MM-DD') AS yesterday,
                ((app.logical_date(app.now(), $1) - 1) + time '20:00') AT TIME ZONE $1 AS at`,
        [ZONE],
      );
      const { now, yesterday } = rows[0];
      const at = rows[0].at.toISOString();
      const key = randomUUID();
      await Promise.all(Array.from({ length: 10 }, () => db.app.query('SELECT 1')));
      const lead = Math.floor(Math.random() * 12);
      const [closed, written] = await Promise.all([
        pause(round % 2 === 0 ? lead : 0).then(() => runJob('day-close', db.app, now, log)),
        pause(round % 2 === 1 ? lead : 0).then(() => write(user, key, at)),
      ]);
      const label = `${kind} round ${round}`;
      assert.equal(closed.failed, 0, label);
      assert.ok(
        written.status === 200 || (written.status === 409 && written.body.error.code === 'DAY_CLOSED'),
        `${label}: ${written.status} ${JSON.stringify(written.body)}`,
      );
      if (written.status === 200) {
        seen.accepted++;
      } else {
        seen.closed++;
      }
      const state = await db.admin.query(
        `SELECT to_char(s.last_closed_date, 'YYYY-MM-DD') AS closed,
                (SELECT count(*)::int FROM daily_logs d
                  WHERE d.user_id = s.user_id AND d.logical_date <= s.last_closed_date AND d.closed_at IS NULL) AS open_closed
           FROM progression_state s WHERE s.user_id = $1`,
        [user.userId],
      );
      if (kind !== 'timezone') {
        assert.equal(state.rows[0].closed, yesterday, label);
      }
      assert.equal(state.rows[0].open_closed, 0, `${label}: a log of a closed date was written after the close`);
      if (row !== null) {
        const landed = await db.admin.query(
          `SELECT to_char(d.logical_date, 'YYYY-MM-DD') AS date, d.closed_at IS NOT NULL AS closed
             FROM ${row} r JOIN daily_logs d ON d.id = r.daily_log_id WHERE r.id = $1`,
          [key],
        );
        assert.deepEqual(
          landed.rows,
          written.status === 200 ? [{ date: yesterday, closed: true }] : [],
          label,
        );
      }
      // a second run at the same instant reopens nothing; it closes nothing more, unless the user moved
      // east, where yesterday is a later date
      await runJob('day-close', db.app, now, log);
      const again = await db.admin.query(
        "SELECT to_char(last_closed_date, 'YYYY-MM-DD') AS closed FROM progression_state WHERE user_id = $1",
        [user.userId],
      );
      if (kind === 'timezone') {
        assert.ok(again.rows[0].closed >= state.rows[0].closed, label);
      } else {
        assert.equal(again.rows[0].closed, state.rows[0].closed, label);
      }
    }
    t.diagnostic(`${kind}: ${seen.accepted} answered 200 (before the close), ${seen.closed} answered 409 DAY_CLOSED`);
  });
}

test('the ledgers of every user are sound after the races: no sum below zero, the high-water mark at or above the XP sum', async () => {
  const { rows } = await db.admin.query(
    `SELECT s.user_id, s.xp_high_water,
            (SELECT coalesce(sum(amount), 0) FROM xp_ledger x WHERE x.user_id = s.user_id)::int AS xp,
            (SELECT coalesce(sum(amount), 0) FROM coin_ledger c WHERE c.user_id = s.user_id)::int AS coin
       FROM progression_state s JOIN users u ON u.id = s.user_id WHERE u.onboarded_at IS NOT NULL`,
  );
  assert.ok(rows.length >= ROUNDS * Object.keys(WRITES).length);
  for (const user of rows) {
    assert.ok(user.xp >= 0 && user.coin >= 0 && user.xp_high_water >= user.xp, JSON.stringify(user));
  }
});
