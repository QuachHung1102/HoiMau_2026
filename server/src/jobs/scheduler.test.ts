// The scheduler with a fake clock: when day-close is due, one run of a job at a time, the late
// alert, failures recorded with ok = false, /healthz from memory, and a stop that leaves no timer
// and waits for the runs in flight. Runs are recorded in the job_runs of a test database.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { createLogger } from '../log.ts';
import dayClose from './dayClose.ts';
import { LATE_MS, loadJobs, startScheduler } from './scheduler.ts';
import type { Job } from './scheduler.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await app.close();
  await db.drop();
});

const MINUTE = 60_000;
const at = (iso: string) => new Date(iso);

/** A scheduler whose clock is `clock.now`, with a log kept in `lines`; the timer is far away. */
async function fake(jobs: Job[], start = '2027-03-10T10:15:00.000Z') {
  const lines: Record<string, unknown>[] = [];
  const clock = { now: at(start) };
  const scheduler = await startScheduler({
    pool: db.app,
    log: createLogger(line => lines.push(JSON.parse(line))),
    jobs,
    now: async () => clock.now,
    intervalMs: 3_600_000,
  });
  /** Moves the clock to `iso` and ticks; resolves when what that tick started has ended. */
  const tickAt = (iso: string) => {
    clock.now = at(iso);
    return scheduler.tick();
  };
  return { scheduler, lines, clock, tickAt };
}

/** A job that counts its runs; `gate` holds a run until released. */
function counting(name: string, due: Job['due']) {
  const job = {
    runs: 0,
    release: () => {},
    gate: Promise.resolve(),
    hold() {
      this.gate = new Promise<void>(resolve => {
        this.release = resolve;
      });
    },
  };
  const asJob: Job = {
    name,
    due,
    run: async () => {
      job.runs++;
      await job.gate;
      return { done: job.runs };
    },
  };
  return { job, asJob };
}

test('the jobs are the files of src/jobs, except the scheduler, run.ts and tests', async () => {
  assert.deepEqual((await loadJobs()).map(job => job.name), ['day-close', 'housekeeping', 'leaderboard-refresh', 'reminder-dispatch', 'ticket-grant', 'weekly-rollover']);
});

test('day-close is due once per hour from minute 15', () => {
  const due = (now: string, last: string | null) => dayClose.due(at(now), last === null ? null : at(last));
  assert.equal(due('2027-03-10T10:15:00.000Z', null), true);
  assert.equal(due('2027-03-10T10:15:00.000Z', '2027-03-10T09:15:00.000Z'), true);
  assert.equal(due('2027-03-10T10:16:00.000Z', '2027-03-10T10:15:00.000Z'), false);
  assert.equal(due('2027-03-10T11:14:59.999Z', '2027-03-10T10:15:00.000Z'), false);
  assert.equal(due('2027-03-10T11:15:00.000Z', '2027-03-10T10:15:00.000Z'), true);
  // a run missed at 10:15 (the process was down) is made at the next look
  assert.equal(due('2027-03-10T10:40:00.000Z', '2027-03-10T09:15:00.000Z'), true);
  assert.equal(due('2027-03-10T10:14:00.000Z', '2027-03-10T09:15:00.000Z'), false);
});

test('with a fake clock day-close runs at hh:15 and not again at hh:16; the next one at the next hh:15', async () => {
  const { job, asJob } = counting('day-close', dayClose.due);
  const { scheduler, tickAt } = await fake([asJob]);
  try {
    await tickAt('2027-03-10T10:15:00.000Z');
    await tickAt('2027-03-10T10:16:00.000Z');
    await tickAt('2027-03-10T11:14:00.000Z');
    assert.equal(job.runs, 1);
    await tickAt('2027-03-10T11:15:00.000Z');
    assert.equal(job.runs, 2);
  } finally {
    await scheduler.stop();
  }
});

