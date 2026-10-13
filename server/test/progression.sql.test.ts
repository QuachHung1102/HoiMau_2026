// 20-progression.sql at the SQL level. app._grant and app._level are internal, so they are
// called through the owner connection (as the SECURITY DEFINER functions of later tasks will);
// every fence is tried through app_conn with the real role switch.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { PET_STAGES } from '../../domain/pet.ts';
import {
  MAX_SEEDED_LEVEL,
  cumulativeXpForLevel,
  levelForXp,
} from '../../domain/progression.ts';
import { SHOP_ITEMS } from '../content/shopItems.ts';
import { SUPERUSER, TEST } from '../scripts/cluster.ts';
import { seed as seedLevels } from '../src/seed/levels.ts';
import { seed as seedShopItems } from '../src/seed/shopItems.ts';
import { asAnon, asJob, asUser, expectPgError } from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
/** The owner again, but ten connections wide: db.admin has two, too few to race ten grants. */
let wide: pg.Pool;
before(async () => {
  db = await createTestDb();
  wide = new pg.Pool({
    host: '127.0.0.1',
    port: TEST.port,
    ...SUPERUSER,
    database: db.name,
    max: 10,
  });
});
after(async () => {
  await wide.end();
  await db.drop();
});

type Work = (client: pg.PoolClient) => Promise<unknown>;

const DENIED = '42501';
const RAISED = 'P0001';
const UNIQUE = '23505';
const CHECK = '23514';
const FOREIGN_KEY = '23503';

type Granted = {
  xpBefore: number;
  xpAfter: number;
  coinBefore: number;
  coinAfter: number;
  highWaterBefore: number;
  highWaterAfter: number;
  applied: boolean;
};

/** A registered user with a progression_state row, arranged by the owner. */
async function newPlayer(): Promise<string> {
  const { rows } = await asAnon(db.app, c =>
    c.query<{ id: string }>('SELECT auth_register($1, $2, $3, $4, $5) AS id', [
      `p${randomBytes(6).toString('hex')}@example.com`,
      'Mầm',
      randomBytes(16),
      randomBytes(32),
      randomBytes(32),
    ]),
  );
  await db.admin.query(
    "INSERT INTO progression_state (user_id, onboard_date) VALUES ($1, '2027-01-10')",
    [rows[0].id],
  );
  return rows[0].id;
}

async function grant(
  user: string | null,
  xp: number | null,
  coin: number | null,
  reason: string | null,
  ref: string | null,
  pool: pg.Pool = db.admin,
): Promise<Granted> {
  const { rows } = await pool.query<{ r: Granted }>(
    'SELECT app._grant($1, $2, $3, $4, $5) AS r',
    [user, xp, coin, reason, ref],
  );
  return rows[0].r;
}

/** What the database holds for the user, read by the owner. */
async function state(user: string) {
  const { rows } = await db.admin.query<{
    xp: number;
    xp_rows: number;
    coin: number;
    coin_rows: number;
    high: number;
  }>(
    `SELECT (SELECT coalesce(sum(amount), 0)::int FROM xp_ledger WHERE user_id = $1) AS xp,
            (SELECT count(*)::int FROM xp_ledger WHERE user_id = $1) AS xp_rows,
            (SELECT coalesce(sum(amount), 0)::int FROM coin_ledger WHERE user_id = $1) AS coin,
            (SELECT count(*)::int FROM coin_ledger WHERE user_id = $1) AS coin_rows,
            (SELECT xp_high_water FROM progression_state WHERE user_id = $1) AS high`,
    [user],
  );
  return rows[0];
}

const level = async (user: string): Promise<number> =>
  (await db.admin.query('SELECT app._level($1) AS level', [user])).rows[0]
    .level;

// ---------------------------------------------------------------- app._grant

