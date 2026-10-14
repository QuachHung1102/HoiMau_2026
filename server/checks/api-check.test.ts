// Gate 2 (npm run db:api-check): what a request can really do.
// Everything under test goes through app_conn, the role the application connects as, with the
// role switch of a request; the superuser pool only reads the registry, arranges and reads back.
//
// The twelve generic checks are driven by the registry (meta.expected_*) and the catalog, so a
// table or function added by a later SQL file is covered without an edit here. The attacks of
// checks/attacks/*.ts follow. The controls at the end break one fence at a time on a second
// database and require the check to fail, naming what was broken.
//
// Rules for whoever edits a check (backend-tu-chu 6.1 to 6.4):
//   * one intact state per assertion: SQLSTATE 42501 and the whole message, which names the
//     fence (schema, table, function or policy) and the object. Any other outcome is a failure:
//     another error, another refusal, a result;
//   * each fence is asserted by its own mechanism. refusal() below is what was measured on the
//     intact schema, per role and kind of object; never accept two of them in one assertion;
//   * a probe needs exactly the one thing it probes. For a GRANT: INSERT ... DEFAULT VALUES,
//     UPDATE ... SET c = DEFAULT WHERE false, DELETE ... WHERE false, TRUNCATE. A statement
//     that also reads a column is refused for the missing SELECT and hides a stray write grant.
//     For a policy: UPDATE ... SET c = <value> and DELETE with no WHERE, rolled back, whose row
//     count must be the rows user A owns. A statement that reads a column (WHERE owner = the
//     decoy) passes through the SELECT policy first: its "0 rows" says nothing about the
//     UPDATE or DELETE policy;
//   * a check that looks for rows first proves, as the superuser, that the rows are there;
//   * the class a file registered is a claim: what holds user data is read from the keys;
//   * a check that covered nothing fails, and every new check gets a control.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import { APP_CONN, TEST } from '../scripts/cluster.ts';
import { asAnon, asJob, asUser, expectPgError } from '../test/helpers.ts';
import { newOnboardedUser } from '../test/http.ts';
import { createTestDb } from '../test/testdb.ts';
import type { TestDb } from '../test/testdb.ts';
import { DECOY_1, DECOY_2, userDataTables } from './attacks/base.ts';
import type { Attack } from './attacks/base.ts';

const DENIED = '42501';

type Role = 'app_conn' | 'app_anon' | 'app_auth' | 'app_job';
const ROLES: Role[] = ['app_conn', 'app_anon', 'app_auth', 'app_job'];

/**
 * Who may use each schema. A role without USAGE is stopped at the schema, before the object is
 * even looked at: that is the whole fence of plain app_conn (no role switch), and of every role
 * in meta.
 */
const SCHEMA_USERS: Record<string, Role[]> = {
  public: ['app_anon', 'app_auth', 'app_job'],
  app: ['app_anon', 'app_auth', 'app_job'],
  meta: [],
};

/**
 * The message of the one refusal `role` gets for an object it holds no privilege on, named
 * with its schema. Measured on the intact schema (docs/backend.md, "Cổng 2"):
 *   no USAGE on the schema              permission denied for schema <schema>
 *   USAGE, no privilege on the table    permission denied for table <table>
 *   USAGE, no EXECUTE on the function   permission denied for function <function>
 */
function refusal(
  role: Role,
  schema: string,
  kind: 'table' | 'function',
  name: string,
): string {
  const users = SCHEMA_USERS[schema];
  assert.ok(users, `schema ${schema}: say in SCHEMA_USERS who may use it`);
  return users.includes(role)
    ? `permission denied for ${kind} ${name}`
    : `permission denied for schema ${schema}`;
}
/** The refusal of a policy, for a role that got past the GRANT. */
const policyRefusal = (table: string) =>
  `new row violates row-level security policy for table "${table}"`;

/** A database, the attacker A, and B: an ordinary user whose rows are not A's either. */
type Target = { db: TestDb; userA: string; userB: string };

async function newTarget(): Promise<Target> {
  const db = await createTestDb();
  return {
    db,
    userA: (await newOnboardedUser(db)).userId,
    userB: (await newOnboardedUser(db)).userId,
  };
}

/** One statement as `role`, the way the application would run it. */
function as(
  t: Target,
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  const work = (c: PoolClient) => c.query(sql, params);
  switch (role) {
    case 'app_conn':
      // no transaction and no role switch: what a statement outside withRole runs as
      return t.db.app.query(sql, params);
    case 'app_anon':
      return asAnon(t.db.app, work);
    case 'app_auth':
      return asUser(t.db.app, t.userA, work);
    case 'app_job':
      return asJob(t.db.app, work);
  }
}

/**
 * Passes only when the statement is refused with 42501 and exactly this message. Anything else
 * is the fence missing: another error (the statement got past the fence and failed further on),
 * another refusal (a different fence answered), or a result.
 */
async function refused(
  what: string,
  attempt: Promise<unknown>,
  message: string,
): Promise<void> {
  const outcome = await attempt.then(
    result =>
      `but it succeeded (${
        (result as { rowCount: number | null }).rowCount
      } rows)`,
    (e: { code?: string; message?: string }) =>
      e.code === DENIED && e.message === message
        ? null
        : `got ${e.code} "${e.message}"`,
  );
  if (outcome !== null) {
    throw new Error(`${what}: expected ${DENIED} "${message}", ${outcome}`);
  }
}

const ROLLED_BACK = new Error('rolled back on purpose');
/**
 * The row count of a statement run as user A and rolled back: a statement that reaches the rows
 * of somebody else must not eat the rows the next check looks for.
 */
async function affected(
  t: Target,
  what: string,
  sql: string,
  params: unknown[] = [],
): Promise<number | null> {
  let count: number | null = null;
  await asUser(t.db.app, t.userA, async c => {
    count = (await c.query(sql, params)).rowCount;
    throw ROLLED_BACK;
  }).catch((e: { code?: string; message?: string }) => {
    if (e !== ROLLED_BACK) {
      throw new Error(
        `${what}: expected a row count, got ${e.code} "${e.message}"`,
      );
    }
  });
  return count;
}

