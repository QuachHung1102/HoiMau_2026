// The server process: node src/main.ts, with DATABASE_URL, JOURNAL_KEY, HOST and PORT in the
// environment or in server/.env. scripts/dev.ts starts the same thing on the dev cluster.
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import type { Mailer } from './app.ts';
import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { createPool } from './db.ts';
import { createLogger, describeError } from './log.ts';

// Until the outbox mailer exists, a route that sends mail fails loudly instead of pretending.
const noMailer: Mailer = () =>
  Promise.reject(new Error('mail is not configured'));

/** Pool, app and listening socket. `stop` lets requests in flight finish, then closes all three. */
export async function serve({
  databaseUrl,
  journalKey,
  host,
  port,
}: Config): Promise<{ stop(): Promise<void> }> {
  const log = createLogger();
  const pool = createPool(databaseUrl, e =>
    log.line({ level: 'error', evt: 'pool', ...describeError(e) }),
  );
  const server = createApp({ pool, mailer: noMailer, journalKey, log });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  log.line({ level: 'info', evt: 'listening', host, port });
  return {
    async stop() {
      // a request that never ends must not keep the process alive for ever
      const force = setTimeout(() => server.closeAllConnections(), 10_000);
      await new Promise(resolve => server.close(resolve));
      clearTimeout(force);
      await pool.end();
    },
  };
}

/**
 * The process around a running server. `stop` runs once, on the first SIGINT or SIGTERM (Ctrl+C
 * in a Windows console is SIGINT) and after an uncaught exception, which also sets a failing
 * exit code: the state of the process is unknown by then. A rejection nobody handled is logged
 * and the server keeps serving. Both are logged without their message, like every error.
 */
export function guardProcess(stop: () => Promise<void>): void {
  const log = createLogger();
  let stopping = false;
  const stopOnce = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    // a stop that hangs must not keep a broken process alive
    setTimeout(() => process.exit(1), 30_000).unref();
    stop()
      .catch((e: unknown) => {
        log.line({ level: 'error', evt: 'stop', ...describeError(e) });
        process.exitCode = 1;
      })
      .finally(() => {
        // after a failure nothing is left to wait for; a clean stop lets the process run out
        if (process.exitCode === 1) {
          process.exit(1);
        }
      });
  };
  process.on('SIGINT', stopOnce);
  process.on('SIGTERM', stopOnce);
  process.on('unhandledRejection', reason => {
    log.line({
      level: 'error',
      evt: 'unhandled_rejection',
      ...describeError(reason),
    });
  });
  process.on('uncaughtException', e => {
    log.line({
      level: 'error',
      evt: 'uncaught_exception',
      ...describeError(e),
    });
    process.exitCode = 1;
    stopOnce();
  });
}

/** `server/.env`, when there is one; a variable already in the environment wins. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
  }
}

if (import.meta.main) {
  loadEnvFile();
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const { stop } = await serve(config);
  guardProcess(stop);
}