test('app._grant: a grant becomes one XP row and one coin row and reports the sums before and after', async () => {
  const user = await newPlayer();
  assert.deepEqual(await grant(user, 50, 20, 'QUEST_COMPLETE', 'A:2027-01-10'), {
    xpBefore: 0,
    xpAfter: 50,
    coinBefore: 0,
    coinAfter: 20,
    highWaterBefore: 0,
    highWaterAfter: 50,
    applied: true,
  });
  const { rows } = await db.admin.query(
    `SELECT 'xp' AS kind, amount, reason, ref_id FROM xp_ledger WHERE user_id = $1
     UNION ALL
     SELECT 'coin', amount, reason, ref_id FROM coin_ledger WHERE user_id = $1 ORDER BY 1`,
    [user],
  );
  assert.deepEqual(rows, [
    { kind: 'coin', amount: 20, reason: 'QUEST_COMPLETE', ref_id: 'A:2027-01-10' },
    { kind: 'xp', amount: 50, reason: 'QUEST_COMPLETE', ref_id: 'A:2027-01-10' },
  ]);
});

test('app._grant: the same (reason, ref) twice is one ledger row, and the second call reports applied false', async () => {
  const user = await newPlayer();
  const first = await grant(user, 10, 5, 'QUEST_TICK', 'tick-1');
  assert.equal(first.applied, true);
  assert.deepEqual(await grant(user, 10, 5, 'QUEST_TICK', 'tick-1'), {
    xpBefore: 10,
    xpAfter: 10,
    coinBefore: 5,
    coinAfter: 5,
    highWaterBefore: 10,
    highWaterAfter: 10,
    applied: false,
  });
  assert.deepEqual(await state(user), {
    xp: 10,
    xp_rows: 1,
    coin: 5,
    coin_rows: 1,
    high: 10,
  });
  // the key is (user, reason, ref): another reason or another ref is another grant ...
  assert.equal((await grant(user, 10, 5, 'QUEST_TICK', 'tick-2')).applied, true);
  assert.equal((await grant(user, 10, 5, 'JOURNAL', 'tick-1')).applied, true);
  // ... and so is the same key for another user
  const other = await newPlayer();
  assert.equal((await grant(other, 10, 5, 'QUEST_TICK', 'tick-1')).applied, true);
  assert.deepEqual(await state(user), {
    xp: 30,
    xp_rows: 3,
    coin: 15,
    coin_rows: 3,
    high: 30,
  });
});

test('app._grant: ten grants at the same moment with distinct refs add up exactly, each seeing the one before', async () => {
  const user = await newPlayer();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      grant(user, 10, 3, 'QUEST_TICK', `parallel-${i}`, wide),
    ),
  );
  assert.deepEqual(await state(user), {
    xp: 100,
    xp_rows: 10,
    coin: 30,
    coin_rows: 10,
    high: 100,
  });
  // serialised by the row lock: the ten answers form one chain 0 -> 10 -> ... -> 100
  const sorted = results.sort((a, b) => a.xpAfter - b.xpAfter);
  assert.deepEqual(
    sorted.map(r => [r.xpBefore, r.xpAfter, r.coinBefore, r.coinAfter, r.highWaterAfter, r.applied]),
    Array.from({ length: 10 }, (_, i) => [
      i * 10,
      (i + 1) * 10,
      i * 3,
      (i + 1) * 3,
      (i + 1) * 10,
      true,
    ]),
  );
});

test('app._grant: ten identical grants at the same moment are applied once', async () => {
  const user = await newPlayer();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      grant(user, 50, 20, 'QUEST_COMPLETE', 'WORKOUT_MAIN:2027-01-10', wide),
    ),
  );
  assert.equal(results.filter(r => r.applied).length, 1);
  assert.deepEqual(await state(user), {
    xp: 50,
    xp_rows: 1,
    coin: 20,
    coin_rows: 1,
    high: 50,
  });
});

