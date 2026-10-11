// node --test --test-global-setup=./test/global.ts
// Runs once per test command: starts the test cluster and rebuilds the template database
// that every test file clones (see testdb.ts).
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { APP_CONN, SUPERUSER, TEST, startCluster } from '../scripts/cluster.ts';
import { migrate } from '../src/migrate.ts';

const SQL_DIR = fileURLToPath(new URL('../sql', import.meta.url));
const connection = { host: '127.0.0.1', port: TEST.port, ...SUPERUSER };

let cluster: { stop(): Promise<void> } | undefined;

async function withClient(
  database: string,
  work: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ ...connection, database });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

async function buildTemplate(): Promise<void> {
  await withClient('postgres', async root => {
    // Clones leaked by killed runs, and the previous template.
    const { rows } = await root.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname = 'hm_template' OR datname ~ '^t_[0-9a-f]{12}$'",
    );
    for (const { datname } of rows) {
      await root.query(`ALTER DATABASE ${datname} IS_TEMPLATE false`);
      await root.query(`DROP DATABASE ${datname} WITH (FORCE)`);
    }
    await root.query('CREATE DATABASE hm_template');
  });
  await withClient('hm_template', async template => {
    await migrate(template, SQL_DIR);
    // Development password only; production sets it out of band.
    await template.query(
      `ALTER ROLE ${APP_CONN.user} PASSWORD '${APP_CONN.password}'`,
    );
  });
  await withClient('postgres', root =>
    root.query('ALTER DATABASE hm_template IS_TEMPLATE true').then(() => {}),
  );
}

export async function globalSetup(): Promise<void> {
  cluster = await startCluster(TEST);
  try {
    await buildTemplate();
  } catch (e) {
    await cluster.stop();
    throw e;
  }
}

export async function globalTeardown(): Promise<void> {
  await cluster?.stop();
}
