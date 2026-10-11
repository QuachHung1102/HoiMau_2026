// The server process: node src/main.ts, with DATABASE_URL, JOURNAL_KEY and PORT in the
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
export async function serve(
  { databaseUrl, journalKey, port }: Config,
  host?: string,
): Promise<{ stop(): Promise<void> }> {
  const log = createLogger();
  const pool = createPool(databaseUrl, e =>
    log.line({ level: 'error', evt: 'pool', ...describeError(e) }),
  );
  const server = createApp({ pool, mailer: noMailer, journalKey, log });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  log.line({ level: 'info', evt: 'listening', port });
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

/** Runs `stop` once on the first SIGINT or SIGTERM (Ctrl+C in a Windows console is SIGINT). */
export function onShutdown(stop: () => Promise<void>): void {
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) {
        return;
      }
      stopping = true;
      stop().catch((e: unknown) => {
        console.error(e);
        process.exitCode = 1;
      });
    });
  }
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
  onShutdown(stop);
}