test('app._grant: a negative grant lowers the sum and never xp_high_water', async () => {
  const user = await newPlayer();
  await grant(user, 300, 40, 'QUEST_TICK', 'tick-1');
  assert.deepEqual(await grant(user, -300, -40, 'QUEST_TICK_UNDO', 'tick-1'), {
    xpBefore: 300,
    xpAfter: 0,
    coinBefore: 40,
    coinAfter: 0,
    highWaterBefore: 300,
    highWaterAfter: 300,
    applied: true,
  });
  // earning again below the mark does not move it; passing it does
  assert.equal((await grant(user, 200, 0, 'QUEST_TICK', 'tick-2')).highWaterAfter, 300);
  assert.equal((await grant(user, 150, 0, 'QUEST_TICK', 'tick-3')).highWaterAfter, 350);
  assert.deepEqual(await state(user), {
    xp: 350,
    xp_rows: 4,
    coin: 0,
    coin_rows: 2,
    high: 350,
  });
});

test('app._grant: a zero amount writes no row of that ledger', async () => {
  const user = await newPlayer();
  assert.equal((await grant(user, 15, 0, 'JOURNAL', '2027-01-10')).applied, true);
  assert.equal((await grant(user, 0, -80, 'PURCHASE', 'THEME_FOREST')).applied, true);
  assert.equal((await grant(user, 0, 0, 'NOTHING', 'x')).applied, false);
  assert.deepEqual(await state(user), {
    xp: 15,
    xp_rows: 1,
    coin: -80,
    coin_rows: 1,
    high: 15,
  });
});

test('app._grant refuses a null argument and a user without a progression_state row', async () => {
  const user = await newPlayer();
  const withNull: Parameters<typeof grant>[] = [
    [null, 1, 1, 'R', 'x'],
    [user, null, 1, 'R', 'x'],
    [user, 1, null, 'R', 'x'],
    [user, 1, 1, null, 'x'],
    [user, 1, 1, 'R', null],
  ];
  for (const args of withNull) {
    await expectPgError(grant(...args), {
      code: RAISED,
      messagePrefix: 'app._grant: no argument may be null',
    });
  }
  const { rows } = await asAnon(db.app, c =>
    c.query<{ id: string }>('SELECT auth_register($1, $2, $3, $4, $5) AS id', [
      `p${randomBytes(6).toString('hex')}@example.com`,
      'Mầm',
      randomBytes(16),
      randomBytes(32),
      randomBytes(32),
    ]),
  );
  await expectPgError(grant(rows[0].id, 1, 1, 'R', 'x'), {
    code: RAISED,
    messagePrefix: 'app._grant: the user has no progression_state row',
  });
  assert.deepEqual(await state(user), {
    xp: 0,
    xp_rows: 0,
    coin: 0,
    coin_rows: 0,
    high: 0,
  });
});

// ---------------------------------------------------------------- app._level

test('app._level follows the XP sum across each threshold, and not a higher xp_high_water', async () => {
  for (const target of [2, 5, 10]) {
    const user = await newPlayer();
    const threshold = cumulativeXpForLevel(target);
    await grant(user, threshold - 1, 0, 'TEST', 'below');
    assert.equal(await level(user), target - 1, `one XP below level ${target}`);
    await grant(user, 1, 0, 'TEST', 'at');
    assert.equal(await level(user), target, `at level ${target}`);
    // an undo: the sum is below the threshold again, the high-water mark stays on it
    await grant(user, -1, 0, 'TEST_UNDO', 'at');
    assert.deepEqual(await state(user), {
      xp: threshold - 1,
      xp_rows: 3,
      coin: 0,
      coin_rows: 0,
      high: threshold,
    });
    assert.equal(await level(user), target - 1, `below level ${target} again`);
    assert.equal(levelForXp(threshold - 1).level, target - 1);
    assert.equal(levelForXp(threshold).level, target);
  }
});

test('app._level is 1 without a ledger row and stops at the last seeded level', async () => {
  const user = await newPlayer();
  assert.equal(await level(user), 1);
  await grant(user, cumulativeXpForLevel(MAX_SEEDED_LEVEL) + 5_000_000, 0, 'TEST', 'far');
  assert.equal(await level(user), MAX_SEEDED_LEVEL);
});

// ---------------------------------------------------------------- fences