type Column = { name: string; type: string };
type Table = {
  name: string;
  class: 'own_read' | 'own_rw' | 'internal' | 'content';
  privileges: string[];
  updateColumns: string[];
  owner: string | null;
  columns: Column[];
};
type OwnTable = Table & { owner: string };
type Fn = {
  signature: string;
  schema: string;
  name: string;
  roles: string[];
  /** The call: a NULL of the right type per parameter, a value when the function is STRICT. */
  call: string;
  /** The parameter types of a STRICT function that LITERAL has no value for, or null. */
  noLiteral: string | null;
};
type Registry = {
  tables: Table[];
  own: OwnTable[];
  functions: Fn[];
  helpers: Fn[];
  /** Every relation outside meta and every function of our schemas, registered or not. */
  objects: { object: string; registered: boolean }[];
};

// Names come from the registry and the catalog, read as the superuser: never from a request.
const q = pg.escapeIdentifier;
const rel = (table: Table) => `public.${q(table.name)}`;

const OURS = `left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'`;
const PARAMETERS = `unnest(p.proargtypes::oid[]) WITH ORDINALITY a (type, ord) JOIN pg_type ty ON ty.oid = a.type`;
// PostgreSQL answers a STRICT function called with a NULL without running it, and without
// checking EXECUTE: the call would "succeed" for everybody. A strict function is therefore
// called with a value of each parameter type. A type missing here fails check 7 by name.
const LITERAL = `CASE WHEN ty.typcategory = 'A' THEN '{}'
                      WHEN ty.typcategory = 'B' THEN 'false'
                      WHEN ty.typcategory IN ('N', 'T') THEN '0'
                      WHEN ty.typcategory = 'S' THEN ''
                      WHEN ty.typname IN ('date', 'timestamp', 'timestamptz') THEN '2000-01-01'
                      WHEN ty.typname = 'uuid' THEN '00000000-0000-0000-0000-000000000000'
                      WHEN ty.typname = 'bytea' THEN ''
                      WHEN ty.typname IN ('json', 'jsonb') THEN 'null'
                 END`;
const CALL = `format('%s %I.%I(%s)', CASE p.prokind WHEN 'p' THEN 'CALL' ELSE 'SELECT' END,
                     n.nspname, p.proname,
                     (SELECT coalesce(string_agg(
                               CASE WHEN p.proisstrict THEN quote_literal(${LITERAL}) ELSE 'NULL' END
                               || '::' || format_type(a.type, NULL), ', ' ORDER BY a.ord), '')
                        FROM ${PARAMETERS})) AS call,
              (SELECT string_agg(format_type(a.type, NULL), ', ' ORDER BY a.ord)
                 FROM ${PARAMETERS} WHERE p.proisstrict AND ${LITERAL} IS NULL) AS "noLiteral"`;

async function registry(admin: Pool): Promise<Registry> {
  const tables = (
    await admin.query<Table>(
      `SELECT e.name, e.class, e.auth_privileges AS privileges, e.auth_update_columns AS "updateColumns",
              e.owner_column AS owner,
              coalesce((SELECT jsonb_agg(jsonb_build_object('name', a.attname,
                                                            'type', format_type(a.atttypid, a.atttypmod))
                                         ORDER BY a.attnum)
                          FROM pg_attribute a
                         WHERE a.attrelid = to_regclass(format('public.%I', e.name))
                           AND a.attnum > 0 AND NOT a.attisdropped), '[]') AS columns
         FROM meta.expected_tables e ORDER BY e.name`,
    )
  ).rows;
  for (const table of tables) {
    // a class no check knows would be a table no check looks at
    assert.ok(
      ['own_read', 'own_rw', 'internal', 'content'].includes(table.class),
      `table ${table.name}: unknown class ${table.class}`,
    );
    assert.ok(
      table.columns.length > 0,
      `registered table ${table.name} does not exist`,
    );
    assert.equal(
      table.owner !== null,
      table.class === 'own_read' || table.class === 'own_rw',
      `table ${table.name} (${table.class}): owner_column`,
    );
  }
  const functions = (
    await admin.query<Fn>(
      `SELECT e.signature, e.roles, n.nspname::text AS schema, p.proname::text AS name, ${CALL}
         FROM meta.expected_functions e
         LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
         LEFT JOIN pg_namespace n ON n.oid = p.pronamespace
        ORDER BY e.signature`,
    )
  ).rows;
  for (const fn of functions) {
    assert.ok(fn.name, `registered function ${fn.signature} does not exist`);
  }
  // Internal by name, in every schema of ours, registered or not.
  const helpers = (
    await admin.query<Fn>(
      `SELECT p.oid::regprocedure::text AS signature, '{}'::text[] AS roles, n.nspname::text AS schema,
              p.proname::text AS name, ${CALL}
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${OURS} AND left(p.proname, 1) = '_'
        ORDER BY 1`,
    )
  ).rows;
  // The registry only names tables of public: a relation anywhere else but meta (which no role
  // may use) cannot be registered, and so is reported.
  const objects = (
    await admin.query<{ object: string; registered: boolean }>(
      `SELECT 'relation ' || c.oid::regclass::text AS object,
              n.nspname = 'public'
                AND EXISTS (SELECT 1 FROM meta.expected_tables e WHERE e.name = c.relname) AS registered
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${OURS} AND n.nspname <> 'meta'
        UNION ALL
       SELECT 'function ' || p.oid::regprocedure::text,
              EXISTS (SELECT 1 FROM meta.expected_functions e WHERE to_regprocedure(e.signature) = p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${OURS}
        ORDER BY 1`,
    )
  ).rows;
  return {
    tables,
    own: tables.filter((table): table is OwnTable => table.owner !== null),
    functions,
    helpers,
    objects,
  };
}

