import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const PASSWORD = 'pw-9f3c1e';
const DATABASE_URL = `postgres://app_conn:${PASSWORD}@127.0.0.1:54330/hoimau`;
const key = randomBytes(32);
const JOURNAL_KEY = key.toString('base64');

test('a complete environment is read; PORT defaults to 8787', () => {
  assert.deepEqual(loadConfig({ DATABASE_URL, JOURNAL_KEY }), {
    databaseUrl: DATABASE_URL,
    journalKey: key,
    port: 8787,
  });
  assert.equal(
    loadConfig({ DATABASE_URL, JOURNAL_KEY, PORT: '9000' }).port,
    9000,
  );
  assert.equal(
    loadConfig({
      DATABASE_URL: DATABASE_URL.replace('postgres:', 'postgresql:'),
      JOURNAL_KEY,
    }).journalKey.length,
    32,
  );
});

test('what is missing or malformed is named, all of it at once', () => {
  const failure = (env: Record<string, string | undefined>): string => {
    try {
      loadConfig(env);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('loadConfig accepted the environment');
  };
  assert.equal(
    failure({}),
    'Server configuration: DATABASE_URL is missing; JOURNAL_KEY is missing. See server/.env.example.',
  );
  assert.match(
    failure({ DATABASE_URL: '', JOURNAL_KEY }),
    /DATABASE_URL is missing/,
  );
  for (const url of [
    'not a url',
    `mysql://app_conn:${PASSWORD}@127.0.0.1/hoimau`,
    `postgres://app_conn:${PASSWORD}@127.0.0.1:54330`, // no database
    `postgres://app_conn:${PASSWORD}@127.0.0.1:54330/`,
    'postgres://127.0.0.1:54330/hoimau', // no user
    `postgres://app_conn:${PASSWORD}@/hoimau`, // no host
  ]) {
    assert.match(
      failure({ DATABASE_URL: url, JOURNAL_KEY }),
      /^Server configuration: DATABASE_URL is not a postgres:\/\/ URL/,
      url.replace(PASSWORD, '…'),
    );
  }
  for (const [why, value] of [
    ['31 bytes', randomBytes(31).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['hex', key.toString('hex')],
    ['base64url', Buffer.alloc(32, 0xfb).toString('base64url')],
    ['padding missing', JOURNAL_KEY.slice(0, -1)],
    ['a space inside', ` ${JOURNAL_KEY}`],
  ]) {
    assert.match(
      failure({ DATABASE_URL, JOURNAL_KEY: value }),
      /^Server configuration: JOURNAL_KEY is not 32 bytes in base64/,
      why,
    );
  }
  for (const PORT of ['0', '65536', '80.5', 'http', '']) {
    assert.match(
      failure({ DATABASE_URL, JOURNAL_KEY, PORT }),
      /PORT is not a port number/,
      PORT,
    );
  }
});

test('a failure never prints the database password or the key', () => {
  for (const env of [
    { DATABASE_URL, JOURNAL_KEY: `${JOURNAL_KEY}x` },
    {
      DATABASE_URL: `mysql://app_conn:${PASSWORD}@127.0.0.1/hoimau`,
      JOURNAL_KEY,
    },
    {
      DATABASE_URL: `postgres://app_conn:${PASSWORD}@`,
      JOURNAL_KEY: key.toString('hex'),
    },
    { DATABASE_URL, JOURNAL_KEY, PORT: '-1' },
  ]) {
    assert.throws(
      () => loadConfig(env),
      (e: Error) => {
        const text = `${e.message}\n${e.stack}`;
        assert.ok(!text.includes(PASSWORD));
        assert.ok(!text.includes(JOURNAL_KEY));
        assert.ok(!text.includes(key.toString('hex')));
        return true;
      },
    );
  }
});
