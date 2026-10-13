// No database: the outbox mailer and the MAIL_MODE gate of the process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mailerFromEnv } from './main.ts';
import { outboxMailer } from './mailer.ts';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

test('the outbox mailer creates its directory on demand and appends one JSON line per message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-outbox-'));
  try {
    const file = join(dir, 'not', 'yet', 'there', 'mail.jsonl');
    const send = outboxMailer(file);
    await send({ to: 'a@example.com', subject: 'Mã 1', text: 'dòng 1\ndòng 2' });
    await send({ to: 'b@example.com', subject: 'Mã 2', text: 'x' });
    // many at once: every line stays a whole JSON object
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        send({ to: `c${i}@example.com`, subject: 's', text: 'y'.repeat(2000) }),
      ),
    );
    const lines = (await readFile(file, 'utf8')).split('\n');
    assert.equal(lines.pop(), '', 'the file ends with a line feed');
    assert.equal(lines.length, 22);
    const mails = lines.map(
      line => JSON.parse(line) as Record<string, string>,
    );
    assert.deepEqual(
      [mails[0].to, mails[0].subject, mails[0].text],
      ['a@example.com', 'Mã 1', 'dòng 1\ndòng 2'],
    );
    assert.equal(mails[1].to, 'b@example.com');
    assert.match(mails[0].ts, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('MAIL_MODE=outbox is the only mode: anything else, unset included, is an error that points at the docs', () => {
  assert.equal(typeof mailerFromEnv({ MAIL_MODE: 'outbox' }), 'function');
  for (const env of [{}, { MAIL_MODE: '' }, { MAIL_MODE: 'smtp' }, { MAIL_MODE: 'Outbox' }]) {
    assert.throws(() => mailerFromEnv(env), /MAIL_MODE.*docs\/backend\.md/);
  }
});

test('MAIL_MODE=outbox is refused when NODE_ENV is production: reset codes are never written to disk there', () => {
  assert.equal(typeof mailerFromEnv({ MAIL_MODE: 'outbox', NODE_ENV: 'development' }), 'function');
  assert.throws(
    () => mailerFromEnv({ MAIL_MODE: 'outbox', NODE_ENV: 'production' }),
    /MAIL_MODE.*production.*docs\/backend\.md/,
  );
  const { status, stderr } = spawnSync(process.execPath, ['src/main.ts'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
      JOURNAL_KEY: Buffer.alloc(32, 3).toString('base64'),
      MAIL_MODE: 'outbox',
      NODE_ENV: 'production',
    },
  });
  assert.equal(status, 1, stderr);
  assert.match(stderr, /production.*docs\/backend\.md/);
});

test('the outbox directory is created owner-only and the file owner-read/write (mode is ignored on Windows)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-outbox-'));
  try {
    const file = join(dir, 'box', 'mail.jsonl');
    await outboxMailer(file)({ to: 'a@example.com', subject: 's', text: 't' });
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(dir, 'box'))).mode.toString(8).slice(-3), '700');
      assert.equal((await stat(file)).mode.toString(8).slice(-3), '600');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('main.ts stops at start-up, before it connects to anything, when MAIL_MODE is not outbox', () => {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    ['src/main.ts'],
    {
      cwd: SERVER_DIR,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
        JOURNAL_KEY: Buffer.alloc(32, 3).toString('base64'),
        MAIL_MODE: 'smtp',
      },
    },
  );
  assert.equal(status, 1, `${stdout}${stderr}`);
  assert.match(stderr, /MAIL_MODE.*docs\/backend\.md/);
});
