// Gate 1 (npm run db:verify): the catalog matches the design.
// The first three tests judge the real schema. The rest prove on a throwaway fixture schema
// that 90-verify.sql accepts each access class and raises, naming the object, when a fence is
// broken; the mutation check repeats that proof over every real table and function.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/migrate.ts';
import { expectPgError, setTestClock } from '../test/helpers.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';

const SQL_DIR = fileURLToPath(new URL('../sql', import.meta.url));
const VERIFY = readFileSync(`${SQL_DIR}/90-verify.sql`, 'utf8');

let real: TestDb;
let fixture: TestDb;
before(async () => {
  real = await createTestDb();
  fixture = await createTestDb();
});
after(async () => {
  await real.drop();
  await fixture.drop();
});

test('every SQL file applies a second time on a populated clone', async () => {
  const client = await real.admin.connect();
  try {
    const steps = await migrate(client, SQL_DIR);
    assert.deepEqual(steps.slice(0, 3), [
      '00-roles.sql',
      '01-app-context.sql',
      '02-meta.sql',
    ]);
    assert.equal(steps.at(-1), '90-verify.sql');
  } finally {
    client.release();
  }
});

test('90-verify.sql passes on the migrated schema', async () => {
  await real.admin.query(VERIFY);
});

test('90-verify.sql raises while meta.test_clock holds a row', async () => {
  try {
    await setTestClock(real.admin, '2026-09-09T18:30:00Z');
    await assert.rejects(
      real.admin.query(VERIFY),
      /^error: meta\.test_clock is not empty/,
    );
  } finally {
    await setTestClock(real.admin, null);
  }
  await real.admin.query(VERIFY);
});

const OWN = '(app.current_user_id() = user_id)';
const FIXTURE = `
  CREATE TABLE fx_own_read (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text);
  ALTER TABLE fx_own_read ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own_select ON fx_own_read FOR SELECT USING ${OWN};
  GRANT SELECT ON fx_own_read TO app_auth;
  SELECT meta.expect_table('fx_own_read', 'own_read', '{SELECT}', '{}', 'user_id');
  SELECT meta.expect_policy('fx_own_read', 'own_select', 'SELECT', '${OWN}', NULL);

  CREATE TABLE fx_own_rw (user_id uuid PRIMARY KEY, a text, b text);
  ALTER TABLE fx_own_rw ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own_select ON fx_own_rw FOR SELECT USING ${OWN};
  CREATE POLICY own_insert ON fx_own_rw FOR INSERT WITH CHECK ${OWN};
  CREATE POLICY own_update ON fx_own_rw FOR UPDATE USING ${OWN} WITH CHECK ${OWN};
  GRANT INSERT, SELECT ON fx_own_rw TO app_auth;
  GRANT UPDATE (a) ON fx_own_rw TO app_auth;
  SELECT meta.expect_table('fx_own_rw', 'own_rw', '{SELECT,INSERT}', '{a}', 'user_id');
  SELECT meta.expect_policy('fx_own_rw', 'own_select', 'SELECT', '${OWN}', NULL);
  SELECT meta.expect_policy('fx_own_rw', 'own_insert', 'INSERT', NULL, '${OWN}');
  SELECT meta.expect_policy('fx_own_rw', 'own_update', 'UPDATE', '${OWN}', '${OWN}');

  CREATE TABLE fx_internal (id int PRIMARY KEY, secret text);
  ALTER TABLE fx_internal ENABLE ROW LEVEL SECURITY;
  SELECT meta.expect_table('fx_internal', 'internal', '{}', '{}', NULL);

  CREATE TABLE fx_content (code text PRIMARY KEY);
  GRANT SELECT ON fx_content TO app_auth;
  SELECT meta.expect_table('fx_content', 'content', '{SELECT}', '{}', NULL);

  CREATE FUNCTION fx_fn(p text) RETURNS text
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT p';
  GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_auth, app_anon;
  SELECT meta.expect_function('fx_fn(text)', '{app_auth,app_anon}');

  CREATE FUNCTION fx_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
  SELECT meta.expect_function('fx_trigger()', '{}');

  CREATE FUNCTION app._fx_helper(p_user uuid) RETURNS int LANGUAGE sql AS 'SELECT 1';
`;

