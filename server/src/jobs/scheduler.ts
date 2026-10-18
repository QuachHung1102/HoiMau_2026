// The jobs of the server process: every src/jobs/<name>.ts except this file, run.ts and tests
// default-exports a Job, found at start-up (adding a job adds a file, it edits no list). One
// timer looks every minute which job is due and runs it; never two runs of one job at once.
//
// A job reads time from its `now` argument only, which is `SELECT app.now()` here and in run.ts:
// the test clock of a scenario applies to jobs exactly as it does to SQL.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import type { Health } from '../../../domain/contract/core.ts';
import { withRole } from '../db.ts';
import { createLogger, describeError } from '../log.ts';
import type { Logger } from '../log.ts';

export type Job = {
  /** As listed by /healthz and recorded in job_runs. */
  name: string;
  /**
   * Whether a run is due at `now`, given the instant of the last run in this process (null: none
   * yet) and whether that run succeeded (undefined: none yet).
   */
  due(now: Date, lastRunAt: Date | null, lastOk?: boolean): boolean;
  /**
   * One run for the instant `now`; what it returns is recorded in job_runs and logged, so counts
   * only, never personal data. `log` is the scheduler's: `log.ledger` for every ledger row the
   * run wrote. Throwing records the run with ok = false.
   */
  run(pool: Pool, now: Date, log: Logger): Promise<Record<string, unknown>>;
};

const MINUTE_MS = 60_000;
const TICK_MS = MINUTE_MS;
/** A day-close whose last success is older than this is late (NFR: alert when day-close is late). */
export const LATE_MS = 90 * MINUTE_MS;
const NOT_JOBS = new Set(['scheduler.ts', 'run.ts']);

/** The default-exported Job of every job file of `dir`, in name order. */
export async function loadJobs(
  dir = fileURLToPath(new URL('.', import.meta.url)),
): Promise<Job[]> {
  const files = (await readdir(dir))
    .filter(
      name =>
        name.endsWith('.ts') && !name.endsWith('.test.ts') && !NOT_JOBS.has(name),
    )
    .sort();
  const jobs: Job[] = [];
  for (const name of files) {
    const job = (
      (await import(pathToFileURL(join(dir, name)).href)) as { default?: Job }
    ).default;
    if (
      typeof job?.name !== 'string' ||
      typeof job.due !== 'function' ||
      typeof job.run !== 'function'
    ) {
      throw new Error(`jobs/${name} must default-export a Job`);
    }
    if (jobs.some(other => other.name === job.name)) {
      throw new Error(`two jobs are named ${job.name}`);
    }
    jobs.push(job);
  }
  return jobs;
}

/**
 * One run of `job`, recorded in job_runs as a row of its own (a fresh run id; run_for = `now`)
 * and logged as one line. A throw is recorded with ok = false and thrown again. A record that
 * cannot be written (the database is gone) is logged and does not change the outcome.
 */
async function execute(
  job: Job,
  pool: Pool,
  now: Date,
  log: Logger,
): Promise<Record<string, unknown>> {
  const started = performance.now();
  let result: Record<string, unknown> | undefined;
  let failure: unknown;
  try {
    result = await job.run(pool, now, log);
  } catch (e) {
    failure = e;
  }
  const ok = failure === undefined;
  const detail = ok ? result : describeError(failure);
  log.line({
    level: ok ? 'info' : 'error',
    evt: 'job',
    job: job.name,
    ok,
    ms: Math.round(performance.now() - started),
    ...(ok ? { detail } : detail),
  });
  await withRole(pool, 'app_job', null, c =>
    c.query('SELECT job_record_run($1, $2, $3, $4, $5)', [
      job.name,
      randomUUID(),
      now,
      ok,
      JSON.stringify(detail ?? {}),
    ]),
  ).catch((e: unknown) =>
    log.line({ level: 'error', evt: 'job_record', job: job.name, ...describeError(e) }),
  );
  if (!ok) {
    throw failure;
  }
  return result ?? {};
}

let discovered: Promise<Job[]> | undefined;

