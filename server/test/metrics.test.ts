// The success metrics of spec section 12 (server/scripts/metrics.sql): every query runs on a
// seeded database and answers one row, `value` and `n` only, with the number the fixture was
// built to give. The fixture holds the people each query must leave out (the decoys that every
// database ships with, an account that asked for deletion with the best numbers in the file, a
// person who returned on the wrong day, a person whose second day is not over), so a query that
// forgets a rule gives another number. The clock is frozen: "today" is 2027-03-10 in
// Asia/Ho_Chi_Minh.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { setTestClock } from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
let empty: TestDb;
before(async () => {
  db = await createTestDb();
  empty = await createTestDb();
});
after(async () => {
  await db.drop();
  await empty.drop();
});

type Query = { id: string; sql: string };

/** The queries of metrics.sql: the statement under each comment that starts `-- M-nn`, without comments. */
async function queries(): Promise<Query[]> {
  const text = await readFile(new URL('../scripts/metrics.sql', import.meta.url), 'utf8');
  return text
    .split(/^-- (?=M-\d\d )/m)
    .slice(1)
    .map(chunk => ({
      id: chunk.slice(0, 4),
      sql: chunk
        .split('\n')
        .slice(1) // the rest of the comment line the split cut into
        .filter(line => !line.startsWith('--') && line.trim() !== '')
        .join('\n'),
    }));
}

type Person = {
  name: string;
  /** Onboarded on this date (null: registered only). */
  onboarded: string | null;
  streak?: number;
  clamped?: boolean;
  deleted?: boolean;
  guild?: string;
  /** Dates with a daily log. */
  logs?: string[];
};

// Today is 2027-03-10. D1 looks at people onboarded on or before 03-08 (second day over), D7 at
// those onboarded on or before 03-02. Active: a log on 03-04 or later.
const PEOPLE: Person[] = [
  { name: 'n1', onboarded: null },
  { name: 'n2', onboarded: null },
  // asked for deletion: the best numbers of the file in every metric, and in no result
  { name: 'dd', onboarded: '2027-03-01', streak: 100, clamped: true, deleted: true, guild: 'G', logs: ['2027-03-02', '2027-03-08', '2027-03-09', '2027-03-10'] },
  { name: 'o1', onboarded: '2027-03-01', streak: 2, guild: 'G', logs: ['2027-03-02', '2027-03-08'] },
  { name: 'o2', onboarded: '2027-03-01', streak: 9, clamped: true, guild: 'G', logs: ['2027-03-02', '2027-03-08'] },
  // logs the day before and the day after the D7 day, not on it
  { name: 'o3', onboarded: '2027-03-01', streak: 4, guild: 'G', logs: ['2027-03-02', '2027-03-07', '2027-03-09'] },
  // came back on the third day, not the second; inactive for a week (03-03 is before 03-04)
  { name: 'o4', onboarded: '2027-03-01', streak: 50, logs: ['2027-03-03'] },
  { name: 'o5', onboarded: '2027-03-01', streak: 30, clamped: true },
  { name: 'o6', onboarded: '2027-03-08', streak: 0, logs: ['2027-03-09'] },
  // second day is today: not over, in no D1 denominator
  { name: 'o7', onboarded: '2027-03-09', streak: 6, logs: ['2027-03-10'] },
  { name: 'o8', onboarded: '2027-03-10', streak: 1 },
];