/** How many rows of the table `user` owns, by the registered owner column, as the superuser. */
async function ownedBy(
  t: Target,
  table: OwnTable,
  user: string,
): Promise<number> {
  const { rows } = await t.db.admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${rel(table)} WHERE ${q(table.owner)} = $1`,
    [user],
  );
  return rows[0].n;
}

/** Fails with "no decoy row in <table>": the message a task that added a table without one reads. */
async function requireDecoyRow(t: Target, table: OwnTable): Promise<void> {
  if ((await ownedBy(t, table, DECOY_1)) === 0) {
    throw new Error(`no decoy row in ${table.name}`);
  }
}

const selectRefused = (t: Target, role: Role, table: Table) =>
  refused(
    `${role} SELECT ${table.name}`,
    as(t, role, `SELECT 1 FROM ${rel(table)} LIMIT 1`),
    refusal(role, 'public', 'table', table.name),
  );
/**
 * Every write as `role`, each statement needing one privilege only, UPDATE once per column (a
 * grant can be on a single column). Returns the number of statements.
 */
async function writesRefused(
  t: Target,
  role: Role,
  table: Table,
): Promise<number> {
  await refused(
    `${role} INSERT ${table.name}`,
    as(t, role, `INSERT INTO ${rel(table)} DEFAULT VALUES`),
    refusal(role, 'public', 'table', table.name),
  );
  await deleteRefused(t, role, table);
  await truncateRefused(t, role, table);
  for (const column of table.columns) {
    await updateRefused(t, role, table, column);
  }
  return 3 + table.columns.length;
}
const deleteRefused = (t: Target, role: Role, table: Table) =>
  refused(
    `${role} DELETE ${table.name}`,
    as(t, role, `DELETE FROM ${rel(table)} WHERE false`),
    refusal(role, 'public', 'table', table.name),
  );
/** TRUNCATE is not subject to row level security: no class allows it, on any table. */
const truncateRefused = (t: Target, role: Role, table: Table) =>
  refused(
    `${role} TRUNCATE ${table.name}`,
    as(t, role, `TRUNCATE ${rel(table)}`),
    refusal(role, 'public', 'table', table.name),
  );
const updateRefused = (t: Target, role: Role, table: Table, column: Column) =>
  refused(
    `${role} UPDATE ${table.name}.${column.name}`,
    as(
      t,
      role,
      `UPDATE ${rel(table)} SET ${q(column.name)} = DEFAULT WHERE false`,
    ),
    refusal(role, 'public', 'table', table.name),
  );

/** `role` calls the function and must be refused; a function that cannot be called fails by name. */
async function callRefused(t: Target, role: Role, fn: Fn): Promise<void> {
  if (fn.noLiteral !== null) {
    throw new Error(
      `${fn.signature} is STRICT and has no literal for ${fn.noLiteral}: a strict function called ` +
        'with NULL answers NULL without checking EXECUTE, so it is called with values. Add the type to LITERAL',
    );
  }
  await refused(
    `${role} ${fn.call}`,
    as(t, role, fn.call),
    refusal(role, fn.schema, 'function', fn.name),
  );
}

type Coverage = { covered: number; unit: string; note?: string };
type Check = {
  id: number;
  title: string;
  run(t: Target, r: Registry): Promise<Coverage>;
};

const CHECKS: Check[] = [
  {
    id: 1,
    title:
      'plain app_conn, no role switch: SELECT from every table is refused at the schema',
    async run(t, { tables }) {
      const who = await t.db.app.query(
        'SELECT current_user::text AS now, session_user::text AS login',
      );
      assert.deepEqual(who.rows, [{ now: 'app_conn', login: 'app_conn' }]);
      for (const table of tables) {
        await selectRefused(t, 'app_conn', table);
      }
      return { covered: tables.length, unit: 'tables' };
    },
  },
  {
    id: 2,
    title:
      'app_anon and app_job: SELECT and every write on every table are refused by the GRANT',
    async run(t, { tables }) {
      const roles: Role[] = ['app_anon', 'app_job'];
      let statements = 0;
      for (const role of roles) {
        for (const table of tables) {
          await selectRefused(t, role, table);
          statements += 1 + (await writesRefused(t, role, table));
        }
      }
      return {
        covered: roles.length * tables.length,
        unit: `roles x tables (${roles.length} x ${tables.length})`,
        note: `${statements} statements: SELECT, INSERT, DELETE, TRUNCATE, UPDATE of every column`,
      };
    },
  },
  {
    id: 3,
    title:
      'own_read and own_rw: the decoy owns a row, and user A reads own rows only',
    async run(t, { own }) {
      let seen = 0;
      let ofB = 0;
      for (const table of own) {
        await requireDecoyRow(t, table);
        const rowsOfB = await ownedBy(t, table, t.userB);
        ofB += rowsOfB > 0 ? 1 : 0;
        for (const [who, user] of [
          ['the decoy', DECOY_1],
          ['user B', t.userB],
        ]) {
          const aimed = await as(
            t,
            'app_auth',
            `SELECT count(*)::int AS n FROM ${rel(table)} WHERE ${q(
              table.owner,
            )} = $1`,
            [user],
          );
          if (aimed.rows[0].n !== 0) {
            throw new Error(
              `${table.name}: user A sees ${aimed.rows[0].n} row(s) of ${who}`,
            );
          }
        }
        const all = await as(
          t,
          'app_auth',
          `SELECT ${q(table.owner)}::text AS owner FROM ${rel(table)}`,
        );
        const foreign = all.rows.filter(row => row.owner !== t.userA);
        if (foreign.length > 0) {
          throw new Error(
            `${table.name}: an unfiltered SELECT as user A returns ${foreign.length} row(s) of other users`,
          );
        }
        seen += all.rows.length;
      }
      // Both are onboarded. An A who sees nothing is not a reader whose view was judged, and a
      // B without rows is nobody to hide: the decoy alone is one kind of row (hide_streak true,
      // not onboarded), and a policy can tell kinds of rows apart.
      if (own.length > 0 && (seen === 0 || ofB === 0)) {
        throw new Error(
          `user A sees ${seen} own row(s) and user B owns rows in ${ofB} table(s)`,
        );
      }
      return {
        covered: own.length,
        unit: 'tables',
        note: `user A read ${seen} own rows; user B owns rows in ${ofB} of the tables`,
      };
    },
  },
  {
    id: 4,
    title:
      'own_read: INSERT, DELETE, TRUNCATE and UPDATE of every column as user A are refused by the GRANT',
    async run(t, { tables }) {
      const ownRead = tables.filter(table => table.class === 'own_read');
      let statements = 0;
      for (const table of ownRead) {
        statements += await writesRefused(t, 'app_auth', table);
      }
      return {
        covered: ownRead.length,
        unit: 'tables',
        note: `${statements} statements`,
      };
    },
  },
  {
    id: 5,
    title:
      'own_rw: a granted write reaches the rows of user A only, every other write stops at the GRANT',
    async run(t, { own }) {
      const ownRw = own.filter(table => table.class === 'own_rw');
      const n = { insert: 0, delete: 0, updatable: 0, outside: 0 };
      for (const table of ownRw) {
        await requireDecoyRow(t, table);
        const granted = (privilege: string) =>
          table.privileges.includes(privilege);
        const ownRows = await ownedBy(t, table, t.userA);

        if (granted('INSERT')) {
          n.insert++;
          await refused(
            `app_auth INSERT ${table.name} with the id of the decoy`,
            as(
              t,
              'app_auth',
              `INSERT INTO ${rel(table)} (${q(table.owner)}) VALUES ($1)`,
              [DECOY_1],
            ),
            policyRefusal(table.name),
          );
        } else {
          await refused(
            `app_auth INSERT ${table.name}`,
            as(t, 'app_auth', `INSERT INTO ${rel(table)} DEFAULT VALUES`),
            refusal('app_auth', 'public', 'table', table.name),
          );
        }

        // No WHERE: the statement reads no column, so the SELECT policy has no say and the
        // DELETE (UPDATE) policy alone picks the rows. Intact = exactly the rows of user A.
        if (granted('DELETE')) {
          n.delete++;
          const what = `${table.name}: a DELETE by user A, without WHERE,`;
          const removed = await affected(t, what, `DELETE FROM ${rel(table)}`);
          if (removed !== ownRows) {
            throw new Error(
              `${what} removed ${removed} row(s); user A owns ${ownRows}`,
            );
          }
        } else {
          await deleteRefused(t, 'app_auth', table);
        }
        await truncateRefused(t, 'app_auth', table);

        for (const column of table.columns) {
          if (granted('UPDATE') || table.updateColumns.includes(column.name)) {
            n.updatable++;
            // The value user A already has there (of the decoy when A owns no row): valid for
            // the rows it must reach. Handed over as text, so the statement reads nothing.
            // ponytail: one value for every row of A; a user with several rows in a table
            // whose granted column is unique would need one statement per row.
            const value = await t.db.admin.query<{ v: string | null }>(
              `SELECT ${q(column.name)}::text AS v FROM ${rel(table)} WHERE ${q(
                table.owner,
              )} = $1 LIMIT 1`,
              [ownRows > 0 ? t.userA : DECOY_1],
            );
            const what = `${table.name}: an UPDATE of ${column.name} by user A, without WHERE,`;
            const changed = await affected(
              t,
              what,
              `UPDATE ${rel(table)} SET ${q(column.name)} = $1::text::${
                column.type
              }`,
              [value.rows[0].v],
            );
            if (changed !== ownRows) {
              throw new Error(
                `${what} changed ${changed} row(s); user A owns ${ownRows}`,
              );
            }
          } else {
            n.outside++;
            await updateRefused(t, 'app_auth', table, column);
          }
        }
      }
      return {
        covered: ownRw.length,
        unit: 'tables',
        note:
          `${n.updatable} granted columns by an UPDATE without WHERE (the rows of user A only), ` +
          `${n.outside} columns outside the grant, ${n.insert} with INSERT granted, ${n.delete} with DELETE granted`,
      };
    },
  },
  {
    id: 6,
    title:
      'internal: SELECT and every write as user A are refused by the GRANT; content: every write',
    async run(t, { tables }) {
      const internal = tables.filter(table => table.class === 'internal');
      const content = tables.filter(table => table.class === 'content');
      let statements = 0;
      for (const table of internal) {
        await selectRefused(t, 'app_auth', table);
        statements += 1 + (await writesRefused(t, 'app_auth', table));
      }
      for (const table of content) {
        statements += await writesRefused(t, 'app_auth', table);
      }
      if (internal.length === 0 || content.length === 0) {
        throw new Error(
          `check 6 covered ${internal.length} internal and ${content.length} content tables`,
        );
      }
      return {
        covered: internal.length + content.length,
        unit: `tables (${internal.length} internal, ${content.length} content)`,
        note: `${statements} statements`,
      };
    },
  },
  {
    id: 7,
    title:
      'every registered function: a role outside its registered roles cannot call it',
    async run(t, { functions }) {
      let calls = 0;
      for (const fn of functions) {
        for (const role of ROLES.filter(r => !fn.roles.includes(r))) {
          await callRefused(t, role, fn);
          calls++;
        }
      }
      return {
        covered: calls,
        unit: `roles x functions (${functions.length} functions)`,
      };
    },
  },
  {
    id: 8,
    title:
      'every internal helper (a name starting with "_"): user A cannot call it',
    async run(t, { helpers }) {
      for (const fn of helpers) {
        await callRefused(t, 'app_auth', fn);
      }
      return { covered: helpers.length, unit: 'functions' };
    },
  },
  {
    id: 9,
    title:
      'no role can set the test clock: INSERT INTO meta.test_clock is refused at the schema',
    async run(t) {
      for (const role of ROLES) {
        await refused(
          `${role} INSERT meta.test_clock`,
          as(t, role, 'INSERT INTO meta.test_clock (now) VALUES (now())'),
          refusal(role, 'meta', 'table', 'test_clock'),
        );
      }
      return { covered: ROLES.length, unit: 'roles' };
    },
  },
  {
    id: 10,
    title: 'app_auth without a user id sees 0 rows in every own table',
    async run(t, { own }) {
      // Two requests that carry no user: the setting cleared ('', what a pooled connection
      // holds after its first request) and the setting never made (a new connection).
      const noUser = async (
        c: Pick<PoolClient, 'query'>,
        setting: string | null,
      ) => {
        const who = await c.query(
          "SELECT current_user::text AS role, current_setting('app.user_id', true) AS setting",
        );
        assert.deepEqual(who.rows, [{ role: 'app_auth', setting }]);
        for (const table of own) {
          const { rows } = await c.query(
            `SELECT count(*)::int AS n FROM ${rel(table)}`,
          );
          if (rows[0].n !== 0) {
            throw new Error(
              `${table.name}: a request without a user id sees ${rows[0].n} row(s)`,
            );
          }
        }
      };
      for (const table of own) {
        await requireDecoyRow(t, table);
      }
      await asAnon(t.db.app, async c => {
        await c.query('SET LOCAL ROLE app_auth');
        await noUser(c, '');
      });
      const fresh = new pg.Client({
        host: '127.0.0.1',
        port: TEST.port,
        ...APP_CONN,
        database: t.db.name,
      });
      await fresh.connect();
      try {
        await fresh.query('BEGIN');
        await fresh.query('SET LOCAL ROLE app_auth');
        await noUser(fresh, null);
      } finally {
        await fresh.end();
      }
      return {
        covered: own.length,
        unit: 'tables',
        note: 'each in 2 requests',
      };
    },
  },
  {
    id: 11,
    title:
      'every relation and every function of ours is registered: nothing here is outside the checks above',
    async run(_t, { objects }) {
      const missing = objects.filter(o => !o.registered).map(o => o.object);
      if (missing.length > 0) {
        throw new Error(`not registered: ${missing.join(', ')}`);
      }
      const relations = objects.filter(o => o.object.startsWith('relation '));
      return {
        covered: objects.length,
        unit: `objects (${relations.length} relations, ${
          objects.length - relations.length
        } functions)`,
        note: `${missing.length} of them unregistered`,
      };
    },
  },
  {
    id: 12,
    title:
      'every table with a foreign key chain to users: not registered as content, and the decoy has a row',
    async run(t, { tables }) {
      const userData = await userDataTables(t.db.admin);
      for (const { name, ofUser } of userData) {
        // The copied-block mistake: a content table is readable by every signed-in user and
        // has no policy. (An unregistered table is check 11's to report.)
        if (tables.find(table => table.name === name)?.class === 'content') {
          throw new Error(
            `${name} is registered as content, but it has a foreign key chain to users: it holds user data`,
          );
        }
        const { rows } = await t.db.admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.${q(name)} WHERE ${ofUser}`,
          [DECOY_1],
        );
        if (rows[0].n === 0) {
          throw new Error(`no decoy row in ${name}`);
        }
      }
      return {
        covered: userData.length,
        unit: 'tables with a key chain to users',
        note: 'none registered as content, a row of the decoy in each',
      };
    },
  },
];

