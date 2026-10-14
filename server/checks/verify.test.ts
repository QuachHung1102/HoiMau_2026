// Gate 1 (npm run db:verify): the catalog matches the design.
// The first three tests judge the real schema. The rest prove on a throwaway fixture schema
// that 90-verify.sql accepts each access class and raises, naming the object, when a fence is
// broken; the mutation check repeats that proof over every real table and function.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { SUPERUSER } from '../scripts/cluster.ts';
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

  -- an identity key: its sequence belongs to the table and changes owner with it
  CREATE TABLE fx_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, secret text);
  ALTER TABLE fx_events ENABLE ROW LEVEL SECURITY;
  SELECT meta.expect_table('fx_events', 'internal', '{}', '{}', NULL);

  CREATE TABLE fx_content (code text PRIMARY KEY);
  GRANT SELECT ON fx_content TO app_auth;
  SELECT meta.expect_table('fx_content', 'content', '{SELECT}', '{}', NULL);

  CREATE TABLE fx_content_part (id int PRIMARY KEY, code text NOT NULL REFERENCES fx_content (code));
  GRANT SELECT ON fx_content_part TO app_auth;
  SELECT meta.expect_table('fx_content_part', 'content', '{SELECT}', '{}', NULL);

  CREATE VIEW fx_view WITH (security_invoker = true) AS SELECT code FROM fx_content;
  GRANT SELECT ON fx_view TO app_auth;
  SELECT meta.expect_table('fx_view', 'content', '{SELECT}', '{}', NULL);

  CREATE SEQUENCE fx_seq;

  CREATE FUNCTION fx_fn(p text) RETURNS text
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT p';
  GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_auth, app_anon;
  SELECT meta.expect_function('fx_fn(text)', 'definer', '{app_auth,app_anon}');

  CREATE FUNCTION fx_trigger() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
  SELECT meta.expect_function('fx_trigger()', 'invoker', '{}');

  CREATE FUNCTION app._fx_helper(p_user uuid) RETURNS int LANGUAGE sql AS 'SELECT 1';
  SELECT meta.expect_function('app._fx_helper(uuid)', 'invoker', '{}');

  CREATE FUNCTION app._fx_pinned(p_user uuid) RETURNS int
    LANGUAGE sql SET search_path = public, pg_temp AS 'SELECT 1';
  SELECT meta.expect_function('app._fx_pinned(uuid)', 'invoker', '{}');

  -- a callable function that runs as its caller, under row level security, and pins its path
  CREATE FUNCTION fx_count() RETURNS bigint
    LANGUAGE sql STABLE SET search_path = public, pg_temp AS 'SELECT count(*) FROM fx_own_read';
  GRANT EXECUTE ON FUNCTION fx_count() TO app_auth;
  SELECT meta.expect_function('fx_count()', 'invoker', '{app_auth}');

  -- an internal function that has to run as the owner: a trigger function writing an internal table
  CREATE FUNCTION app._fx_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS 'BEGIN RETURN NEW; END';
  SELECT meta.expect_function('app._fx_audit()', 'definer', '{}');
