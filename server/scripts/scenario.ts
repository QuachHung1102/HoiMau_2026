// npm --prefix server run scenario -- list | clock <ISO instant with a zone | off> | <name>
// Puts the development database (npm run server:dev: port 54330, database hoimau) into a named
// situation through the RUNNING server's API and the real jobs, stepping the test clock
// (meta.test_clock), then prints the demo account and the clock it left. Every file of
// scripts/scenarios/ default-exports a Scenario and is found here: adding a scenario adds a file.
//
// The clock is a dev / test facility: the verify gate (npm run db:verify, 90-verify.sql) fails
// while a clock row exists. `scenario clock off` removes it, and so does the next npm run server:dev.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { logicalDateOf } from '../../domain/logicalDate.ts';
import type { DateLabel } from '../../domain/types.ts';
import { createPool, withRole } from '../src/db.ts';
import { runJob } from '../src/jobs/scheduler.ts';
import { createLogger } from '../src/log.ts';
import { BASE_PATH } from '../src/http.ts';
import { loadEnvFile } from '../src/main.ts';
import { instantOf } from '../src/routes/day.ts';
import { setTestClock } from '../test/helpers.ts';
import { APP_CONN, DEV, SUPERUSER } from './cluster.ts';
import type { Scenario, ScenarioCtx } from './scenarioKit.ts';

export type { Scenario, ScenarioCtx } from './scenarioKit.ts';

const DATABASE = 'hoimau';
/** The only users `reset` deletes. Decoys (@decoy.invalid) and real accounts never match. */
const DEMO_EMAIL = /^demo-[a-z0-9]+@hoimau\.test$/;
const NOT_NAMES = new Set(['list', 'clock']);
const USAGE =
  'usage: scenario list | scenario clock <ISO instant with a zone> | scenario clock off | scenario <name>  [--include-real-users]';
const INCLUDE_REAL_USERS = '--include-real-users';

/** Every scenario of `dir`, in name order. */
export async function loadScenarios(
  dir = fileURLToPath(new URL('./scenarios/', import.meta.url)),
): Promise<Scenario[]> {
  const files = (await readdir(dir))
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  const found: Scenario[] = [];
  for (const file of files) {
    const scenario = (
      (await import(pathToFileURL(join(dir, file)).href)) as { default?: Scenario }
    ).default;
    if (
      !/^[a-z0-9]+$/.test(scenario?.name ?? '') ||
      NOT_NAMES.has(scenario?.name ?? '') ||
      typeof scenario?.describe !== 'string' ||
      typeof scenario.run !== 'function'
    ) {
      throw new Error(`scenarios/${file} must default-export a Scenario with a name of a-z and 0-9`);
    }
    if (found.some(other => other.name === scenario.name)) {
      throw new Error(`two scenarios are named ${scenario.name}`);
    }
    found.push(scenario);
  }
  return found;
}

/** Refuses unless the connection itself says it is the development database. */
export async function assertDevDatabase(admin: pg.Pool): Promise<void> {
  const { rows } = await admin.query<{ db: string; port: string }>(
    "SELECT current_database() AS db, current_setting('port') AS port",
  );
  if (rows[0].db !== DATABASE || rows[0].port !== String(DEV.port)) {
    throw new Error(
      `refusing to run: connected to database ${rows[0].db} on port ${rows[0].port}, not ${DATABASE} on port ${DEV.port}`,
    );
  }
}

/**
 * The pool a scenario sees. `query(text, values?)` takes ONE statement that starts with SELECT
 * (a ";" anywhere in the text is refused) and runs it in BEGIN READ ONLY ... ROLLBACK on a client
 * of its own: a function that writes and SELECT ... INTO fail, and a session setting
 * (set_config) is undone. Not guarded: a session-level advisory lock outlives the rollback.
 * Every other member of the pool throws. State is built through the API, setClock and reset.
 */