/** Runs one check; the line of the summary, or the failure with the number of the check. */
async function runCheck(id: number, t: Target): Promise<string> {
  const check = CHECKS.find(c => c.id === id);
  assert.ok(check, `no check ${id}`);
  let coverage: Coverage;
  try {
    coverage = await check.run(t, await registry(t.db.admin));
  } catch (e) {
    throw new Error(`check ${id}: ${(e as Error).message}`, { cause: e });
  }
  if (!(coverage.covered > 0)) {
    throw new Error(`check ${id}: covered 0 ${coverage.unit}`);
  }
  return `check ${String(id).padStart(2)}  ${String(coverage.covered).padStart(
    4,
  )} ${coverage.unit}${coverage.note ? ` - ${coverage.note}` : ''}`;
}

const ATTACK_DIR = new URL('./attacks/', import.meta.url);
const attacks: { file: string; attack: Attack }[] = [];
for (const file of readdirSync(ATTACK_DIR)
  .filter(name => name.endsWith('.ts'))
  .sort()) {
  const loaded = (await import(new URL(file, ATTACK_DIR).href)) as {
    attacks?: Attack[];
  };
  assert.ok(
    Array.isArray(loaded.attacks) && loaded.attacks.length > 0,
    `checks/attacks/${file} must export a non-empty "attacks"`,
  );
  attacks.push(...loaded.attacks.map(attack => ({ file, attack })));
}
const runAttack = (name: string, t: Target) => {
  const found = attacks.filter(({ attack }) => attack.name === name);
  assert.equal(found.length, 1, `attack "${name}"`);
  return found[0].attack.run({
    app: t.db.app,
    admin: t.db.admin,
    userA: t.userA,
    decoy: DECOY_1,
    asUser,
    asAnon,
    expectPgError,
  });
};

