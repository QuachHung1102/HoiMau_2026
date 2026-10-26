// The whole product over HTTP for 15 days (spec §11, all phases): four people A–D (one per
// archetype, D in America/New_York) register and onboard on Monday 2027-01-04 and live two weeks:
// plans, a lunch swap and planned meals (A), meals by hand (B), workouts in full and one partial,
// water ticks with one undo, bedtime before and after 23:00, a late write accepted on an open day
// and one refused with DAY_CLOSED, journal entries that grant a weekly ticket, a missed day rescued
// with that ticket and the 7-day milestone after it, nudges (one sent, one over the receiver limit,
// one to a muted receiver), two weekly guild rollovers, the shop, a perk, and D's export, deletion
// and purge 30 days later.
//
// Every expected reward comes from the content (server/content/quests.ts, the shop and catalog the
// server lists) and the domain constants (domain/economy.ts), never from a hard-coded total: each
// write adds what it should earn to the person's expected sums, each job run adds what it should
// pay, and the ledger sums are compared after every write and every run. At the end every write is
// replayed with its own Idempotency-Key, every job runs twice more, and nothing moves; after the
// purge no column of any table holds D's id.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { JOURNAL_XP, PERKS, STREAK_MILESTONES, guildWeeklyReward } from '../../../domain/economy.ts';
import { addDays } from '../../../domain/logicalDate.ts';
import type { Archetype } from '../../../domain/types.ts';
import { QUESTS } from '../../content/quests.ts';
import { loadJobs, runJob } from '../../src/jobs/scheduler.ts';
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

const VN = 'Asia/Ho_Chi_Minh';
const NY = 'America/New_York';
/** A Monday, far from daylight saving in New York and from the decoys' 2026 dates. */
const START = '2027-01-04';
const PASSWORD = 'matkhau-e2e-full';
const quest = (code: string) => QUESTS.find(q => q.code === code)!;
const WATER = quest('WATER_8');
const WORKOUT = quest('WORKOUT_MAIN');
const NUTRITION = quest('NUTRITION_TARGET');
const BEDTIME = quest('BEDTIME_BEFORE_23');
const MILESTONE_7 = STREAK_MILESTONES.find(m => m.days === 7)!;

type Gain = { xp: number; coin: number };
const NOTHING: Gain = { xp: 0, coin: 0 };
type Write = { method: string; path: string; key: string; body: unknown; status: number; answer: unknown };
type Day = { kcal: number; nutrition: boolean; workout: boolean; partialXp: number; journal: boolean; bedtime: boolean };

type Person = {
  name: string;
  zone: string;
  id: string;
  token: string;
  xp: number;
  coin: number;
  writes: Write[];
  /** Logical dates with a daily log (any write that maps to a day): "active" for the guild week. */
  active: Set<string>;
  days: Map<string, Day>;
  band: { min: number; max: number };
  streak: number;
  preBreak: number;
  milestone7: boolean;
  closedThrough: string | null;
  deleted: boolean;
};

const dayOf = (p: Person, date: string): Day => {
  if (!p.days.has(date)) {
    p.days.set(date, { kcal: 0, nutrition: false, workout: false, partialXp: 0, journal: false, bedtime: false });
  }
  return p.days.get(date)!;
};

/** The instant of `time` on day `n` (0 = START) on the wall clock of `zone`, from PostgreSQL's zone database. */
async function at(n: number, time: string, zone = VN): Promise<string> {
  const { rows } = await db.admin.query<{ at: Date }>('SELECT ($1::date + $2::time) AT TIME ZONE $3 AS at', [addDays(START, n), time, zone]);
  return rows[0].at.toISOString();
}
const clock = (iso: string) => setTestClock(db.admin, iso);

