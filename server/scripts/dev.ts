// npm run server:dev: the API on the development cluster (port 54330, server/.pgdata-dev,
// database hoimau), migrated and seeded on every start. Ctrl+C stops the API and the cluster.
// Never the test cluster (54329), never the machine's own PostgreSQL service (5432).
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../src/config.ts';
import { guardProcess, loadEnvFile, serve } from '../src/main.ts';
import { migrate } from '../src/migrate.ts';
import { APP_CONN, DEV, SUPERUSER, startCluster } from './cluster.ts';

const DATABASE = 'hoimau';
const SQL_DIR = fileURLToPath(new URL('../sql', import.meta.url));
const HOST = '127.0.0.1';
// Development only, like the passwords in cluster.ts: journal entries written by one run stay
// readable in the next. Production sets JOURNAL_KEY out of band.
const DEV_JOURNAL_KEY = Buffer.alloc(32, 'hoi-mau-dev').toString('base64');

async function asOwner(
  database: string,
  work: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({
    host: HOST,
    port: DEV.port,
    ...SUPERUSER,
    database,
  });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

// embedded-postgres hooks the signals itself: it would stop the cluster under the API and call
// process.exit while requests are in flight. The shutdown below is the only one.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'message'];
const emitter: NodeJS.EventEmitter = process;
const before = SIGNALS.map(event => emitter.listeners(event));
const cluster = await startCluster(DEV);
SIGNALS.forEach((event, i) => {
  for (const listener of emitter.listeners(event)) {
    if (!before[i].includes(listener)) {
      emitter.off(event, listener as () => void);
    }
  }
});

try {
  await asOwner('postgres', async root => {
    const { rowCount } = await root.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [DATABASE],
    );
    if (rowCount === 0) {
      await root.query(`CREATE DATABASE ${DATABASE}`); // a constant of this file
    }
  });
  await asOwner(DATABASE, async owner => {
    await migrate(owner, SQL_DIR);
    // Development password only; production sets it out of band.
    await owner.query(
      `ALTER ROLE ${APP_CONN.user} PASSWORD '${APP_CONN.password}'`,
    );
  });

  loadEnvFile();
  const config = loadConfig({
    JOURNAL_KEY: process.env.JOURNAL_KEY || DEV_JOURNAL_KEY,
    PORT: process.env.PORT,
    HOST,
    // always the cluster started above, whatever the environment names
    DATABASE_URL: `postgres://${APP_CONN.user}:${APP_CONN.password}@${HOST}:${DEV.port}/${DATABASE}`,
  });
  const api = await serve(config);
  guardProcess(async () => {
    try {
      await api.stop();
    } finally {
      await cluster.stop();
    }
  });
  console.log(
    `API ready: http://${HOST}:${config.port}/api/v1 (Ctrl+C stops it)`,
  );
} catch (e) {
  await cluster.stop();
  throw e;
}