let real: Target;
let control: Target;
before(async () => {
  real = await newTarget();
  control = await newTarget();
});
after(async () => {
  await real.db.drop();
  await control.db.drop();
});

// ---------------------------------------------------------------------------------------------
// The gate: the migrated schema, as it is.

const summary: string[] = [];
for (const { id, title } of CHECKS) {
  test(`check ${id}: ${title}`, async () => {
    summary.push(await runCheck(id, real));
  });
}
for (const { file, attack } of attacks) {
  test(`attack ${file}: ${attack.name}`, () => runAttack(attack.name, real));
}
test('summary: every check ran and covered something', () => {
  assert.equal(summary.length, CHECKS.length);
  assert.ok(attacks.length > 0, 'no attack');
  console.log(
    [
      ...summary,
      `attacks   ${String(attacks.length).padStart(4)} cases from ${
        new Set(attacks.map(({ file }) => file)).size
      } file(s)`,
    ].join('\n'),
  );
});

// ---------------------------------------------------------------------------------------------
// Controls, on a database of their own: each fence is broken once, the check that guards it
// must fail naming what was broken, and after the repair it must pass again.

const DECOY_SQL = readFileSync(
  fileURLToPath(new URL('../sql/80-decoy-base.sql', import.meta.url)),
  'utf8',
);
const DECOYS = `('${DECOY_1}', '${DECOY_2}')`;
const OWN = '(app.current_user_id() = user_id)';
const OWN_USER = '(app.current_user_id() = id)';
/** Replaces a policy; `to` and `back` are what follows "TO app_auth". */
const policy = (
  table: string,
  name: string,
  cmd: string,
  to: string,
  back: string,
) => ({
  break: `DROP POLICY ${name} ON ${table}; CREATE POLICY ${name} ON ${table} FOR ${cmd} TO app_auth ${to}`,
  mend: `DROP POLICY ${name} ON ${table}; CREATE POLICY ${name} ON ${table} FOR ${cmd} TO app_auth ${back}`,
});
const grant = (privilege: string, on: string, role: string) => ({
  break: `GRANT ${privilege} ON ${on} TO ${role}`,
  mend: `REVOKE ${privilege} ON ${on} FROM ${role}`,
});
/** Rewrites the body of a function; `edit` is an SQL expression over its definition, "def". */
const functionBody = (signature: string, edit: string) => ({
  break: `CREATE TABLE meta.saved_def AS SELECT pg_get_functiondef('${signature}'::regprocedure) AS def;
          DO $do$ BEGIN EXECUTE (SELECT ${edit} FROM meta.saved_def); END $do$`,
  mend: 'DO $do$ BEGIN EXECUTE (SELECT def FROM meta.saved_def); END $do$; DROP TABLE meta.saved_def',
});

const ARCHETYPE_WITHOUT_WHERE = functionBody(
  'profile_set_archetype(text, jsonb)',
  "replace(def, 'archetype_set_at = app.now() WHERE id = v_user', 'archetype_set_at = app.now()')",
);
const RESET_ACCEPTS_USED_CODE = functionBody(
  'auth_reset_confirm(text, bytea, bytea, bytea)',
  "replace(replace(def, 'AND c.used_at IS NULL AND c.expires_at > app.now()', ''), 'AND r.used_at IS NULL', '')",
);

