// Gate 1 (npm run db:verify): the catalog matches the design.
// The first three tests judge the real schema. The rest prove on a throwaway fixture schema
// that 90-verify.sql accepts each access class and raises, naming the object, when a fence is
// broken; the mutation check repeats that proof over every real table and function.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { migrate } from '../src/migrate.ts';
import { expectPgError, setTestClock } from '../test/helpers.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';

const SQL_DIR = fileURLToPath(new URL('../sql', import.meta.url));
const VERIFY = readFileSync(`${SQL_DIR}/90-verify.sql`, 'utf8');
/** What RAISE EXCEPTION carries: every refusal of 90-verify.sql is one of its own, not a crash. */
const RAISED = 'P0001';

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

/**
 * One line per catalog row of ours. Equal before and after = the run changed nothing. Schemas,
 * tables and columns carry their oid (a table must never be dropped and recreated); policies,
 * constraints and functions are compared by definition, since DROP ... IF EXISTS followed by
 * CREATE is a legitimate way to make a file re-runnable.
 */
async function catalog(admin: Pick<Pool, 'query'>): Promise<string[]> {
  const ours = `(SELECT oid FROM pg_namespace WHERE nspname IN ('public', 'app', 'meta'))`;
  const { rows } = await admin.query(`
    SELECT line FROM (
      SELECT format('schema %s %s %s', oid, nspname, nspacl) FROM pg_namespace WHERE oid IN ${ours}
      UNION ALL
      SELECT format('relation %s %s %s %s %s %s', oid, relname, relkind, relacl, reloptions, relrowsecurity)
        FROM pg_class WHERE relnamespace IN ${ours}
      UNION ALL
      SELECT format('column %s %s %s %s', a.attrelid, a.attname, a.atttypid, a.attacl)
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.relnamespace IN ${ours} AND a.attnum > 0
      UNION ALL
      SELECT format('constraint %s %s %s', conrelid, conname, pg_get_constraintdef(oid))
        FROM pg_constraint WHERE connamespace IN ${ours}
      UNION ALL
      SELECT format('function %s %s %s %s %s', oid::regprocedure, prosecdef, proconfig, proacl, md5(prosrc))
        FROM pg_proc WHERE pronamespace IN ${ours}
      UNION ALL
      SELECT format('policy %s %s %s %s %s %s %s', polrelid, polname, polcmd, polpermissive, polroles,
                    pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) FROM pg_policy
      UNION ALL
      SELECT format('role %s %s', rolname, row(rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb))
        FROM pg_roles WHERE rolname LIKE 'app\\_%'
      UNION ALL
      SELECT format('member %s', row(member::regrole, roleid::regrole, inherit_option, set_option, admin_option))
        FROM pg_auth_members
      UNION ALL
      SELECT format('default acl %s', row(defaclrole::regrole, defaclnamespace, defaclobjtype, defaclacl)) FROM pg_default_acl
      UNION ALL
      SELECT 'registry ' || t::text FROM meta.expected_tables t
      UNION ALL
      SELECT 'registry ' || p::text FROM meta.expected_policies p
      UNION ALL
      SELECT 'registry ' || f::text FROM meta.expected_functions f
    ) lines (line) ORDER BY 1`);
  return rows.map(row => row.line);
}