test('a signed-in user writes no ledger, state, inventory, perk or content row, and calls neither helper (R-03.1)', async () => {
  const user = await newPlayer();
  await grant(user, 100, 50, 'TEST', 'seed');
  await db.admin.query(
    `INSERT INTO inventory (user_id, shop_item_id, kind)
     SELECT $1, id, kind FROM shop_items WHERE code = 'THEME_FOREST'`,
    [user],
  );
  await db.admin.query(
    "INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'MEAL_SWAP_PLUS', 2)",
    [user],
  );
  const earlier = await snapshot(user);

  const onTable: [string, string][] = [
    ['xp_ledger', "INSERT INTO xp_ledger (user_id, amount, reason, ref_id) VALUES ($1, 100000, 'CHEAT', 'x')"],
    ['xp_ledger', 'UPDATE xp_ledger SET amount = 100000 WHERE user_id = $1'],
    ['xp_ledger', 'DELETE FROM xp_ledger WHERE user_id = $1'],
    ['coin_ledger', "INSERT INTO coin_ledger (user_id, amount, reason, ref_id) VALUES ($1, 100000, 'CHEAT', 'x')"],
    ['coin_ledger', 'UPDATE coin_ledger SET amount = 100000 WHERE user_id = $1'],
    ['coin_ledger', 'DELETE FROM coin_ledger WHERE user_id = $1'],
    ['progression_state', 'UPDATE progression_state SET xp_high_water = 100000 WHERE user_id = $1'],
    ['progression_state', 'UPDATE progression_state SET streak_current = 99, streak_best = 99 WHERE user_id = $1'],
    ['progression_state', 'DELETE FROM progression_state WHERE user_id = $1'],
    ['progression_state', "INSERT INTO progression_state (user_id, onboard_date) VALUES ($1, '2027-01-01')"],
    ['inventory', "INSERT INTO inventory (user_id, shop_item_id, kind) SELECT $1, id, kind FROM shop_items WHERE code = 'THEME_SKY'"],
    ['inventory', 'UPDATE inventory SET equipped = true WHERE user_id = $1'],
    ['inventory', 'DELETE FROM inventory WHERE user_id = $1'],
    ['perk_unlocks', "INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'TICKET_CAP_PLUS', 3)"],
    ['perk_unlocks', 'DELETE FROM perk_unlocks WHERE user_id = $1'],
    ['shop_items', 'UPDATE shop_items SET price_coin = 0, min_level = 1 WHERE $1::uuid IS NOT NULL'],
    ['level_thresholds', 'UPDATE level_thresholds SET cumulative_xp = 0 WHERE $1::uuid IS NOT NULL'],
    ['level_thresholds', 'INSERT INTO level_thresholds (level, cumulative_xp) SELECT 999, 1 WHERE $1::uuid IS NOT NULL'],
    ['pet_stages', 'DELETE FROM pet_stages WHERE $1::uuid IS NOT NULL'],
  ];
  for (const [table, sql] of onTable) {
    await expectPgError(
      asUser(db.app, user, c => c.query(sql, [user])),
      { code: DENIED, messagePrefix: `permission denied for table ${table}` },
    );
  }
  const onFunction: [string, string][] = [
    ['_grant', "SELECT app._grant($1, 100000, 100000, 'CHEAT', 'x')"],
    ['_level', 'SELECT app._level($1)'],
  ];
  for (const [name, sql] of onFunction) {
    for (const as of [
      (work: Work) => asUser(db.app, user, work),
      (work: Work) => asAnon(db.app, work),
      (work: Work) => asJob(db.app, work),
    ]) {
      await expectPgError(
        as(c => c.query(sql, [user])),
        { code: DENIED, messagePrefix: `permission denied for function ${name}` },
      );
    }
  }
  // a request that never switched role is app_conn, which cannot even name the schemas
  await expectPgError(
    db.app.query("SELECT app._grant($1, 1, 1, 'CHEAT', 'x')", [user]),
    { code: DENIED, messagePrefix: 'permission denied for schema app' },
  );
  await expectPgError(db.app.query('SELECT * FROM public.xp_ledger'), {
    code: DENIED,
    messagePrefix: 'permission denied for schema public',
  });
  // and a visitor reads none of it
  for (const table of ['xp_ledger', 'coin_ledger', 'progression_state', 'inventory', 'perk_unlocks', 'shop_items', 'level_thresholds', 'pet_stages']) {
    await expectPgError(
      asAnon(db.app, c => c.query(`SELECT * FROM ${table}`)),
      { code: DENIED, messagePrefix: `permission denied for table ${table}` },
    );
  }
  assert.deepEqual(await snapshot(user), earlier);
});