async function seed(target: TestDb) {
  await setTestClock(target.admin, '2027-03-10T05:00:00.000Z');
  const guild = randomUUID();
  await target.admin.query("INSERT INTO guilds (id, name, invite_code) VALUES ($1, 'Metrics', 'METRICS1')", [guild]);
  for (const p of PEOPLE) {
    const id = randomUUID();
    const onboardedAt = p.onboarded === null ? null : `${p.onboarded}T09:00:00+07:00`;
    await target.admin.query(
      `INSERT INTO users (id, email, display_name, archetype, onboarded_at, terms_accepted_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, '2027-02-01T00:00:00Z', $6)`,
      [id, `${p.name}@example.com`, p.name, p.onboarded === null ? null : 'SUPPORTER', onboardedAt, p.deleted ? '2027-03-09T00:00:00Z' : null],
    );
    if (p.onboarded !== null) {
      await target.admin.query(
        `INSERT INTO progression_state (user_id, streak_current, streak_best, onboard_date) VALUES ($1, $2, $2, $3)`,
        [id, p.streak ?? 0, p.onboarded],
      );
      await target.admin.query(
        `INSERT INTO prescriptions (user_id, bmr, tdee, calorie_target, protein_g, carbs_g, fat_g, water_ml,
                                    safety_clamped, macro_adjusted, computed_at)
         VALUES ($1, 1500, 2100, 1800, 90, 220, 60, 2000, $2, false, now())`,
        [id, p.clamped === true],
      );
    }
    for (const date of p.logs ?? []) {
      await target.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2)', [id, date]);
    }
    if (p.guild !== undefined) {
      await target.admin.query("INSERT INTO guild_memberships (user_id, guild_id, role) VALUES ($1, $2, 'MEMBER')", [id, guild]);
    }
  }
}

// value, n
const EXPECTED: Record<string, [number, number]> = {
  'M-01': [0.8, 10], // 8 of the 10 live registered users (n1, n2, o1..o8)
  'M-02': [0.6667, 6], // o1, o2, o3, o6 of o1..o6
  'M-03': [0.4, 5], // o1, o2 of o1..o5
  'M-04': [4, 5], // streaks 2, 9, 4, 0, 6 of the active o1, o2, o3, o6, o7
  'M-05': [0.375, 8], // o1, o2, o3 of the 8 onboarded
  'M-07': [0.25, 8], // o2, o5 of the 8 onboarded
};

test('metrics.sql has a query for M-01 to M-05 and M-07, and says why there is none for M-06', async () => {
  const found = await queries();
  assert.deepEqual(found.map(q => q.id), ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-07']);
  const text = await readFile(new URL('../scripts/metrics.sql', import.meta.url), 'utf8');
  assert.match(text, /M-06[^\n]*cannot be measured/);
  for (const { id, sql } of found) {
    assert.equal(sql.split(';').length, 2, `${id}: one statement, ended by one semicolon`);
    assert.match(sql.trim(), /;$/, `${id}: ends with its semicolon`);
  }
});

test('on a seeded database every query answers one row of value and n, with the number the fixture gives', async () => {
  await seed(db);
  // the rule "leave out the decoys" is tested only if there are decoys
  const decoys = await db.admin.query("SELECT count(*)::int AS n FROM users WHERE email LIKE '%@decoy.invalid'");
  assert.ok(decoys.rows[0].n >= 1, 'the database ships decoy accounts');
  for (const { id, sql } of await queries()) {
    const result = await db.admin.query(sql);
    assert.equal(result.rowCount, 1, `${id}: one row`);
    assert.deepEqual(result.fields.map(field => field.name), ['value', 'n'], `${id}: only value and n`);
    const [value, n] = [Number(result.rows[0].value), Number(result.rows[0].n)];
    assert.ok(Number.isFinite(value) && value >= 0, `${id}: a non-negative number`);
    if (id !== 'M-04') {
      assert.ok(value <= 1, `${id}: a ratio between 0 and 1 (${value})`);
    }
    assert.deepEqual([value, n], EXPECTED[id], id);
  }
});

test('with nobody to count over a query answers NULL and 0, not an error and not a zero ratio', async () => {
  for (const { id, sql } of await queries()) {
    const result = await empty.admin.query(sql);
    assert.equal(result.rowCount, 1, `${id}: one row`);
    assert.deepEqual([result.rows[0].value, Number(result.rows[0].n)], [null, 0], id);
  }
});

test('a result carries no person: no id, no email, no name, no date', async () => {
  for (const { id, sql } of await queries()) {
    const row = (await db.admin.query(sql)).rows[0];
    for (const value of Object.values(row)) {
      assert.match(String(value), /^[0-9]+(\.[0-9]+)?$/, `${id}: ${value} is a plain number`);
    }
  }
});