async function get(p: Person, path: string) {
  const result = await app.call('GET', path, { token: p.token });
  assert.equal(result.status, 200, `${p.name} GET ${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function ledgerSums(userId: string): Promise<Gain> {
  const { rows } = await db.admin.query<{ xp: number; coin: number }>(
    `SELECT (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
            (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin`,
    [userId],
  );
  return rows[0];
}
async function checkLedger(p: Person, what: string) {
  assert.deepEqual(await ledgerSums(p.id), { xp: p.xp, coin: p.coin }, `${p.name} ledger after ${what}`);
}

/** A keyed write that must succeed; `gain` is what it should earn, added to the expected sums. */
async function write(p: Person, method: string, path: string, body?: unknown, gain: Gain = NOTHING, status = 200) {
  const key = randomUUID();
  const result = await app.call(method, path, { token: p.token, key, body });
  assert.equal(result.status, status, `${p.name} ${method} ${path}: ${JSON.stringify(result.body)}`);
  p.writes.push({ method, path, key, body, status, answer: result.body });
  const date = result.body?.day?.logicalDate;
  if (date) {
    p.active.add(date);
  }
  p.xp += gain.xp;
  p.coin += gain.coin;
  await checkLedger(p, path);
  return result.body;
}
const post = (p: Person, path: string, body?: unknown, gain: Gain = NOTHING, status = 200) => write(p, 'POST', path, body, gain, status);
/** A write that must be refused with `code`; nothing may move. */
async function refused(p: Person, method: string, path: string, body: unknown, code: string) {
  const result = await app.call(method, path, { token: p.token, key: randomUUID(), body });
  assert.ok(result.status >= 400, `${p.name} ${path} should be refused with ${code}`);
  assert.equal(result.body.error.code, code, `${p.name} ${path}: ${JSON.stringify(result.body)}`);
  await checkLedger(p, `${path} refused`);
  return result.body.error;
}

/** The person's current logical date, as the server names it. */
const today = async (p: Person): Promise<string> => (await get(p, '/day')).logicalDate;

function storyCheck(p: Person, date: string) {
  const d = dayOf(p, date);
  return d.nutrition && d.workout;
}

/** Calories of a meal: completes NUTRITION_TARGET the first time the day's total is inside the band (ends included). */
function kcalGain(p: Person, date: string, kcal: number): Gain {
  const d = dayOf(p, date);
  d.kcal += kcal;
  if (!d.nutrition && d.kcal >= p.band.min && d.kcal <= p.band.max) {
    d.nutrition = true;
    return { xp: NUTRITION.xpReward, coin: NUTRITION.coinReward };
  }
  return NOTHING;
}

async function manualMeal(p: Person, kcal: number) {
  const date = await today(p);
  const result = await post(p, '/nutrition/log', { kcal }, kcalGain(p, date, kcal));
  assert.equal(result.day.logicalDate, date);
}

/** Every planned meal of today; tops up by hand if the total is still under the band. */
async function plannedMeals(p: Person) {
  const plan = await get(p, '/nutrition/plan');
  const date = plan.logicalDate;
  for (const slot of plan.slots.filter((s: { meal: unknown }) => s.meal !== null)) {
    await post(p, '/nutrition/log', { mealSlot: slot.mealSlot }, kcalGain(p, date, Number(slot.meal.kcal)));
  }
  const d = dayOf(p, date);
  if (!d.nutrition) {
    assert.ok(d.kcal < p.band.min, `${p.name}: the planned meals passed the band without landing in it`);
    await manualMeal(p, Math.ceil(p.band.min - d.kcal));
  }
  assert.ok(dayOf(p, date).nutrition);
}

let shortest: { id: string; durationSec: number };
/** The shortest workout: in full (completes WORKOUT_MAIN) or a quarter of it (WORKOUT_PARTIAL, XP only). */
async function workout(p: Person, full: boolean) {
  const date = await today(p);
  const d = dayOf(p, date);
  const elapsedSec = full ? shortest.durationSec : Math.floor(shortest.durationSec / 4);
  let gain: Gain;
  if (d.workout) {
    gain = NOTHING;
  } else if (full) {
    gain = { xp: WORKOUT.xpReward - d.partialXp, coin: WORKOUT.coinReward };
    d.workout = true;
  } else {
    const xp = Math.min(Math.floor((WORKOUT.xpReward * elapsedSec) / shortest.durationSec), WORKOUT.xpReward - d.partialXp);
    d.partialXp += xp;
    gain = { xp, coin: 0 };
  }
  const result = await post(p, '/workout/complete', { exerciseItemId: shortest.id, elapsedSec }, gain);
  assert.equal(result.completed, full);
  assert.equal(result.day.logicalDate, date);
}

async function tick(p: Person, occurredAt?: string) {
  const result = await post(p, '/day/quests/WATER_8/progress', occurredAt ? { occurredAt } : {}, { xp: WATER.xpReward, coin: WATER.coinReward });
  return result;
}
async function water(p: Person, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    await tick(p);
  }
}

async function bedtime(p: Person) {
  const date = await today(p);
  const d = dayOf(p, date);
  const { rows } = await db.admin.query<{ hour: number }>('SELECT extract(hour FROM app.now() AT TIME ZONE $1)::int AS hour', [p.zone]);
  const earns = !d.bedtime && rows[0].hour >= 18 && rows[0].hour <= 22;
  d.bedtime ||= earns;
  return post(p, '/day/bedtime', {}, earns ? { xp: BEDTIME.xpReward, coin: BEDTIME.coinReward } : NOTHING);
}

async function journal(p: Person, body: string) {
  const date = await today(p);
  const d = dayOf(p, date);
  const result = await post(p, '/journal', { body }, d.journal ? NOTHING : { xp: JOURNAL_XP, coin: 0 });
  assert.equal(result.xpAwarded, d.journal ? 0 : JOURNAL_XP);
  d.journal = true;
  return result;
}

/** A normal day of a person: plan read, meals, all water, the workout in full. */
async function fullDay(p: Person, meals: 'planned' | 'manual') {
  const plan = await get(p, '/nutrition/plan');
  assert.equal(plan.slots.length, 4, 'the plan has its four slots');
  if (meals === 'planned') {
    await plannedMeals(p);
  } else {
    await manualMeal(p, Math.round((p.band.min + p.band.max) / 2));
  }
  await water(p, WATER.targetCount - (await get(p, '/day')).quests.find((q: { code: string }) => q.code === 'WATER_8').progress);
  await workout(p, true);
  const day = await get(p, '/day');
  assert.deepEqual([day.story.done, day.story.total], [2, 2], `${p.name} story of ${day.logicalDate}`);
}

const people: Person[] = [];
const alive = () => people.filter(p => !p.deleted);

/**
 * What a day-close owes each person for the days it closed, by the domain rules (D-04, D-07):
 * a completed day raises the streak, the seventh in a row pays the milestone once; a missed day
 * breaks it (the value before is kept for a rescue). Then streak and ledgers are compared.
 */
async function dayClose(iso: string) {
  await clock(iso);
  const counts = await runJob('day-close', db.app, new Date(iso), log);
  assert.deepEqual([counts.failed, counts.skipped], [0, 0], JSON.stringify(counts));
  for (const p of alive()) {
    const { rows } = await db.admin.query<{ last: string | null; onboard: string }>(
      'SELECT last_closed_date::text AS last, onboard_date::text AS onboard FROM progression_state WHERE user_id = $1',
      [p.id],
    );
    const last = rows[0].last;
    for (let date = p.closedThrough === null ? rows[0].onboard : addDays(p.closedThrough, 1); last !== null && date <= last; date = addDays(date, 1)) {
      if (storyCheck(p, date)) {
        p.streak += 1;
        if (p.streak === MILESTONE_7.days && !p.milestone7) {
          p.milestone7 = true;
          p.coin += MILESTONE_7.coins;
        }
      } else {
        p.preBreak = p.streak;
        p.streak = 0;
      }
    }
    p.closedThrough = last;
    await checkLedger(p, `day-close ${iso}`);
    assert.equal((await get(p, '/progression')).streakCurrent, p.streak, `${p.name} streak after day-close ${iso}`);
  }
}

let guildMembers: Person[] = [];
/** The rollover of the week of `weekStart`: every active member of a ranked guild gets the reward of its rank once. */
async function rollover(iso: string, weekStart: string) {
  await clock(iso);
  await runJob('weekly-rollover', db.app, new Date(iso), log);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const active = guildMembers.filter(p => !p.deleted && week.some(date => p.active.has(date)));
  // the only guild with members in these weeks (the decoys live in 2026): rank 1 when ranked (>= 3 active, D-08)
  const ranked = active.length >= 3;
  if (ranked) {
    for (const p of active) {
      p.coin += guildWeeklyReward(1).coins;
    }
  }
  for (const p of alive()) {
    await checkLedger(p, `weekly-rollover ${weekStart}`);
  }
  const board = await get(people[0], '/leaderboard?week=previous');
  assert.equal(board.weekStart, weekStart);
  assert.equal(board.final, true);
  assert.deepEqual(board.mine, { ranked, rank: ranked ? 1 : null, avgCompletion: board.mine.avgCompletion, activeMembers: active.length });
  return active;
}

/** Every table of the public schema (but the job log) as one value, for "nothing moved". */
async function snapshot(): Promise<Record<string, string>> {
  const { rows: tables } = await db.admin.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'job_runs' ORDER BY 1",
  );
  const out: Record<string, string> = {};
  for (const { name } of tables) {
    // names from the catalog, never data
    const { rows } = await db.admin.query<{ h: string | null }>(`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM public."${name}" t`);
    out[name] = rows[0].h ?? '';
  }
  return out;
}

async function everyJob(iso: string) {
  for (const job of await loadJobs()) {
    await runJob(job.name, db.app, new Date(iso), log);
  }
}

test('four people, fifteen days, every feature: ledgers equal the expected rewards; replays, repeated jobs and the purge leave nothing behind', async () => {
  // Day 0 (Monday) 09:00 in Ho Chi Minh City: four registrations and onboardings
  await clock(await at(0, '09:00'));
  const cast: { name: string; displayName: string; archetype: Archetype; zone: string }[] = [
    { name: 'A', displayName: 'Anh Một', archetype: 'SUPPORTER', zone: VN },
    { name: 'B', displayName: 'Bình Hai', archetype: 'TANKER', zone: VN },
    { name: 'C', displayName: 'Chi Ba', archetype: 'ASSASSIN', zone: VN },
    { name: 'D', displayName: 'Dũng Bốn', archetype: 'SUPPORTER', zone: NY },
  ];
  const emails: string[] = [];
  for (const c of cast) {
    const email = `full-${c.name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`;
    emails.push(email);
    const registered = await app.call('POST', '/auth/register', { body: { email, password: PASSWORD, displayName: c.displayName, acceptedTerms: true } });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const p: Person = {
      name: c.name, zone: c.zone, id: registered.body.userId, token: registered.body.token, xp: 0, coin: 0, writes: [],
      active: new Set(), days: new Map(), band: { min: 0, max: 0 }, streak: 0, preBreak: 0, milestone7: false, closedThrough: null, deleted: false,
    };
    const me = await post(p, '/onboarding', { ...ONBOARDING_INPUT, archetype: c.archetype, timezone: c.zone });
    assert.deepEqual([me.user.onboarded, me.user.archetype, me.user.timezone], [true, c.archetype, c.zone]);
    const day = await get(p, '/day');
    p.band = { min: day.calorieWindow.min, max: day.calorieWindow.max };
    people.push(p);
  }
  const [A, B, C, D] = people;
  const { items } = await get(A, '/workout/catalog');
  shortest = [...items].sort((x, y) => x.durationSec - y.durationSec)[0];

  // A creates a guild, B, C and D join
  const made = await post(A, '/guilds', { name: `Tổ Mười Lăm ${randomUUID().slice(0, 6)}`, motto: 'Mỗi ngày một chút' });
  for (const p of [B, C, D]) {
    await post(p, '/guilds/join', { inviteCode: made.guild.inviteCode });
  }
  guildMembers = [A, B, C, D];
  assert.equal((await get(A, '/guilds/me')).guild.members.length, 4);

  const journalTexts = new Map<Person, string>();
  let deletedAt = '';

  for (let n = 0; n <= 14; n++) {
    // 03:15: the day-close of the Ho Chi Minh City day before; Monday 03:30: the rollover of the week before
    if (n > 0) {
      await dayClose(await at(n, '03:15'));
    }
    if (n === 7 || n === 14) {
      const active = await rollover(await at(n, '03:30'), addDays(START, n - 7));
      assert.equal(active.length, n === 7 ? 4 : 3, 'D counts in week 1, is gone in week 2');
      if (n === 7) {
        for (const p of active) {
          assert.ok((await get(p, '/inventory')).items.some((i: { code: string }) => i.code === guildWeeklyReward(1).badgeCode));
        }
      }
    }

    if (n === 1) {
      // 09:00: A buys a theme and equips it; an item beyond the balance is refused
      await clock(await at(n, '09:00'));
      const shop = await get(A, '/shop');
      const forest = shop.items.find((i: { code: string }) => i.code === 'THEME_FOREST');
      assert.ok(forest.priceCoin <= A.coin, 'A can afford the theme after day 0');
      const bought = await post(A, '/shop/THEME_FOREST/purchase', undefined, { xp: 0, coin: -forest.priceCoin });
      assert.equal(bought.coin, A.coin);
      await post(A, '/inventory/THEME_FOREST/equip');
      assert.equal((await get(A, '/me')).appearance.themeCode, 'THEME_FOREST');
      const level = (await get(A, '/progression')).level;
      const tooDear = (await get(A, '/shop')).items.find(
        (i: { purchasable: boolean; owned: boolean; minLevel: number; priceCoin: number }) => i.purchasable && !i.owned && i.minLevel <= level && i.priceCoin > A.coin,
      );
      assert.ok(tooDear, 'an affordable-level item that costs more than A has');
      const error = await refused(A, 'POST', `/shop/${tooDear.code}/purchase`, undefined, 'INSUFFICIENT_COINS');
      assert.deepEqual(error.details, { price: tooDear.priceCoin, coin: A.coin });
    }
    if (n === 3) {
      // 09:00: A missed day 2; the ticket of week 1 rescues it inside the 12 h window
      await clock(await at(n, '09:00'));
      const yesterday = addDays(START, 2);
      assert.equal(A.streak, 0);
      const tickets = await get(A, '/freeze-tickets');
      assert.equal(tickets.available, 1);
      const offer = tickets.eligible.find((e: { date: string }) => e.date === yesterday);
      assert.deepEqual([offer.target, offer.needed, offer.withTicket], ['YESTERDAY', true, A.preBreak]);
      const used = await post(A, '/freeze-tickets/use', { date: yesterday });
      A.streak = A.preBreak;
      assert.deepEqual([used.available, used.progression.streakCurrent], [0, A.streak]);
    }

    // 12:00 in Ho Chi Minh City: A, B and C
    await clock(await at(n, '12:00'));
    if (n !== 2) {
      if (n === 0) {
        // a lunch swap, then one water tick taken back
        const candidates = await get(A, '/nutrition/swap-candidates?mealSlot=LUNCH');
        assert.ok(candidates.candidates.length > 0);
        const swapped = await post(A, '/nutrition/swap', { mealSlot: 'LUNCH', mealId: candidates.candidates[0].id });
        const lunch = swapped.slots.find((s: { mealSlot: string }) => s.mealSlot === 'LUNCH');
        assert.deepEqual([lunch.meal.id, lunch.swapsUsed], [candidates.candidates[0].id, 1]);
        const ticked = await tick(A);
        const undone = await post(A, '/day/quests/WATER_8/undo', { tickId: ticked.day.quests.find((q: { code: string }) => q.code === 'WATER_8').lastTick.id }, { xp: -WATER.xpReward, coin: -WATER.coinReward });
        assert.equal(undone.day.waterMl, 0);
      }
      await fullDay(A, 'planned');
    }
    if (n === 0 || n === 7) {
      const entry = await journal(A, `Tuần ${n === 0 ? 'một' : 'hai'}: mình đã đi bộ sau bữa trưa.`);
      assert.equal(entry.ticket.outcome, 'GRANTED');
      assert.equal(entry.ticket.available, 1);
    }
    if (n === 5) {
      // a perk bought with points: two more swaps per slot
      const perks = await get(A, '/perks');
      assert.ok(perks.pointsAvailable >= PERKS.MEAL_SWAP_PLUS.cost);
      const unlocked = await post(A, '/perks/unlock', { perkCode: 'MEAL_SWAP_PLUS' });
      assert.equal(unlocked.pointsAvailable, perks.pointsAvailable - PERKS.MEAL_SWAP_PLUS.cost);
      assert.equal((await get(A, '/nutrition/plan')).slots[0].swapsAllowed, 5);
    }

    if (n === 1) {
      // B: meals by hand, water, and only a partial workout: the story is not done
      await manualMeal(B, Math.round((B.band.min + B.band.max) / 2));
      await water(B, WATER.targetCount);
      await workout(B, false);
    } else if (n === 5) {
      // a queued-style write: occurredAt 10:00 today is accepted; one for yesterday evening is refused (closed)
      const late = await tick(B, await at(n, '10:00'));
      assert.equal(late.day.logicalDate, addDays(START, n));
      await refused(B, 'POST', '/day/quests/WATER_8/progress', { occurredAt: await at(n - 1, '20:00') }, 'DAY_CLOSED');
      await fullDay(B, 'manual');
    } else {
      await fullDay(B, 'manual');
    }

    if (n !== 4) {
      await fullDay(C, 'manual');
    } else {
      // C records nothing today; 13:00: A nudges C, a second nudge is over the limit; B mutes, A is refused
      await clock(await at(n, '13:00'));
      const templates = (await get(A, '/guilds/nudge-templates')).templates;
      await post(A, '/guilds/nudge', { receiverId: C.id, templateCode: templates[0].code });
      await refused(B, 'POST', '/guilds/nudge', { receiverId: C.id, templateCode: templates[0].code }, 'NUDGE_RECEIVER_LIMIT');
      const inbox = await get(C, '/inbox');
      assert.equal(inbox.items.filter((i: { kind: string }) => i.kind === 'NUDGE').length, 1);
      assert.equal(inbox.items.find((i: { kind: string }) => i.kind === 'NUDGE').payload.senderName, 'Anh Một');
      assert.equal((await write(B, 'PATCH', '/settings', { nudgesEnabled: false })).nudgesEnabled, false);
      await refused(A, 'POST', '/guilds/nudge', { receiverId: B.id, templateCode: templates[0].code }, 'NUDGE_RECEIVER_MUTED');
    }

    // 15:15: the day-close of New York's day before (03:15 there)
    if (n > 0) {
      await dayClose(await at(n, '15:15'));
    }

    // 20:00 in Ho Chi Minh City is 08:00 in New York: D's day
    if (!D.deleted) {
      await clock(await at(n, '20:00'));
      assert.equal(await today(D), addDays(START, n));
      await fullDay(D, 'manual');
      if (n === 10) {
        const text = `Nhật ký của Dũng ${randomUUID()}`;
        journalTexts.set(D, text);
        await journal(D, text);
        // D exports: D's journal text, nothing of anyone else
        const exported = await get(D, '/me/export');
        const doc = JSON.stringify(exported);
        assert.deepEqual(exported.data.journal_entries.map((e: { text: string }) => e.text), [text]);
        for (const [i, other] of [A, B, C].entries()) {
          for (const secret of [other.id, emails[i], cast[i].displayName]) {
            assert.ok(!doc.includes(secret), `D's export holds ${secret}`);
          }
        }
        // D deletes the account; the guild shrinks
        await clock(await at(n, '21:00'));
        await post(D, '/me/delete', { password: PASSWORD }, NOTHING, 204);
        D.deleted = true;
        deletedAt = await at(n, '21:00');
        const guild = (await get(A, '/guilds/me')).guild;
        assert.deepEqual(guild.members.map((m: { userId: string }) => m.userId).sort(), [A.id, B.id, C.id].sort());
      }
    }

    // 22:00: A closes the day before 23:00 (the hidden quest); 23:30: B after 23:00 (nothing)
    if (n === 0 || n === 6) {
      await clock(await at(n, '22:00'));
      await bedtime(A);
      await clock(await at(n, '23:30'));
      await bedtime(B);
    }
  }

  // the milestone: A's streak reached 7 after the rescued day (coins + badge + inbox item), so did B's, C's and D's
  for (const p of [A, B, C]) {
    assert.equal(p.milestone7, true, `${p.name} reached 7`);
    const progression = await get(p, '/progression');
    assert.ok(progression.milestones.find((m: { days: number }) => m.days === 7).achieved);
    assert.ok((await get(p, '/inventory')).items.some((i: { code: string }) => i.code === MILESTONE_7.badgeCode));
    const item = (await get(p, '/inbox')).items.find((i: { kind: string }) => i.kind === 'STREAK_MILESTONE');
    assert.deepEqual(item.payload, { days: 7, coins: MILESTONE_7.coins, badgeCode: MILESTONE_7.badgeCode });
  }
  assert.equal(D.milestone7, true);

  // the last close (day 14 in Ho Chi Minh City), then replay every write with its own key
  await dayClose(await at(15, '03:15'));
  const settled = await snapshot();
  for (const p of people) {
    for (const w of p.writes) {
      const again = await app.call(w.method, w.path, { token: p.token, key: w.key, body: w.body });
      if (p.deleted) {
        // the session died with the account: refused before anything is read
        assert.equal(again.status, 401, `replay ${p.name} ${w.path}`);
        assert.equal(again.body.error.code, 'SESSION_INVALID');
      } else {
        assert.equal(again.status, w.status, `replay ${p.name} ${w.path}`);
        assert.deepEqual(again.body, w.answer, `replay ${p.name} ${w.path}`);
      }
    }
  }
  assert.deepEqual(await snapshot(), settled, 'the replays moved nothing');

  // every job once to settle (the idempotency purge, reminders), then twice more: nothing moves
  const late = await at(15, '04:30');
  await clock(late);
  await everyJob(late);
  const afterJobs = await snapshot();
  await everyJob(late);
  await everyJob(late);
  assert.deepEqual(await snapshot(), afterJobs, 'a second and third run of every job moved nothing');
  for (const p of alive()) {
    await checkLedger(p, 'the repeated jobs');
  }

  // 30 days after the deletion the purge removes D completely
  const purgeAt = new Date(Date.parse(deletedAt) + 30 * 86_400_000 + 60_000).toISOString();
  await clock(purgeAt);
  const purged = await runJob('housekeeping', db.app, new Date(purgeAt), log);
  assert.equal(purged.accounts, 1, JSON.stringify(purged));
  assert.equal((await runJob('housekeeping', db.app, new Date(purgeAt), log)).accounts, 0);
  const { rows: columns } = await db.admin.query<{ schema: string; table: string; column: string }>(
    `SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column
       FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.data_type = 'uuid' AND t.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')`,
  );
  assert.ok(columns.length > 10);
  for (const { schema, table, column } of columns) {
    // identifiers from the catalog, never data
    const { rows } = await db.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${schema}"."${table}" WHERE "${column}" = $1`, [D.id]);
    assert.equal(rows[0].n, 0, `${schema}.${table}.${column} still holds the purged user`);
  }
  assert.equal((await get(A, '/guilds/me')).guild.members.length, 3);
});