/** Runs the job named `name` once for `now` (tests, run.ts, the dev scenarios). */
export async function runJob(
  name: string,
  pool: Pool,
  now: Date,
  log: Logger = createLogger(),
): Promise<Record<string, unknown>> {
  discovered ??= loadJobs();
  const job = (await discovered).find(found => found.name === name);
  if (job === undefined) {
    throw new Error(`no job named ${name}`);
  }
  return execute(job, pool, now, log);
}

type Last = { at: Date; ok: boolean; succeededAt: Date | null };

export type Scheduler = {
  /** One look at the clock and the jobs; the timer calls it every minute. Resolves when the runs it started have ended. */
  tick(): Promise<void>;
  /** The timer is gone and every run in flight has ended when this resolves. */
  stop(): Promise<void>;
  /** The last run of each job that ran in this scheduler. */
  health(): Health['jobs'];
};

/** The scheduler that is running in this process, for /healthz. */
let active: Scheduler | null = null;

/** `Health.jobs` of the running scheduler: empty when none runs. Memory only, never job_runs. */
export const jobHealth = (): Health['jobs'] => active?.health() ?? [];

/**
 * Starts the timer. `now` defaults to `SELECT app.now()` as app_job; `jobs` to every job file.
 * Every tick: when the last successful `day-close` is older than LATE_MS (counted from the first
 * tick while there is none), one `{level:'alert', evt:'job_late', job:'day-close'}` line; then
 * every job that is due and not running is started. The timer does not wait for the runs; the
 * promise of tick() resolves when the runs it started have ended.
 */
export async function startScheduler(opts: {
  pool: Pool;
  log: Logger;
  jobs?: Job[];
  now?: () => Promise<Date>;
  intervalMs?: number;
}): Promise<Scheduler> {
  const { pool, log } = opts;
  const jobs = opts.jobs ?? (await loadJobs());
  const clock =
    opts.now ??
    (async () =>
      (
        await withRole(pool, 'app_job', null, c =>
          c.query<{ now: Date }>('SELECT app.now() AS now'),
        )
      ).rows[0].now);
  const last = new Map<string, Last>();
  const running = new Map<string, Promise<void>>();
  let first: Date | null = null;
  let stopped = false;

  const late = (now: Date) => {
    if (!jobs.some(job => job.name === 'day-close')) {
      return false;
    }
    const since = last.get('day-close')?.succeededAt ?? first ?? now;
    return now.getTime() - since.getTime() > LATE_MS;
  };

  async function tick(): Promise<void> {
    let now: Date;
    try {
      now = await clock();
    } catch (e) {
      // ponytail: no clock, no alert either while the database is out of reach; /healthz says db false
      log.line({ level: 'error', evt: 'scheduler', ...describeError(e) });
      return;
    }
    if (stopped) {
      return; // a tick that was asking the clock while stop() ran starts nothing
    }
    first ??= now;
    if (late(now)) {
      log.line({ level: 'alert', evt: 'job_late', job: 'day-close' });
    }
    const started: Promise<void>[] = [];
    for (const job of jobs) {
      if (running.has(job.name) || !job.due(now, last.get(job.name)?.at ?? null, last.get(job.name)?.ok)) {
        continue;
      }
      const run = execute(job, pool, now, log).then(
        () => true,
        () => false, // logged and recorded by execute
      );
      const ended = run.then(ok => {
        const before = last.get(job.name);
        last.set(job.name, { at: now, ok, succeededAt: ok ? now : (before?.succeededAt ?? null) });
        running.delete(job.name);
      });
      running.set(job.name, ended);
      started.push(ended);
    }
    await Promise.all(started);
  }

  const timer = setInterval(() => {
    tick().catch(() => {}); // a tick logs what fails in it
  }, opts.intervalMs ?? TICK_MS);
  // not unref'd: a scheduler that is never stopped keeps the process alive, where it shows
  const scheduler: Scheduler = {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (active === scheduler) {
        active = null;
      }
      await Promise.all(running.values());
    },
    health: () =>
      [...last].map(([job, { at, ok }]) => ({ job, lastRunAt: at.toISOString(), ok })),
  };
  active = scheduler;
  return scheduler;
}
