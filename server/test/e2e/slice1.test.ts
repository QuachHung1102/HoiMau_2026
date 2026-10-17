// Slice 1 end to end over HTTP (spec §11 phase 1): a person registers, gets targets, records three
// consecutive logical days (eight water ticks, calories inside the band, a workout at >= 50 %, one
// action at 23:50 and one at 00:30 local) and sees the streak rise after each 03:00 close. Then every
// write is replayed with its own Idempotency-Key and day-close runs twice more: the ledger and the
// decoy rows do not move.
//
// Expected numbers come from the sources: rewards from the quests of GET /day, the calorie band from
// its calorieWindow, the workout from the catalog. Every date and every 03:00 comes from the server
// (GET /day logicalDate / closesAt) or from PostgreSQL's zone database: never from Node's.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { addDays } from '../../../domain/logicalDate.ts';
import { decoyRows } from '../../checks/attacks/base.ts';
import { runJob } from '../../src/jobs/scheduler.ts';
import { createLogger } from '../../src/log.ts';
import { setTestClock } from '../helpers.ts';
import { ONBOARDING_INPUT, startTestApp } from '../http.ts';
import type { TestApp } from '../http.ts';
import { createTestDb } from '../testdb.ts';
import type { TestDb } from '../testdb.ts';

let db: TestDb;
let app: TestApp;
const log = createLogger(() => {});
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

type Write = { method: string; path: string; key: string; body: unknown; status: number; answer: unknown };

/** One person talking to the server; every keyed write is kept to be replayed later. */
function person(token: string) {
  const writes: Write[] = [];
  return {
    writes,
    async get(path: string) {
      const result = await app.call('GET', path, { token });
      assert.equal(result.status, 200, `GET ${path}: ${JSON.stringify(result.body)}`);
      return result.body;
    },
    async post(path: string, body: unknown) {
      const key = randomUUID();
      const result = await app.call('POST', path, { token, key, body });
      assert.equal(result.status, 200, `POST ${path}: ${JSON.stringify(result.body)}`);
      writes.push({ method: 'POST', path, key, body, status: result.status, answer: result.body });
      return result.body;
    },
    replay: (write: Write) => app.call(write.method, write.path, { token, key: write.key, body: write.body }),
  };
}

/** The instant of `time` on `date` on the wall clock of `zone`, from PostgreSQL's zone database. */
async function wallClock(date: string, time: string, zone: string): Promise<string> {
  const { rows } = await db.admin.query<{ at: Date }>('SELECT ($1::date + $2::time) AT TIME ZONE $3 AS at', [date, time, zone]);
  return rows[0].at.toISOString();
}