type Control = {
  /** What is broken, in words. */
  name: string;
  break: string;
  mend: string;
  /** The check that must fail, or the name of the attack. */
  guard: number | string;
  /** A part of the failure message that names the fence and the object. */
  fails: string;
};
const CONTROLS: Control[] = [
  {
    name: 'app_conn may use schema public',
    ...grant('USAGE', 'SCHEMA public', 'app_conn'),
    guard: 1,
    fails:
      'expected 42501 "permission denied for schema public", got 42501 "permission denied for table ',
  },
  {
    name: 'app_anon may read xp_ledger',
    ...grant('SELECT', 'xp_ledger', 'app_anon'),
    guard: 2,
    fails:
      'check 2: app_anon SELECT xp_ledger: expected 42501 "permission denied for table xp_ledger", but it succeeded',
  },
  {
    name: 'app_anon may UPDATE shop_items',
    ...grant('UPDATE', 'shop_items', 'app_anon'),
    guard: 2,
    fails:
      'check 2: app_anon UPDATE shop_items.id: expected 42501 "permission denied for table shop_items", but it succeeded',
  },
  {
    // TRUNCATE got through and emptied the table: the repair puts the decoy row back
    name: 'app_job may TRUNCATE xp_ledger',
    break: 'GRANT TRUNCATE ON xp_ledger TO app_job',
    mend: `REVOKE TRUNCATE ON xp_ledger FROM app_job; ${DECOY_SQL}`,
    guard: 2,
    fails:
      'check 2: app_job TRUNCATE xp_ledger: expected 42501 "permission denied for table xp_ledger", but it succeeded',
  },
  {
    name: 'the decoy has no prescriptions row',
    break: `DELETE FROM prescriptions WHERE user_id = '${DECOY_1}'`,
    mend: DECOY_SQL,
    guard: 3,
    fails: 'check 3: no decoy row in prescriptions',
  },
  {
    name: 'the SELECT policy of prescriptions lets every row through',
    ...policy(
      'prescriptions',
      'own_select',
      'SELECT',
      'USING (true)',
      `USING ${OWN}`,
    ),
    guard: 3,
    fails: 'check 3: prescriptions: user A sees 1 row(s) of the decoy',
  },
  {
    // the decoy hides its streak, an ordinary user does not: only user B can show this
    name: 'the SELECT policy of user_settings shows the rows that do not hide the streak',
    ...policy(
      'user_settings',
      'own_select',
      'SELECT',
      `USING (${OWN} OR NOT hide_streak)`,
      `USING ${OWN}`,
    ),
    guard: 3,
    fails: 'check 3: user_settings: user A sees 1 row(s) of user B',
  },
  {
    name: 'app_auth may INSERT into xp_ledger',
    ...grant('INSERT', 'xp_ledger', 'app_auth'),
    guard: 4,
    fails:
      'check 4: app_auth INSERT xp_ledger: expected 42501 "permission denied for table xp_ledger", ' +
      'got 42501 "new row violates row-level security policy for table "xp_ledger""',
  },
  {
    name: 'app_auth may UPDATE one column of xp_ledger',
    ...grant('UPDATE (amount)', 'xp_ledger', 'app_auth'),
    guard: 4,
    fails:
      'check 4: app_auth UPDATE xp_ledger.amount: expected 42501 "permission denied for table xp_ledger", but it succeeded',
  },
  {
    name: 'app_auth may TRUNCATE xp_ledger',
    break: 'GRANT TRUNCATE ON xp_ledger TO app_auth',
    mend: `REVOKE TRUNCATE ON xp_ledger FROM app_auth; ${DECOY_SQL}`,
    guard: 4,
    fails:
      'check 4: app_auth TRUNCATE xp_ledger: expected 42501 "permission denied for table xp_ledger", but it succeeded',
  },
  {
    name: 'app_auth may UPDATE users.email',
    ...grant('UPDATE (email)', 'users', 'app_auth'),
    guard: 5,
    fails:
      'check 5: app_auth UPDATE users.email: expected 42501 "permission denied for table users", but it succeeded',
  },
  {
    // the SELECT policy is intact: only a statement that reads no column sees this
    name: 'the UPDATE policy of user_settings alone lets every row through',
    ...policy(
      'user_settings',
      'own_update',
      'UPDATE',
      'USING (true) WITH CHECK (true)',
      `USING ${OWN} WITH CHECK ${OWN}`,
    ),
    guard: 5,
    fails:
      'check 5: user_settings: an UPDATE of nudges_enabled by user A, without WHERE, changed 3 row(s); user A owns 1',
  },
  {
    name: 'user_settings has a second, open UPDATE policy beside the right one',
    break:
      'CREATE POLICY extra ON user_settings FOR UPDATE TO app_auth USING (true)',
    mend: 'DROP POLICY extra ON user_settings',
    guard: 5,
    fails:
      'check 5: user_settings: an UPDATE of nudges_enabled by user A, without WHERE, changed 3 row(s); user A owns 1',
  },
  {
    name: 'app_auth may read credentials',
    ...grant('SELECT', 'credentials', 'app_auth'),
    guard: 6,
    fails:
      'check 6: app_auth SELECT credentials: expected 42501 "permission denied for table credentials", but it succeeded',
  },
  {
    name: 'app_auth may INSERT into shop_items',
    ...grant('INSERT', 'shop_items', 'app_auth'),
    guard: 6,
    fails:
      'check 6: app_auth INSERT shop_items: expected 42501 "permission denied for table shop_items", got 23502 "null value in column',
  },
  {
    name: 'app_auth may call auth_login',
    ...grant('EXECUTE', 'FUNCTION auth_login(text, bytea, bytea)', 'app_auth'),
    guard: 7,
    fails:
      'check 7: app_auth SELECT public.auth_login(NULL::text, NULL::bytea, NULL::bytea): expected 42501 ' +
      '"permission denied for function auth_login", got P0001 "auth_login: key and token hash must be 32 bytes each"',
  },
  {
    name: 'the registry lists no function',
    break:
      'CREATE TABLE meta.saved AS SELECT * FROM meta.expected_functions; DELETE FROM meta.expected_functions',
    mend: 'INSERT INTO meta.expected_functions SELECT * FROM meta.saved; DROP TABLE meta.saved',
    guard: 7,
    fails: 'check 7: covered 0 roles x functions (0 functions)',
  },
  {
    name: 'app_auth may call app._level',
    ...grant('EXECUTE', 'FUNCTION app._level(uuid)', 'app_auth'),
    guard: 8,
    fails:
      'check 8: app_auth SELECT app._level(NULL::uuid): expected 42501 "permission denied for function _level", but it succeeded',
  },
  {
    name: 'app_auth may use schema meta',
    ...grant('USAGE', 'SCHEMA meta', 'app_auth'),
    guard: 9,
    fails:
      'check 9: app_auth INSERT meta.test_clock: expected 42501 "permission denied for schema meta", ' +
      'got 42501 "permission denied for table test_clock"',
  },
  {
    name: 'the SELECT policy of prescriptions lets a request without a user through',
    ...policy(
      'prescriptions',
      'own_select',
      'SELECT',
      'USING (app.current_user_id() IS NULL OR app.current_user_id() = user_id)',
      `USING ${OWN}`,
    ),
    guard: 10,
    fails: 'check 10: prescriptions: a request without a user id sees ',
  },
  {
    // one in public, one in schema app, where the registry cannot name a table at all
    name: 'two tables nobody registered are readable by app_auth',
    break:
      'CREATE TABLE fx_loose (user_id uuid, secret text); GRANT SELECT ON fx_loose TO app_auth; ' +
      'CREATE TABLE app.fx_side (user_id uuid, secret text); GRANT SELECT ON app.fx_side TO app_auth',
    mend: 'DROP TABLE fx_loose; DROP TABLE app.fx_side',
    guard: 11,
    fails: 'check 11: not registered: relation app.fx_side, relation fx_loose',
  },
  {
    name: 'a function nobody registered is callable by app_auth',
    break:
      "CREATE FUNCTION fx_leak() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT count(*) FROM credentials'; " +
      'GRANT EXECUTE ON FUNCTION fx_leak() TO app_auth',
    mend: 'DROP FUNCTION fx_leak()',
    guard: 11,
    fails: 'check 11: not registered: function fx_leak()',
  },
  {
    // the SELECT policy is intact, and the attack rolls back: nothing to undo but the policy
    name: 'the UPDATE policy of users alone lets every row through',
    ...policy(
      'users',
      'own_update',
      'UPDATE',
      'USING (true) WITH CHECK (true)',
      `USING ${OWN_USER} WITH CHECK ${OWN_USER}`,
    ),
    guard:
      'an UPDATE of users or of user_settings by A, without WHERE, changes the row of A only',
    fails:
      'rows changed by an UPDATE without WHERE (users, user_settings): 4,1; user A owns one of each',
  },
  {
    // the change got through and was committed for every user: the repair resets the decoys
    name: 'profile_set_archetype changes the archetype of every user (its UPDATE lost the WHERE)',
    break: ARCHETYPE_WITHOUT_WHERE.break,
    mend: `${ARCHETYPE_WITHOUT_WHERE.mend}; UPDATE users SET archetype = NULL, archetype_set_at = NULL WHERE id IN ${DECOYS}`,
    guard:
      'profile_add_biometrics and a change of archetype by A write rows of A and none of the decoy',
    fails: 'the attack changed rows of the decoy in: users',
  },
  {
    // the reset went through: the repair writes the decoy's credentials and code again
    name: 'auth_reset_confirm accepts a used, expired code',
    break: RESET_ACCEPTS_USED_CODE.break,
    mend:
      `${RESET_ACCEPTS_USED_CODE.mend}; DELETE FROM credentials WHERE user_id = '${DECOY_1}'; ` +
      `DELETE FROM reset_codes WHERE user_id = '${DECOY_1}'; ${DECOY_SQL}`,
    guard:
      'auth_reset_confirm with the used, expired code of the decoy answers false',
    fails: 'auth_reset_confirm accepted the used, expired code of the decoy',
  },
];

