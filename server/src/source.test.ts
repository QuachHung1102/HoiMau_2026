// Rules about the server's own source, checked by reading it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const LF = String.fromCharCode(10);

/** Every source file under src that is not a test, as a path with forward slashes. */
const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .map(name => relative(SRC, join(SRC, name)).split(sep).join('/'))
  .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort();

/**
 * Transaction control and role switching, as sequences of words. The text is cut into words at
 * everything that is not a letter or an underscore and compared without regard to case, so a
 * statement is found however it is spaced, quoted or broken over lines, in code and in comments.
 */
const FORBIDDEN = [
  'SET ROLE',
  'SET LOCAL ROLE',
  'SET SESSION ROLE',
  'RESET ROLE',
  'SESSION AUTHORIZATION',
  'SET_CONFIG',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'START TRANSACTION',
  'SAVEPOINT',
];

function found(text: string): string[] {
  const words = ` ${text
    .toUpperCase()
    .split(/[^A-Z_]+/)
    .join(' ')} `;
  return FORBIDDEN.filter(phrase => words.includes(` ${phrase} `));
}

test('only db.ts writes transaction control or a role switch; routes never manage the transaction', () => {
  assert.ok(sources.includes('app.ts') && sources.includes('routes/meta.ts'));
  // the control: the scan does see such text where it is allowed
  const inDb = found(readFileSync(join(SRC, 'db.ts'), 'utf8'));
  for (const phrase of [
    'SET LOCAL ROLE',
    'SET_CONFIG',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
  ]) {
    assert.ok(inDb.includes(phrase), phrase);
  }
  assert.deepEqual(
    found(['await db.query(`commit;', '  set', ' role app_auth`)'].join(LF)),
    ['SET ROLE', 'COMMIT'],
  );
  assert.deepEqual(
    found('recommit, beginKey, idempotency_begin, rolled back'),
    [],
  );

  // db.ts: the request transaction. migrate.ts: the schema owner's own, never a request's.
  const allowed = ['db.ts', 'migrate.ts'];
  const offenders = sources
    .filter(name => !allowed.includes(name))
    .map(name => ({
      name,
      found: found(readFileSync(join(SRC, name), 'utf8')),
    }))
    .filter(file => file.found.length > 0);
  assert.deepEqual(offenders, []);
});