/** Every row of the five user tables for one user, and the content a cheat would aim at. */
async function snapshot(user: string): Promise<unknown> {
  const { rows } = await db.admin.query(
    `SELECT (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM xp_ledger t WHERE t.user_id = $1) AS xp,
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM coin_ledger t WHERE t.user_id = $1) AS coin,
            (SELECT to_jsonb(t) FROM progression_state t WHERE t.user_id = $1) AS state,
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM inventory t WHERE t.user_id = $1) AS inventory,
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM perk_unlocks t WHERE t.user_id = $1) AS perks,
            (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.code) FROM shop_items t) AS shop,
            (SELECT count(*)::int FROM level_thresholds) AS levels,
            (SELECT count(*)::int FROM pet_stages) AS stages`,
    [user],
  );
  return rows[0];
}

test('a signed-in user reads the own rows only, and the content', async () => {
  const [a, b] = [await newPlayer(), await newPlayer()];
  for (const user of [a, b]) {
    await grant(user, 100, 50, 'TEST', 'seed');
    await db.admin.query(
      `INSERT INTO inventory (user_id, shop_item_id, kind)
       SELECT $1, id, kind FROM shop_items WHERE code = 'THEME_FOREST'`,
      [user],
    );
    await db.admin.query(
      "INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'MEAL_SWAP_PLUS', 2)",
      [user],
    );
  }
  for (const table of ['progression_state', 'xp_ledger', 'coin_ledger', 'inventory', 'perk_unlocks']) {
    const all = await asUser(db.app, a, c =>
      c.query(`SELECT user_id FROM ${table}`),
    );
    assert.deepEqual(all.rows, [{ user_id: a }], table);
    const theirs = await asUser(db.app, a, c =>
      c.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [b]),
    );
    assert.equal(theirs.rowCount, 0, table);
  }
  const content = await asUser(db.app, a, c =>
    c.query(
      `SELECT (SELECT count(*)::int FROM level_thresholds) AS levels,
              (SELECT count(*)::int FROM pet_stages) AS stages,
              (SELECT count(*)::int FROM shop_items) AS items`,
    ),
  );
  assert.deepEqual(content.rows, [
    { levels: MAX_SEEDED_LEVEL, stages: PET_STAGES.length, items: SHOP_ITEMS.length },
  ]);
});

// ---------------------------------------------------------------- shape and seeds

test('nothing derivable is stored: no xp, coin, level, perk point or stat column (AR-04)', async () => {
  const { rows } = await db.admin.query<{ column: string }>(
    `SELECT table_name || '.' || column_name AS column
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~ '^(xp|coins?|level|perk_?points?|hp|en|str|spd|pet_stage|stage|mood)$'
      ORDER BY 1`,
  );
  // the two keys of the content tables, and nothing on any table that holds a user's rows
  assert.deepEqual(
    rows.map(row => row.column),
    ['level_thresholds.level', 'pet_stages.stage'],
  );
});

