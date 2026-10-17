// errors.ts, log.ts and session.ts on their own: no database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AppError, STATUS, errorResponse, refusalOf } from './errors.ts';
import { createLogger, describeError } from './log.ts';
import { bearerTokenHash, hashToken, newToken } from './session.ts';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('every error code has the status docs/api/openapi.yaml gives it', () => {
  // operation responses: the status at 8 spaces, then its description listing the codes
  const fromYaml = new Map<string, Set<number>>();
  let status: number | null = null;
  for (const line of read('../../docs/api/openapi.yaml').split(/\r?\n/)) {
    const response = /^ {8}'(\d{3})':$/.exec(line);
    if (response) {
      status = Number(response[1]);
      continue;
    }
    const description = /^ {10}description: (.*)$/.exec(line);
    if (status !== null && description) {
      for (const [, code] of description[1].matchAll(/`([A-Z_]+)`/g)) {
        fromYaml.set(code, (fromYaml.get(code) ?? new Set()).add(status));
      }
    }
    status = null;
  }
  const expected = Object.fromEntries(
    [...fromYaml].map(([code, statuses]) => [code, [...statuses]]),
  );
  const actual = Object.fromEntries(
    Object.entries(STATUS).map(([code, value]) => [code, [value]]),
  );
  assert.equal(Object.keys(actual).length, 58); // 57 + UNDO_COINS_SPENT (Task 37)
  assert.deepEqual(
    actual,
    Object.fromEntries(Object.keys(actual).map(c => [c, expected[c]])),
  );
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(actual).sort());
});

test('errorResponse: status of the code, a message made of the code, details only when there are some', () => {
  assert.deepEqual(errorResponse('DAY_CLOSED'), {
    status: 409,
    body: { error: { code: 'DAY_CLOSED', message: 'day closed' } },
  });
  assert.deepEqual(
    errorResponse('DAY_CLOSED', {}),
    errorResponse('DAY_CLOSED'),
  );
  assert.deepEqual(
    errorResponse('ARCHETYPE_COOLDOWN', { availableAt: 'x' }).body.error,
    {
      code: 'ARCHETYPE_COOLDOWN',
      message: 'archetype cooldown',
      details: { availableAt: 'x' },
    },
  );
});

test('refusalOf: AppError and HM000 name a code; anything else is nobody’s answer', () => {
  assert.deepEqual(
    refusalOf(new AppError('NOT_LEADER', { a: 1 })),
    errorResponse('NOT_LEADER', { a: 1 }),
  );
  const pgError = (fields: Record<string, unknown>) =>
    Object.assign(new Error(), fields);
  assert.deepEqual(
    refusalOf(
      pgError({ code: 'HM000', message: 'GUILD_FULL', detail: '{"max":8}' }),
    ),
    errorResponse('GUILD_FULL', { max: 8 }),
  );
  assert.deepEqual(
    refusalOf(pgError({ code: 'HM000', message: 'GUILD_FULL' })),
    errorResponse('GUILD_FULL'),
  );
  for (const thrown of [
    pgError({ code: 'P0001', message: 'GUILD_FULL' }), // the right word, not our SQLSTATE
    pgError({ code: 'HM000', message: 'guild_full' }),
    pgError({ code: 'HM000', message: 'toString' }), // a property every object has
    pgError({ code: 'HM000', message: '__proto__' }),
    new Error('DAY_CLOSED'),
    'DAY_CLOSED',
    null,
    undefined,
  ]) {
    assert.equal(refusalOf(thrown), null);
  }
});

test('log.ledger emits {evt, kind, userId, amount, reason, refId}, one JSON object per line', () => {
  const lines: string[] = [];
  const log = createLogger(line => lines.push(line));
  log.ledger({
    kind: 'xp',
    userId: 'u1',
    amount: 15,
    reason: 'JOURNAL',
    refId: '2026-10-12',
  });
  log.ledger({
    kind: 'coin',
    userId: 'u1',
    amount: -40,
    reason: 'PURCHASE',
    refId: 'HAT',
  });
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => !line.includes(String.fromCharCode(10))));
  const [xp, coin] = lines.map(line => JSON.parse(line));
  assert.ok(!Number.isNaN(Date.parse(xp.ts)));
  delete xp.ts;
  delete coin.ts;
  assert.deepEqual(xp, {
    evt: 'ledger',
    kind: 'xp',
    userId: 'u1',
    amount: 15,
    reason: 'JOURNAL',
    refId: '2026-10-12',
  });
  assert.deepEqual(coin, {
    evt: 'ledger',
    kind: 'coin',
    userId: 'u1',
    amount: -40,
    reason: 'PURCHASE',
    refId: 'HAT',
  });
});