/** [what is broken, the message 90-verify.sql must raise] — each names the broken object. */
const MUTATIONS: [sql: string, raises: RegExp][] = [
  // (1) roles
  ['ALTER ROLE app_conn INHERIT', /role app_conn must be LOGIN NOINHERIT/],
  ['ALTER ROLE app_conn NOLOGIN', /role app_conn must be LOGIN NOINHERIT/],
  ['ALTER ROLE app_auth BYPASSRLS', /role app_auth is SUPERUSER, BYPASSRLS/],
  ['ALTER ROLE app_job SUPERUSER', /role app_job is SUPERUSER, BYPASSRLS/],
  ['ALTER ROLE app_anon LOGIN', /role app_anon can log in/],
  [
    'GRANT app_auth TO app_conn WITH INHERIT TRUE',
    /role membership .* found: app_conn in app_auth \(inherit t, set t, admin f\)/,
  ],
  [
    'GRANT app_job TO app_anon',
    /role membership .* found: app_anon in app_job/,
  ],
  [
    'GRANT pg_read_all_data TO app_auth',
    /role membership .* found: app_auth in pg_read_all_data/,
  ],
  ['REVOKE app_job FROM app_conn', /app_conn cannot SET ROLE app_job/],
  // schemas
  ['GRANT USAGE ON SCHEMA meta TO app_auth', /wrong: app_auth on schema meta/],
  [
    'GRANT CREATE ON SCHEMA public TO app_auth',
    /wrong: app_auth on schema public/,
  ],
  [
    'GRANT USAGE ON SCHEMA public TO PUBLIC',
    /wrong: app_conn on schema public/,
  ],
  ['REVOKE USAGE ON SCHEMA app FROM app_job', /wrong: app_job on schema app/],
  // (2) ownership
  [
    'ALTER TABLE fx_own_read OWNER TO app_auth',
    /table fx_own_read is owned by app role app_auth/,
  ],
  // (3) registry and catalog list the same tables
  [
    'CREATE TABLE public.fx_unregistered (id int)',
    /table fx_unregistered is not registered/,
  ],
  [
    'CREATE VIEW public.fx_view AS SELECT * FROM fx_internal',
    /table fx_view is not registered/,
  ],
  ['DROP TABLE fx_content', /registered table does not exist: fx_content/],
  // (4) row level security and privileges, per class
  [
    'ALTER TABLE fx_own_read DISABLE ROW LEVEL SECURITY',
    /table fx_own_read \(own_read\): row level security is off/,
  ],
  [
    'ALTER TABLE fx_own_rw DISABLE ROW LEVEL SECURITY',
    /table fx_own_rw \(own_rw\): row level security is off/,
  ],
  [
    'ALTER TABLE fx_internal DISABLE ROW LEVEL SECURITY',
    /table fx_internal \(internal\): row level security is off/,
  ],
  [
    'ALTER TABLE fx_own_read RENAME COLUMN user_id TO owner_id',
    /table fx_own_read: registered owner column user_id does not exist/,
  ],
  [
    'GRANT INSERT ON fx_own_read TO app_auth',
    /table fx_own_read: app_auth holds \{INSERT,SELECT\}, expected \{SELECT\}/,
  ],
  [
    'GRANT DELETE ON fx_own_rw TO app_auth',
    /table fx_own_rw: app_auth holds \{DELETE,INSERT,SELECT\}, expected \{INSERT,SELECT\}/,
  ],
  [
    'GRANT SELECT ON fx_internal TO app_auth',
    /table fx_internal: app_auth holds \{SELECT\}, expected \{\}/,
  ],
  [
    'GRANT INSERT ON fx_content TO app_auth',
    /table fx_content: app_auth holds \{INSERT,SELECT\}, expected \{SELECT\}/,
  ],
  [
    'REVOKE SELECT ON fx_content FROM app_auth',
    /table fx_content: app_auth holds \{\}, expected \{SELECT\}/,
  ],
  [
    'GRANT SELECT ON fx_content TO app_anon',
    /table fx_content: app_anon holds \{SELECT\}, expected \{\}/,
  ],
  [
    'GRANT SELECT ON fx_own_read TO app_job',
    /table fx_own_read: app_job holds \{SELECT\}, expected \{\}/,
  ],
  [
    'GRANT SELECT ON fx_own_read TO PUBLIC',
    /table fx_own_read: app_anon holds \{SELECT\}, expected \{\}/,
  ],
  [
    'GRANT SELECT ON meta.test_clock TO app_auth',
    /table meta\.test_clock: app_auth holds \{SELECT\}, expected \{\}/,
  ],
  [
    'GRANT SELECT (secret) ON fx_internal TO app_auth',
    /table fx_internal: app_auth holds a column-level SELECT/,
  ],
  [
    'GRANT UPDATE (b) ON fx_own_rw TO app_auth',
    /table fx_own_rw: app_auth can UPDATE columns \{a,b\}, expected \{a\}/,
  ],
  [
    'REVOKE UPDATE (a) ON fx_own_rw FROM app_auth',
    /table fx_own_rw: app_auth can UPDATE columns \{\}, expected \{a\}/,
  ],
  [
    'GRANT UPDATE (note) ON fx_own_read TO app_anon',
    /table fx_own_read: app_anon can UPDATE columns \{note\}, expected \{\}/,
  ],
  // (5) policies
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read FOR SELECT USING (app.current_user_id() = user_id OR true)`,
    /policy "own_select" on table fx_own_read: USING is \(\(app\.current_user_id\(\) = user_id\) OR true\), registered \(app\.current_user_id\(\) = user_id\)/,
  ],
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read FOR SELECT USING (app.current_user_id() = id)`,
    /policy "own_select" on table fx_own_read: USING is \(app\.current_user_id\(\) = id\)/,
  ],
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read FOR ALL USING ${OWN}`,
    /policy "own_select" on table fx_own_read: command is ALL, registered SELECT/,
  ],
  [
    'DROP POLICY own_select ON fx_own_read',
    /registered policy "own_select" on table fx_own_read does not exist/,
  ],
  [
    'CREATE POLICY extra ON fx_own_read FOR SELECT USING (true)',
    /policy "extra" on table fx_own_read is not registered/,
  ],
  [
    'ALTER POLICY own_update ON fx_own_rw WITH CHECK (true)',
    /policy "own_update" on table fx_own_rw: WITH CHECK is true, registered/,
  ],
  [
    'ALTER POLICY own_insert ON fx_own_rw WITH CHECK (user_id IS NOT NULL)',
    /policy "own_insert" on table fx_own_rw: WITH CHECK is \(user_id IS NOT NULL\)/,
  ],
  [
    'CREATE POLICY anything ON fx_internal USING (true)',
    /internal table fx_internal has policy "anything"/,
  ],
  // (6) search_path of SECURITY DEFINER functions
  [
    'ALTER FUNCTION fx_fn(text) RESET search_path',
    /SECURITY DEFINER function without SET search_path: fx_fn\(text\)/,
  ],
  [
    'ALTER FUNCTION app.now() RESET search_path',
    /SECURITY DEFINER function without SET search_path: app\.now\(\)/,
  ],
  // (7) functions in public
  [
    "CREATE FUNCTION public.fx_unregistered() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    /function fx_unregistered\(\) is not registered/,
  ],
  [
    'DROP FUNCTION fx_fn(text)',
    /registered function fx_fn\(text\) does not exist/,
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_job',
    /function fx_fn\(text\): EXECUTE is held by \{app_anon,app_auth,app_job\}, registered/,
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_trigger() TO app_auth',
    /function fx_trigger\(\): EXECUTE is held by \{app_auth\}, registered \{\}/,
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_fn(text) TO PUBLIC',
    /function fx_fn\(text\): EXECUTE is held by \{app_anon,app_auth,app_conn,app_job,PUBLIC\}/,
  ],
  [
    'REVOKE EXECUTE ON FUNCTION fx_fn(text) FROM app_anon',
    /function fx_fn\(text\): EXECUTE is held by \{app_auth\}, registered/,
  ],
  // (8) internal helpers
  [
    'GRANT EXECUTE ON FUNCTION app._fx_helper(uuid) TO app_auth',
    /internal function app\._fx_helper\(uuid\) is executable by \{app_auth\}/,
  ],
  [
    'GRANT EXECUTE ON FUNCTION app._fx_helper(uuid) TO PUBLIC',
    /internal function app\._fx_helper\(uuid\) is executable by/,
  ],
  [
    'GRANT EXECUTE ON FUNCTION meta.expect_table(text, text, text[], text[], text) TO app_auth',
    /internal function meta\.expect_table\(text,text,text\[\],text\[\],text\) is executable by \{app_auth\}/,
  ],
  // (9) test clock
  [
    'INSERT INTO meta.test_clock (now) VALUES (now())',
    /meta\.test_clock is not empty/,
  ],
];

test('90-verify.sql accepts a schema with every access class', async () => {
  await fixture.admin.query(FIXTURE);
  await fixture.admin.query(VERIFY);
});

test('90-verify.sql raises for each broken fence and names the object', async t => {
  const client = await fixture.admin.connect();
  try {
    for (const [mutation, raises] of MUTATIONS) {
      await t.test(mutation.replace(/\s+/g, ' '), async () => {
        await client.query('BEGIN');
        try {
          await client.query(mutation);
          await assert.rejects(client.query(VERIFY), raises);
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
    // every mutation was rolled back: the fixture schema is intact again
    await client.query(VERIFY);
  } finally {
    client.release();
  }
});

test('the registry refuses a malformed declaration', async () => {
  const declare = (sql: string) => fixture.admin.query(`SELECT ${sql}`);
  const shape = { code: '23514', messagePrefix: 'new row for relation' };
  await expectPgError(
    declare(
      "meta.expect_table('x', 'own_read', '{SELECT,INSERT}', '{}', 'user_id')",
    ),
    shape,
  );
  await expectPgError(
    declare("meta.expect_table('x', 'own_read', '{SELECT}', '{}', NULL)"),
    shape,
  );
  await expectPgError(
    declare("meta.expect_table('x', 'internal', '{SELECT}', '{}', NULL)"),
    shape,
  );
  await expectPgError(
    declare("meta.expect_table('x', 'public', '{SELECT}', '{}', NULL)"),
    shape,
  );
  await expectPgError(
    declare("meta.expect_policy('fx_absent', 'p', 'SELECT', 'true', NULL)"),
    { code: '23503', messagePrefix: 'insert or update on table' },
  );
  await expectPgError(declare("meta.expect_function('fx_absent()', '{}')"), {
    code: '42883',
    messagePrefix: 'function "fx_absent()" does not exist',
  });
});

test('a migration rebuilds the registry from the SQL files and ends with the self-check', async () => {
  const client = await fixture.admin.connect();
  try {
    // the fixture tables are declared by no SQL file, so the rebuilt registry disowns them
    await assert.rejects(
      migrate(client, SQL_DIR),
      /^Error: 90-verify\.sql: table fx_content is not registered/,
    );
  } finally {
    client.release();
  }
});
