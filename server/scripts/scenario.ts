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
  'usage: scenario list | scenario clock <ISO instant with a zone> | scenario clock off | scenario <name>';

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

/** The pool a scenario sees: SELECT only. Writes go through the API, setClock and reset. */
function readOnly(pool: pg.Pool): pg.Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property !== 'query') {
        throw new Error('ctx.admin is read-only: only query("SELECT ...")');
      }
      return (text: unknown, ...rest: unknown[]) => {
        if (typeof text !== 'string' || !/^\s*select\b/i.test(text)) {
          throw new Error('ctx.admin is read-only: a scenario builds state through the API');
        }
        return (target.query as (...args: unknown[]) => unknown)(text, ...rest);
      };
    },
  });
}

/**
 * The context of a scenario: `baseUrl` is the API (ending in /api/v1), `admin` a superuser pool
 * and `app` an app_conn pool (the jobs run on it, like the server's own), both on the database
 * the API serves.
 */
export function makeCtx(opts: { baseUrl: string; admin: pg.Pool; app: pg.Pool }): ScenarioCtx {
  const { baseUrl, admin, app } = opts;
  const quiet = createLogger(() => {});
  return {
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
      const parsed = text === '' ? undefined : JSON.parse(text);
      if (!response.ok) {
        throw new Error(`${method} ${path} answered ${response.status} ${parsed?.error?.code ?? ''}`.trim());
      }
      return parsed;
    },
    admin: readOnly(admin),
    setClock: iso => setTestClock(admin, iso),
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
  };
}

async function main(args: string[]): Promise<void> {
  const [word, value, ...rest] = args;
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
      await setTestClock(admin, value === 'off' ? null : new Date(instantOf(value)).toISOString());
    } else {
      const baseUrl = `http://127.0.0.1:${process.env.PORT ?? '8787'}${BASE_PATH}`;
      await fetch(`${baseUrl}/healthz`).catch(() => {
        throw new Error(`the API does not answer at ${baseUrl}: start it with npm run server:dev`);
      });
      const done = await scenario!.run(makeCtx({ baseUrl, admin, app }));
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