test('describeError: class, code, catalog names and frames; never a message, a detail or a line of them', () => {
  const value = 'someone@example.com';
  const lf = String.fromCharCode(10);
  const frameOf = (described: Record<string, unknown>) =>
    String(described.stack).split(lf);

  const pgError = Object.assign(
    new Error(`invalid input syntax for type uuid: "${value}"`),
    {
      severity: 'ERROR',
      code: '22P02',
      detail: `Failing row contains (${value}).`,
      where: `unnamed portal parameter $1 = '${value}'`,
      routine: 'string_to_uuid',
      table: 'users',
      constraint: 'users_display_name_check',
    },
  );
  const described = describeError(pgError);
  assert.deepEqual(
    { ...described, stack: undefined },
    {
      error: 'Error',
      code: '22P02',
      schema: undefined,
      table: 'users',
      column: undefined,
      constraint: 'users_display_name_check',
      routine: 'string_to_uuid',
      stack: undefined,
    },
  );
  assert.ok(!JSON.stringify(described).includes(value));
  assert.ok(frameOf(described)[0].includes('errors.test.ts'));

  // the message of our own RAISE EXCEPTION is dropped like any other: a later one may quote input
  const raised = Object.assign(new Error(`auth: no account for ${value}`), {
    severity: 'ERROR',
    code: 'P0001',
  });
  assert.equal(describeError(raised).message, undefined);
  assert.ok(!JSON.stringify(describeError(raised)).includes(value));

  // errors of JavaScript itself quote their input too
  const cases: [string, () => unknown][] = [
    ['RangeError', () => new Intl.DateTimeFormat('en', { timeZone: value })],
    ['SyntaxError', () => BigInt(value)],
    ['SyntaxError', () => JSON.parse(`{"email": ${value}`)],
    ['TypeError', () => (undefined as unknown as { x: { y: 1 } }).x.y],
    [
      'Error',
      () => {
        // a message of several lines, the later ones dressed up as frames
        throw new Error(
          `mail${lf}    at ${value} (${value}:1:1)${lf}    at ${value}`,
        );
      },
    ],
    [
      'Error',
      () => {
        // a message put in after the stack was made
        const late = new Error('x');
        late.message = value;
        throw late;
      },
    ],
    [
      'Error',
      () => {
        // a code that is no code
        throw Object.assign(new Error(value), { code: `E ${value}` });
      },
    ],
  ];
  for (const [name, fail] of cases) {
    let thrown: unknown;
    try {
      fail();
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof Error, name);
    const kept = describeError(thrown);
    assert.equal(kept.error, name);
    assert.equal(kept.message, undefined);
    assert.ok(
      !JSON.stringify(kept).includes(value),
      `${name}: ${JSON.stringify(kept)}`,
    );
    assert.ok(
      frameOf(kept).every(row => row === '' || row.startsWith('    at ')),
      name,
    );
  }
  // where it happened is still there
  const here = describeError(new TypeError('x is not a function'));
  assert.ok(frameOf(here)[0].includes('errors.test.ts'));
  // an errno keeps its name
  assert.equal(
    describeError(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }))
      .code,
    'ECONNREFUSED',
  );
  assert.deepEqual(describeError('text'), { error: 'string' });
  assert.deepEqual(describeError(undefined), { error: 'undefined' });
});

test('bearerTokenHash: exactly "Bearer <43 base64url characters>"', () => {
  const token = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), token);
  assert.equal(hashToken(token).length, 32);
  assert.deepEqual(bearerTokenHash(`Bearer ${token}`), hashToken(token));
  for (const header of [
    undefined,
    '',
    token,
    `bearer ${token}`,
    `Bearer  ${token}`,
    `Bearer ${token} `,
    `Bearer ${token}=`,
    `Bearer ${token.slice(1)}`,
    `Bearer ${token.slice(1)}+`,
    `Bearer ${token}${String.fromCharCode(10)}`,
  ]) {
    assert.equal(bearerTokenHash(header), null, JSON.stringify(header));
  }
});
