// Gate 2 (npm run db:api-check): what a request can really do.
// Everything under test goes through app_conn, the role the application connects as, with the
// role switch of a request; the superuser pool only reads the registry, arranges and reads back.
//
// The ten generic checks are driven by the registry (meta.expected_*) and the catalog, so a
// table or function added by a later SQL file is covered without an edit here. The attacks of
// checks/attacks/*.ts follow. The controls at the end break one fence at a time on a second
// database and require the check to fail, naming what was broken.
//
// Rules for whoever edits a check (backend-tu-chu 6.1 to 6.4):
//   * one intact state per assertion: SQLSTATE 42501 and the whole message, which names the
//     fence (schema, table, function or policy) and the object. Any other outcome is a failure:
//     another error, another refusal, a result;
//   * each fence is asserted by its own mechanism. REFUSALS below is what was measured on the
//     intact schema, per role and kind of object; never accept two of them in one assertion;
//   * a probe needs exactly the one privilege it probes (INSERT ... DEFAULT VALUES, UPDATE ...
//     SET c = DEFAULT WHERE false, DELETE ... WHERE false): a statement that also reads a
//     column is refused for the missing SELECT and would hide a stray write grant;
//   * a check that looks for rows first proves, as the superuser, that the rows are there;
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
import { DECOY_1 } from './attacks/base.ts';
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

type Target = { db: TestDb; userA: string };

