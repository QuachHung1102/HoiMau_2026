// npm --prefix server run jobs -- <name> [--now <ISO>]: runs one job once against the running
// development database (npm run server:dev: port 54330, database hoimau, the fixed dev
// credentials) and prints its result as one JSON line on stdout; its log lines go to stderr.
// Without --now the instant is SELECT app.now(), so a test clock set by a scenario applies.
import { APP_CONN, DEV } from '../../scripts/cluster.ts';
import { createPool, withRole } from '../db.ts';
import { createLogger, describeError } from '../log.ts';
import { instantOf } from '../routes/day.ts';
import { runJob } from './scheduler.ts';

const USAGE = 'usage: node src/jobs/run.ts <name> [--now <ISO instant with a zone>]';

const [name, flag, value, ...rest] = process.argv.slice(2);
const at = flag === '--now' ? instantOf(value) : NaN;
if (
  name === undefined ||
  rest.length > 0 ||
  (flag !== undefined && Number.isNaN(at))
) {
  console.error(USAGE);
  process.exit(2);
}

const log = createLogger(line => process.stderr.write(`${line}\n`));
const pool = createPool(
  `postgres://${APP_CONN.user}:${APP_CONN.password}@127.0.0.1:${DEV.port}/hoimau`,
  e => log.line({ level: 'error', evt: 'pool', ...describeError(e) }),
);
try {
  const now =
    flag === undefined
      ? (
          await withRole(pool, 'app_job', null, c =>
            c.query<{ now: Date }>('SELECT app.now() AS now'),
          )
        ).rows[0].now
      : new Date(at);
  console.log(JSON.stringify({ job: name, now: now.toISOString(), result: await runJob(name, pool, now, log) }));
} catch (e) {
  log.line({ level: 'error', evt: 'run', ...describeError(e) });
  process.exitCode = 1;
} finally {
  await pool.end();
}
