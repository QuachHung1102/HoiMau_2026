import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { APP_CONN, SUPERUSER, TEST } from '../scripts/cluster.ts';

const host = { host: '127.0.0.1', port: TEST.port };

async function asRoot(sql: string): Promise<void> {
  const root = new pg.Client({ ...host, ...SUPERUSER, database: 'postgres' });
  await root.connect();
  try {
    await root.query(sql);
  } finally {
    await root.end();
  }
}

export type TestDb = {
  name: string;
  /** Superuser pool: arranging fixtures and asserting only, never the code under test. */
  admin: pg.Pool;
  /** Pool as `app_conn`, exactly what the application connects with. */
  app: pg.Pool;
  drop(): Promise<void>;
};

/**
 * One database per test file, cloned from the migrated template. Inside a file, isolate tests
 * with fresh random users, never with an outer ROLLBACK (the code under test commits).
 */
export async function createTestDb(): Promise<TestDb> {
  const name = `t_${randomBytes(6).toString('hex')}`; // generated here, never user data
  await asRoot(`CREATE DATABASE ${name} TEMPLATE hm_template`);
  const admin = new pg.Pool({ ...host, ...SUPERUSER, database: name, max: 2 });
  const app = new pg.Pool({ ...host, ...APP_CONN, database: name, max: 10 });
  return {
    name,
    admin,
    app,
    async drop() {
      await app.end();
      await admin.end();
      await asRoot(`DROP DATABASE ${name} WITH (FORCE)`);
    },
  };
}