`;

const MEMBERSHIP =
  'role membership must be only app_conn in app_anon, app_auth, app_job WITH INHERIT FALSE, SET TRUE; found: ';
const SEARCH_PATH =
  'function settings: a SECURITY DEFINER function must carry exactly SET search_path = public, pg_temp (or pg_catalog, pg_temp); any other function carries exactly that or no setting at all; found: ';
const ONE_OWNER = `every table, view, sequence and function of ours belongs to ${SUPERUSER.user}, the owner of schema meta, who runs the schema files`;
const SCHEMA_USAGE = '{app_anon:USAGE,app_auth:USAGE,app_job:USAGE}';
const APP_HELPER = '{app_anon:EXECUTE,app_auth:EXECUTE,app_job:EXECUTE}';
const FUNCTION_SECURITY =
  'function security: the mode of a function is the one registered for it (meta.expect_function); found: ';
/** A table registered as content whose rows hang off `parent`. */
const claimedContent = (parent: string) =>
  `CREATE TABLE fx_diary (id int PRIMARY KEY, parent ${parent});
   GRANT SELECT ON fx_diary TO app_auth;
   SELECT meta.expect_table('fx_diary', 'content', '{SELECT}', '{}', NULL)`;
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
  ['ALTER ROLE app_anon CREATEDB', 'role app_anon is SUPERUSER, BYPASSRLS'],
  ['ALTER ROLE app_auth REPLICATION', 'role app_auth is SUPERUSER, BYPASSRLS'],
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
  // a table with column grants: the owner is named, not the column grants an owner no longer shows
  [
    'ALTER TABLE fx_own_rw OWNER TO app_auth',
    'table fx_own_rw is owned by app role app_auth',
  ],
  // a table with an identity key: the table is named, not the sequence that follows its owner
  [
    'ALTER TABLE fx_events OWNER TO app_auth',
    'table fx_events is owned by app role app_auth',
  ],
  [
    'ALTER SEQUENCE fx_seq OWNER TO app_auth',
    'sequence fx_seq is owned by app role app_auth',
  ],
  [
    'ALTER FUNCTION fx_fn(text) OWNER TO app_job',
    'function fx_fn(text) is owned by app role app_job',
  ],
  // a function given to a role outside app_*: the function and its owner are named, not the
  // default privileges of that owner
  [
    'CREATE ROLE fx_fifth; ALTER FUNCTION app.week_start(date) OWNER TO fx_fifth',
    `function app.week_start(date) is owned by fx_fifth: ${ONE_OWNER}`,
  ],
  // and so is a table, a view or a sequence: any owner but the one that runs the schema files
  // is exempt from the policies of what it owns. The table is named, not its column grants and
  // not the sequence of its identity column, which changes owner with it.
  [
    'CREATE ROLE fx_fifth; ALTER TABLE fx_own_read OWNER TO fx_fifth',
    `table fx_own_read is owned by fx_fifth: ${ONE_OWNER}`,
  ],
  [
    'CREATE ROLE fx_fifth; ALTER TABLE fx_own_rw OWNER TO fx_fifth',
    `table fx_own_rw is owned by fx_fifth: ${ONE_OWNER}`,
  ],
  [
    'CREATE ROLE fx_fifth; ALTER TABLE fx_events OWNER TO fx_fifth',
    `table fx_events is owned by fx_fifth: ${ONE_OWNER}`,
  ],
  [
    'CREATE ROLE fx_fifth; ALTER VIEW fx_view OWNER TO fx_fifth',
    `view fx_view is owned by fx_fifth: ${ONE_OWNER}`,
  ],
  [
    'CREATE ROLE fx_fifth; ALTER SEQUENCE fx_seq OWNER TO fx_fifth',
    `sequence fx_seq is owned by fx_fifth: ${ONE_OWNER}`,
  ],
  [
    'CREATE ROLE fx_fifth; ALTER TABLE meta.test_clock OWNER TO fx_fifth',
    `table meta.test_clock is owned by fx_fifth: ${ONE_OWNER}`,
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
  [
    'ALTER VIEW fx_view OWNER TO app_auth',
    'view fx_view is owned by app role app_auth',
  ],
  [
    `CREATE FOREIGN DATA WRAPPER fx_wrapper;
     CREATE SERVER fx_server FOREIGN DATA WRAPPER fx_wrapper;
     CREATE FOREIGN TABLE fx_remote (id int) SERVER fx_server;
     GRANT SELECT ON fx_remote TO app_auth;
     SELECT meta.expect_table('fx_remote', 'content', '{SELECT}', '{}', NULL)`,
    'foreign table fx_remote is not allowed',
  ],
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
  // a rule is privileged code that is no function
  [
    'CREATE RULE fx_rule AS ON INSERT TO fx_own_rw DO ALSO DELETE FROM fx_internal',
    'rule "fx_rule" on fx_own_rw is not allowed',
  ],
  [
    'CREATE RULE fx_rule AS ON INSERT TO fx_view DO INSTEAD NOTHING',
    'rule "fx_rule" on fx_view is not allowed',
  ],
  [
    'CREATE RULE fx_rule AS ON DELETE TO meta.test_clock DO INSTEAD NOTHING',
    'rule "fx_rule" on meta.test_clock is not allowed',
  ],
  // what the intact database has none of: triggers (no registry for them yet), event triggers,
  // publications, foreign-data wrappers and servers, LEAKPROOF functions
  [
    `CREATE TRIGGER fx_touch BEFORE INSERT OR UPDATE ON fx_own_rw FOR EACH ROW EXECUTE FUNCTION fx_trigger();
     ALTER TABLE fx_own_rw ENABLE ALWAYS TRIGGER fx_touch`,
    'trigger "fx_touch" on fx_own_rw is not allowed yet',
  ],
  [
    'CREATE TRIGGER fx_touch INSTEAD OF INSERT ON fx_view FOR EACH ROW EXECUTE FUNCTION fx_trigger()',
    'trigger "fx_touch" on fx_view is not allowed yet',
  ],
  [
    `CREATE FUNCTION fx_ddl() RETURNS event_trigger LANGUAGE plpgsql AS 'BEGIN NULL; END';
     SELECT meta.expect_function('fx_ddl()', 'invoker', '{}');
     CREATE EVENT TRIGGER fx_ddl ON ddl_command_end EXECUTE FUNCTION fx_ddl()`,
    'event trigger fx_ddl is not allowed',
  ],
  [
    'CREATE PUBLICATION fx_pub FOR ALL TABLES',
    'publication fx_pub is not allowed',
  ],
  ['CREATE PUBLICATION fx_pub', 'publication fx_pub is not allowed'],
  [
    'CREATE FOREIGN DATA WRAPPER fx_wrapper',
    'foreign-data wrapper fx_wrapper is not allowed',
  ],
  [
    `CREATE FOREIGN DATA WRAPPER fx_wrapper;
     CREATE SERVER fx_server FOREIGN DATA WRAPPER fx_wrapper;
     GRANT USAGE ON FOREIGN SERVER fx_server TO app_auth`,
    'foreign server fx_server is not allowed',
  ],
  [
    'ALTER FUNCTION app.logical_date(timestamptz, text) LEAKPROOF',
    'function app.logical_date(timestamp with time zone,text) is LEAKPROOF',
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
  // the class is a claim: a content table hangs off content only
  [
    claimedContent('uuid REFERENCES fx_own_rw (user_id)'),
    'content table fx_diary has a foreign key to fx_own_rw (own_rw)',
  ],
  [
    claimedContent('int REFERENCES fx_internal (id)'),
    'content table fx_diary has a foreign key to fx_internal (internal)',
  ],
  [
    claimedContent('text REFERENCES meta.expected_tables (name)'),
    'content table fx_diary has a foreign key to meta.expected_tables (not registered)',
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
    `${SEARCH_PATH}fx_fn(text) {}`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET search_path = public',
    `${SEARCH_PATH}fx_fn(text) {search_path=public}`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET search_path = pg_temp, public',
    `${SEARCH_PATH}fx_fn(text) {"search_path=pg_temp, public"}`,
  ],
  [
    "ALTER FUNCTION fx_fn(text) SET search_path = 'public, pg_temp'",
    `${SEARCH_PATH}fx_fn(text) {"search_path=\\"public, pg_temp\\""}`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET search_path = app, public, pg_temp',
    `${SEARCH_PATH}fx_fn(text) {"search_path=app, public, pg_temp"}`,
  ],
  ['ALTER FUNCTION app.now() RESET search_path', `${SEARCH_PATH}app.now() {}`],
  [
    'ALTER FUNCTION app._fx_helper(uuid) SECURITY DEFINER',
    `${SEARCH_PATH}app._fx_helper(uuid) {}`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SET session_replication_role = replica',
    `${SEARCH_PATH}fx_fn(text) {"search_path=public, pg_temp",session_replication_role=replica}`,
  ],
  // a SECURITY INVOKER helper runs as the owner when a SECURITY DEFINER function calls it
  [
    'ALTER FUNCTION app._fx_helper(uuid) SET search_path = pg_temp, public',
    `${SEARCH_PATH}app._fx_helper(uuid) {"search_path=pg_temp, public"}`,
  ],
  [
    'ALTER FUNCTION app._fx_pinned(uuid) SET search_path = public',
    `${SEARCH_PATH}app._fx_pinned(uuid) {search_path=public}`,
  ],
  [
    'ALTER FUNCTION app._fx_helper(uuid) SET session_replication_role = replica',
    `${SEARCH_PATH}app._fx_helper(uuid) {session_replication_role=replica}`,
  ],
  // security of a function: the registered mode, by equality. The mode alone, and the mode
  // together with the setting that would make the function look well-formed in its new mode.
  [
    'ALTER FUNCTION fx_fn(text) SECURITY INVOKER',
    `${FUNCTION_SECURITY}fx_fn(text) is SECURITY INVOKER, registered definer`,
  ],
  [
    'ALTER FUNCTION fx_fn(text) SECURITY INVOKER RESET search_path',
    `${FUNCTION_SECURITY}fx_fn(text) is SECURITY INVOKER, registered definer`,
  ],
  [
    'ALTER FUNCTION app.now() SECURITY INVOKER',
    `${FUNCTION_SECURITY}app.now() is SECURITY INVOKER, registered definer`,
  ],
  [
    'ALTER FUNCTION app.current_user_id() SECURITY DEFINER SET search_path = public, pg_temp',
    `${FUNCTION_SECURITY}app.current_user_id() is SECURITY DEFINER, registered invoker`,
  ],
  [
    'ALTER FUNCTION fx_count() SECURITY DEFINER',
    `${FUNCTION_SECURITY}fx_count() is SECURITY DEFINER, registered invoker`,
  ],
  [
    'ALTER FUNCTION app._fx_helper(uuid) SECURITY DEFINER SET search_path = public, pg_temp',
    `${FUNCTION_SECURITY}app._fx_helper(uuid) is SECURITY DEFINER, registered invoker`,
  ],
  [
    'ALTER FUNCTION app._fx_audit() SECURITY INVOKER',
    `${FUNCTION_SECURITY}app._fx_audit() is SECURITY INVOKER, registered definer`,
  ],
  [
    'ALTER FUNCTION meta.expect_function(text, text, text[]) SECURITY DEFINER',
    `${FUNCTION_SECURITY}meta.expect_function(text,text,text[]) is SECURITY DEFINER, registered invoker`,
  ],
  // the file states one mode and creates the other
  [
    "SELECT meta.expect_function('fx_trigger()', 'definer', '{}')",
    `${FUNCTION_SECURITY}fx_trigger() is SECURITY INVOKER, registered definer`,
  ],
  // a word that is neither is refused where it is registered (see the test below); the registry
  // is judged all the same, for the day the constraint is gone and a row was written directly
  [
    `ALTER TABLE meta.expected_functions DROP CONSTRAINT expected_functions_security_check;
     UPDATE meta.expected_functions SET security = 'owner' WHERE signature = 'fx_fn(text)'`,
    'registry: function fx_fn(text): the security mode is definer or invoker, not owner',
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
    `SELECT meta.expect_function('app._fx_helper(uuid)', 'invoker', '{app_job}');
     GRANT EXECUTE ON FUNCTION app._fx_helper(uuid) TO app_job`,
    'internal function must be registered with no role: app._fx_helper(uuid) {app_job}',
  ],
  [
    'GRANT EXECUTE ON FUNCTION meta.expect_table(text, text, text[], text[], text) TO app_auth',
    'function meta.expect_table(text,text,text[],text[],text): grants are {app_auth:EXECUTE}, expected {}',
  ],
  [
    `SELECT meta.expect_function('meta.expect_function(text, text, text[])', 'invoker', '{app_auth}');
     GRANT EXECUTE ON FUNCTION meta.expect_function(text, text, text[]) TO app_auth`,
    'internal function must be registered with no role: meta.expect_function(text,text,text[]) {app_auth}',
  ],
  [
    `CREATE FUNCTION public._fx_h(p_user uuid) RETURNS int LANGUAGE sql AS 'SELECT 1';
     GRANT EXECUTE ON FUNCTION _fx_h(uuid) TO app_auth;
     SELECT meta.expect_function('_fx_h(uuid)', 'invoker', '{app_auth}')`,
    'internal function must be registered with no role: _fx_h(uuid) {app_auth}',
  ],
  // a function born while the default was open keeps no ACL of its own (proacl is null), which
  // means EXECUTE to PUBLIC, also after the default is closed again
  [
    `ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
     CREATE FUNCTION fx_open() RETURNS int LANGUAGE sql AS 'SELECT 1';
     ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
     SELECT meta.expect_function('fx_open()', 'invoker', '{}')`,
    'function fx_open(): grants are {PUBLIC:EXECUTE}, expected {}',
  ],
  // default privileges: what the next table, sequence or function is born with
  [
    'ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC',
    `default privileges for functions created by ${SUPERUSER.user}: grants are {PUBLIC:EXECUTE}, expected {}`,
  ],
  [
    'ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO app_auth',
    `default privileges for functions created by ${SUPERUSER.user}: grants are {app_auth:EXECUTE}, expected {}`,
  ],
  [
    'ALTER DEFAULT PRIVILEGES GRANT INSERT, UPDATE, DELETE ON TABLES TO app_auth',
    `default privileges for tables created by ${SUPERUSER.user}: grants are {app_auth:DELETE,app_auth:INSERT,app_auth:UPDATE}, expected {}`,
  ],
  [
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_anon',
    `default privileges for tables created by ${SUPERUSER.user} in schema public: grants are {app_anon:SELECT}, expected {}`,
  ],
  [
    'ALTER DEFAULT PRIVILEGES GRANT USAGE ON SEQUENCES TO PUBLIC',
    `default privileges for sequences created by ${SUPERUSER.user}: grants are {PUBLIC:USAGE}, expected {}`,
  ],
  [
    'CREATE ROLE fx_fifth; ALTER DEFAULT PRIVILEGES FOR ROLE fx_fifth GRANT SELECT ON TABLES TO app_auth',
    'default privileges for tables created by fx_fifth: grants are {app_auth:SELECT}, expected {}',
  ],
  // the registry itself is not trusted: a row that contradicts its class is refused, however
  // it got there, even when the catalog agrees with it
  [
    "UPDATE meta.expected_tables SET class = 'bogus' WHERE name = 'fx_content'",
    'registry: table fx_content (bogus): unknown class',
  ],
  [
    `GRANT TRUNCATE ON fx_own_rw TO app_auth;
     UPDATE meta.expected_tables SET auth_privileges = '{SELECT,INSERT,TRUNCATE}' WHERE name = 'fx_own_rw'`,
    'registry: table fx_own_rw (own_rw): app_auth may hold only SELECT, INSERT, UPDATE, DELETE',
  ],
  ...['REFERENCES', 'TRIGGER', 'select'].map((privilege): [string, string] => [
    `SELECT meta.expect_table('fx_own_rw', 'own_rw', '{SELECT,INSERT,${privilege}}', '{a}', 'user_id')`,
    'registry: table fx_own_rw (own_rw): app_auth may hold only SELECT, INSERT, UPDATE, DELETE',
  ]),
  [
    `GRANT INSERT ON fx_own_read TO app_auth;
     SELECT meta.expect_table('fx_own_read', 'own_read', '{SELECT,INSERT}', '{}', 'user_id')`,
    'registry: table fx_own_read (own_read): app_auth holds exactly {SELECT} and no column grant',
  ],
  [
    `GRANT UPDATE (code) ON fx_content TO app_auth;
     SELECT meta.expect_table('fx_content', 'content', '{SELECT}', '{code}', NULL)`,
    'registry: table fx_content (content): app_auth holds exactly {SELECT} and no column grant',
  ],
  [
    `GRANT SELECT ON fx_internal TO app_auth;
     SELECT meta.expect_table('fx_internal', 'internal', '{SELECT}', '{}', NULL)`,
    'registry: table fx_internal (internal): app_auth holds nothing',
  ],
  [
    "UPDATE meta.expected_tables SET owner_column = NULL WHERE name = 'fx_own_read'",
    'registry: table fx_own_read (own_read): owner_column is required for own_read and own_rw',
  ],
  [
    "SELECT meta.expect_table('fx_content', 'content', '{SELECT}', '{}', 'code')",
    'registry: table fx_content (content): owner_column is required for own_read and own_rw',
  ],
  [
    `GRANT EXECUTE ON FUNCTION fx_fn(text) TO PUBLIC;
     SELECT meta.expect_function('fx_fn(text)', 'definer', '{app_auth,app_anon,PUBLIC}')`,
    'registry: function fx_fn(text): only app_anon, app_auth, app_job can be registered, not {app_auth,app_anon,PUBLIC}',
  ],
  [
    `GRANT EXECUTE ON FUNCTION fx_fn(text) TO app_conn;
     SELECT meta.expect_function('fx_fn(text)', 'definer', '{app_auth,app_anon,app_conn}')`,
    'registry: function fx_fn(text): only app_anon, app_auth, app_job can be registered, not {app_auth,app_anon,app_conn}',
  ],
  // privileges on configuration parameters
  [
    'GRANT SET ON PARAMETER session_replication_role TO app_auth',
    'a configuration parameter is granted to an app role or to PUBLIC: session_replication_role to app_auth',
  ],
  [
    'GRANT SET ON PARAMETER session_replication_role TO PUBLIC',
    'a configuration parameter is granted to an app role or to PUBLIC: session_replication_role to PUBLIC',
  ],
  [
    'GRANT ALTER SYSTEM ON PARAMETER log_statement TO app_conn',
    'a configuration parameter is granted to an app role or to PUBLIC: log_statement to app_conn',
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

test('the registry refuses a declaration for something that does not exist', async () => {
  const declare = (sql: string) => fixture.admin.query(`SELECT ${sql}`);
  await expectPgError(
    declare("meta.expect_policy('fx_absent', 'p', 'SELECT', 'true', NULL)"),
    { code: '23503', messagePrefix: 'insert or update on table' },
  );
  await expectPgError(
    declare("meta.expect_function('fx_absent()', 'invoker', '{}')"),
    {
      code: '42883',
      messagePrefix: 'function "fx_absent()" does not exist',
    },
  );
});

test('a function is registered with its security mode: no default, no shorter form', async () => {
  const declare = (sql: string) => fixture.admin.query(`SELECT ${sql}`);
  // the form that registered roles only is gone: a file that was not converted fails right there
  await expectPgError(declare("meta.expect_function('fx_fn(text)', '{}')"), {
    code: '42883',
    messagePrefix:
      'function meta.expect_function(unknown, unknown) does not exist',
  });
  await expectPgError(
    declare("meta.expect_function('fx_fn(text)', NULL, '{}')"),
    { code: '23502', messagePrefix: 'null value in column "security"' },
  );
  // a typo fails at the registration, not at the end of the migration; so does a direct write
  const refused = {
    code: '23514',
    messagePrefix:
      'new row for relation "expected_functions" violates check constraint "expected_functions_security_check"',
  };
  await expectPgError(
    declare("meta.expect_function('fx_fn(text)', 'DEFINER', '{}')"),
    refused,
  );
  await expectPgError(
    fixture.admin.query(
      "UPDATE meta.expected_functions SET security = 'owner' WHERE signature = 'fx_fn(text)'",
    ),
    refused,
  );
});

test('a migration rebuilds the registry from the SQL files and ends with the self-check', async () => {
  // A migration rewrites the registry for good, so this runs on a database of its own: the
  // fixture database stays usable by any test added to this file.
  const disowned = await createTestDb();
  const client = await disowned.admin.connect();
  try {
    await client.query(FIXTURE);
    await client.query(VERIFY);
    // the fixture objects are declared by no SQL file, so the rebuilt registry disowns them
    await assert.rejects(
      migrate(client, SQL_DIR),
      /^Error: 90-verify.sql: table fx_content is not registered/,
    );
  } finally {
    client.release();
    await disowned.drop();
  }
});
