import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('reads, anonymous endpoints and logout take no Idempotency-Key', () => {
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

const linesOf = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').split(/\r?\n/);

/**
 * Line scan of docs/api/openapi.yaml — no YAML parser. It relies on the one layout the
 * document keeps: a path at 2 spaces, a method at 4, `operationId` and `x-auth` at 6, the
 * Idempotency-Key parameter as a `$ref`, and the members of the `ErrorCode` enum at 8.
 */
function scanOpenApi() {
  const operations: {
    method: string;
    path: string;
    auth: string;
    idempotent: boolean;
    operationId: string;
  }[] = [];
  const errorCodes: string[] = [];
  let section = '';
  let path = '';
  let schema = '';
  for (const line of linesOf('../../docs/api/openapi.yaml')) {
    if (/^[a-z]/.test(line)) {
      section = line;
    } else if (section === 'paths:') {
      const pathLine = /^ {2}([/].*):$/.exec(line);
      const method = /^ {4}(get|post|patch|put|delete):$/.exec(line);
      const field = /^ {6}(operationId|x-auth): (.+)$/.exec(line);
      const last = operations.at(-1);
      if (pathLine) {
        path = pathLine[1].replaceAll('{', ':').replaceAll('}', '');
      } else if (method) {
        operations.push({
          method: method[1].toUpperCase(),
          path,
          auth: '',
          idempotent: false,
          operationId: '',
        });
      } else if (field && last) {
        last[field[1] === 'x-auth' ? 'auth' : 'operationId'] = field[2];
      } else if (line.includes('#/components/parameters/IdempotencyKey')) {
        assert.ok(last);
        last.idempotent = true;
      }
    } else if (section === 'components:') {
      const name = /^ {4}([A-Za-z]+):$/.exec(line);
      const member = /^ {8}- ([A-Z0-9_]+)$/.exec(line);
      if (name) {
        schema = name[1];
      } else if (schema === 'ErrorCode' && member) {
        errorCodes.push(member[1]);
      }
    }
  }
  return { operations, errorCodes };
}

/** The members of the `ErrorCode` union, read from the source of common.ts (a type has no runtime value). */
function errorCodeUnion() {
  const lines = linesOf('./common.ts');
  const start = lines.findIndex(line =>
    line.startsWith('export type ErrorCode ='),
  );
  const end = lines.findIndex(
    (line, index) => index > start && line.endsWith(';'),
  );
  assert.ok(start >= 0 && end > start);
  return lines
    .slice(start, end + 1)
    .flatMap(line => /^ {2}[|] '([A-Z0-9_]+)';?$/.exec(line)?.[1] ?? []);
}

test('openapi.yaml has exactly the operations of OPERATIONS: same method, path, auth, key, order', () => {
  const key = (op: {
    method: string;
    path: string;
    auth: string;
    idempotent: boolean;
  }) => `${op.method} ${op.path} ${op.auth} ${op.idempotent}`;
  assert.deepEqual(scanOpenApi().operations.map(key), OPERATIONS.map(key));
});

test('every operation of openapi.yaml has an operationId of its own', () => {
  const ids = scanOpenApi().operations.map(operation => operation.operationId);
  assert.deepEqual(
    ids.filter((id, index) => id === '' || ids.indexOf(id) !== index),
    [],
  );
  assert.equal(ids.length, OPERATIONS.length);
});

test('the ErrorCode union equals the ErrorCode enum of openapi.yaml', () => {
  const union = errorCodeUnion();
  assert.ok(union.length > 0);
  assert.deepEqual(scanOpenApi().errorCodes.toSorted(), union.toSorted());
  assert.equal(new Set(union).size, union.length);
});