test('every SQL file applies a second time on a populated clone and changes nothing', async () => {
  const client = await real.admin.connect();
  try {
    const migrated = await catalog(real.admin);
    // the snapshot really looks at the objects: it sees a function, a role and a registry row
    for (const known of [
      /^function app\.now\(\) t /,
      /^role app_conn /,
      /^registry \("app\.now\(\)"/,
    ]) {
      assert.ok(
        migrated.some(line => known.test(line)),
        String(known),
      );
    }
    for (const run of ['second', 'third']) {
      const steps = await migrate(client, SQL_DIR);
      assert.deepEqual(steps.slice(0, 3), [
        '00-roles.sql',
        '01-app-context.sql',
        '02-meta.sql',
      ]);
      assert.equal(steps.at(-1), '90-verify.sql');
      assert.deepEqual(await catalog(real.admin), migrated, `${run} run`);
    }
    // and the comparison is not blind: one grant, and the snapshot differs
    await client.query('BEGIN');
    try {
      await client.query('GRANT EXECUTE ON FUNCTION app.now() TO app_conn');
      assert.notDeepEqual(await catalog(client), migrated);
    } finally {
      await client.query('ROLLBACK');
    }
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
    await expectPgError(real.admin.query(VERIFY), {
      code: RAISED,
      messagePrefix: 'meta.test_clock is not empty',
    });
  } finally {
    await setTestClock(real.admin, null);
  }
  await real.admin.query(VERIFY);
});

const OWN = '(app.current_user_id() = user_id)';
const FIXTURE = `
  CREATE TABLE fx_own_read (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text);
  ALTER TABLE fx_own_read ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own_select ON fx_own_read FOR SELECT TO app_auth USING ${OWN};
  GRANT SELECT ON fx_own_read TO app_auth;
  SELECT meta.expect_table('fx_own_read', 'own_read', '{SELECT}', '{}', 'user_id');
  SELECT meta.expect_policy('fx_own_read', 'own_select', 'SELECT', '${OWN}', NULL);

  CREATE TABLE fx_own_rw (user_id uuid PRIMARY KEY, a text, b text);
  ALTER TABLE fx_own_rw ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own_select ON fx_own_rw FOR SELECT TO app_auth USING ${OWN};
  CREATE POLICY own_insert ON fx_own_rw FOR INSERT TO app_auth WITH CHECK ${OWN};
  CREATE POLICY own_update ON fx_own_rw FOR UPDATE TO app_auth USING ${OWN} WITH CHECK ${OWN};
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

  CREATE VIEW fx_view WITH (security_invoker = true) AS SELECT code FROM fx_content;
  GRANT SELECT ON fx_view TO app_auth;
  SELECT meta.expect_table('fx_view', 'content', '{SELECT}', '{}', NULL);

  CREATE SEQUENCE fx_seq;

  CREATE FUNCTION fx_fn(p text) RETURNS text
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT p';
  GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_auth, app_anon;
  SELECT meta.expect_function('fx_fn(text)', '{app_auth,app_anon}');

  CREATE FUNCTION fx_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
  SELECT meta.expect_function('fx_trigger()', '{}');

  CREATE FUNCTION app._fx_helper(p_user uuid) RETURNS int LANGUAGE sql AS 'SELECT 1';
  SELECT meta.expect_function('app._fx_helper(uuid)', '{}');
`;

const MEMBERSHIP =
  'role membership must be only app_conn in app_anon, app_auth, app_job WITH INHERIT FALSE, SET TRUE; found: ';
const SEARCH_PATH =
  'SECURITY DEFINER function must SET search_path to "public, pg_temp" or "pg_catalog, pg_temp": ';
const SCHEMA_USAGE = '{app_anon:USAGE,app_auth:USAGE,app_job:USAGE}';
const APP_HELPER = '{app_anon:EXECUTE,app_auth:EXECUTE,app_job:EXECUTE}';
const LEAKY_VIEW = `CREATE VIEW fx_leak AS SELECT * FROM fx_own_read;
  GRANT SELECT ON fx_leak TO app_auth;
  SELECT meta.expect_table('fx_leak', 'content', '{SELECT}', '{}', NULL)`;

/** [what is broken, how the message 90-verify.sql must raise starts] — each names the broken object. */
const mutations = (database: string): [sql: string, raises: string][] => [
  // (1) roles
  ['ALTER ROLE app_conn INHERIT', 'role app_conn must be LOGIN NOINHERIT'],
  ['ALTER ROLE app_conn NOLOGIN', 'role app_conn must be LOGIN NOINHERIT'],
  ['ALTER ROLE app_auth BYPASSRLS', 'role app_auth is SUPERUSER, BYPASSRLS'],
  ['ALTER ROLE app_job SUPERUSER', 'role app_job is SUPERUSER, BYPASSRLS'],
  ['ALTER ROLE app_anon CREATEROLE', 'role app_anon is SUPERUSER, BYPASSRLS'],
  ['ALTER ROLE app_anon LOGIN', 'role app_anon can log in: only app_conn may'],
  [
    'GRANT app_auth TO app_conn WITH INHERIT TRUE',
    `${MEMBERSHIP}app_conn in app_auth (inherit t, set t, admin f)`,
  ],
  [
    'GRANT app_auth TO app_conn WITH ADMIN TRUE',
    `${MEMBERSHIP}app_conn in app_auth (inherit f, set t, admin t)`,
  ],
  ['GRANT app_job TO app_anon', `${MEMBERSHIP}app_anon in app_job`],
  [
    'GRANT pg_read_all_data TO app_auth',
    `${MEMBERSHIP}app_auth in pg_read_all_data`,
  ],
  [
    'CREATE ROLE fx_outsider LOGIN; GRANT app_auth TO fx_outsider',
    `${MEMBERSHIP}fx_outsider in app_auth`,
  ],
  ['REVOKE app_job FROM app_conn', 'app_conn cannot SET ROLE app_job'],
  // settings stored for a role or a database: app_conn can write its own
  [
    "ALTER ROLE app_conn SET role = 'app_job'",
    'a stored setting applies to an app role: role app_conn, database (all): {role=app_job}',
  ],
  [
    `ALTER ROLE app_auth IN DATABASE ${database} SET search_path = pg_temp`,
    `a stored setting applies to an app role: role app_auth, database ${database}: {search_path=pg_temp}`,
  ],
  [
    `ALTER DATABASE ${database} SET search_path = pg_temp, public`,
    `a stored setting applies to an app role: role (all), database ${database}: `,
  ],
  [
    "ALTER ROLE ALL SET statement_timeout = '1s'",
    'a stored setting applies to an app role: role (all), database (all): {statement_timeout=1s}',
  ],
  // ownership: the owner of an object needs no grant and is not subject to its policies
  [
    'ALTER TABLE fx_own_read OWNER TO app_auth',
    'table fx_own_read is owned by app role app_auth',
  ],
  [
    'ALTER SEQUENCE fx_seq OWNER TO app_auth',
    'sequence fx_seq is owned by app role app_auth',
  ],
  [
    'ALTER FUNCTION fx_fn(text) OWNER TO app_job',
    'function fx_fn(text) is owned by app role app_job',
  ],
  [
    'ALTER SCHEMA app OWNER TO app_auth',
    'schema app is owned by app role app_auth',
  ],
  [
    `ALTER DATABASE ${database} OWNER TO app_auth`,
    `database ${database} is owned by app role app_auth`,
  ],
  // grants on the database and on schemas
  [
    `GRANT CREATE ON DATABASE ${database} TO app_auth`,
    `database ${database}: grants are {PUBLIC:CONNECT,PUBLIC:TEMPORARY,app_auth:CREATE}, expected {PUBLIC:CONNECT,PUBLIC:TEMPORARY}`,
  ],
  [
    'GRANT USAGE ON SCHEMA meta TO app_auth',
    'schema meta: grants are {app_auth:USAGE}, expected {}',
  ],
  [
    'GRANT CREATE ON SCHEMA public TO app_auth',
    `schema public: grants are {app_anon:USAGE,app_auth:CREATE,app_auth:USAGE,app_job:USAGE}, expected ${SCHEMA_USAGE}`,
  ],
  [
    'GRANT USAGE ON SCHEMA public TO PUBLIC',
    `schema public: grants are {PUBLIC:USAGE,app_anon:USAGE,app_auth:USAGE,app_job:USAGE}, expected ${SCHEMA_USAGE}`,
  ],
  [
    'GRANT USAGE ON SCHEMA public TO app_conn',
    `schema public: grants are {app_anon:USAGE,app_auth:USAGE,app_conn:USAGE,app_job:USAGE}, expected ${SCHEMA_USAGE}`,
  ],
  [
    'REVOKE USAGE ON SCHEMA app FROM app_job',
    `schema app: grants are {app_anon:USAGE,app_auth:USAGE}, expected ${SCHEMA_USAGE}`,
  ],
  [
    'CREATE ROLE fx_fifth; GRANT USAGE ON SCHEMA app TO fx_fifth',
    `schema app: grants are {app_anon:USAGE,app_auth:USAGE,app_job:USAGE,fx_fifth:USAGE}, expected ${SCHEMA_USAGE}`,
  ],
  // (3) registry and catalog list the same tables
  [
    'CREATE TABLE public.fx_unregistered (id int)',
    'table fx_unregistered is not registered (meta.expect_table)',
  ],
  ['DROP TABLE fx_internal', 'registered table does not exist: fx_internal'],
  // views read as their owner unless security_invoker; materialized views store rows
  [LEAKY_VIEW, 'view fx_leak must be WITH (security_invoker = true)'],
  [
    'ALTER VIEW fx_view RESET (security_invoker)',
    'view fx_view must be WITH (security_invoker = true)',
  ],
  [
    'ALTER VIEW fx_view SET (security_invoker = false)',
    'view fx_view must be WITH (security_invoker = true)',
  ],
  [
    'CREATE VIEW app.fx_side AS SELECT * FROM fx_internal',
    'view app.fx_side must be WITH (security_invoker = true)',
  ],
  [
    'CREATE VIEW public.fx_unregistered WITH (security_invoker = true) AS SELECT 1 AS one',
    'table fx_unregistered is not registered (meta.expect_table)',
  ],
  [
    `CREATE MATERIALIZED VIEW fx_copy AS SELECT * FROM fx_own_read;
     SELECT meta.expect_table('fx_copy', 'content', '{SELECT}', '{}', NULL)`,
    'materialized view fx_copy is not allowed',
  ],
  // (4) row level security and grants, per class
  [
    'ALTER TABLE fx_own_read DISABLE ROW LEVEL SECURITY',
    'table fx_own_read (own_read): row level security is off',
  ],
  [
    'ALTER TABLE fx_own_rw DISABLE ROW LEVEL SECURITY',
    'table fx_own_rw (own_rw): row level security is off',
  ],
  [
    'ALTER TABLE fx_internal DISABLE ROW LEVEL SECURITY',
    'table fx_internal (internal): row level security is off',
  ],
  [
    'ALTER TABLE fx_own_read RENAME COLUMN user_id TO owner_id',
    'table fx_own_read: registered column does not exist: user_id',
  ],
  [
    'ALTER TABLE fx_own_rw RENAME COLUMN a TO c',
    'table fx_own_rw: registered column does not exist: a',
  ],
  [
    'GRANT INSERT ON fx_own_read TO app_auth',
    'table fx_own_read: grants are {app_auth:INSERT,app_auth:SELECT}, expected {app_auth:SELECT}',
  ],
  [
    'GRANT DELETE ON fx_own_rw TO app_auth',
    'table fx_own_rw: grants are {app_auth:DELETE,app_auth:INSERT,app_auth:SELECT}, expected {app_auth:INSERT,app_auth:SELECT}',
  ],
  [
    'GRANT TRUNCATE ON fx_own_rw TO app_auth',
    'table fx_own_rw: grants are {app_auth:INSERT,app_auth:SELECT,app_auth:TRUNCATE}, expected {app_auth:INSERT,app_auth:SELECT}',
  ],
  [
    'GRANT SELECT ON fx_internal TO app_auth',
    'table fx_internal: grants are {app_auth:SELECT}, expected {}',
  ],
  [
    'GRANT INSERT ON fx_content TO app_auth',
    'table fx_content: grants are {app_auth:INSERT,app_auth:SELECT}, expected {app_auth:SELECT}',
  ],
  [
    'REVOKE SELECT ON fx_content FROM app_auth',
    'table fx_content: grants are {}, expected {app_auth:SELECT}',
  ],
  [
    'GRANT SELECT ON fx_content TO app_anon',
    'table fx_content: grants are {app_anon:SELECT,app_auth:SELECT}, expected {app_auth:SELECT}',
  ],
  [
    'GRANT SELECT ON fx_own_read TO app_job',
    'table fx_own_read: grants are {app_auth:SELECT,app_job:SELECT}, expected {app_auth:SELECT}',
  ],
  [
    'GRANT SELECT ON fx_own_read TO PUBLIC',
    'table fx_own_read: grants are {PUBLIC:SELECT,app_auth:SELECT}, expected {app_auth:SELECT}',
  ],
  [
    'GRANT SELECT ON fx_own_read TO app_auth WITH GRANT OPTION',
    'table fx_own_read: grants are {app_auth:SELECT*}, expected {app_auth:SELECT}',
  ],
  [
    'CREATE ROLE fx_fifth LOGIN BYPASSRLS; GRANT SELECT ON fx_internal TO fx_fifth',
    'table fx_internal: grants are {fx_fifth:SELECT}, expected {}',
  ],
  [
    'GRANT SELECT ON meta.test_clock TO app_auth',
    'table meta.test_clock: grants are {app_auth:SELECT}, expected {}',
  ],
  [
    'GRANT INSERT ON fx_view TO app_auth',
    'view fx_view: grants are {app_auth:INSERT,app_auth:SELECT}, expected {app_auth:SELECT}',
  ],
  [
    'GRANT USAGE ON SEQUENCE fx_seq TO app_auth',
    'sequence fx_seq: grants are {app_auth:USAGE}, expected {}',
  ],
  [
    'GRANT SELECT (secret) ON fx_internal TO app_auth',
    'column fx_internal.secret: grants are {app_auth:SELECT}, expected {}',
  ],
  [
    'GRANT UPDATE (b) ON fx_own_rw TO app_auth',
    'column fx_own_rw.b: grants are {app_auth:UPDATE}, expected {}',
  ],
  [
    'REVOKE UPDATE (a) ON fx_own_rw FROM app_auth',
    'column fx_own_rw.a: grants are {}, expected {app_auth:UPDATE}',
  ],
  [
    'GRANT UPDATE (a) ON fx_own_rw TO app_auth WITH GRANT OPTION',
    'column fx_own_rw.a: grants are {app_auth:UPDATE*}, expected {app_auth:UPDATE}',
  ],
  [
    'GRANT UPDATE (note) ON fx_own_read TO app_anon',
    'column fx_own_read.note: grants are {app_anon:UPDATE}, expected {}',
  ],
  // (5) policies
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read FOR SELECT TO app_auth USING (app.current_user_id() = user_id OR true)`,
    `policy "own_select" on table fx_own_read: USING is (${OWN} OR true), registered ${OWN}`,
  ],
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read FOR SELECT TO app_auth USING (app.current_user_id() = id)`,
    `policy "own_select" on table fx_own_read: USING is (app.current_user_id() = id), registered ${OWN}`,
  ],
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read FOR ALL TO app_auth USING ${OWN}`,
    'policy "own_select" on table fx_own_read: command is ALL, registered SELECT',
  ],
  [
    `DROP POLICY own_select ON fx_own_read;
     CREATE POLICY own_select ON fx_own_read AS RESTRICTIVE FOR SELECT TO app_auth USING ${OWN}`,
    'policy "own_select" on table fx_own_read: is RESTRICTIVE, must be PERMISSIVE',
  ],
  [
    'ALTER POLICY own_select ON fx_own_read TO public',
    'policy "own_select" on table fx_own_read: applies to {PUBLIC}, must be {app_auth}',
  ],
  [
    'ALTER POLICY own_update ON fx_own_rw TO app_auth, app_anon',
    'policy "own_update" on table fx_own_rw: applies to {app_anon,app_auth}, must be {app_auth}',
  ],
  [
    'DROP POLICY own_select ON fx_own_read',
    'registered policy "own_select" on table fx_own_read does not exist',
  ],
  [
    'CREATE POLICY extra ON fx_own_read FOR SELECT TO app_auth USING (true)',
    'policy "extra" on table fx_own_read is not registered (meta.expect_policy)',
  ],
  [
    'ALTER POLICY own_update ON fx_own_rw WITH CHECK (true)',
    `policy "own_update" on table fx_own_rw: WITH CHECK is true, registered ${OWN}`,
  ],
  [
    'ALTER POLICY own_insert ON fx_own_rw WITH CHECK (user_id IS NOT NULL)',
    `policy "own_insert" on table fx_own_rw: WITH CHECK is (user_id IS NOT NULL), registered ${OWN}`,
  ],
  [
    'CREATE POLICY anything ON fx_internal TO app_auth USING (true)',
    'internal table fx_internal has policy "anything": it must have none',
  ],
  // (6) search_path of SECURITY DEFINER functions: one of the allowed values, by equality
  [
    'ALTER FUNCTION fx_fn(text) RESET search_path',
    `${SEARCH_PATH}fx_fn(text) (search_path not set)`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET search_path = public',
    `${SEARCH_PATH}fx_fn(text) (search_path=public)`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET search_path = pg_temp, public',
    `${SEARCH_PATH}fx_fn(text) (search_path=pg_temp, public)`,
  ],
  [
    "ALTER FUNCTION fx_fn(text) SET search_path = 'public, pg_temp'",
    `${SEARCH_PATH}fx_fn(text) (search_path="public, pg_temp")`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET search_path = app, public, pg_temp',
    `${SEARCH_PATH}fx_fn(text) (search_path=app, public, pg_temp)`,
  ],
  [
    'ALTER FUNCTION app.now() RESET search_path',
    `${SEARCH_PATH}app.now() (search_path not set)`,
  ],
  [
    'ALTER FUNCTION app._fx_helper(uuid) SECURITY DEFINER',
    `${SEARCH_PATH}app._fx_helper(uuid) (search_path not set)`,
  ],
  // (7) every function of ours is registered, and EXECUTE is granted to exactly the registered roles
  [
    "CREATE FUNCTION public.fx_unregistered() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    'function is not registered (meta.expect_function): fx_unregistered()',
  ],
  [
    `CREATE FUNCTION app.fx_grant_coins(p_user uuid, p_amount int) RETURNS int
       LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT p_amount';
     GRANT EXECUTE ON FUNCTION app.fx_grant_coins(uuid, int) TO PUBLIC`,
    'function is not registered (meta.expect_function): app.fx_grant_coins(uuid,integer)',
  ],
  [
    "CREATE FUNCTION meta.fx_unregistered() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    'function is not registered (meta.expect_function): meta.fx_unregistered()',
  ],
  [
    'DROP FUNCTION fx_fn(text)',
    'registered function does not exist: fx_fn(text)',
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_job',
    'function fx_fn(text): grants are {app_anon:EXECUTE,app_auth:EXECUTE,app_job:EXECUTE}, expected {app_anon:EXECUTE,app_auth:EXECUTE}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_fn(text) TO PUBLIC',
    'function fx_fn(text): grants are {PUBLIC:EXECUTE,app_anon:EXECUTE,app_auth:EXECUTE}, expected {app_anon:EXECUTE,app_auth:EXECUTE}',
  ],
  [
    'REVOKE EXECUTE ON FUNCTION fx_fn(text) FROM app_anon',
    'function fx_fn(text): grants are {app_auth:EXECUTE}, expected {app_anon:EXECUTE,app_auth:EXECUTE}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_auth WITH GRANT OPTION',
    'function fx_fn(text): grants are {app_anon:EXECUTE,app_auth:EXECUTE*}, expected {app_anon:EXECUTE,app_auth:EXECUTE}',
  ],
  [
    'CREATE ROLE fx_fifth LOGIN; GRANT EXECUTE ON FUNCTION fx_fn(text) TO fx_fifth',
    'function fx_fn(text): grants are {app_anon:EXECUTE,app_auth:EXECUTE,fx_fifth:EXECUTE}, expected {app_anon:EXECUTE,app_auth:EXECUTE}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION fx_trigger() TO app_auth',
    'function fx_trigger(): grants are {app_auth:EXECUTE}, expected {}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION app.current_user_id() TO PUBLIC',
    `function app.current_user_id(): grants are {PUBLIC:EXECUTE,app_anon:EXECUTE,app_auth:EXECUTE,app_job:EXECUTE}, expected ${APP_HELPER}`,
  ],
  [
    'REVOKE EXECUTE ON FUNCTION app.now() FROM app_job',
    `function app.now(): grants are {app_anon:EXECUTE,app_auth:EXECUTE}, expected ${APP_HELPER}`,
  ],
  [
    'GRANT EXECUTE ON FUNCTION app.week_start(date) TO app_conn',
    `function app.week_start(date): grants are {app_anon:EXECUTE,app_auth:EXECUTE,app_conn:EXECUTE,app_job:EXECUTE}, expected ${APP_HELPER}`,
  ],
  // (8) internal helpers: registered with no role, executable by no role
  [
    'GRANT EXECUTE ON FUNCTION app._fx_helper(uuid) TO app_auth',
    'function app._fx_helper(uuid): grants are {app_auth:EXECUTE}, expected {}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION app._fx_helper(uuid) TO PUBLIC',
    'function app._fx_helper(uuid): grants are {PUBLIC:EXECUTE}, expected {}',
  ],
  [
    `SELECT meta.expect_function('app._fx_helper(uuid)', '{app_job}');
     GRANT EXECUTE ON FUNCTION app._fx_helper(uuid) TO app_job`,
    'internal function must be registered with no role: app._fx_helper(uuid) {app_job}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION meta.expect_table(text, text, text[], text[], text) TO app_auth',
    'function meta.expect_table(text,text,text[],text[],text): grants are {app_auth:EXECUTE}, expected {}',
  ],
  [
    `SELECT meta.expect_function('meta.expect_function(text, text[])', '{app_auth}');
     GRANT EXECUTE ON FUNCTION meta.expect_function(text, text[]) TO app_auth`,
    'internal function must be registered with no role: meta.expect_function(text,text[]) {app_auth}',
  ],
  // (9) test clock
  [
    'INSERT INTO meta.test_clock (now) VALUES (now())',
    'meta.test_clock is not empty',
  ],
];

test('90-verify.sql accepts a schema with every access class', async () => {
  await fixture.admin.query(FIXTURE);
  await fixture.admin.query(VERIFY);
});

test('90-verify.sql raises for each broken fence and names the object', async t => {
  const client = await fixture.admin.connect();
  try {
    for (const [mutation, raises] of mutations(fixture.name)) {
      await t.test(mutation.replace(/\s+/g, ' '), async () => {
        await client.query('BEGIN');
        try {
          await client.query(mutation);
          await expectPgError(client.query(VERIFY), {
            code: RAISED,
            messagePrefix: raises,
          });
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
  const refused = (messagePrefix: string) => ({ code: '23514', messagePrefix });
  await expectPgError(
    declare(
      "meta.expect_table('x', 'own_read', '{SELECT,INSERT}', '{}', 'user_id')",
    ),
    refused('meta.expect_table(x, own_read): app_auth holds exactly {SELECT}'),
  );
  await expectPgError(
    declare("meta.expect_table('x', 'content', '{SELECT}', '{a}', NULL)"),
    refused('meta.expect_table(x, content): app_auth holds exactly {SELECT}'),
  );
  await expectPgError(
    declare("meta.expect_table('x', 'own_read', '{SELECT}', '{}', NULL)"),
    refused('meta.expect_table(x, own_read): owner_column is required'),
  );
  await expectPgError(
    declare("meta.expect_table('x', 'content', '{SELECT}', '{}', 'user_id')"),
    refused('meta.expect_table(x, content): owner_column is required'),
  );
  await expectPgError(
    declare("meta.expect_table('x', 'internal', '{SELECT}', '{}', NULL)"),
    refused('meta.expect_table(x, internal): app_auth holds nothing'),
  );
  for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'select']) {
    await expectPgError(
      declare(
        `meta.expect_table('x', 'own_rw', '{SELECT,${privilege}}', '{}', 'user_id')`,
      ),
      refused(
        'meta.expect_table(x, own_rw): app_auth may hold only SELECT, INSERT, UPDATE, DELETE',
      ),
    );
  }
  await expectPgError(
    declare("meta.expect_table('x', 'public', '{SELECT}', '{}', NULL)"),
    refused('meta.expect_table(x, public): unknown class'),
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
    // the fixture objects are declared by no SQL file, so the rebuilt registry disowns them
    await assert.rejects(
      migrate(client, SQL_DIR),
      /^Error: 90-verify\.sql: table fx_content is not registered/,
    );
  } finally {
    client.release();
  }
});