const guardOf = (guard: number | string, t: Target): Promise<unknown> =>
  typeof guard === 'number' ? runCheck(guard, t) : runAttack(guard, t);

/** The message `guard` fails with on the control database; fails itself when the guard passes. */
async function failureOf(guard: number | string): Promise<string> {
  let message = '';
  await assert.rejects(guardOf(guard, control), (e: Error) => {
    message = e.message;
    return true;
  });
  return message;
}
/** Requires the guard to fail on the control database with a message that holds `fails`. */
async function failsWith(
  guard: number | string,
  fails: string,
  broken: string,
): Promise<void> {
  const message = await failureOf(guard);
  assert.ok(
    message.includes(fails),
    `failed, but not for this: "${message}" does not contain "${fails}"`,
  );
  console.log(`${broken} -> ${message.split('\n')[0]}`);
}

for (const c of CONTROLS) {
  test(`control: ${
    typeof c.guard === 'number' ? `check ${c.guard}` : 'the attack'
  } fails when ${c.name}`, async () => {
    await guardOf(c.guard, control);
    await control.db.admin.query(c.break);
    try {
      await failsWith(c.guard, c.fails, c.name);
    } finally {
      await control.db.admin.query(c.mend);
    }
    await guardOf(c.guard, control);
  });
}