test('the constraints the functions of later tasks rely on', async () => {
  const user = await newPlayer();
  await grant(user, 10, 10, 'TEST', 'seed');
  const item = (code: string) =>
    `(SELECT id FROM shop_items WHERE code = '${code}')`;
  const refused: [string, string, string][] = [
    [CHECK, 'xp_ledger_amount_check', "INSERT INTO xp_ledger (user_id, amount, reason, ref_id) VALUES ($1, 0, 'TEST', 'zero')"],
    [CHECK, 'coin_ledger_amount_check', "INSERT INTO coin_ledger (user_id, amount, reason, ref_id) VALUES ($1, 0, 'TEST', 'zero')"],
    [UNIQUE, 'xp_ledger_once_key', "INSERT INTO xp_ledger (user_id, amount, reason, ref_id) VALUES ($1, 5, 'TEST', 'seed')"],
    [UNIQUE, 'coin_ledger_once_key', "INSERT INTO coin_ledger (user_id, amount, reason, ref_id) VALUES ($1, 5, 'TEST', 'seed')"],
    [CHECK, 'progression_state_xp_high_water_check', 'UPDATE progression_state SET xp_high_water = -1 WHERE user_id = $1'],
    [CHECK, 'progression_state_streak_best_check', 'UPDATE progression_state SET streak_current = 3, streak_best = 2 WHERE user_id = $1'],
    [CHECK, 'progression_state_last_outcome_check', "UPDATE progression_state SET last_outcome = 'WON' WHERE user_id = $1"],
    [FOREIGN_KEY, 'inventory_item_kind_fkey', `INSERT INTO inventory (user_id, shop_item_id, kind) VALUES ($1, ${item('THEME_SKY')}, 'BADGE')`],
    [UNIQUE, 'inventory_owned_once_key', `INSERT INTO inventory (user_id, shop_item_id, kind) VALUES ($1, ${item('THEME_FOREST')}, 'THEME')`],
    [UNIQUE, 'inventory_one_equipped_idx', `INSERT INTO inventory (user_id, shop_item_id, kind, equipped) VALUES ($1, ${item('THEME_SKY')}, 'THEME', true)`],
    [UNIQUE, 'perk_unlocks_once_idx', "INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'MEAL_SWAP_PLUS', 2)"],
    [UNIQUE, 'perk_unlocks_once_idx', `INSERT INTO perk_unlocks (user_id, perk_code, shop_item_id, cost) VALUES ($1, 'THEME_UNLOCK', ${item('THEME_SKY')}, 1)`],
    [CHECK, 'perk_unlocks_cost_check', "INSERT INTO perk_unlocks (user_id, perk_code, cost) VALUES ($1, 'TICKET_CAP_PLUS', 0)"],
    [UNIQUE, 'shop_items_one_default_idx', "INSERT INTO shop_items (code, name, kind, price_coin, min_level, asset_key, purchasable, is_default) SELECT 'THEME_X', 'x', 'THEME', 0, 1, 'x', false, true WHERE $1::uuid IS NOT NULL"],
    [CHECK, 'shop_items_kind_check', "INSERT INTO shop_items (code, name, kind, price_coin, min_level, asset_key, purchasable, is_default) SELECT 'X', 'x', 'WEAPON', 0, 1, 'x', false, false WHERE $1::uuid IS NOT NULL"],
  ];
  // what the refusals below collide with
  await db.admin.query(
    `INSERT INTO inventory (user_id, shop_item_id, kind, equipped) VALUES ($1, ${item('THEME_FOREST')}, 'THEME', true)`,
    [user],
  );
  await db.admin.query(
    `INSERT INTO perk_unlocks (user_id, perk_code, shop_item_id, cost)
     VALUES ($1, 'MEAL_SWAP_PLUS', NULL, 2), ($1, 'THEME_UNLOCK', ${item('THEME_SKY')}, 1)`,
    [user],
  );
  for (const [code, constraint, sql] of refused) {
    await assert.rejects(db.admin.query(sql, [user]), (e: unknown) => {
      assert.deepEqual(
        [(e as pg.DatabaseError).code, (e as pg.DatabaseError).constraint],
        [code, constraint],
        sql,
      );
      return true;
    });
  }
  // the repeatable perk: another theme is another row
  await db.admin.query(
    `INSERT INTO perk_unlocks (user_id, perk_code, shop_item_id, cost) VALUES ($1, 'THEME_UNLOCK', ${item('THEME_FOREST')}, 1)`,
    [user],
  );
  // deleting the account takes every row with it
  await db.admin.query('DELETE FROM users WHERE id = $1', [user]);
  const left = await db.admin.query(
    `SELECT (SELECT count(*) FROM xp_ledger WHERE user_id = $1) + (SELECT count(*) FROM coin_ledger WHERE user_id = $1)
          + (SELECT count(*) FROM progression_state WHERE user_id = $1) + (SELECT count(*) FROM inventory WHERE user_id = $1)
          + (SELECT count(*) FROM perk_unlocks WHERE user_id = $1) AS n`,
    [user],
  );
  assert.equal(Number(left.rows[0].n), 0);
});

