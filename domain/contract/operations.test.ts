import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPERATIONS } from './operations.ts';

const isWrite = (method: string) => method === 'POST' || method === 'PATCH';
const keyless = (op: (typeof OPERATIONS)[number]) =>
  op.auth === 'anon' || op.path === '/auth/logout';

test('OPERATIONS has no duplicate method + path', () => {
  const keys = OPERATIONS.map(op => `${op.method} ${op.path}`);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
  assert.ok(keys.length > 0);
});

test('every authenticated write except logout requires an Idempotency-Key', () => {
  const missing = OPERATIONS.filter(
    op => isWrite(op.method) && !keyless(op) && !op.idempotent,
  );
  assert.deepEqual(missing, []);
});

test('reads, anonymous endpoints and logout take no Idempotency-Key (AR-08)', () => {
  const wrong = OPERATIONS.filter(
    op => (op.method === 'GET' || keyless(op)) && op.idempotent,
  );
  assert.deepEqual(wrong, []);
});

test('paths are rooted and use :param placeholders', () => {
  const wrong = OPERATIONS.filter(
    op => !op.path.startsWith('/') || op.path.includes('{'),
  );
  assert.deepEqual(wrong, []);
});
