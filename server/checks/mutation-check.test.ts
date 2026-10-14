// Gate 3 (npm run db:mutation-check): gate 1 screams.
// 90-verify.sql is green on a correct schema, and so is a 90-verify.sql that has rotted. This
// gate tells the two apart: on one clone of the migrated database, through one superuser
// connection, it breaks every fence once inside a transaction, runs the full text of
// 90-verify.sql, requires it to raise a message that names what was broken, and rolls back.
// checks/verify.test.ts proves the same sentence by sentence on a hand-written fixture schema;
// here the mutations are enumerated from the catalog and the registry of the real schema, so a
// table, policy or function added by a later SQL file is covered without an edit.
//
// Rules for whoever edits it (backend-tu-chu 6.1 to 6.4, for a check of a check):
//   * one answer per mutation: SQLSTATE P0001 and a message carrying every fragment listed for
//     the mutation, each as a whole name, the first of them where the message (or the first
//     item after its "found: ") begins. Anything else fails and says which: the mutation did
//     not apply, verify did not raise, verify crashed, verify raised for another reason;
//   * a fragment is written the way the one assertion under test says it ("table users: grants
//     are" and "app_job:TRUNCATE", not "users"): another assertion that merely mentions the
//     table must not count. After OWNER TO app_auth the grants no longer match either, and that
//     sentence also holds "users" and "app_auth";
//   * a mutation that changes nothing reads as "verify did not raise": enumerate what the
//     intact schema lacks (a privilege not held, a membership not there), never a fixed list;
//   * a class that enumerated nothing fails, so no class is about a kind of object the schema
//     may lack. A view, a sequence or a trigger function is covered by the classes of
//     relations and functions; the test on a schema that has them proves every class still
//     applies (a class that breaks only views, such as dropping security_invoker, has no place
//     here until the real schema has a view);
//   * role mutations are rows of cluster-wide catalogs. They are safe because this gate runs
//     alone and never commits; the last test proves it through a new connection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { SUPERUSER, TEST } from '../scripts/cluster.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';

const VERIFY = readFileSync(
  new URL('../sql/90-verify.sql', import.meta.url),
  'utf8',
);
/** What RAISE EXCEPTION carries: a refusal of 90-verify.sql, not a crash inside it. */
const RAISED = 'P0001';

/**
 * `names`: what the message of 90-verify.sql must carry, every fragment of it. The first is the
 * subject of the sentence: the message, or the first item after its "found: ", begins with it.
 */
type Mutation = { sql: string; names: string[] };
type MutationClass = { name: string; mutations: Mutation[] };

// ---------------------------------------------------------------------------------------------
// The judge.

const NAME_CHARACTER = /[A-Za-z0-9_.]/;
/** Where `name` stands in `text` as a whole name: "users" is not in "user_settings", "app.users". */
function occurrences(text: string, name: string): number[] {
  const found: number[] = [];
  for (
    let at = text.indexOf(name);
    at !== -1;
    at = text.indexOf(name, at + 1)
  ) {
    const previous = text[at - 1] ?? ' ';
    const next = text[at + name.length] ?? ' ';
    if (!NAME_CHARACTER.test(previous) && !NAME_CHARACTER.test(next)) {
      found.push(at);
    }
  }
  return found;
}

const failure = (e: unknown) => e as { code?: string; message?: string };

/** The message 90-verify.sql refused the mutation with, or what happened instead. */
async function judge(
  client: PoolClient,
  { sql, names }: Mutation,
): Promise<{ message: string } | { problem: string }> {
  if (!sql || !names?.length || names.some(name => !name)) {
    return { problem: 'the gate lists no statement or names nothing for it' };
  }
  await client.query('BEGIN');
  try {
    const refusedDdl = await client.query(sql).then(() => null, failure);
    if (refusedDdl) {
      return {
        problem: `the mutation did not apply: ${refusedDdl.code} "${refusedDdl.message}"`,
      };
    }
    const raised = await client.query(VERIFY).then(() => null, failure);
    if (!raised) {
      return { problem: 'verify did not raise' };
    }
    const message = raised.message ?? '';
    if (raised.code !== RAISED) {
      return {
        problem: `verify crashed instead of refusing: ${raised.code} "${message}"`,
      };
    }
    // "schema public: grants are" also stands in the middle of the message about the default
    // privileges in schema public: the subject counts only where a sentence of verify begins
    const missing = names.filter(
      (name, i) =>
        !occurrences(message, name).some(
          at => i > 0 || at === 0 || message.slice(0, at).endsWith('found: '),
        ),
    );
    if (missing.length > 0) {
      return {
        problem: `raised for the wrong reason: "${message}" does not name "${missing.join(
          '" and "',
        )}"`,
      };
    }
    return { message };
  } finally {
    await client.query('ROLLBACK');
  }
}

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

type Result = { passed: string[]; failed: string[]; counts: string[] };