test('a second tick while a run is in flight does not start a second run of that job', async () => {
  const { job, asJob } = counting('slow', () => true);
  const { scheduler, tickAt } = await fake([asJob]);
  try {
    job.hold();
    const first = tickAt('2027-03-10T10:15:00.000Z');
    while (job.runs === 0) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await tickAt('2027-03-10T10:16:00.000Z');
    await tickAt('2027-03-10T10:17:00.000Z');
    assert.equal(job.runs, 1);
    job.release();
    await first;
    await tickAt('2027-03-10T10:18:00.000Z');
    assert.equal(job.runs, 2);
  } finally {
    await scheduler.stop();
  }
});

test('the alert line appears when the last successful day-close is 91 minutes old, not at 89', async () => {
  const { asJob } = counting('day-close', (_now, last) => last === null);
  const { scheduler, lines, tickAt } = await fake([asJob]);
  const alerts = () => lines.filter(line => line.evt === 'job_late');
  try {
    await tickAt('2027-03-10T10:15:00.000Z');
    await tickAt('2027-03-10T11:44:00.000Z');
    assert.deepEqual(alerts(), []);
    await tickAt('2027-03-10T11:46:00.000Z');
    assert.deepEqual(
      alerts().map(({ level, evt, job }) => ({ level, evt, job })),
      [{ level: 'alert', evt: 'job_late', job: 'day-close' }],
    );
    assert.equal(LATE_MS, 90 * MINUTE);
  } finally {
    await scheduler.stop();
  }
});

test('a run that throws is logged without its message, recorded with ok = false, and the scheduler goes on; /healthz lists the last run of each job from memory', async () => {
  const failing: Job = {
    name: 'failing',
    due: () => true,
    run: async () => {
      throw new RangeError('secret someone@example.com');
    },
  };
  const { asJob } = counting('fine', () => true);
  const { scheduler, lines, tickAt } = await fake([failing, asJob]);
  try {
    await tickAt('2027-03-10T10:15:00.000Z');
    const { rows } = await db.admin.query(
      "SELECT job, ok, detail FROM job_runs WHERE run_for = '2027-03-10T10:15:00.000Z' AND job IN ('failing', 'fine') ORDER BY job",
    );
    assert.deepEqual(
      rows.map(row => [row.job, row.ok, row.detail.error ?? row.detail.done]),
      [
        ['failing', false, 'RangeError'],
        ['fine', true, 1],
      ],
    );
    const failed = lines.find(line => line.evt === 'job' && line.job === 'failing')!;
    assert.deepEqual([failed.level, failed.ok, failed.error], ['error', false, 'RangeError']);
    assert.ok(!JSON.stringify(lines).includes('someone@example.com'));
    const health = await app.call('GET', '/healthz');
    assert.deepEqual(health.body, {
      ok: true,
      db: true,
      jobs: [
        { job: 'failing', lastRunAt: '2027-03-10T10:15:00.000Z', ok: false },
        { job: 'fine', lastRunAt: '2027-03-10T10:15:00.000Z', ok: true },
      ],
    });
  } finally {
    await scheduler.stop();
  }
  // a stopped scheduler is not listed
  assert.deepEqual((await app.call('GET', '/healthz')).body.jobs, []);
});

test('stop() leaves no timer behind and resolves once the run in flight has ended', async () => {
  const timers = () => process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length;
  const timersBefore = timers();
  let looks = 0;
  const { job, asJob } = counting('slow', () => true);
  const scheduler = await startScheduler({
    pool: db.app,
    log: createLogger(() => {}),
    jobs: [asJob],
    now: async () => {
      looks++;
      return at('2027-03-10T10:15:00.000Z');
    },
    intervalMs: 5,
  });
  assert.equal(timers(), timersBefore + 1);
  job.hold();
  while (job.runs === 0) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  let stopped = false;
  const stopping = scheduler.stop().then(() => {
    stopped = true;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(stopped, false, 'stop() waits for the run in flight');
  job.release();
  await stopping;
  const seen = looks;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(looks, seen, 'no tick after stop()');
  assert.equal(timers(), timersBefore);
  assert.equal(job.runs, 1);
});
