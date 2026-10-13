// No database: the derivation and its gate.
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { AppError } from './errors.ts';
import { createGate, deriveKey, newSalt } from './password.ts';

const SALT = Buffer.alloc(16, 7);

test('deriveKey is scrypt N=32768 r=8 p=1, 32 bytes: deterministic, and different when the password or the salt differs', async () => {
  const key = await deriveKey('mật khẩu của tôi', SALT);
  assert.equal(key.length, 32);
  // the parameters are the contract with every key already stored: compare with the library
  assert.deepEqual(
    key,
    scryptSync('mật khẩu của tôi', SALT, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }),
  );
  assert.deepEqual(await deriveKey('mật khẩu của tôi', SALT), key);
  assert.notDeepEqual(await deriveKey('mật khẩu của tôI', SALT), key);
  assert.notDeepEqual(
    await deriveKey('mật khẩu của tôi', Buffer.alloc(16, 8)),
    key,
  );
});

test('newSalt is 16 random bytes', () => {
  const [a, b] = [newSalt(), newSalt()];
  assert.equal(a.length, 16);
  assert.notDeepEqual(a, b);
});

test('a gate runs maxRunning at a time, queues maxWaiting, refuses the next with RATE_LIMITED, and hands a freed slot on', async () => {
  const gate = createGate(2, 1);
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const job = (name: string) =>
    gate.run(
      () =>
        new Promise<string>(resolve => {
          started.push(name);
          finish.set(name, () => resolve(name));
        }),
    );
  const a = job('a');
  const b = job('b');
  const c = job('c');
  await tick();
  assert.deepEqual(started, ['a', 'b'], 'c waits');
  await assert.rejects(
    job('d'),
    (e: unknown) => e instanceof AppError && e.code === 'RATE_LIMITED',
  );
  assert.deepEqual(started, ['a', 'b'], 'the refused one never ran');

  finish.get('a')?.();
  assert.equal(await a, 'a');
  await tick();
  assert.deepEqual(started, ['a', 'b', 'c'], 'the waiter took the slot of a');
  // c holds a slot now: the line is empty and both slots are taken
  const e = job('e');
  await tick();
  assert.deepEqual(started, ['a', 'b', 'c'], 'e waits behind two running');
  finish.get('b')?.();
  finish.get('c')?.();
  await Promise.all([b, c]);
  await tick();
  assert.deepEqual(started, ['a', 'b', 'c', 'e']);
  finish.get('e')?.();
  await e;
});

test('a work that throws gives its slot back', async () => {
  const gate = createGate(1, 0);
  await assert.rejects(
    gate.run(() => Promise.reject(new Error('x'))),
    /x/,
  );
  assert.equal(await gate.run(() => Promise.resolve(5)), 5);
  // no one waits, one runs: the next is refused until it finishes
  let finish = () => {};
  const running = gate.run(
    () => new Promise<void>(resolve => (finish = resolve)),
  );
  await assert.rejects(
    gate.run(() => Promise.resolve()),
    (e: unknown) => e instanceof AppError && e.code === 'RATE_LIMITED',
  );
  finish();
  await running;
});

test('deriveKey goes through a gate of 4 running and 32 waiting: of 40 at once, 36 are derived and 4 refused', async () => {
  const salt = randomBytes(16);
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, () => deriveKey('pw-pw-pw-pw', salt)),
  );
  const refused = results.filter(
    r =>
      r.status === 'rejected' &&
      r.reason instanceof AppError &&
      r.reason.code === 'RATE_LIMITED',
  );
  assert.equal(
    results.filter(r => r.status === 'fulfilled').length,
    36,
    JSON.stringify(results.map(r => r.status)),
  );
  assert.equal(refused.length, 4);
  // the gate is free again afterwards
  assert.equal((await deriveKey('pw-pw-pw-pw', salt)).length, 32);
});
