// GET /progression, GET /pet and the derived parts of GET /me, with state arranged by the owner
// (the functions that earn XP, close days and equip items come with later tasks). Every expected
// number is computed here by the domain function the read model must use.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Me, Pet, Progression } from '../../../domain/contract/core.ts';
import { petMood, petProgress } from '../../../domain/pet.ts';
import {
  cumulativeXpForLevel,
  levelForXp,
  perkPointsEarned,
  titleKeyForLevel,
} from '../../../domain/progression.ts';
import { mapStats } from '../../../domain/stats.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await app.close();
  await db.drop();
});

const get = async <T>(path: string, token: string): Promise<T> => {
  const result = await app.call('GET', path, { token });
  assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.body)}`);
  return result.body;
};
const grant = (userId: string, xp: number, coin: number, ref: string) =>
  db.admin.query("SELECT app._grant($1, $2, $3, 'TEST', $4)", [userId, xp, coin, ref]);
const own = (userId: string, code: string, equipped = false) =>
  db.admin.query(
    `INSERT INTO inventory (user_id, shop_item_id, kind, equipped)
     SELECT $1, id, kind, $3 FROM shop_items WHERE code = $2`,
    [userId, code, equipped],
  );

test('a fresh profile: level 1, no XP, no coins, the egg at 0 %, neutral, the default skin', async () => {
  const user = await newOnboardedUser(db);
  const progression: Progression = {
    xp: 0,
    level: 1,
    titleKey: 'TAN_BINH',
    xpIntoLevel: 0,
    xpForNextLevel: 100,
    coin: 0,
    streakCurrent: 0,
    streakBest: 0,
    perkPointsAvailable: 0,
    milestones: [
      { days: 7, achieved: false },
      { days: 30, achieved: false },
      { days: 100, achieved: false },
    ],
    lastOutcome: null,
    breakNotice: null,
  };
  const pet: Pet = {
    stage: 'EGG',
    stageIndex: 0,
    growthPercent: 0,
    mood: 'NEUTRAL',
    skinCode: 'SKIN_DEFAULT',
    nextStage: 'HATCHLING',
  };
  assert.deepEqual(await get('/progression', user.token), progression);
  assert.deepEqual(await get('/pet', user.token), pet);
});

test('XP and coins are ledger sums, the level follows the sum, perk points and the pet follow the high-water mark', async () => {
  const user = await newOnboardedUser(db);
  // up to level 6 and a bit, then an undo that drops the sum back into level 5
  const high = cumulativeXpForLevel(6) + 40;
  const xp = cumulativeXpForLevel(6) - 25;
  await grant(user.userId, high, 310, 'earned');
  await grant(user.userId, xp - high, -45, 'undone');
  await db.admin.query(
    `INSERT INTO perk_unlocks (user_id, perk_code, shop_item_id, cost)
     VALUES ($1, 'MEAL_SWAP_PLUS', NULL, 2), ($1, 'THEME_UNLOCK', (SELECT id FROM shop_items WHERE code = 'THEME_SKY'), 1)`,
    [user.userId],
  );
  await db.admin.query(
    `UPDATE progression_state SET streak_current = 4, streak_best = 9, missed_run = 0,
            last_outcome = 'COMPLETED', last_closed_date = '2027-01-09' WHERE user_id = $1`,
    [user.userId],
  );
  await own(user.userId, 'BADGE_STREAK_7');
  await own(user.userId, 'THEME_FOREST', true);
  await own(user.userId, 'THEME_SKY');
  await own(user.userId, 'SKIN_FOX', true);
  await own(user.userId, 'BADGE_NEW_DAY', true);

  const level = levelForXp(xp);
  assert.deepEqual([level.level, levelForXp(high).level], [5, 6], 'the fixture straddles a level');
  const progression: Progression = {
    xp,
    level: level.level,
    titleKey: titleKeyForLevel(level.level),
    xpIntoLevel: level.xpIntoLevel,
    xpForNextLevel: level.xpForNextLevel,
    coin: 265,
    streakCurrent: 4,
    streakBest: 9,
    // earned on the mark (level 6: five points), never taken back by the undo; three are spent
    perkPointsAvailable: perkPointsEarned(high) - 3,
    milestones: [
      { days: 7, achieved: true },
      { days: 30, achieved: false },
      { days: 100, achieved: false },
    ],
    lastOutcome: 'COMPLETED',
    breakNotice: null,
  };
  assert.equal(progression.perkPointsAvailable, 2);
  assert.equal(progression.titleKey, 'NGUOI_KIEN_TRI');
  const pet: Pet = {
    ...petProgress(high),
    mood: petMood({ streakCurrent: 4, lastOutcome: 'COMPLETED', missedRun: 0 }),
    skinCode: 'SKIN_FOX',
  };
  assert.deepEqual([pet.stage, pet.mood], ['JUVENILE', 'HAPPY']);
  assert.notDeepEqual(petProgress(high), petProgress(xp), 'sum and mark give different growth');

  assert.deepEqual(await get('/progression', user.token), progression);
  assert.deepEqual(await get('/pet', user.token), pet);

  const me = await get<Me>('/me', user.token);
  const prescription = await get<{ calorieTarget: number; waterMl: number }>(
    '/me/prescription',
    user.token,
  );
  assert.deepEqual(
    { progression: me.progression, stats: me.stats, pet: me.pet, appearance: me.appearance },
    {
      progression,
      // nothing recorded today yet (day data arrives with the day routes): only the streak counts
      stats: mapStats({
        waterMl: 0,
        waterTargetMl: prescription.waterMl,
        bedtimeMarked: false,
        streakCurrent: 4,
        caloriesIn: 0,
        calorieTarget: prescription.calorieTarget,
        resistanceMinutes7d: 0,
        cardioMinutes7d: 0,
      }),
      pet,
      appearance: { themeCode: 'THEME_FOREST', petSkinCode: 'SKIN_FOX', badgeCode: 'BADGE_NEW_DAY' },
    },
  );
  assert.deepEqual(me.stats, { hp: 11, en: 0, str: 0, spd: 0 });
});

test('a broken streak shows as breakNotice, three missed days make the pet tired, every milestone badge counts', async () => {
  const user = await newOnboardedUser(db);
  await db.admin.query(
    `UPDATE progression_state SET streak_current = 0, streak_best = 31, streak_before_break = 6,
            break_date = '2027-01-08', missed_run = 3, last_outcome = 'MISSED' WHERE user_id = $1`,
    [user.userId],
  );
  for (const code of ['BADGE_STREAK_7', 'BADGE_STREAK_30', 'BADGE_STREAK_100', 'BADGE_GUILD_TOP1']) {
    await own(user.userId, code);
  }
  const progression = await get<Progression>('/progression', user.token);
  assert.deepEqual(
    {
      streakCurrent: progression.streakCurrent,
      streakBest: progression.streakBest,
      lastOutcome: progression.lastOutcome,
      breakNotice: progression.breakNotice,
      milestones: progression.milestones,
    },
    {
      streakCurrent: 0,
      streakBest: 31,
      lastOutcome: 'MISSED',
      breakNotice: { previous: 6, date: '2027-01-08' },
      milestones: [
        { days: 7, achieved: true },
        { days: 30, achieved: true },
        { days: 100, achieved: true },
      ],
    },
  );
  const pet = await get<Pet>('/pet', user.token);
  assert.deepEqual([pet.mood, pet.stage, pet.skinCode], ['TIRED', 'EGG', 'SKIN_DEFAULT']);
  // owned, none equipped: the defaults, and no badge
  assert.deepEqual((await get<Me>('/me', user.token)).appearance, {
    themeCode: 'THEME_DEFAULT',
    petSkinCode: 'SKIN_DEFAULT',
    badgeCode: null,
  });
});

test('progression and pet are the caller’s own: another user’s ledger, streak and items do not show', async () => {
  const [a, b] = [await newOnboardedUser(db), await newOnboardedUser(db)];
  await grant(b.userId, 5000, 900, 'earned');
  await db.admin.query(
    "UPDATE progression_state SET streak_current = 12, streak_best = 12, last_outcome = 'COMPLETED' WHERE user_id = $1",
    [b.userId],
  );
  await own(b.userId, 'SKIN_FOX', true);
  await own(b.userId, 'BADGE_STREAK_7', true);
  await db.admin.query(
    "INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'TICKET_CAP_PLUS', 3)",
    [b.userId],
  );

  const mine = await get<Progression>('/progression', a.token);
  assert.deepEqual(
    [mine.xp, mine.coin, mine.level, mine.streakCurrent, mine.perkPointsAvailable, mine.milestones[0].achieved],
    [0, 0, 1, 0, 0, false],
  );
  const pet = await get<Pet>('/pet', a.token);
  assert.deepEqual([pet.stage, pet.growthPercent, pet.mood, pet.skinCode], ['EGG', 0, 'NEUTRAL', 'SKIN_DEFAULT']);
  assert.equal((await get<Me>('/me', a.token)).appearance?.badgeCode, null);

  const theirs = await get<Progression>('/progression', b.token);
  assert.deepEqual([theirs.xp, theirs.coin, theirs.streakCurrent], [5000, 900, 12]);
  assert.equal(theirs.perkPointsAvailable, perkPointsEarned(5000) - 3);
});