async function newTarget(): Promise<Target> {
  const db = await createTestDb();
  return { db, userA: (await newOnboardedUser(db)).userId };
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
 * The row count of a statement run as user A and rolled back: an attack that got through must
 * not eat the rows the next check looks for.
 */
async function affected(
  t: Target,
  sql: string,
  params: unknown[],
): Promise<number | null> {
  let count: number | null = null;
  await asUser(t.db.app, t.userA, async c => {
    count = (await c.query(sql, params)).rowCount;
    throw ROLLED_BACK;
  }).catch(e => {
    if (e !== ROLLED_BACK) {
      throw e;
    }
  });
  return count;
}

type Table = {
  name: string;
  class: 'own_read' | 'own_rw' | 'internal' | 'content';
  privileges: string[];
  updateColumns: string[];
  owner: string | null;
  columns: string[];
};
type OwnTable = Table & { owner: string };
type Fn = {
  signature: string;
  schema: string;
  name: string;
  roles: string[];
  /** The call with a NULL of the right type for every parameter. */
  call: string;
};
type Registry = {
  tables: Table[];
  own: OwnTable[];
  functions: Fn[];
  helpers: Fn[];
};

// Names come from the registry and the catalog, read as the superuser: never from a request.
const q = pg.escapeIdentifier;
const rel = (table: Table) => `public.${q(table.name)}`;

const CALL = `format('%s %I.%I(%s)', CASE p.prokind WHEN 'p' THEN 'CALL' ELSE 'SELECT' END,
                     n.nspname, p.proname,
                     (SELECT coalesce(string_agg('NULL::' || format_type(a.type, NULL), ', ' ORDER BY a.ord), '')
                        FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a (type, ord)))`;

async function registry(admin: Pool): Promise<Registry> {
  const tables = (
    await admin.query<Table>(
      `SELECT e.name, e.class, e.auth_privileges AS privileges, e.auth_update_columns AS "updateColumns",
              e.owner_column AS owner,
              ARRAY(SELECT a.attname::text FROM pg_attribute a
                     WHERE a.attrelid = to_regclass(format('public.%I', e.name))
                       AND a.attnum > 0 AND NOT a.attisdropped
                     ORDER BY a.attnum) AS columns
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
      `SELECT e.signature, e.roles, n.nspname::text AS schema, p.proname::text AS name, ${CALL} AS call
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
              p.proname::text AS name, ${CALL} AS call
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema' AND left(p.proname, 1) = '_'
        ORDER BY 1`,
    )
  ).rows;
  return {
    tables,
    own: tables.filter((table): table is OwnTable => table.owner !== null),
    functions,
    helpers,
  };
}

/** Fails with "no decoy row in <table>": the message a task that added a table without one reads. */
async function requireDecoyRow(t: Target, table: OwnTable): Promise<void> {
  const { rows } = await t.db.admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${rel(table)} WHERE ${q(table.owner)} = $1`,
    [DECOY_1],
  );
  if (rows[0].n === 0) {
    throw new Error(`no decoy row in ${table.name}`);
  }
}

/**
 * Every write as user A, each statement needing one privilege only, UPDATE once per column (a
 * grant can be on a single column). Returns the number of statements.
 */
async function writesRefused(t: Target, table: Table): Promise<number> {
  await refused(
    `app_auth INSERT ${table.name}`,
    as(t, 'app_auth', `INSERT INTO ${rel(table)} DEFAULT VALUES`),
    refusal('app_auth', 'public', 'table', table.name),
  );
  await deleteRefused(t, table);
  await truncateRefused(t, table);
  for (const column of table.columns) {
    await updateRefused(t, table, column);
  }
  return 3 + table.columns.length;
}
const deleteRefused = (t: Target, table: Table) =>
  refused(
    `app_auth DELETE ${table.name}`,
    as(t, 'app_auth', `DELETE FROM ${rel(table)} WHERE false`),
    refusal('app_auth', 'public', 'table', table.name),
  );
/** TRUNCATE is not subject to row level security: no class allows it, on any table. */
const truncateRefused = (t: Target, table: Table) =>
  refused(
    `app_auth TRUNCATE ${table.name}`,
    as(t, 'app_auth', `TRUNCATE ${rel(table)}`),
    refusal('app_auth', 'public', 'table', table.name),
  );
const updateRefused = (t: Target, table: Table, column: string) =>
  refused(
    `app_auth UPDATE ${table.name}.${column}`,
    as(
      t,
      'app_auth',
      `UPDATE ${rel(table)} SET ${q(column)} = DEFAULT WHERE false`,
    ),
    refusal('app_auth', 'public', 'table', table.name),
  );

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
        await refused(
          `app_conn SELECT ${table.name}`,
          as(t, 'app_conn', `SELECT 1 FROM ${rel(table)} LIMIT 1`),
          refusal('app_conn', 'public', 'table', table.name),
        );
      }
      return { covered: tables.length, unit: 'tables' };
    },
  },
  {
    id: 2,
    title:
      'app_anon and app_job: SELECT from every table is refused by the GRANT',
    async run(t, { tables }) {
      const roles: Role[] = ['app_anon', 'app_job'];
      for (const role of roles) {
        for (const table of tables) {
          await refused(
            `${role} SELECT ${table.name}`,
            as(t, role, `SELECT 1 FROM ${rel(table)} LIMIT 1`),
            refusal(role, 'public', 'table', table.name),
          );
        }
      }
      return {
        covered: roles.length * tables.length,
        unit: `roles x tables (${roles.length} x ${tables.length})`,
      };
    },
  },
  {
    id: 3,
    title:
      'own_read and own_rw: the decoy owns a row, and user A reads own rows only',
    async run(t, { own }) {
      let seen = 0;
      for (const table of own) {
        await requireDecoyRow(t, table);
        const aimed = await as(
          t,
          'app_auth',
          `SELECT count(*)::int AS n FROM ${rel(table)} WHERE ${q(
            table.owner,
          )} = $1`,
          [DECOY_1],
        );
        if (aimed.rows[0].n !== 0) {
          throw new Error(
            `${table.name}: user A sees ${aimed.rows[0].n} row(s) of the decoy`,
          );
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
      // user A is onboarded: an A who sees nothing at all is not a reader whose view was judged
      if (own.length > 0 && seen === 0) {
        throw new Error('user A sees no row in any own table');
      }
      return {
        covered: own.length,
        unit: 'tables',
        note: `user A read ${seen} own rows`,
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
        statements += await writesRefused(t, table);
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
      'own_rw: a granted write stops at the policy, every other write at the GRANT',
    async run(t, { own }) {
      const ownRw = own.filter(table => table.class === 'own_rw');
      const n = { insert: 0, delete: 0, updatable: 0, outside: 0 };
      for (const table of ownRw) {
        await requireDecoyRow(t, table);
        const granted = (privilege: string) =>
          table.privileges.includes(privilege);
        const decoyRow = `WHERE ${q(table.owner)} = $1`;

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

        if (granted('DELETE')) {
          n.delete++;
          const removed = await affected(
            t,
            `DELETE FROM ${rel(table)} ${decoyRow}`,
            [DECOY_1],
          );
          if (removed !== 0) {
            throw new Error(
              `${table.name}: DELETE aimed at the decoy removed ${removed} row(s)`,
            );
          }
        } else {
          await deleteRefused(t, table);
        }
        await truncateRefused(t, table);

        for (const column of table.columns) {
          if (granted('UPDATE') || table.updateColumns.includes(column)) {
            n.updatable++;
            const changed = await affected(
              t,
              `UPDATE ${rel(table)} SET ${q(column)} = ${q(
                column,
              )} ${decoyRow}`,
              [DECOY_1],
            );
            if (changed !== 0) {
              throw new Error(
                `${table.name}: UPDATE of ${column} aimed at the decoy changed ${changed} row(s)`,
              );
            }
          } else {
            n.outside++;
            await updateRefused(t, table, column);
          }
        }
        // ponytail: a policy whose WITH CHECK lets A hand an own row to the decoy is not tried
        // here (A owns no row in most tables); gate 1 compares WITH CHECK text for text.
      }
      return {
        covered: ownRw.length,
        unit: 'tables',
        note:
          `${n.updatable} granted columns (0 rows of the decoy), ${n.outside} columns outside the grant, ` +
          `${n.insert} with INSERT granted, ${n.delete} with DELETE granted`,
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
        await refused(
          `app_auth SELECT ${table.name}`,
          as(t, 'app_auth', `SELECT 1 FROM ${rel(table)} LIMIT 1`),
          refusal('app_auth', 'public', 'table', table.name),
        );
        statements += 1 + (await writesRefused(t, table));
      }
      for (const table of content) {
        statements += await writesRefused(t, table);
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
          await refused(
            `${role} ${fn.call}`,
            as(t, role, fn.call),
            refusal(role, fn.schema, 'function', fn.name),
          );
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
        await refused(
          `app_auth ${fn.call}`,
          as(t, 'app_auth', fn.call),
          refusal('app_auth', fn.schema, 'function', fn.name),
        );
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
const OWN = '(app.current_user_id() = user_id)';
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

// An UPDATE with a WHERE must pass the SELECT policy too: both must be open for it to land.
const SETTINGS_SELECT = policy(
  'user_settings',
  'own_select',
  'SELECT',
  'USING (true)',
  `USING ${OWN}`,
);
const SETTINGS_UPDATE = policy(
  'user_settings',
  'own_update',
  'UPDATE',
  'USING (true) WITH CHECK (true)',
  `USING ${OWN} WITH CHECK ${OWN}`,
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
    name: 'app_auth may UPDATE users.email',
    ...grant('UPDATE (email)', 'users', 'app_auth'),
    guard: 5,
    fails:
      'check 5: app_auth UPDATE users.email: expected 42501 "permission denied for table users", but it succeeded',
  },
  {
    name: 'the policies of user_settings let every row through',
    break: `${SETTINGS_SELECT.break}; ${SETTINGS_UPDATE.break}`,
    mend: `${SETTINGS_SELECT.mend}; ${SETTINGS_UPDATE.mend}`,
    guard: 5,
    fails:
      'check 5: user_settings: UPDATE of nudges_enabled aimed at the decoy changed 1 row(s)',
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
    // TRUNCATE got through and emptied the table: the repair puts the decoy row back
    name: 'app_auth may TRUNCATE xp_ledger',
    break: 'GRANT TRUNCATE ON xp_ledger TO app_auth',
    mend: `REVOKE TRUNCATE ON xp_ledger FROM app_auth; ${DECOY_SQL}`,
    guard: 4,
    fails:
      'check 4: app_auth TRUNCATE xp_ledger: expected 42501 "permission denied for table xp_ledger", but it succeeded',
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
    name: 'the policies of user_settings let every row through',
    break: `${SETTINGS_SELECT.break}; ${SETTINGS_UPDATE.break}`,
    // the attack got through and was committed: the repair also undoes what it wrote
    mend:
      `${SETTINGS_SELECT.mend}; ${SETTINGS_UPDATE.mend}; ` +
      `UPDATE user_settings SET hide_streak = true, nudges_enabled = true WHERE user_id = '${DECOY_1}'`,
    guard:
      'UPDATE of users and of user_settings aimed at the decoy changes 0 rows',
    fails:
      'rows changed (users of the decoy, user_settings of the decoy, own users, own user_settings)',
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

for (const c of CONTROLS) {
  test(`control: ${
    typeof c.guard === 'number' ? `check ${c.guard}` : 'the attack'
  } fails when ${c.name}`, async () => {
    await guardOf(c.guard, control);
    await control.db.admin.query(c.break);
    try {
      const message = await failureOf(c.guard);
      assert.ok(
        message.includes(c.fails),
        `failed, but not for this: "${message}" does not contain "${c.fails}"`,
      );
      console.log(`${c.name} -> ${message.split('\n')[0]}`);
    } finally {
      await control.db.admin.query(c.mend);
    }
    await guardOf(c.guard, control);
  });
}

// A table with every command granted: the branches of check 5 no real table takes yet, and what a
// later task sees when it registers a table and forgets its decoy row.
test('control: a new own_rw table with INSERT, UPDATE and DELETE granted', async () => {
  const { admin } = control.db;
  const fx = (to: string) =>
    `DROP POLICY IF EXISTS own ON fx_notes; CREATE POLICY own ON fx_notes FOR ALL TO app_auth ${to}`;
  await admin.query(`
    CREATE TABLE fx_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text NOT NULL DEFAULT '');
    ALTER TABLE fx_notes ENABLE ROW LEVEL SECURITY;
    ${fx(`USING ${OWN} WITH CHECK ${OWN}`)};
    GRANT SELECT, INSERT, UPDATE, DELETE ON fx_notes TO app_auth;
    SELECT meta.expect_table('fx_notes', 'own_rw', '{SELECT,INSERT,UPDATE,DELETE}', '{}', 'user_id')`);
  try {
    for (const id of [3, 5, 10]) {
      assert.equal(
        await failureOf(id),
        `check ${id}: no decoy row in fx_notes`,
      );
    }
    console.log(
      'fx_notes, registered, no decoy row -> check 3, 5, 10: no decoy row in fx_notes',
    );
    await admin.query('INSERT INTO fx_notes (user_id) VALUES ($1)', [DECOY_1]);
    for (const id of [3, 10]) {
      await runCheck(id, control);
    }
    const line = await runCheck(5, control);
    assert.ok(
      line.endsWith('1 with INSERT granted, 1 with DELETE granted'),
      line,
    );
    console.log(`fx_notes, intact -> ${line}`);

    for (const [to, fails] of [
      [
        `USING (true) WITH CHECK ${OWN}`,
        'check 5: fx_notes: DELETE aimed at the decoy removed 1 row(s)',
      ],
      [
        `USING ${OWN} WITH CHECK (true)`,
        'check 5: app_auth INSERT fx_notes with the id of the decoy: expected 42501 ' +
          '"new row violates row-level security policy for table "fx_notes"", but it succeeded',
      ],
    ]) {
      await admin.query(fx(to));
      const message = await failureOf(5);
      assert.ok(
        message.includes(fails),
        `"${message}" does not contain "${fails}"`,
      );
      console.log(`fx_notes: ${to} -> ${message}`);
    }
  } finally {
    await admin.query(
      "DROP TABLE fx_notes; DELETE FROM meta.expected_tables WHERE name = 'fx_notes'",
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