test('seed parity: level_thresholds, pet_stages and shop_items are what the domain and the content say', async () => {
  const levels = await db.admin.query(
    'SELECT level, cumulative_xp FROM level_thresholds ORDER BY level',
  );
  assert.equal(levels.rowCount, MAX_SEEDED_LEVEL);
  assert.deepEqual(
    levels.rows,
    Array.from({ length: MAX_SEEDED_LEVEL }, (_, i) => ({
      level: i + 1,
      cumulative_xp: cumulativeXpForLevel(i + 1),
    })),
  );
  assert.deepEqual(levels.rows[0], { level: 1, cumulative_xp: 0 });
  assert.ok(
    levels.rows.every(
      (row, i) => i === 0 || row.cumulative_xp > levels.rows[i - 1].cumulative_xp,
    ),
    'strictly increasing',
  );

  const stages = await db.admin.query(
    'SELECT stage, size_xp AS "sizeXp" FROM pet_stages ORDER BY ord',
  );
  assert.deepEqual(stages.rows, [...PET_STAGES]);

  const items = await db.admin.query(
    `SELECT code, name, kind, price_coin AS "priceCoin", min_level AS "minLevel", asset_key AS "assetKey",
            purchasable, is_default AS "isDefault"
       FROM shop_items ORDER BY code`,
  );
  assert.deepEqual(
    items.rows,
    [...SHOP_ITEMS].sort((a, b) => (a.code < b.code ? -1 : 1)),
  );
  // what the read model relies on: one default theme and one default skin
  const defaults = await db.admin.query(
    'SELECT kind, code FROM shop_items WHERE is_default ORDER BY kind',
  );
  assert.deepEqual(defaults.rows, [
    { kind: 'PET_SKIN', code: 'SKIN_DEFAULT' },
    { kind: 'THEME', code: 'THEME_DEFAULT' },
  ]);
});

test('the seeders run again and rewrite no row; a row that drifted is put back', async () => {
  // xmin changes whenever a row is written, also when it is written with the same values
  const content = async () =>
    (
      await db.admin.query(
        `SELECT 'level' AS t, level::text AS k, xmin::text AS x, to_jsonb(l) AS row FROM level_thresholds l
         UNION ALL SELECT 'stage', stage, xmin::text, to_jsonb(p) FROM pet_stages p
         UNION ALL SELECT 'item', code, xmin::text, to_jsonb(s) FROM shop_items s
         ORDER BY 1, 2`,
      )
    ).rows;
  const seeded = await content();
  assert.equal(
    seeded.length,
    MAX_SEEDED_LEVEL + PET_STAGES.length + SHOP_ITEMS.length,
  );
  for (let run = 0; run < 2; run++) {
    await seedLevels(db.admin as unknown as pg.ClientBase);
    await seedShopItems(db.admin as unknown as pg.ClientBase);
    assert.deepEqual(await content(), seeded);
  }

  await db.admin.query('UPDATE level_thresholds SET cumulative_xp = 1 WHERE level = 2');
  await db.admin.query("UPDATE pet_stages SET size_xp = 1 WHERE stage = 'EGG'");
  await db.admin.query("UPDATE shop_items SET price_coin = 1 WHERE code = 'THEME_SKY'");
  await db.admin.query("DELETE FROM level_thresholds WHERE level = 200");
  await seedLevels(db.admin as unknown as pg.ClientBase);
  await seedShopItems(db.admin as unknown as pg.ClientBase);
  const strip = (rows: { t: string; k: string; row: Record<string, unknown> }[]) =>
    rows.map(({ t, k, row }) => [t, k, { ...row, created_at: null }]);
  assert.deepEqual(strip(await content()), strip(seeded));
});
