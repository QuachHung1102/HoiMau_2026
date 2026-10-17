// GET /shop, POST /shop/{itemCode}/purchase, GET /inventory, POST /inventory/{itemCode}/equip,
// GET /perks, POST /perks/unlock over HTTP on the real database, and the races of
// shop_purchase and perk_unlock as transactions of two pools of app_conn (the real role switch).
// Prices, levels and costs come from the content and the domain, never from the code under test;
// coins and XP are arranged with app._grant through the owner connection.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { PERKS } from '../../../domain/economy.ts';
import { cumulativeXpForLevel } from '../../../domain/progression.ts';
import { SHOP_ITEMS } from '../../content/shopItems.ts';
import { asUser, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, serverPool, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh

let db: TestDb;
let app: TestApp;
let second: Pool;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  second = serverPool(db);
  await setTestClock(db.admin, NOON);
});
after(async () => {
  await setTestClock(db.admin, null);
  await second.end();
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;

const item = (code: string) => SHOP_ITEMS.find(found => found.code === code)!;
const FOREST = item('THEME_FOREST');
const FOX = item('SKIN_FOX');
const SKY = item('THEME_SKY');

function ok(result: CallResult): any {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
function refusal(result: CallResult, status: number, code: string, details?: unknown) {
  assert.deepEqual([result.status, result.body?.error?.code], [status, code], JSON.stringify(result.body));
  assert.deepEqual(result.body.error.details, details);
}
const get = (user: User, path: string) => app.call('GET', path, { token: user.token });
const buy = (user: User, code: string, key = randomUUID()) =>
  app.call('POST', `/shop/${code}/purchase`, { token: user.token, key });
const equip = (user: User, code: string) =>
  app.call('POST', `/inventory/${code}/equip`, { token: user.token, key: randomUUID() });
const unlock = (user: User, body: unknown) =>
  app.call('POST', '/perks/unlock', { token: user.token, key: randomUUID(), body });

/** Ledger rows written as the owner, through the one writer, like a reward would be. */
async function grant(userId: string, xp: number, coin: number) {
  await db.admin.query("SELECT app._grant($1, $2, $3, 'TEST', $4)", [userId, xp, coin, randomUUID()]);
}
/** An onboarded user at the start of `level` (XP sum and high-water mark) with `coin` coins. */
async function userWith({ level = 1, coin = 0 }: { level?: number; coin?: number }) {
  const user = await newOnboardedUser(db);
  if (level > 1 || coin > 0) {
    await grant(user.userId, cumulativeXpForLevel(level), coin);
  }
  return user;
}

/** Everything a purchase or an unlock may touch, as the owner reads it. */
async function stored(userId: string) {
  const { rows } = await db.admin.query(
    `SELECT (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin,
            (SELECT count(*)::int FROM coin_ledger WHERE user_id = $1) AS coin_rows,
            (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows,
            (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
            ARRAY(SELECT s.code || CASE WHEN i.equipped THEN '*' ELSE '' END
                    FROM inventory i JOIN shop_items s ON s.id = i.shop_item_id
                   WHERE i.user_id = $1 ORDER BY s.code) AS inventory,
            ARRAY(SELECT k.perk_code || ':' || k.cost || coalesce(':' || s.code, '')
                    FROM perk_unlocks k LEFT JOIN shop_items s ON s.id = k.shop_item_id
                   WHERE k.user_id = $1 ORDER BY k.perk_code, s.code) AS perks,
            (SELECT to_jsonb(p) - 'created_at' FROM progression_state p WHERE p.user_id = $1) AS state`,
    [userId],
  );
  return rows[0];
}

/** Items made for one test, `n` of them, each a non-default purchasable item at level 1. */
async function testItems(kind: string, price: number, n: number): Promise<string[]> {
  const prefix = `T${randomUUID().slice(0, 8).toUpperCase()}`;
  const codes = Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
  await db.admin.query(
    `INSERT INTO shop_items (code, name, kind, price_coin, min_level, asset_key, purchasable, is_default)
     SELECT c, c, $2, $3, 1, 'test', true, false FROM unnest($1::text[]) c`,
    [codes, kind, price],
  );
  return codes;
}

/** Runs the calls at once, each a transaction of its own, alternating between the two pools. */
function race(userId: string, calls: [string, unknown[]][]) {
  return Promise.allSettled(
    calls.map(([sql, values], i) => asUser(i % 2 === 0 ? db.app : second, userId, c => c.query(sql, values))),
  );
}
const refusalsOf = (results: PromiseSettledResult<unknown>[]) =>
  results.flatMap(r => (r.status === 'rejected' ? [(r.reason as { message: string }).message] : [])).sort();

test('GET /shop: the purchasable and default items with owned, equipped, locked, the coins and the level', async () => {
  const user = await userWith({ level: 2, coin: 95 });
  const shop = ok(await get(user, '/shop'));
  assert.equal(shop.coin, 95);
  assert.equal(shop.level, 2);
  const listed = SHOP_ITEMS.filter(i => i.purchasable || i.isDefault);
  assert.deepEqual(shop.items.map((i: { code: string }) => i.code).sort(), listed.map(i => i.code).sort());
  for (const seed of listed) {
    const got = shop.items.find((i: { code: string }) => i.code === seed.code);
    assert.deepEqual(got, {
      ...seed,
      owned: seed.isDefault,
      equipped: seed.isDefault,
      locked: seed.minLevel > 2,
    });
  }
});

test('purchase: the coins drop by the price, one inventory row, one ledger row, no XP row; a replay answers the same', async () => {
  const user = await userWith({ coin: 100 });
  const start = await stored(user.userId);
  const from = app.logs.length;
  const key = randomUUID();
  const body = ok(await buy(user, 'THEME_FOREST', key));
  assert.deepEqual(body, {
    coin: 100 - FOREST.priceCoin,
    item: { ...FOREST, owned: true, equipped: false, locked: false },
  });
  const end = await stored(user.userId);
  assert.deepEqual(end, {
    ...start,
    coin: 100 - FOREST.priceCoin,
    coin_rows: start.coin_rows + 1,
    inventory: ['THEME_FOREST'],
  });
  const { rows } = await db.admin.query(
    "SELECT amount, ref_id FROM coin_ledger WHERE user_id = $1 AND reason = 'PURCHASE'",
    [user.userId],
  );
  assert.deepEqual(rows, [{ amount: -FOREST.priceCoin, ref_id: 'THEME_FOREST' }]);
  assert.deepEqual(
    app.logs
      .slice(from)
      .filter(line => line.evt === 'ledger')
      .map(({ ts: _, ...line }) => line),
    [{ evt: 'ledger', kind: 'coin', userId: user.userId, amount: -FOREST.priceCoin, reason: 'PURCHASE', refId: 'THEME_FOREST' }],
  );
  assert.deepEqual(ok(await buy(user, 'THEME_FOREST', key)), body);
  assert.deepEqual(await stored(user.userId), end);
  assert.equal(ok(await get(user, '/shop')).coin, 100 - FOREST.priceCoin);
});

test('purchase refusals carry their code and details and change nothing', async () => {
  const user = await userWith({ level: 2, coin: FOREST.priceCoin - 1 });
  const kept = await stored(user.userId);
  refusal(await buy(user, 'NO_SUCH_ITEM'), 404, 'ITEM_NOT_FOUND');
  refusal(await buy(user, 'BADGE_STREAK_7'), 409, 'ITEM_NOT_PURCHASABLE');
  refusal(await buy(user, 'THEME_DEFAULT'), 409, 'ITEM_NOT_PURCHASABLE');
  refusal(await buy(user, 'SKIN_FOX'), 409, 'ITEM_LOCKED_LEVEL', { minLevel: FOX.minLevel });
  refusal(await buy(user, 'THEME_FOREST'), 409, 'INSUFFICIENT_COINS', {
    price: FOREST.priceCoin,
    coin: FOREST.priceCoin - 1,
  });
  assert.deepEqual(await stored(user.userId), kept);

  await grant(user.userId, 0, 1);
  ok(await buy(user, 'THEME_FOREST'));
  await grant(user.userId, 0, 500);
  const owned = await stored(user.userId);
  refusal(await buy(user, 'THEME_FOREST'), 409, 'ALREADY_OWNED');
  assert.deepEqual(await stored(user.userId), owned);
});

test('a purchase made with the coins of a tick: the undo of that tick is 409 UNDO_COINS_SPENT and changes nothing', async () => {
  const user = await userWith({ coin: FOREST.priceCoin - 5 });
  const tick = ok(
    await app.call('POST', '/day/quests/WATER_8/progress', { token: user.token, key: randomUUID(), body: {} }),
  );
  assert.equal(tick.delta.coin, 5);
  ok(await buy(user, 'THEME_FOREST'));
  const kept = await stored(user.userId);
  assert.equal(kept.coin, 0);
  refusal(
    await app.call('POST', '/day/quests/WATER_8/undo', {
      token: user.token,
      key: randomUUID(),
      body: { tickId: tick.actionId },
    }),
    409,
    'UNDO_COINS_SPENT',
  );
  assert.deepEqual(await stored(user.userId), kept);
});

test('race: two different items each costing the whole balance, 20 rounds: exactly one is bought, the balance ends at 0', async () => {
  for (let round = 0; round < 20; round++) {
    const user = await userWith({ coin: 100 });
    const [a, b] = await testItems('THEME', 100, 2);
    const results = await race(user.userId, [
      ['SELECT shop_purchase($1, $2)', [a, randomUUID()]],
      ['SELECT shop_purchase($1, $2)', [b, randomUUID()]],
    ]);
    assert.deepEqual(refusalsOf(results), ['INSUFFICIENT_COINS'], `round ${round}`);
    const end = await stored(user.userId);
    assert.equal(end.coin, 0, `round ${round}`);
    assert.equal(end.coin_rows, 2, `round ${round}`);
    assert.equal(end.inventory.length, 1, `round ${round}`);
  }
});

test('race: the same item with two keys, 20 rounds: one inventory row, one ledger row, the other ALREADY_OWNED', async () => {
  for (let round = 0; round < 20; round++) {
    const user = await userWith({ coin: 500 });
    const results = await race(user.userId, [
      ['SELECT shop_purchase($1, $2)', ['THEME_FOREST', randomUUID()]],
      ['SELECT shop_purchase($1, $2)', ['THEME_FOREST', randomUUID()]],
    ]);
    assert.deepEqual(refusalsOf(results), ['ALREADY_OWNED'], `round ${round}`);
    const end = await stored(user.userId);
    assert.deepEqual([end.coin, end.coin_rows, end.inventory], [500 - FOREST.priceCoin, 2, ['THEME_FOREST']]);
  }
});

test('race: ten 30-coin items against 100 coins: exactly 3 are bought, 10 coins left', async () => {
  const user = await userWith({ coin: 100 });
  const codes = await testItems('BADGE', 30, 10);
  const results = await race(
    user.userId,
    codes.map(code => ['SELECT shop_purchase($1, $2)', [code, randomUUID()]]),
  );
  assert.deepEqual(refusalsOf(results), Array(7).fill('INSUFFICIENT_COINS'));
  const end = await stored(user.userId);
  assert.equal(end.coin, 10);
  assert.equal(end.coin_rows, 4);
  assert.equal(end.inventory.length, 3);
});

test('equip: one item per kind, other kinds untouched, the default leaves none equipped, GET /me follows', async () => {
  const user = await userWith({ level: FOX.minLevel, coin: FOREST.priceCoin + FOX.priceCoin });
  const appearance = async () => ok(await get(user, '/me')).appearance;
  assert.deepEqual(await appearance(), { themeCode: 'THEME_DEFAULT', petSkinCode: 'SKIN_DEFAULT', badgeCode: null });
  ok(await buy(user, 'THEME_FOREST'));
  ok(await buy(user, 'SKIN_FOX'));
  await db.admin.query(
    "INSERT INTO inventory (user_id, shop_item_id, kind) SELECT $1, id, kind FROM shop_items WHERE code = 'BADGE_STREAK_7'",
    [user.userId],
  );

  ok(await equip(user, 'SKIN_FOX'));
  ok(await equip(user, 'BADGE_STREAK_7'));
  const inventory = ok(await equip(user, 'THEME_FOREST'));
  assert.deepEqual((await stored(user.userId)).inventory, ['BADGE_STREAK_7*', 'SKIN_FOX*', 'THEME_FOREST*']);
  assert.deepEqual(await appearance(), { themeCode: 'THEME_FOREST', petSkinCode: 'SKIN_FOX', badgeCode: 'BADGE_STREAK_7' });
  assert.deepEqual(
    inventory.items.map((i: { code: string; equipped: boolean }) => [i.code, i.equipped]),
    [
      ['THEME_DEFAULT', false],
      ['THEME_FOREST', true],
      ['SKIN_DEFAULT', false],
      ['SKIN_FOX', true],
      ['BADGE_STREAK_7', true],
    ],
  );
  assert.deepEqual(ok(await get(user, '/inventory')), inventory);

  const back = ok(await equip(user, 'THEME_DEFAULT'));
  assert.deepEqual((await stored(user.userId)).inventory, ['BADGE_STREAK_7*', 'SKIN_FOX*', 'THEME_FOREST']);
  assert.deepEqual(await appearance(), { themeCode: 'THEME_DEFAULT', petSkinCode: 'SKIN_FOX', badgeCode: 'BADGE_STREAK_7' });
  assert.deepEqual(
    back.items.filter((i: { kind: string }) => i.kind === 'THEME').map((i: { code: string; equipped: boolean }) => [i.code, i.equipped]),
    [['THEME_DEFAULT', true], ['THEME_FOREST', false]],
  );

  const kept = await stored(user.userId);
  refusal(await equip(user, 'THEME_SKY'), 409, 'ITEM_NOT_OWNED');
  refusal(await equip(user, 'BADGE_STREAK_30'), 409, 'ITEM_NOT_OWNED');
  refusal(await equip(user, 'NO_SUCH_ITEM'), 409, 'ITEM_NOT_OWNED');
  assert.deepEqual(await stored(user.userId), kept);
});

test('GET /inventory: the defaults, the owned items and the earned badges; nothing else', async () => {
  const user = await userWith({ coin: FOREST.priceCoin });
  ok(await buy(user, 'THEME_FOREST'));
  await db.admin.query(
    "INSERT INTO inventory (user_id, shop_item_id, kind) SELECT $1, id, kind FROM shop_items WHERE code = 'BADGE_STREAK_7'",
    [user.userId],
  );
  const { items } = ok(await get(user, '/inventory'));
  assert.deepEqual(items.map((i: { code: string }) => i.code), ['THEME_DEFAULT', 'THEME_FOREST', 'SKIN_DEFAULT', 'BADGE_STREAK_7']);
  assert.ok(items.every((i: { owned: boolean }) => i.owned));
});

test('perks: with 2 points MEAL_SWAP_PLUS once, TICKET_CAP_PLUS is short; the cost column equals PERKS', async () => {
  const user = await userWith({ level: 3 });
  const perks = ok(await get(user, '/perks'));
  assert.deepEqual(perks, {
    pointsAvailable: 2,
    perks: [
      { code: 'MEAL_SWAP_PLUS', cost: PERKS.MEAL_SWAP_PLUS.cost, unlocked: false, repeatable: false },
      { code: 'TICKET_CAP_PLUS', cost: PERKS.TICKET_CAP_PLUS.cost, unlocked: false, repeatable: false },
      { code: 'THEME_UNLOCK', cost: PERKS.THEME_UNLOCK.cost, unlocked: false, repeatable: true },
    ],
  });
  refusal(await unlock(user, { perkCode: 'TICKET_CAP_PLUS' }), 409, 'PERK_POINTS_INSUFFICIENT');
  const end = ok(await unlock(user, { perkCode: 'MEAL_SWAP_PLUS', itemCode: 'THEME_FOREST' }));
  assert.equal(end.pointsAvailable, 0);
  assert.equal(end.perks[0].unlocked, true);
  assert.deepEqual((await stored(user.userId)).perks, [`MEAL_SWAP_PLUS:${PERKS.MEAL_SWAP_PLUS.cost}`]);
  assert.deepEqual((await stored(user.userId)).inventory, [], 'the itemCode of another perk is ignored');
  await grant(user.userId, cumulativeXpForLevel(10), 0);
  refusal(await unlock(user, { perkCode: 'MEAL_SWAP_PLUS' }), 409, 'PERK_ALREADY_UNLOCKED');
  ok(await unlock(user, { perkCode: 'TICKET_CAP_PLUS' }));
  refusal(await unlock(user, { perkCode: 'TICKET_CAP_PLUS' }), 409, 'PERK_ALREADY_UNLOCKED');
  assert.deepEqual((await stored(user.userId)).perks, [
    `MEAL_SWAP_PLUS:${PERKS.MEAL_SWAP_PLUS.cost}`,
    `TICKET_CAP_PLUS:${PERKS.TICKET_CAP_PLUS.cost}`,
  ]);
});

test('THEME_UNLOCK: adds the theme without touching coins; refuses an owned, a level-locked or a non-theme item', async () => {
  const user = await userWith({ level: 3, coin: 200 });
  const start = await stored(user.userId);
  refusal(await unlock(user, { perkCode: 'THEME_UNLOCK', itemCode: 'THEME_SKY' }), 409, 'ITEM_LOCKED_LEVEL', {
    minLevel: SKY.minLevel,
  });
  for (const code of ['SKIN_FOX', 'THEME_DEFAULT', 'NO_SUCH_ITEM']) {
    refusal(await unlock(user, { perkCode: 'THEME_UNLOCK', itemCode: code }), 404, 'ITEM_NOT_FOUND');
  }
  assert.deepEqual(await stored(user.userId), start);

  const perks = ok(await unlock(user, { perkCode: 'THEME_UNLOCK', itemCode: 'THEME_FOREST' }));
  assert.equal(perks.pointsAvailable, 1);
  assert.equal(perks.perks[2].unlocked, true);
  assert.deepEqual(await stored(user.userId), {
    ...start,
    inventory: ['THEME_FOREST'],
    perks: [`THEME_UNLOCK:${PERKS.THEME_UNLOCK.cost}:THEME_FOREST`],
  });
  const kept = await stored(user.userId);
  refusal(await unlock(user, { perkCode: 'THEME_UNLOCK', itemCode: 'THEME_FOREST' }), 409, 'ALREADY_OWNED');
  refusal(await buy(user, 'THEME_FOREST'), 409, 'ALREADY_OWNED');
  assert.deepEqual(await stored(user.userId), kept);
});

test('POST /perks/unlock validates its body', async () => {
  const user = await userWith({ level: 3 });
  const fields = async (body: unknown) => {
    const result = await unlock(user, body);
    assert.equal(result.status, 422, JSON.stringify(result.body));
    return result.body.error.details.fields;
  };
  assert.deepEqual(await fields({}), [{ field: 'perkCode', rule: 'required' }]);
  assert.deepEqual(await fields({ perkCode: 'MORE_XP' }), [{ field: 'perkCode', rule: 'enum' }]);
  assert.deepEqual(await fields({ perkCode: 'THEME_UNLOCK' }), [{ field: 'itemCode', rule: 'required' }]);
  assert.deepEqual(await fields({ perkCode: 'THEME_UNLOCK', itemCode: 7 }), [{ field: 'itemCode', rule: 'format' }]);
  assert.deepEqual((await stored(user.userId)).perks, []);
});

test('race: five THEME_UNLOCKs with 3 points, 10 rounds: exactly 3 go through, points end at 0, never below', async () => {
  for (let round = 0; round < 10; round++) {
    const user = await userWith({ level: 4 });
    const themes = await testItems('THEME', 500, 5);
    const results = await race(
      user.userId,
      themes.map(code => ['SELECT perk_unlock($1, $2)', ['THEME_UNLOCK', code]]),
    );
    assert.deepEqual(refusalsOf(results), ['PERK_POINTS_INSUFFICIENT', 'PERK_POINTS_INSUFFICIENT'], `round ${round}`);
    assert.equal(ok(await get(user, '/perks')).pointsAvailable, 0);
    const end = await stored(user.userId);
    assert.equal(end.perks.length, 3);
    assert.equal(end.inventory.length, 3);
    assert.equal(end.coin_rows, 0);
  }
});

test('perk points survive an XP sum lowered below the level: they come from the high-water mark', async () => {
  const user = await userWith({ level: 3 });
  await grant(user.userId, -(cumulativeXpForLevel(3) - cumulativeXpForLevel(2) + 1), 0);
  assert.equal(ok(await get(user, '/shop')).level, 1);
  assert.equal(ok(await get(user, '/perks')).pointsAvailable, 2);
  ok(await unlock(user, { perkCode: 'MEAL_SWAP_PLUS' }));
  assert.equal(ok(await get(user, '/perks')).pointsAvailable, 0);
});