// A table with every command granted, one policy per command: the branches of check 5 no real
// table takes yet, and what a later task sees when it registers a table and forgets its decoy row.
test('control: a new own_rw table with INSERT, UPDATE and DELETE granted', async () => {
  const { admin } = control.db;
  const fx = (name: string, cmd: string, body: string) =>
    `DROP POLICY IF EXISTS ${name} ON fx_notes; CREATE POLICY ${name} ON fx_notes FOR ${cmd} TO app_auth ${body}`;
  const INSERT_POLICY = ['own_insert', 'INSERT', `WITH CHECK ${OWN}`] as const;
  const DELETE_POLICY = ['own_delete', 'DELETE', `USING ${OWN}`] as const;
  await admin.query(`
    CREATE TABLE fx_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text NOT NULL DEFAULT '');
    ALTER TABLE fx_notes ENABLE ROW LEVEL SECURITY;
    ${fx('own_select', 'SELECT', `USING ${OWN}`)};
    ${fx('own_update', 'UPDATE', `USING ${OWN} WITH CHECK ${OWN}`)};
    ${fx(...INSERT_POLICY)};
    ${fx(...DELETE_POLICY)};
    GRANT SELECT, INSERT, UPDATE, DELETE ON fx_notes TO app_auth;
    SELECT meta.expect_table('fx_notes', 'own_rw', '{SELECT,INSERT,UPDATE,DELETE}', '{}', 'user_id')`);
  try {
    for (const id of [3, 5, 10]) {
      await failsWith(
        id,
        `check ${id}: no decoy row in fx_notes`,
        'fx_notes, registered, no decoy row',
      );
    }
    await admin.query('INSERT INTO fx_notes (user_id) VALUES ($1), ($2)', [
      DECOY_1,
      control.userA,
    ]);
    for (const id of [3, 10]) {
      await runCheck(id, control);
    }
    const line = await runCheck(5, control);
    assert.ok(
      line.endsWith('1 with INSERT granted, 1 with DELETE granted'),
      line,
    );
    console.log(`fx_notes, intact -> ${line}`);

    // the SELECT policy stays intact in both: the DELETE first, its statement is rolled back
    await admin.query(fx('own_delete', 'DELETE', 'USING (true)'));
    await failsWith(
      5,
      'check 5: fx_notes: a DELETE by user A, without WHERE, removed 2 row(s); user A owns 1',
      'fx_notes: the DELETE policy alone lets every row through',
    );
    await admin.query(fx(...DELETE_POLICY));
    await admin.query(fx('own_insert', 'INSERT', 'WITH CHECK (true)'));
    await failsWith(
      5,
      'check 5: app_auth INSERT fx_notes with the id of the decoy: expected 42501 ' +
        '"new row violates row-level security policy for table "fx_notes"", but it succeeded',
      'fx_notes: the INSERT policy accepts any row',
    );
  } finally {
    await admin.query(
      "DROP TABLE fx_notes; DELETE FROM meta.expected_tables WHERE name = 'fx_notes'",
    );
  }
});

// What a table is comes from its keys. The two mistakes a registration can hide: a table with
// user rows registered with the block of a content table, and an internal table (no owner
// column, so checks 3 and 10 do not look) without a row of the decoy.
test('control: check 12 judges a table by its foreign keys, whatever it was registered as', async () => {
  const { admin } = control.db;
  const intact = await runCheck(12, control);
  await admin.query(`
    CREATE TABLE fx_diary (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users (id), body text);
    GRANT SELECT ON fx_diary TO app_auth;
    SELECT meta.expect_table('fx_diary', 'content', '{SELECT}', '{}', NULL);
    INSERT INTO fx_diary (user_id, body) VALUES ('${DECOY_1}', 'of the decoy')`);
  try {
    await failsWith(
      12,
      'check 12: fx_diary is registered as content, but it has a foreign key chain to users: it holds user data',
      'fx_diary: user rows, registered as content, SELECT granted',
    );
  } finally {
    await admin.query(
      "DROP TABLE fx_diary; DELETE FROM meta.expected_tables WHERE name = 'fx_diary'",
    );
  }

  await admin.query(`
    CREATE TABLE fx_vault (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users (id));
    CREATE TABLE fx_vault_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vault_id uuid NOT NULL REFERENCES fx_vault (id));
    ALTER TABLE fx_vault ENABLE ROW LEVEL SECURITY;
    ALTER TABLE fx_vault_items ENABLE ROW LEVEL SECURITY;
    SELECT meta.expect_table('fx_vault', 'internal', '{}', '{}', NULL);
    SELECT meta.expect_table('fx_vault_items', 'internal', '{}', '{}', NULL)`);
  try {
    await failsWith(
      12,
      'check 12: no decoy row in fx_vault',
      'fx_vault: internal, a key to users, no row of the decoy',
    );
    // a row of somebody else is no row of the decoy, here and one key further
    await admin.query(
      `WITH v AS (INSERT INTO fx_vault (user_id) VALUES ($1), ($2) RETURNING id, user_id)
       INSERT INTO fx_vault_items (vault_id) SELECT id FROM v WHERE user_id = $2`,
      [DECOY_1, control.userA],
    );
    await failsWith(
      12,
      'check 12: no decoy row in fx_vault_items',
      'fx_vault_items: a key to fx_vault only, a row of user A, none of the decoy',
    );
    await admin.query(
      'INSERT INTO fx_vault_items (vault_id) SELECT id FROM fx_vault WHERE user_id = $1',
      [DECOY_1],
    );
    const line = await runCheck(12, control);
    assert.notEqual(line, intact);
    console.log(`fx_vault and fx_vault_items, a decoy row in each -> ${line}`);
  } finally {
    await admin.query(
      "DROP TABLE fx_vault_items; DROP TABLE fx_vault; DELETE FROM meta.expected_tables WHERE name LIKE 'fx_vault%'",
    );
  }
  assert.equal(await runCheck(12, control), intact);
});

// No function is STRICT today. A strict one called with NULL is answered without the EXECUTE
// check, so checks 7 and 8 call it with values, and say so when they have none for a type.
test('control: checks 7 and 8 call a STRICT function with values', async () => {
  const { admin } = control.db;
  const strict =
    'app._fx_strict(integer, text, uuid, bytea, jsonb, timestamptz, boolean, text[], date, numeric, interval)';
  const point = 'app._fx_strict_point(point)';
  const create = (signature: string) =>
    `CREATE FUNCTION ${signature} RETURNS integer LANGUAGE sql STRICT AS 'SELECT 1';
     REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
     SELECT meta.expect_function('${signature}', 'invoker', '{}')`;
  await admin.query(create(strict));
  try {
    for (const id of [7, 8]) {
      const line = await runCheck(id, control);
      console.log(`a STRICT helper, no grant -> ${line}`);
    }
    await admin.query(`GRANT EXECUTE ON FUNCTION ${strict} TO app_auth`);
    for (const id of [7, 8]) {
      await failsWith(
        id,
        '::interval): expected 42501 "permission denied for function _fx_strict", but it succeeded (1 rows)',
        'app_auth may call the STRICT helper',
      );
    }
    await admin.query(`REVOKE EXECUTE ON FUNCTION ${strict} FROM app_auth`);
    await admin.query(create(point));
    await failsWith(
      7,
      'check 7: app._fx_strict_point(point) is STRICT and has no literal for point',
      'a STRICT helper with a parameter type the gate has no value for',
    );
  } finally {
    await admin.query(
      `DROP FUNCTION IF EXISTS ${strict}; DROP FUNCTION IF EXISTS ${point};
       DELETE FROM meta.expected_functions WHERE signature LIKE 'app._fx_strict%'`,
    );
  }
});

test('control: after every repair the control database passes the whole gate', async () => {
  for (const { id } of CHECKS) {
    await runCheck(id, control);
  }
  for (const { attack } of attacks) {
    await runAttack(attack.name, control);
  }
});