/** Every mutation of every class, each in its own transaction. Nothing stops at the first failure. */
async function run(
  client: PoolClient,
  classes: MutationClass[],
): Promise<Result> {
  const result: Result = { passed: [], failed: [], counts: [] };
  for (const { name, mutations } of classes) {
    if (mutations.length === 0) {
      result.failed.push(`class "${name}": covered 0`);
    }
    for (const mutation of mutations) {
      const verdict = await judge(client, mutation);
      if ('message' in verdict) {
        result.passed.push(
          `PASS ${oneLine(mutation.sql)} -> "${verdict.message}"`,
        );
      } else {
        result.failed.push(
          `FAIL ${oneLine(mutation.sql)} [${name}] -> ${verdict.problem}`,
        );
      }
    }
    result.counts.push(`${String(mutations.length).padStart(5)}  ${name}`);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// The mutations. Every statement below returns (sql, names): names and quoting come from the
// catalog, read as the superuser, never from a request.

const q = pg.escapeIdentifier;

const OURS = `left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'`;
const APP_ROLES = `(SELECT oid, rolname::text AS name, rolcanlogin, rolinherit
                      FROM pg_roles WHERE left(rolname, 4) = 'app_')`;
/** $1 is PUBLIC or an app role: as GRANT takes it (sql), as the ACL prints it (name), its oid. */
const GRANTEE = `(SELECT $1::text AS name,
                         CASE WHEN $1::text = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident($1::text) END AS sql,
                         coalesce((SELECT oid FROM pg_roles WHERE rolname = $1::text), 0) AS oid) g`;
/**
 * Every table, view and sequence of ours, with its class when it is registered. `kind` is what
 * 90-verify.sql calls it; `acl_type` what acldefault() calls it.
 */
const RELATIONS = `(SELECT c.oid, c.oid::regclass::text AS label, c.relrowsecurity AS rls, c.relowner AS owner,
                           CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' ELSE 'table' END AS kind,
                           x.acl_type, coalesce(c.relacl, acldefault(x.acl_type, c.relowner)) AS acl,
                           e.class, coalesce(e.auth_update_columns, '{}') AS update_columns
                      FROM pg_class c
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     CROSS JOIN LATERAL (SELECT (CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char" AS acl_type) x
                      LEFT JOIN meta.expected_tables e
                        ON n.nspname = 'public' AND e.name = c.relname AND c.relkind <> 'S'
                     WHERE c.relkind IN ('r', 'p', 'v', 'S') AND ${OURS}) t`;
/** The tables and views among them. */
const TABLES = `(SELECT * FROM ${RELATIONS} WHERE t.kind <> 'sequence') t`;
/** Every function of ours. */
const FUNCTIONS = `(SELECT p.oid::regprocedure::text AS label, p.prosecdef AS definer, p.proconfig AS settings,
                           coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
                      FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE ${OURS}) f`;
const ALLOWED_PATHS = `(ARRAY['search_path=public, pg_temp'], ARRAY['search_path=pg_catalog, pg_temp'])`;
/** The identity a stored setting would hand to every request: any uuid makes the point. */
const SOMEBODY = '00000000-0000-4000-8000-00000000abcd';

/** One class, or one per grantee when the statement takes $1. */
const CLASSES: { name: string; sql: string; perGrantee?: true }[] = [
  {
    name: 'row level security switched off',
    sql: `SELECT format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', t.label) AS sql,
                 ARRAY[format('table %s (%s): row level security is off', t.label, t.class)] AS names
            FROM ${TABLES} WHERE t.rls AND t.class IS NOT NULL ORDER BY t.label`,
  },
  {
    // The premise of running without FORCE ROW LEVEL SECURITY: no application role owns a table.
    name: 'table owned by app_auth',
    sql: `SELECT format('ALTER TABLE %s OWNER TO app_auth', t.label) AS sql,
                 ARRAY[format('%s %s is owned by app role app_auth', t.kind, t.label)] AS names
            FROM ${TABLES} ORDER BY t.label`,
  },
  {
    // Any other owner is exempt from the policies of the table just the same, and may grant it
    // on. The sequence of an identity column follows its table: the answer names the table.
    name: 'table owned by a role outside app_*',
    sql: `SELECT format('CREATE ROLE mc_outsider; ALTER TABLE %s OWNER TO mc_outsider', t.label) AS sql,
                 ARRAY[format('%s %s is owned by mc_outsider', t.kind, t.label)] AS names
            FROM ${TABLES} ORDER BY t.label`,
  },
  {
    // Nothing registers a trigger yet, so the intact schema has none. ENABLE ALWAYS: the kind
    // that fires whatever session_replication_role says.
    name: 'trigger on a table',
    sql: `SELECT format('CREATE FUNCTION public.mc_trigger() RETURNS trigger LANGUAGE plpgsql AS ''BEGIN RETURN NEW; END'';
                         SELECT meta.expect_function(''mc_trigger()'', ''invoker'', ''{}'');
                         CREATE TRIGGER mc_trigger BEFORE INSERT ON %1$s FOR EACH ROW EXECUTE FUNCTION public.mc_trigger();
                         ALTER TABLE %1$s ENABLE ALWAYS TRIGGER mc_trigger', t.label) AS sql,
                 ARRAY[format('trigger "mc_trigger" on %s is not allowed', t.label)] AS names
            FROM ${TABLES} WHERE t.kind = 'table' ORDER BY t.label`,
  },
  {
    // What a rule adds to a statement runs as the owner of the table: privileged code that is
    // no registered function.
    name: 'rule on a table',
    sql: `SELECT format('CREATE RULE mc_rule AS ON INSERT TO %s DO ALSO NOTHING', t.label) AS sql,
                 ARRAY[format('rule "mc_rule" on %s is not allowed', t.label)] AS names
            FROM ${TABLES} ORDER BY t.label`,
  },
  {
    // Every kind of privilege PostgreSQL knows for the relation (a table, a view, the sequence
    // of an identity column), to everyone who does not hold it.
    name: 'table or sequence privilege granted to',
    perGrantee: true,
    sql: `SELECT format('GRANT %s ON %s %s TO %s', k.privilege,
                        CASE WHEN t.kind = 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, t.label, g.sql) AS sql,
                 ARRAY[format('%s %s: grants are', t.kind, t.label), g.name || ':' || k.privilege] AS names
            FROM ${RELATIONS}
           CROSS JOIN ${GRANTEE}
           CROSS JOIN LATERAL (SELECT DISTINCT privilege_type AS privilege
                                 FROM aclexplode(acldefault(t.acl_type, t.owner))) k
           WHERE NOT EXISTS (SELECT 1 FROM aclexplode(t.acl) a
                              WHERE a.grantee = g.oid AND a.privilege_type = k.privilege)
           ORDER BY t.label, k.privilege`,
  },
  {
    // A privilege an app role holds by design, handed on: "*" in the ACL.
    name: 'privilege an app role holds, granted again WITH GRANT OPTION',
    sql: `SELECT format('GRANT %s ON %s %s TO %I WITH GRANT OPTION', a.privilege_type,
                        CASE WHEN t.kind = 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, t.label, r.name) AS sql,
                 ARRAY[format('%s %s: grants are', t.kind, t.label),
                       r.name || ':' || a.privilege_type || '*'] AS names
            FROM ${RELATIONS}
           CROSS JOIN LATERAL aclexplode(t.acl) a
            JOIN ${APP_ROLES} r ON r.oid = a.grantee
           WHERE NOT a.is_grantable
           ORDER BY t.label, r.name, a.privilege_type`,
  },
  {
    name: 'UPDATE granted to app_auth on a column not registered for it',
    sql: `SELECT format('GRANT UPDATE (%I) ON %s TO app_auth', a.attname, t.label) AS sql,
                 ARRAY[format('column %s.%s: grants are', t.label, a.attname), 'app_auth:UPDATE'] AS names
            FROM ${TABLES}
           CROSS JOIN LATERAL (SELECT a.attname FROM pg_attribute a
                                WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
                                  AND a.attname::text <> ALL (t.update_columns)
                                ORDER BY a.attnum LIMIT 1) a
           ORDER BY t.label`,
  },
  {
    // A table of user or internal rows, declared with the block of a content table.
    name: 'table hanging off a user-data table, registered as content',
    sql: `SELECT format('CREATE TABLE public.mc_content (LIKE %1$s);
                         ALTER TABLE public.mc_content ADD FOREIGN KEY (%2$s) REFERENCES %1$s;
                         GRANT SELECT ON public.mc_content TO app_auth;
                         SELECT meta.expect_table(''mc_content'', ''content'', ''{SELECT}'', ''{}'', NULL)',
                        t.label, key.columns) AS sql,
                 ARRAY[format('content table mc_content has a foreign key to %s (%s)', t.label, t.class)] AS names
            FROM ${TABLES}
           CROSS JOIN LATERAL (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord) AS columns
                                 FROM pg_constraint c
                                CROSS JOIN unnest(c.conkey) WITH ORDINALITY k (attnum, ord)
                                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                                WHERE c.conrelid = t.oid AND c.contype = 'p') key
           WHERE t.class <> 'content' AND key.columns IS NOT NULL
           ORDER BY t.label`,
  },
  {
    // For each command the table grants app_auth; FOR ALL where it grants none.
    name: 'second permissive policy USING (true)',
    sql: `SELECT format('CREATE POLICY mc_open ON %s FOR %s TO app_auth %s (true)', t.label, k.cmd,
                        CASE WHEN k.cmd = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END) AS sql,
                 ARRAY[CASE WHEN t.class = 'internal'
                            THEN format('internal table %s has policy "mc_open"', t.label)
                            ELSE format('policy "mc_open" on table %s is not registered', t.label) END] AS names
            FROM ${TABLES}
           CROSS JOIN LATERAL (
                   SELECT cmd FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) cmd
                    WHERE CASE WHEN cmd = 'DELETE' THEN has_table_privilege('app_auth', t.oid, cmd)
                               ELSE has_any_column_privilege('app_auth', t.oid, cmd) END
                    UNION ALL
                   SELECT 'ALL' WHERE NOT has_table_privilege('app_auth', t.oid, 'DELETE')
                                  AND NOT has_any_column_privilege('app_auth', t.oid, 'SELECT, INSERT, UPDATE')) k
           WHERE t.class IS NOT NULL AND t.kind = 'table'
           ORDER BY t.label, k.cmd`,
  },
  {
    name: 'EXECUTE granted to',
    perGrantee: true,
    sql: `SELECT format('GRANT EXECUTE ON ROUTINE %s TO %s', f.label, g.sql) AS sql,
                 ARRAY[format('function %s: grants are', f.label), g.name || ':EXECUTE'] AS names
            FROM ${FUNCTIONS}
           CROSS JOIN ${GRANTEE}
           WHERE NOT EXISTS (SELECT 1 FROM aclexplode(f.acl) a WHERE a.grantee = g.oid)
           ORDER BY f.label`,
  },
  {
    name: 'function owned by app_auth',
    sql: `SELECT format('ALTER ROUTINE %s OWNER TO app_auth', f.label) AS sql,
                 ARRAY[format('function %s is owned by app role app_auth', f.label)] AS names
            FROM ${FUNCTIONS} ORDER BY f.label`,
  },
  {
    // A SECURITY DEFINER function runs as its owner, whoever that is, and its owner may
    // replace its body: the answer names the function, not the default privileges of the role.
    name: 'function owned by a role outside app_*',
    sql: `SELECT format('CREATE ROLE mc_outsider; ALTER ROUTINE %s OWNER TO mc_outsider', f.label) AS sql,
                 ARRAY[format('function %s is owned by mc_outsider', f.label)] AS names
            FROM ${FUNCTIONS} ORDER BY f.label`,
  },
  {
    name: 'function declared LEAKPROOF',
    sql: `SELECT format('ALTER ROUTINE %s LEAKPROOF', f.label) AS sql,
                 ARRAY[format('function %s is LEAKPROOF', f.label)] AS names
            FROM ${FUNCTIONS} ORDER BY f.label`,
  },
  {
    name: 'SECURITY DEFINER function without its search_path',
    sql: `SELECT format('ALTER ROUTINE %s RESET search_path', f.label) AS sql,
                 ARRAY[f.label || ' {}'] AS names
            FROM ${FUNCTIONS} WHERE f.definer ORDER BY f.label`,
  },
  {
    // Also a SECURITY INVOKER helper: called by a SECURITY DEFINER function, it runs as the owner.
    name: 'function with a search_path that temporary objects shadow',
    sql: `SELECT format('ALTER ROUTINE %s SET search_path = pg_temp, public', f.label) AS sql,
                 ARRAY[f.label || ' {"search_path=pg_temp, public"}'] AS names
            FROM ${FUNCTIONS} ORDER BY f.label`,
  },
  // The security mode, alone and together with the setting that makes the function look
  // well-formed in its new mode: only the registered mode tells the second kind from a design.
  {
    name: 'SECURITY DEFINER function made SECURITY INVOKER',
    sql: `SELECT format('ALTER ROUTINE %s SECURITY INVOKER', f.label) AS sql,
                 ARRAY[f.label || ' is SECURITY INVOKER, registered definer'] AS names
            FROM ${FUNCTIONS} WHERE f.definer ORDER BY f.label`,
  },
  {
    name: 'SECURITY DEFINER function made SECURITY INVOKER, its search_path reset with it',
    sql: `SELECT format('ALTER ROUTINE %s SECURITY INVOKER RESET search_path', f.label) AS sql,
                 ARRAY[f.label || ' is SECURITY INVOKER, registered definer'] AS names
            FROM ${FUNCTIONS} WHERE f.definer ORDER BY f.label`,
  },
  {
    // One that carries no setting is refused for that first: a definer must carry its path.
    name: 'SECURITY INVOKER function made SECURITY DEFINER',
    sql: `SELECT format('ALTER ROUTINE %s SECURITY DEFINER', f.label) AS sql,
                 ARRAY[CASE WHEN f.settings IN ${ALLOWED_PATHS}
                            THEN f.label || ' is SECURITY DEFINER, registered invoker'
                            ELSE format('%s %s', f.label, coalesce(f.settings, '{}')) END] AS names
            FROM ${FUNCTIONS} WHERE NOT f.definer ORDER BY f.label`,
  },
  {
    name: 'SECURITY INVOKER function made SECURITY DEFINER, with the allowed search_path',
    sql: `SELECT format('ALTER ROUTINE %s SECURITY DEFINER SET search_path = public, pg_temp', f.label) AS sql,
                 ARRAY[f.label || ' is SECURITY DEFINER, registered invoker'] AS names
            FROM ${FUNCTIONS} WHERE NOT f.definer ORDER BY f.label`,
  },
  {
    name: 'schema privilege granted to',
    perGrantee: true,
    sql: `SELECT format('GRANT %s ON SCHEMA %I TO %s', k.privilege, n.nspname, g.sql) AS sql,
                 ARRAY[format('schema %s: grants are', n.nspname), g.name || ':' || k.privilege] AS names
            FROM pg_namespace n
           CROSS JOIN ${GRANTEE}
           CROSS JOIN LATERAL (SELECT DISTINCT privilege_type AS privilege
                                 FROM aclexplode(acldefault('n', n.nspowner))) k
           WHERE ${OURS}
             AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                              WHERE a.grantee = g.oid AND a.privilege_type = k.privilege)
           ORDER BY n.nspname, k.privilege`,
  },
  {
    // What the next table, function or sequence is born with: nothing exists yet to look at.
    name: 'default privileges granted to',
    perGrantee: true,
    sql: `SELECT format('ALTER DEFAULT PRIVILEGES %sGRANT %s ON %s TO %s', s.clause, k.privileges, k.objects, g.sql) AS sql,
                 ARRAY[format('default privileges for %s created by %s%s: grants are', lower(k.objects), current_user, s.label),
                       g.name || ':' || k.one] AS names
            FROM (VALUES ('INSERT, UPDATE, DELETE', 'TABLES', 'INSERT'),
                         ('EXECUTE', 'FUNCTIONS', 'EXECUTE'),
                         ('USAGE', 'SEQUENCES', 'USAGE')) k (privileges, objects, one)
           CROSS JOIN (VALUES ('', ''), ('IN SCHEMA public ', ' in schema public')) s (clause, label)
           CROSS JOIN ${GRANTEE}
           ORDER BY k.objects, s.clause`,
  },
  {
    name: 'app role made SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION',
    sql: `SELECT format('ALTER ROLE %I %s', r.name, attribute) AS sql,
                 ARRAY[format('role %s is SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION', r.name)] AS names
            FROM ${APP_ROLES} r
           CROSS JOIN unnest(ARRAY['SUPERUSER', 'BYPASSRLS', 'CREATEROLE', 'CREATEDB', 'REPLICATION']) attribute
           ORDER BY r.name, attribute`,
  },
  {
    name: 'request role allowed to log in',
    sql: `SELECT format('ALTER ROLE %I LOGIN', r.name) AS sql,
                 ARRAY[format('role %s can log in', r.name)] AS names
            FROM ${APP_ROLES} r WHERE NOT r.rolcanlogin ORDER BY r.name`,
  },
  {
    name: 'login role made INHERIT',
    sql: `SELECT format('ALTER ROLE %I INHERIT', r.name) AS sql,
                 ARRAY[format('role %s must be LOGIN NOINHERIT', r.name)] AS names
            FROM ${APP_ROLES} r WHERE r.rolcanlogin ORDER BY r.name`,
  },
  {
    // Every pair of app roles with no membership in either direction (a second one would be a loop).
    name: 'membership between app roles that the design lacks',
    sql: `SELECT format('GRANT %I TO %I', g.name, m.name) AS sql,
                 ARRAY[format('%s in %s', m.name, g.name)] AS names
            FROM ${APP_ROLES} m
            JOIN ${APP_ROLES} g ON g.oid <> m.oid
           WHERE NOT EXISTS (SELECT 1 FROM pg_auth_members am
                              WHERE (am.member = m.oid AND am.roleid = g.oid)
                                 OR (am.member = g.oid AND am.roleid = m.oid))
           ORDER BY m.name, g.name`,
  },
  {
    name: 'membership of the login role made inheriting',
    sql: `SELECT format('GRANT %I TO %I WITH INHERIT TRUE', g.name, m.name) AS sql,
                 ARRAY[format('%s in %s (inherit t, set t, admin f)', m.name, g.name)] AS names
            FROM pg_auth_members am
            JOIN ${APP_ROLES} m ON m.oid = am.member
            JOIN ${APP_ROLES} g ON g.oid = am.roleid
           ORDER BY m.name, g.name`,
  },
  {
    // Applied at login, before any request code runs: a role and an identity nobody asked for.
    name: 'setting stored for an app role in this database',
    sql: `SELECT format('ALTER ROLE %I IN DATABASE %I SET %s = %L', r.name, current_database(), s.name, s.value) AS sql,
                 ARRAY[format('a stored setting applies to an app role: role %s, database %s: {%s=%s}',
                              r.name, current_database(), s.name, s.value)] AS names
            FROM ${APP_ROLES} r
           CROSS JOIN (VALUES ('role', 'app_auth'), ('app.user_id', '${SOMEBODY}')) s (name, value)
           ORDER BY r.name, s.name`,
  },
];

/** Objects of the database, not of a schema: the intact one has none, so one of each. */
const DATABASE_OBJECTS: MutationClass[] = [
  {
    name: 'event trigger',
    mutations: [
      {
        sql: `CREATE FUNCTION public.mc_ddl() RETURNS event_trigger LANGUAGE plpgsql AS 'BEGIN NULL; END';
              SELECT meta.expect_function('mc_ddl()', 'invoker', '{}');
              CREATE EVENT TRIGGER mc_ddl ON ddl_command_end EXECUTE FUNCTION public.mc_ddl()`,
        names: ['event trigger mc_ddl is not allowed'],
      },
    ],
  },
  {
    name: 'publication',
    mutations: [
      {
        sql: 'CREATE PUBLICATION mc_publication FOR ALL TABLES',
        names: ['publication mc_publication is not allowed'],
      },
    ],
  },
  {
    name: 'foreign-data wrapper, foreign server',
    mutations: [
      {
        sql: 'CREATE FOREIGN DATA WRAPPER mc_wrapper',
        names: ['foreign-data wrapper mc_wrapper is not allowed'],
      },
      {
        sql: `CREATE FOREIGN DATA WRAPPER mc_wrapper;
              CREATE SERVER mc_server FOREIGN DATA WRAPPER mc_wrapper;
              GRANT USAGE ON FOREIGN SERVER mc_server TO app_auth`,
        names: ['foreign server mc_server is not allowed'],
      },
    ],
  },
];

const ONE_OF_EACH: Mutation[] = [
  {
    sql: 'CREATE TABLE public.mc_unregistered (id int)',
    names: ['table mc_unregistered is not registered'],
  },
  {
    sql: "CREATE FUNCTION public.mc_unregistered() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    names: ['function is not registered', 'mc_unregistered()'],
  },
  {
    sql: 'INSERT INTO meta.test_clock (now) VALUES (now())',
    names: ['meta.test_clock is not empty'],
  },
];

type Policy = {
  name: string;
  table: string;
  permissive: boolean;
  cmd: string;
  roles: string;
  using: string | null;
  check: string | null;
  columns: { name: string; type: string }[];
};
const POLICIES = `
  SELECT p.polname::text AS name, t.label AS "table", p.polpermissive AS permissive,
         CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                       WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS cmd,
         (SELECT string_agg(CASE WHEN o = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(o)) END, ', ')
            FROM unnest(p.polroles) o) AS roles,
         pg_get_expr(p.polqual, p.polrelid) AS "using",
         pg_get_expr(p.polwithcheck, p.polrelid) AS "check",
         (SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod))
                           ORDER BY a.attnum)
            FROM pg_attribute a
           WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns
    FROM pg_policy p
    JOIN ${TABLES} ON t.oid = p.polrelid
   ORDER BY t.label, p.polname`;

/** The policy dropped and created again, the same but for `change`. */
function recreated(
  policy: Policy,
  change: Partial<Pick<Policy, 'permissive' | 'cmd' | 'using' | 'check'>>,
): string {
  const { name, table, permissive, cmd, roles, using, check } = {
    ...policy,
    ...change,
  };
  return (
    `DROP POLICY ${q(name)} ON ${table}; ` +
    `CREATE POLICY ${q(name)} ON ${table} AS ${
      permissive ? 'PERMISSIVE' : 'RESTRICTIVE'
    } FOR ${cmd} TO ${roles}` +
    (using === null ? '' : ` USING (${using})`) +
    (check === null ? '' : ` WITH CHECK (${check})`)
  );
}

/**
 * The expression with the first column it reads replaced by another column of the table, or
 * null when it reads none. Any type casts to text and text to any type, so it still parses.
 * ponytail: matches the bare column name, so a column whose name needs quotes makes a statement
 * that does not apply, and the gate says so; quote-aware matching when such a column exists.
 */
function onAnotherColumn(
  expression: string,
  columns: Policy['columns'],
): string | null {
  for (const column of columns) {
    const [at] = occurrences(expression, column.name);
    const other = columns.find(({ name }) => name !== column.name);
    if (at !== undefined && other) {
      return (
        expression.slice(0, at) +
        `(${q(other.name)})::text::${column.type}` +
        expression.slice(at + column.name.length)
      );
    }
  }
  return null;
}

function policyClasses(policies: Policy[]): MutationClass[] {
  const named = ({ name, table }: Policy) =>
    `policy "${name}" on table ${table}`;
  /** One mutation per expression of each policy: USING, WITH CHECK, or both. */
  const perExpression = (
    edit: (expression: string, p: Policy) => string | null,
  ) =>
    policies.flatMap(policy =>
      (
        [
          ['using', 'USING'],
          ['check', 'WITH CHECK'],
        ] as const
      ).flatMap(([key, clause]): Mutation[] => {
        const original = policy[key];
        const edited = original === null ? null : edit(original, policy);
        return edited === null
          ? []
          : [
              {
                sql: recreated(policy, { [key]: edited }),
                names: [`${named(policy)}: ${clause} is`],
              },
            ];
      }),
    );
  return [
    {
      name: 'policy expression opened with OR true',
      mutations: perExpression(expression => `(${expression}) OR true`),
    },
    {
      name: 'policy expression on a different column',
      mutations: perExpression((expression, { columns }) =>
        onAnotherColumn(expression, columns),
      ),
    },
    {
      name: 'policy dropped',
      mutations: policies.map(policy => ({
        sql: `DROP POLICY ${q(policy.name)} ON ${policy.table}`,
        names: [`registered ${named(policy)} does not exist`],
      })),
    },
    {
      name: 'policy made RESTRICTIVE',
      mutations: policies
        .filter(({ permissive }) => permissive)
        .map(policy => ({
          sql: recreated(policy, { permissive: false }),
          names: [`${named(policy)}: is RESTRICTIVE`],
        })),
    },
    {
      name: 'policy widened to FOR ALL',
      mutations: policies
        .filter(({ cmd }) => cmd !== 'ALL')
        .map(policy => ({
          sql: recreated(policy, { cmd: 'ALL' }),
          names: [`${named(policy)}: command is ALL, registered ${policy.cmd}`],
        })),
    },
    {
      name: 'policy TO PUBLIC',
      mutations: policies.map(policy => ({
        sql: `ALTER POLICY ${q(policy.name)} ON ${policy.table} TO PUBLIC`,
        names: [`${named(policy)}: applies to {PUBLIC}`],
      })),
    },
  ];
}

async function enumerate(client: PoolClient): Promise<MutationClass[]> {
  const rows = async <Row extends pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => (await client.query<Row>(sql, params)).rows;
  const roles = await rows<{ name: string }>(
    `SELECT r.name FROM ${APP_ROLES} r ORDER BY 1`,
  );
  const grantees = ['PUBLIC', ...roles.map(({ name }) => name)];
  const classes: MutationClass[] = [];
  for (const { name, sql, perGrantee } of CLASSES) {
    if (perGrantee) {
      for (const grantee of grantees) {
        classes.push({
          name: `${name} ${grantee}`,
          mutations: await rows<Mutation>(sql, [grantee]),
        });
      }
    } else {
      classes.push({ name, mutations: await rows<Mutation>(sql) });
    }
  }
  return [
    ...classes,
    ...policyClasses(await rows<Policy>(POLICIES)),
    ...DATABASE_OBJECTS,
    {
      name: 'unregistered table, unregistered function, test clock set',
      mutations: ONE_OF_EACH,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// The gate.

/** The cluster-wide rows a role mutation writes, and the default privileges of this database. */
async function clusterState(db: Pick<PoolClient, 'query'>): Promise<string[]> {
  const { rows } = await db.query<{ line: string }>(`
    SELECT line FROM (
      SELECT format('role %s %s', rolname, row(rolcanlogin, rolinherit, rolsuper, rolbypassrls,
                                               rolcreaterole, rolcreatedb, rolreplication))
        FROM pg_roles WHERE left(rolname, 4) = 'app_'
      UNION ALL
      SELECT format('member %s', row(member::regrole, roleid::regrole, inherit_option, set_option, admin_option))
        FROM pg_auth_members
      UNION ALL
      SELECT format('setting %s', row(setdatabase, setrole::regrole, setconfig)) FROM pg_db_role_setting
      UNION ALL
      SELECT format('default privileges %s', row(defaclrole::regrole, defaclnamespace, defaclobjtype, defaclacl))
        FROM pg_default_acl
    ) lines (line) ORDER BY 1`);
  return rows.map(({ line }) => line);
}

let db: TestDb;
let client: PoolClient;
let intact: string[];
before(async () => {
  db = await createTestDb();
  client = await db.admin.connect();
  // regclass and regprocedure print a name without its schema exactly when it is public, as
  // 90-verify.sql prints it
  await client.query('SET search_path = public, pg_temp');
});
after(async () => {
  client?.release();
  await db?.drop();
});

test('before any mutation 90-verify.sql passes', async () => {
  await client.query(VERIFY);
  intact = await clusterState(client);
  assert.ok(
    intact.some(line => line.startsWith('role app_conn ')),
    'the snapshot of the cluster sees no app_conn',
  );
});

test('self-test: the gate reports a mutation that proves nothing', async () => {
  const [table] = await client
    .query<{ label: string }>(
      `SELECT t.label FROM ${TABLES} WHERE t.rls ORDER BY 1 LIMIT 1`,
    )
    .then(({ rows }) => rows);
  assert.ok(table, 'no table with row level security to break');
  const rlsOff = `ALTER TABLE ${table.label} DISABLE ROW LEVEL SECURITY`;
  const traps: [what: string, classes: MutationClass[], reported: string][] = [
    [
      'a mutation that breaks nothing',
      [{ name: 'trap', mutations: [{ sql: 'SELECT 1', names: ['anything'] }] }],
      'FAIL SELECT 1 [trap] -> verify did not raise',
    ],
    [
      'a raise for an unrelated object',
      [
        {
          name: 'trap',
          mutations: [{ sql: rlsOff, names: ['table mc_another_table'] }],
        },
      ],
      `FAIL ${rlsOff} [trap] -> raised for the wrong reason: "table ${table.label} (`,
    ],
    [
      'a name that is only part of the name in the message',
      [
        {
          name: 'trap',
          mutations: [{ sql: rlsOff, names: [table.label.slice(0, -1)] }],
        },
      ],
      `FAIL ${rlsOff} [trap] -> raised for the wrong reason: "table ${table.label} (`,
    ],
    [
      'a name that stands in the message, but not where its sentence begins',
      [
        {
          name: 'trap',
          mutations: [{ sql: rlsOff, names: ['row level security is off'] }],
        },
      ],
      `FAIL ${rlsOff} [trap] -> raised for the wrong reason: "table ${table.label} (`,
    ],
    [
      'a mutation that does not apply',
      [
        {
          name: 'trap',
          mutations: [
            {
              sql: 'ALTER TABLE mc_absent DISABLE ROW LEVEL SECURITY',
              names: ['mc_absent'],
            },
          ],
        },
      ],
      'FAIL ALTER TABLE mc_absent DISABLE ROW LEVEL SECURITY [trap] -> the mutation did not apply: 42P01 ',
    ],
    [
      'a mutation that names nothing',
      [{ name: 'trap', mutations: [{ sql: rlsOff, names: [] }] }],
      `FAIL ${rlsOff} [trap] -> the gate lists no statement or names nothing for it`,
    ],
    [
      'a class that enumerated nothing',
      [{ name: 'trap', mutations: [] }],
      'class "trap": covered 0',
    ],
  ];
  for (const [what, classes, reported] of traps) {
    const { passed, failed } = await run(client, classes);
    assert.deepEqual(passed, [], what);
    assert.equal(failed.length, 1, what);
    assert.ok(
      failed[0].startsWith(reported),
      `${what}: "${failed[0]}" does not start with "${reported}"`,
    );
    console.log(`self-test: ${what} -> ${failed[0]}`);
  }
  // and the same mutation, named as verify names it, passes: the traps failed for their names
  const { passed, failed } = await run(client, [
    {
      name: 'control',
      mutations: [{ sql: rlsOff, names: [`table ${table.label}`] }],
    },
  ]);
  assert.deepEqual(failed, []);
  assert.equal(passed.length, 1);
});

/** Every class, on the schema `connection` sees. Fails unless every mutation is detected. */
async function gate(
  connection: PoolClient,
  title: string,
  printed: (passed: string[]) => string[],
): Promise<Result> {
  const started = performance.now();
  const classes = await enumerate(connection);
  const result = await run(connection, classes);
  const { passed, failed, counts } = result;
  console.log(
    [
      ...printed(passed),
      ...failed,
      '',
      'mutations  class',
      ...counts,
      `${title}: ${passed.length} of ${
        passed.length + failed.length
      } detected, ${classes.length} classes, ${Math.round(
        performance.now() - started,
      )} ms`,
    ].join('\n'),
  );
  assert.equal(
    failed.length,
    0,
    `${
      failed.length
    } not detected (every line is printed above), the first:\n${failed
      .slice(0, 20)
      .join('\n')}`,
  );
  return result;
}

let detected = 0;
test('every fence broken once: 90-verify.sql raises and names it', async () => {
  const { passed } = await gate(client, 'mutation-check', lines => lines);
  detected = passed.length;
});

// What later SQL files will bring and the schema does not have yet: an identity key (and so a
// sequence), a view, a callable function that runs as its caller and pins its search_path, an
// internal function that must run as the owner. Each is declared the way docs/backend.md says,
// and nothing above this line knows their names.
const FUTURE_SCHEMA = `
  CREATE TABLE mc_future_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, note text);
  ALTER TABLE mc_future_events ENABLE ROW LEVEL SECURITY;
  CREATE POLICY own_select ON mc_future_events FOR SELECT TO app_auth USING (app.current_user_id() = user_id);
  GRANT SELECT ON mc_future_events TO app_auth;
  SELECT meta.expect_table('mc_future_events', 'own_read', '{SELECT}', '{}', 'user_id');
  SELECT meta.expect_policy('mc_future_events', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);

  CREATE VIEW mc_future_view WITH (security_invoker = true) AS SELECT count(*) AS n FROM mc_future_events;
  GRANT SELECT ON mc_future_view TO app_auth;
  SELECT meta.expect_table('mc_future_view', 'content', '{SELECT}', '{}', NULL);

  CREATE FUNCTION mc_future_count() RETURNS bigint
    LANGUAGE sql STABLE SET search_path = public, pg_temp AS 'SELECT count(*) FROM mc_future_events';
  GRANT EXECUTE ON FUNCTION mc_future_count() TO app_auth;
  SELECT meta.expect_function('mc_future_count()', 'invoker', '{app_auth}');

  CREATE FUNCTION app._mc_future_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS 'BEGIN RETURN NEW; END';
  SELECT meta.expect_function('app._mc_future_audit()', 'definer', '{}');
`;
/** One line per new kind of object: what only the enumeration could have produced. */
const FUTURE_COVERED = [
  'PASS ALTER TABLE mc_future_events OWNER TO app_auth -> "table mc_future_events is owned by app role app_auth"',
  'PASS GRANT USAGE ON SEQUENCE mc_future_events_id_seq TO app_auth -> "sequence mc_future_events_id_seq: grants are {app_auth:USAGE}, expected {}"',
  'PASS ALTER TABLE mc_future_view OWNER TO app_auth -> "view mc_future_view is owned by app role app_auth"',
  ...['table mc_future_events', 'view mc_future_view'].map(
    relation =>
      `PASS CREATE ROLE mc_outsider; ALTER TABLE ${
        relation.split(' ')[1]
      } OWNER TO mc_outsider -> ` +
      `"${relation} is owned by mc_outsider: every table, view, sequence and function of ours belongs to ` +
      `${SUPERUSER.user}, the owner of schema meta, who runs the schema files"`,
  ),
  'PASS GRANT SELECT ON TABLE mc_future_view TO app_anon -> "view mc_future_view: grants are {app_anon:SELECT,app_auth:SELECT}, expected {app_auth:SELECT}"',
  'PASS ALTER ROUTINE mc_future_count() SECURITY DEFINER -> "function security: the mode of a function is the one registered for it (meta.expect_function); found: mc_future_count() is SECURITY DEFINER, registered invoker"',
  'PASS ALTER ROUTINE app._mc_future_audit() SECURITY INVOKER -> "function security: the mode of a function is the one registered for it (meta.expect_function); found: app._mc_future_audit() is SECURITY INVOKER, registered definer"',
];

test('self-test: a schema with an identity key, a view and the rarer kinds of function is covered with no edit here', async () => {
  const future = await createTestDb();
  const connection = await future.admin.connect();
  try {
    await connection.query('SET search_path = public, pg_temp');
    await connection.query(FUTURE_SCHEMA);
    await connection.query(VERIFY);
    const { passed } = await gate(connection, 'future schema', () => []);
    assert.ok(
      passed.length > detected,
      `${passed.length} mutations on the larger schema, ${detected} on the real one`,
    );
    for (const line of FUTURE_COVERED) {
      assert.ok(passed.includes(line), `missing: ${line}`);
    }
  } finally {
    connection.release();
    await future.drop();
  }
});

test('after the last rollback, through a new connection: verify passes and the roles of the cluster are untouched', async () => {
  const fresh = new pg.Client({
    host: '127.0.0.1',
    port: TEST.port,
    ...SUPERUSER,
    database: db.name,
  });
  await fresh.connect();
  try {
    await fresh.query(VERIFY);
    const { rows: roles } = await fresh.query<{
      name: string;
      login: boolean;
      inherit: boolean;
      elevated: boolean;
    }>(
      `SELECT rolname::text AS name, rolcanlogin AS login, rolinherit AS inherit,
              rolsuper OR rolbypassrls AS elevated
         FROM pg_roles WHERE left(rolname, 4) = 'app_' ORDER BY 1`,
    );
    assert.deepEqual(
      roles.filter(({ login }) => login),
      [{ name: 'app_conn', login: true, inherit: false, elevated: false }],
      'only app_conn logs in, and it is NOINHERIT',
    );
    assert.deepEqual(
      roles.filter(({ elevated }) => elevated),
      [],
      'no app role is SUPERUSER or BYPASSRLS',
    );
    // memberships, stored settings and default privileges: exactly those of the intact cluster
    assert.deepEqual(await clusterState(fresh), intact);
  } finally {
    await fresh.end();
  }
});