function readOnly(pool: pg.Pool): pg.Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property !== 'query') {
        throw new Error('ctx.admin is read-only: only query("SELECT ...")');
      }
      return async (text: unknown, values?: unknown[]) => {
        if (typeof text !== 'string' || text.includes(';') || !/^\s*select\b/i.test(text)) {
          throw new Error('ctx.admin is read-only: one SELECT and no ";" (a scenario builds state through the API)');
        }
        const client = await target.connect();
        try {
          await client.query('BEGIN READ ONLY');
          return await client.query(text, values);
        } finally {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
      };
    },
  });
}

/**
 * Moving the clock forward makes the real `day-close` close every day it passes for EVERY
 * onboarded user of the database, so an account that is not a demo one would get months of
 * missed days, a broken streak and a tired pet, and clearing the clock does not undo it.
 * Refuses when there is such a user, unless `include` (--include-real-users) says go on.
 */
export async function assertNoRealUsers(admin: pg.Pool, include: boolean): Promise<void> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users
      WHERE onboarded_at IS NOT NULL AND deleted_at IS NULL
        AND email !~ $1 AND email NOT LIKE '%@decoy.invalid'`,
    [DEMO_EMAIL.source],
  );
  const n = rows[0].n;
  if (n === 0) {
    return;
  }
  const hazard =
    `${n} onboarded user(s) here are not demo-<name>@hoimau.test accounts. Moving the clock forward makes day-close ` +
    'close every passed day for them too: missed days, a broken streak, a tired pet, and clearing the clock does not undo it.';
  if (!include) {
    throw new Error(`refusing to move the clock: ${hazard} Add --include-real-users to do it anyway.`);
  }
  console.error(`warning: ${hazard} (--include-real-users given)`);
}

/**
 * The context of a scenario: `baseUrl` is the API (ending in /api/v1), `admin` a superuser pool
 * and `app` an app_conn pool (the jobs run on it, like the server's own), both on the database
 * the API serves. Before its first clock move the context runs `assertNoRealUsers`.
 */
export function makeCtx(opts: {
  baseUrl: string;
  admin: pg.Pool;
  app: pg.Pool;
  includeRealUsers?: boolean;
  today?: DateLabel;
}): ScenarioCtx {
  const { baseUrl, admin, app, includeRealUsers = false, today } = opts;
  const quiet = createLogger(() => {});
  let checked = false;
  return {
    today,
    async call(method, path, { token, body, key } = {}) {
      const response = await fetch(baseUrl + path, {
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(key === undefined ? {} : { 'idempotency-key': key }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        // the status first: a proxy's or a crash's error page is not JSON
        let code: unknown;
        try {
          code = JSON.parse(text)?.error?.code;
        } catch {
          // not JSON: the excerpt below says what came
        }
        const said = typeof code === 'string' ? code : text.slice(0, 200);
        throw new Error(`${method} ${path} answered ${response.status} ${said}`.trim());
      }
      return text === '' ? undefined : JSON.parse(text);
    },
    admin: readOnly(admin),
    async setClock(iso) {
      if (iso !== null && !checked) {
        await assertNoRealUsers(admin, includeRealUsers);
        checked = true;
      }
      await setTestClock(admin, iso);
    },
    async runJob(name) {
      const { rows } = await withRole(app, 'app_job', null, c =>
        c.query<{ now: Date }>('SELECT app.now() AS now'),
      );
      return runJob(name, app, rows[0].now, quiet);
    },
    async reset(email) {
      if (!DEMO_EMAIL.test(email)) {
        throw new Error(`reset refuses ${email}: only demo-<name>@hoimau.test`);
      }
      await admin.query('DELETE FROM users WHERE email = $1', [email]);
    },
    async removeGuild(name) {
      // one statement: the demo-only guard and the delete see the same members
      const { rows } = await admin.query<{ others: number }>(
        `WITH gone AS (
           DELETE FROM guilds g
            WHERE lower(g.name) = lower(normalize($1, NFC))
              AND NOT EXISTS (SELECT 1 FROM guild_memberships m JOIN users u ON u.id = m.user_id
                               WHERE m.guild_id = g.id AND u.email !~ $2)
           RETURNING g.id)
         SELECT count(*)::int AS others FROM guilds g
          WHERE lower(g.name) = lower(normalize($1, NFC)) AND g.id NOT IN (SELECT id FROM gone)`,
        [name, DEMO_EMAIL.source],
      );
      if (rows[0].others > 0) {
        throw new Error(`removeGuild refuses "${name}": it has a member who is not a demo-<name>@hoimau.test account`);
      }
    },
    async grant(email, xp, coin) {
      if (!DEMO_EMAIL.test(email)) {
        throw new Error(`grant refuses ${email}: only demo-<name>@hoimau.test`);
      }
      const { rowCount } = await admin.query(
        "SELECT app._grant(u.id, $2, $3, 'SCENARIO', gen_random_uuid()::text) FROM users u WHERE u.email = $1",
        [email, xp, coin],
      );
      if (rowCount !== 1) {
        throw new Error(`grant: no user ${email}`);
      }
    },
  };
}

async function main(argv: string[]): Promise<void> {
  const includeRealUsers = argv.includes(INCLUDE_REAL_USERS);
  const [word, value, ...rest] = argv.filter(arg => arg !== INCLUDE_REAL_USERS);
  const scenarios = await loadScenarios();
  const scenario = scenarios.find(found => found.name === word);
  const known =
    (word === 'list' && value === undefined) ||
    (word === 'clock' && value !== undefined && rest.length === 0 && (value === 'off' || !Number.isNaN(instantOf(value)))) ||
    (scenario !== undefined && value === undefined);
  if (!known) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (word === 'list') {
    for (const { name, describe } of scenarios) {
      console.log(`${name.padEnd(8)} ${describe}`);
    }
    return;
  }

  loadEnvFile();
  const dev = { host: '127.0.0.1', port: DEV.port };
  const admin = new pg.Pool({ ...dev, ...SUPERUSER, database: DATABASE, max: 2 });
  const app = createPool(
    `postgres://${APP_CONN.user}:${APP_CONN.password}@127.0.0.1:${DEV.port}/${DATABASE}`,
    () => {},
  );
  try {
    await assertDevDatabase(admin);
    if (word === 'clock') {
      if (value !== 'off') {
        await assertNoRealUsers(admin, includeRealUsers);
      }
      await setTestClock(admin, value === 'off' ? null : new Date(instantOf(value)).toISOString());
    } else {
      const baseUrl = `http://127.0.0.1:${process.env.PORT ?? '8787'}${BASE_PATH}`;
      await fetch(`${baseUrl}/healthz`).catch(() => {
        throw new Error(`the API does not answer at ${baseUrl}: start it with npm run server:dev`);
      });
      const done = await scenario!.run(makeCtx({ baseUrl, admin, app, includeRealUsers, today: logicalDateOf(Date.now(), 'Asia/Ho_Chi_Minh') }));
      console.log(`scenario ${scenario!.name}: ${scenario!.describe}`);
      console.log(`email:    ${done.email}`);
      console.log(`password: ${done.password}`);
      console.log(`note:     ${done.note}`);
    }
    const { rows } = await admin.query<{ now: Date; frozen: boolean }>(
      'SELECT app.now() AS now, EXISTS (SELECT 1 FROM meta.test_clock) AS frozen',
    );
    console.log(
      rows[0].frozen
        ? `clock:    ${rows[0].now.toISOString()} (frozen; real time again with: scenario clock off)`
        : `clock:    ${rows[0].now.toISOString()} (real time)`,
    );
    if (rows[0].frozen) {
      console.log(
        'warning:  a clock moved forward makes day-close close the days it passes for EVERY onboarded user of this database, not only demo accounts; clearing the clock does not reopen them.',
      );
    }
  } finally {
    await app.end();
    await admin.end();
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
