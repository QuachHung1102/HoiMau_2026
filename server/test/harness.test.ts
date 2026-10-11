import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { ClientBase } from 'pg';
import { APP_CONN, TEST } from '../scripts/cluster.ts';
import { migrate } from '../src/migrate.ts';
import {
  asAnon,
  asJob,
  asUser,
  expectPgError,
  setTestClock,
} from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(() => db.drop());

const DENIED = '42501';

test('plain app_conn (no SET LOCAL ROLE) is refused at the schema', async () => {
  await expectPgError(db.app.query('SELECT * FROM meta.test_clock'), {
    code: DENIED,
    messagePrefix: 'permission denied for schema meta',
  });
  await expectPgError(db.app.query('SELECT app.now()'), {
    code: DENIED,
    messagePrefix: 'permission denied for schema app',
  });
});

test('role and user id do not leak to the next user of a pooled connection', async () => {
  const state =
    "SELECT current_user::text AS role, current_setting('app.user_id', true) AS uid, pg_backend_pid() AS pid";
  const userId = randomUUID();

  const committed = await asUser(db.app, userId, async c => {
    const { rows } = await c.query(
      `${state}, app.current_user_id()::text AS id`,
    );
    return rows[0];
  });
  // the switch really happened, otherwise the checks below prove nothing
  assert.equal(committed.role, 'app_auth');
  assert.equal(committed.id, userId);

  let rolledBackPid = 0;
  await assert.rejects(
    asUser(db.app, userId, async c => {
      rolledBackPid = (await c.query(state)).rows[0].pid;
      await c.query('SELECT 1 / 0');
    }),
    { code: '22012' },
  );

  for (const pid of [committed.pid, rolledBackPid]) {
    const client = await db.app.connect();
    try {
      assert.deepEqual((await client.query(state)).rows[0], {
        role: 'app_conn',
        uid: '',
        pid, // the very connection the transaction ran on
      });
    } finally {
      client.release();
    }
  }
});

test('app.current_user_id() is null without a user, also on a reused connection', async () => {
  await asUser(db.app, randomUUID(), c => c.query('SELECT 1'));
  const { rows } = await asAnon(db.app, c =>
    c.query('SELECT app.current_user_id() AS id, current_user::text AS role'),
  );
  assert.deepEqual(rows[0], { id: null, role: 'app_anon' });
});

test('a user id left on the session never becomes the identity of a request', async () => {
  // one connection, so the helpers must run on the one that carries the stale value
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: TEST.port,
    ...APP_CONN,
    database: db.name,
    max: 1,
  });
  try {
    const stale = randomUUID();
    await pool.query("SELECT set_config('app.user_id', $1, false)", [stale]);
    const { rows: session } = await pool.query(
      "SELECT current_setting('app.user_id', true) AS uid",
    );
    assert.equal(session[0].uid, stale);

    const identity = 'SELECT app.current_user_id()::text AS id';
    for (const request of [asAnon, asJob]) {
      const { rows } = await request(pool, c => c.query(identity));
      assert.equal(rows[0].id, null);
    }
    const userId = randomUUID();
    const { rows } = await asUser(pool, userId, c => c.query(identity));
    assert.equal(rows[0].id, userId);
  } finally {
    await pool.end();
  }
});

test('a function granted only to app_job is closed to app_anon and app_auth', async () => {
  await db.admin.query(
    `CREATE FUNCTION public.job_probe() RETURNS int LANGUAGE sql AS 'SELECT 7';
     GRANT EXECUTE ON FUNCTION public.job_probe() TO app_job`,
  );
  const call = 'SELECT job_probe() AS n';
  const refusal = {
    code: DENIED,
    messagePrefix: 'permission denied for function job_probe',
  };
  assert.equal((await asJob(db.app, c => c.query(call))).rows[0].n, 7);
  await expectPgError(
    asAnon(db.app, c => c.query(call)),
    refusal,
  );
  await expectPgError(
    asUser(db.app, randomUUID(), c => c.query(call)),
    refusal,
  );
  // plain app_conn does not get as far as the function: it cannot use schema public at all
  await expectPgError(db.app.query('SELECT public.job_probe()'), {
    code: DENIED,
    messagePrefix: 'permission denied for schema public',
  });
  // and a request role cannot climb to a role app_conn is not a member of
  await expectPgError(
    asAnon(db.app, async c => {
      await c.query('SET LOCAL ROLE postgres');
    }),
    { code: DENIED, messagePrefix: 'permission denied to set role' },
  );
});

test('Vietnamese text round-trips and the ICU locale is active', async () => {
  const text = 'Hồi Máu — nước ấm';
  const { rows } = await db.admin.query(
    `SELECT $1::text AS text, char_length($1) AS chars, octet_length($1) AS bytes,
            upper('hồi máu') AS upper, current_setting('server_encoding') AS encoding`,
    [text],
  );
  assert.deepEqual(rows[0], {
    text,
    chars: [...text].length,
    bytes: Buffer.byteLength(text, 'utf8'),
    upper: 'HỒI MÁU',
    encoding: 'UTF8',
  });
});

test('setTestClock moves app.now() for every role, and clearing returns to real time', async () => {
  const sql =
    'SELECT app.now() AS clock, app.now() = now() AS is_real, now() AS real';
  const frozen = '2026-09-09T18:30:00.000Z';
  try {
    await setTestClock(db.admin, '2001-01-01T00:00:00Z');
    await setTestClock(db.admin, frozen); // a second call replaces the row
    for (const run of [
      asAnon(db.app, c => c.query(sql)),
      asJob(db.app, c => c.query(sql)),
      asUser(db.app, randomUUID(), c => c.query(sql)),
    ]) {
      const { clock, is_real } = (await run).rows[0];
      assert.equal(clock.toISOString(), frozen);
      assert.equal(is_real, false);
    }
  } finally {
    await setTestClock(db.admin, null);
  }
  const { is_real, real } = (await asAnon(db.app, c => c.query(sql))).rows[0];
  assert.equal(is_real, true);
  assert.ok(Math.abs(real.getTime() - Date.now()) < 60_000);
});