/** Per (ledger, reason, ref_id): rows and sum, as the owner. */
async function ledger(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT 'xp' AS ledger, reason, ref_id, count(*)::int AS rows, sum(amount)::int AS sum
       FROM xp_ledger WHERE user_id = $1 GROUP BY reason, ref_id
     UNION ALL
     SELECT 'coin', reason, ref_id, count(*)::int, sum(amount)::int
       FROM coin_ledger WHERE user_id = $1 GROUP BY reason, ref_id
     ORDER BY 1, 2, 3`,
    [userId],
  );
  return rows;
}

const RECORDED = ['WATER_8', 'NUTRITION_TARGET', 'WORKOUT_MAIN'];
type Quest = { code: string; category: string; targetCount: number; xpReward: number; coinReward: number };
/** What one fully recorded day earns by the rewards the server lists: a DAILY quest pays per tick (spec F-06). */
function dayReward(quests: Quest[]) {
  const recorded = quests.filter(quest => RECORDED.includes(quest.code));
  assert.equal(recorded.length, RECORDED.length);
  const times = (quest: Quest) => (quest.category === 'DAILY' ? quest.targetCount : 1);
  return {
    xp: recorded.reduce((sum, quest) => sum + quest.xpReward * times(quest), 0),
    coin: recorded.reduce((sum, quest) => sum + quest.coinReward * times(quest), 0),
  };
}

async function closeAt(at: string) {
  await setTestClock(db.admin, at);
  const counts = await runJob('day-close', db.app, new Date(at), log);
  assert.deepEqual([counts.failed, counts.skipped], [0, 0], JSON.stringify(counts));
  return counts;
}

/** Register, onboard and record three consecutive logical days from `firstDay` in `zone`. */
async function threeDays(zone: string, firstDay: string) {
  const decoysBefore = await decoyRows(db.admin);
  await setTestClock(db.admin, await wallClock(firstDay, '09:00', zone));
  const email = `e2e${randomBytes(6).toString('hex')}@example.com`;
  const registered = await app.call('POST', '/auth/register', {
    body: { email, password: 'matkhau-e2e-1', displayName: 'An', acceptedTerms: true },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const me = person(registered.body.token);
  const onboarded = await me.post('/onboarding', { ...ONBOARDING_INPUT, timezone: zone });
  assert.equal(onboarded.user.onboarded, true);
  const userId: string = onboarded.user.id;
  const targets = await me.get('/me/prescription');
  assert.ok(targets.calorieTarget > 0 && targets.waterMl > 0, 'targets after onboarding');

  const { items } = await me.get('/workout/catalog');
  const workout = [...items].sort((a, b) => a.durationSec - b.durationSec)[0];
  let expected = { xp: 0, coin: 0 };

  for (const n of [0, 1, 2]) {
    const date = addDays(firstDay, n);
    await setTestClock(db.admin, await wallClock(date, '12:00', zone));
    const day = await me.get('/day');
    assert.equal(day.logicalDate, date);
    const reward = dayReward(day.quests);
    expected = { xp: expected.xp + reward.xp, coin: expected.coin + reward.coin };
    for (let tick = 1; tick <= 7; tick++) {
      await me.post('/day/quests/WATER_8/progress', {});
    }

    // 23:50 local: the calories (the low end of the band, ends included) and the eighth tick
    await setTestClock(db.admin, await wallClock(date, '23:50', zone));
    const meal = await me.post('/nutrition/log', { kcal: day.calorieWindow.min });
    assert.equal(meal.day.logicalDate, date);
    const water = await me.post('/day/quests/WATER_8/progress', {});
    assert.deepEqual(water.delta.events, [{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }]);

    // 00:30 local of the next calendar day is still the same logical day: the workout at >= 50 %
    await setTestClock(db.admin, await wallClock(addDays(date, 1), '00:30', zone));
    const session = await me.post('/workout/complete', {
      exerciseItemId: workout.id,
      elapsedSec: Math.ceil(workout.durationSec / 2),
    });
    assert.equal(session.day.logicalDate, date);
    assert.deepEqual([session.day.story.done, session.day.story.total], [2, 2]);

    // just after 03:00 local, as the server names it
    await closeAt(new Date(Date.parse(session.day.closesAt) + 60_000).toISOString());
    const progression = await me.get('/progression');
    assert.equal(progression.streakCurrent, n + 1, `${zone}: streak after closing ${date}`);
  }

  const progression = await me.get('/progression');
  assert.deepEqual([progression.streakCurrent, progression.streakBest], [3, 3]);
  assert.deepEqual([progression.xp, progression.coin], [expected.xp, expected.coin]);
  const profile = await me.get('/me');
  assert.equal(profile.pet.mood, 'HAPPY');
  const history = await me.get(`/day/history?from=${firstDay}&to=${addDays(firstDay, 2)}`);
  assert.deepEqual(history.days.map((d: { outcome: string }) => d.outcome), ['COMPLETED', 'COMPLETED', 'COMPLETED']);

  // replay every keyed write, then run the job twice more: nothing moves
  const settled = await ledger(userId);
  assert.ok(settled.every(row => row.rows === 1), JSON.stringify(settled));
  assert.deepEqual(
    [settled.filter(r => r.ledger === 'xp').reduce((s, r) => s + r.sum, 0), settled.filter(r => r.ledger === 'coin').reduce((s, r) => s + r.sum, 0)],
    [expected.xp, expected.coin],
  );
  assert.equal(me.writes.length, 1 + 3 * 10);
  for (const write of me.writes) {
    const again = await me.replay(write);
    assert.equal(again.status, write.status, `replay ${write.path}`);
    assert.deepEqual(again.body, write.answer, `replay ${write.path}`);
  }
  const now = (await db.admin.query<{ now: Date }>('SELECT app.now() AS now')).rows[0].now.toISOString();
  for (const run of [1, 2]) {
    assert.equal((await closeAt(now)).applied, 0, `extra run ${run}`);
  }
  assert.deepEqual(await ledger(userId), settled);
  const final = await me.get('/progression');
  assert.deepEqual([final.streakCurrent, final.streakBest, final.xp, final.coin], [3, 3, expected.xp, expected.coin]);
  assert.deepEqual(await decoyRows(db.admin), decoysBefore);
}

test('Asia/Ho_Chi_Minh: register, onboard, three recorded days across midnight; streak 1, 2, 3; replays and repeated closes change nothing', async () => {
  await threeDays('Asia/Ho_Chi_Minh', '2027-03-10');
});

test('America/New_York across 2026-03-08 (daylight saving starts): the same three days still give streak 3', async () => {
  // 2026-03-07 is 23 hours long (it ends at 03:00 EDT on the 8th); the 00:30 of the 8th is still EST
  await threeDays('America/New_York', '2026-03-07');
});
