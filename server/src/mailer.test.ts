// No database: the outbox mailer and the MAIL_MODE gate of the process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mailerFromEnv } from './main.ts';
import { outboxMailer } from './mailer.ts';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The last three octal digits of the mode: 'rwx' bits of owner, group, other. */
const modeOf = async (path: string) => (await stat(path)).mode.toString(8).slice(-3);

/** A child `node src/main.ts` that gets exactly this environment (plus a database it never reaches). */
const startMain = (env: Record<string, string>) =>
  spawnSync(process.execPath, ['src/main.ts'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      NODE_ENV: '',
      DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
      JOURNAL_KEY: Buffer.alloc(32, 3).toString('base64'),
      ...env,
    },
  });

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
  const NODE_ENV = 'development';
  assert.equal(typeof mailerFromEnv({ MAIL_MODE: 'outbox', NODE_ENV }), 'function');
  for (const env of [
    { NODE_ENV },
    { NODE_ENV, MAIL_MODE: '' },
    { NODE_ENV, MAIL_MODE: 'smtp' },
    { NODE_ENV, MAIL_MODE: 'Outbox' },
  ]) {
    assert.throws(() => mailerFromEnv(env), /MAIL_MODE.*docs\/backend\.md/);
  }
});

test('MAIL_MODE=outbox starts only with NODE_ENV exactly development or test: every other spelling, unset included, is refused', () => {
  for (const NODE_ENV of ['development', 'test']) {
    assert.equal(typeof mailerFromEnv({ MAIL_MODE: 'outbox', NODE_ENV }), 'function', NODE_ENV);
  }
  const refused: (string | undefined)[] = [
    undefined, '', 'production', 'Production', 'PRODUCTION', 'prod', 'staging',
    'production ', ' production', 'Development', 'dev', 'Test', 'testing', 'development ', 'qa',
  ];
  for (const NODE_ENV of refused) {
    assert.throws(
      () => mailerFromEnv({ MAIL_MODE: 'outbox', NODE_ENV }),
      /MAIL_MODE.*NODE_ENV.*docs\/backend\.md/,
      JSON.stringify(NODE_ENV),
    );
  }
});

test('main.ts stops at start-up, before it connects to anything, on an outbox in any environment but development or test', () => {
  for (const NODE_ENV of ['production', 'Production', 'staging', '']) {
    const { status, stderr } = startMain({ MAIL_MODE: 'outbox', NODE_ENV });
    assert.equal(status, 1, `${NODE_ENV}: ${stderr}`);
    assert.match(stderr, /NODE_ENV.*docs\/backend\.md/, NODE_ENV);
  }
});

test('main.ts stops at start-up, before it connects to anything, when MAIL_MODE is not outbox', () => {
  const { status, stdout, stderr } = startMain({ MAIL_MODE: 'smtp', NODE_ENV: 'development' });
  assert.equal(status, 1, `${stdout}${stderr}`);
  assert.match(stderr, /MAIL_MODE.*docs\/backend\.md/);
});

test('the outbox directory is created owner-only and the file owner-read/write (POSIX: never observed on Windows)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-outbox-'));
  try {
    const file = join(dir, 'box', 'mail.jsonl');
    await outboxMailer(file)({ to: 'a@example.com', subject: 's', text: 't' });
    if (process.platform !== 'win32') {
      assert.equal(await modeOf(join(dir, 'box')), '700');
      assert.equal(await modeOf(file), '600');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a directory and a file that already exist are made owner-only before the next line is written (POSIX: never observed on Windows)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-outbox-'));
  try {
    const box = join(dir, 'box');
    const file = join(box, 'mail.jsonl');
    await mkdir(box, { mode: 0o755 });
    await writeFile(file, '', { mode: 0o644 });
    await chmod(box, 0o755);
    await chmod(file, 0o644);
    await outboxMailer(file)({ to: 'a@example.com', subject: 's', text: 't' });
    if (process.platform !== 'win32') {
      assert.equal(await modeOf(box), '700');
      assert.equal(await modeOf(file), '600');
    }
    assert.equal((await readFile(file, 'utf8')).split('\n').length, 2, 'the line was appended');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