test('expectPgError fails on success, on another SQLSTATE and on another message', async () => {
  const expected = {
    code: DENIED,
    messagePrefix: 'permission denied for schema meta',
  };
  const denied = () => db.app.query('SELECT * FROM meta.test_clock');
  await expectPgError(denied(), expected);
  await assert.rejects(
    expectPgError(db.app.query('SELECT 1'), expected),
    /Missing expected rejection/,
  );
  await assert.rejects(
    expectPgError(denied(), { ...expected, code: '42P01' }),
    /SQLSTATE of/,
  );
  await assert.rejects(
    expectPgError(denied(), {
      ...expected,
      messagePrefix: 'permission denied for table',
    }),
    /does not start with/,
  );
});

test('loading the cluster manager leaves the exit code of the process alone', () => {
  // embedded-postgres installs an exit hook that ends a failing run with 0 and a passing one with 1
  for (const exitCode of [0, 3]) {
    const { status, stderr } = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const { loadEmbeddedPostgres } = await import('./scripts/cluster.ts');
         await loadEmbeddedPostgres();
         process.exitCode = ${exitCode};`,
      ],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
    );
    assert.equal(stderr, '');
    assert.equal(status, exitCode);
  }
});

test('migrate runs SQL below 80, then the seeders, then 8N and 90, and names the step that fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hm-migrate-'));
  const client = await db.admin.connect();
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await mkdir(join(root, 'sql'));
    await mkdir(join(root, 'seed'));
    const step = (name: string) =>
      `INSERT INTO fx_migrate_steps (name) VALUES ('${name}');`;
    await writeFile(
      join(root, 'sql', '10-base.sql'),
      `CREATE TABLE IF NOT EXISTS fx_migrate_steps (n int GENERATED ALWAYS AS IDENTITY, name text);
       CREATE TABLE IF NOT EXISTS fx_content (code text PRIMARY KEY);
       CREATE TABLE IF NOT EXISTS fx_decoy (code text REFERENCES fx_content);
       ${step('10')}`,
    );
    await writeFile(join(root, 'sql', '79-last.sql'), step('79'));
    // the decoy row references content that only the seeder creates
    await writeFile(
      join(root, 'sql', '80-decoy.sql'),
      `INSERT INTO fx_decoy (code) VALUES ('seeded'); ${step('80')}`,
    );
    await writeFile(join(root, 'sql', '90-verify.sql'), step('90'));
    await writeFile(join(root, 'sql', 'notes.sql'), 'SELECT 1 / 0;');
    const seeder = (name: string) =>
      `export async function seed(db) { await db.query("INSERT INTO fx_content VALUES ('${name}') ON CONFLICT DO NOTHING; ${step(
        name,
      )}"); }`;
    await writeFile(join(root, 'seed', 'b.ts'), seeder('seeded'));
    await writeFile(join(root, 'seed', 'a.ts'), seeder('first'));
    await writeFile(join(root, 'seed', 'a.test.ts'), 'throw new Error();');

    const expected = [
      '10-base.sql',
      '79-last.sql',
      'seed/a.ts',
      'seed/b.ts',
      '80-decoy.sql',
      '90-verify.sql',
    ];
    assert.deepEqual(
      await migrate(client, join(root, 'sql'), join(root, 'seed')),
      expected,
    );
    const { rows } = await client.query(
      'SELECT name FROM fx_migrate_steps ORDER BY n',
    );
    assert.deepEqual(
      rows.map(row => row.name),
      ['10', '79', 'first', 'seeded', '80', '90'],
    );

    // a missing seed directory is not an error, and a failing file names itself and rolls back
    await writeFile(
      join(root, 'sql', '11-broken.sql'),
      `${step('11')} SELECT 1 / 0;`,
    );
    await assert.rejects(
      migrate(client, join(root, 'sql'), join(root, 'absent')),
      /^Error: 11-broken\.sql: division by zero$/,
    );
    const { rows: after11 } = await client.query(
      "SELECT count(*)::int AS n FROM fx_migrate_steps WHERE name = '11'",
    );
    assert.equal(after11[0].n, 0);
    await assert.rejects(
      migrate(client, join(root, 'seed')),
      /no NN-\*\.sql file/,
    );
    await rm(join(root, 'sql', '11-broken.sql'));

    // the step's own error is reported even when the rollback fails too
    const lost = {
      query: async (sql: string) => {
        if (sql !== 'BEGIN') {
          throw new Error(sql === 'ROLLBACK' ? 'connection lost' : 'boom');
        }
      },
    } as unknown as ClientBase;
    await assert.rejects(
      migrate(lost, join(root, 'sql'), join(root, 'absent')),
      /^Error: 10-base\.sql: boom$/,
    );

    // nothing may run after the self-check, and the refusal comes before any step
    const stepCount = async () =>
      (await client.query('SELECT count(*)::int AS n FROM fx_migrate_steps'))
        .rows[0].n;
    const stepsBefore = await stepCount();
    await writeFile(join(root, 'sql', '91-late.sql'), step('91'));
    await assert.rejects(
      migrate(client, join(root, 'sql'), join(root, 'seed')),
      /^Error: 90-verify\.sql must be the last step, but 91-late\.sql would run after it$/,
    );
    assert.equal(await stepCount(), stepsBefore);
  } finally {
    client.release();
    await rm(root, { recursive: true, force: true });
  }
});
