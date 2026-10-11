// 10-auth.sql at the SQL level. Every call goes through app_conn with the real role switch, one
// request transaction per call; the admin pool only arranges fixtures and reads results back.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { PoolClient, QueryResult } from 'pg';
import {
  asAnon,
  asJob,
  asUser,
  expectPgError,
  setTestClock,
} from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

const AUTH_SQL = readFileSync(
  fileURLToPath(new URL('../sql/10-auth.sql', import.meta.url)),
  'utf8',
);

let db: TestDb;
before(async () => {
  db = await createTestDb();
});
after(() => db.drop());

const DENIED = '42501';
/** What the functions raise on purpose: MESSAGE is the error code of the API contract. */
const HM = 'HM000';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse('2027-01-10T00:00:00Z');
const instant = (offsetMs: number) => new Date(T0 + offsetMs);
const clock = (offsetMs: number) =>
  setTestClock(db.admin, instant(offsetMs).toISOString());

/** Runs with app.now() frozen at T0 (move it with `clock`), then returns to real time. */
async function frozen(work: () => Promise<void>): Promise<void> {
  try {
    await clock(0);
    await work();
  } finally {
    await setTestClock(db.admin, null);
  }
}

type Request = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;
const anon: Request = work => asAnon(db.app, work);
const job: Request = work => asJob(db.app, work);
const user =
  (id: string): Request =>
  work =>
    asUser(db.app, id, work);

const select = (fn: string, args: unknown[]) =>
  `SELECT ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS v`;

/** One committed request that calls one function; app_anon unless told otherwise. */
async function call<T = unknown>(
  fn: string,
  args: unknown[],
  as: Request = anon,
): Promise<T> {
  const { rows } = await as(c => c.query(select(fn, args), args));
  return rows[0].v;
}

const newEmail = () => `u${randomBytes(6).toString('hex')}@example.com`;

type Account = {
  id: string;
  email: string;
  salt: Buffer;
  key: Buffer;
  token: Buffer;
};

async function register(email = newEmail()): Promise<Account> {
  const account = {
    email,
    salt: randomBytes(16),
    key: randomBytes(32),
    token: randomBytes(32),
  };
  const id = await call<string>('auth_register', [
    email,
    'Mầm',
    account.salt,
    account.key,
    account.token,
  ]);
  return { id, ...account };
}

const salt = (email: string | null) => call<Buffer>('auth_salt', [email]);
const login = (
  email: string | null,
  key: Buffer,
  token: Buffer = randomBytes(32),
) => call<string | null>('auth_login', [email, key, token]);
const session = (token: Buffer) => call<string | null>('auth_session', [token]);

// what the route will send: the hash of the 6-digit code, bound to the email
const codeHash = (email: string, code: string) =>
  createHash('sha256').update(`${email}:${code}`).digest();
const requestReset = (email: string, code: string) =>
  call<boolean>('auth_reset_request', [email, codeHash(email, code)]);
const confirmReset = (
  email: string,
  code: string,
  newSalt = randomBytes(16),
  newKey = randomBytes(32),
) =>
  call<boolean>('auth_reset_confirm', [
    email,
    codeHash(email, code),
    newSalt,
    newKey,
  ]);

async function throttle(
  key: string,
): Promise<{ count: number; window_start: Date } | undefined> {
  const { rows } = await db.admin.query(
    'SELECT count, window_start FROM auth_throttle WHERE key = $1',
    [key],
  );
  return rows[0];
}

const softDelete = (id: string) =>
  db.admin.query(
    "UPDATE users SET deleted_at = app.now(), purge_after = app.now() + interval '30 days' WHERE id = $1",
    [id],
  );

/** Everything a caller can see of a result except the value itself. */
const shape = ({ rowCount, fields }: QueryResult) => ({
  rowCount,
  fields: fields.map(f => [f.name, f.dataTypeID]),
});

// ---------------------------------------------------------------- register, salt, login

test('register creates the user, the credentials and a 30-day session', async () => {
  await frozen(async () => {
    const a = await register();
    const { rows } = await db.admin.query(
      `SELECT u.email, u.display_name, u.timezone, u.archetype, u.terms_accepted_at, u.created_at,
              u.onboarded_at, u.deleted_at, u.purge_after, c.salt, c.key
         FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.id = $1`,
      [a.id],
    );
    assert.deepEqual(rows, [
      {
        email: a.email,
        display_name: 'Mầm',
        timezone: 'Asia/Ho_Chi_Minh',
        archetype: null,
        terms_accepted_at: instant(0),
        created_at: instant(0),
        onboarded_at: null,
        deleted_at: null,
        purge_after: null,
        salt: a.salt,
        key: a.key,
      },
    ]);
    const { rows: sessions } = await db.admin.query(
      'SELECT token_hash, expires_at, revoked_at FROM sessions WHERE user_id = $1',
      [a.id],
    );
    assert.deepEqual(sessions, [
      { token_hash: a.token, expires_at: instant(30 * DAY), revoked_at: null },
    ]);
    assert.equal(await session(a.token), a.id);
  });
});

test('login: the right key returns the user; a wrong key and an unknown email return the same null', async () => {
  const a = await register();
  const attempt = (email: string, key: Buffer, token = randomBytes(32)) =>
    anon(c => c.query('SELECT auth_login($1, $2, $3)', [email, key, token]));

  const token = randomBytes(32);
  const right = await attempt(a.email, a.key, token);
  const wrong = await attempt(a.email, randomBytes(32));
  const unknown = await attempt(newEmail(), a.key);

  assert.deepEqual(right.rows, [{ auth_login: a.id }]);
  assert.equal(await session(token), a.id);
  for (const refused of [wrong, unknown]) {
    assert.deepEqual(refused.rows, [{ auth_login: null }]);
    assert.deepEqual(shape(refused), shape(right));
  }
  // a deleted account answers like one that never existed
  await softDelete(a.id);
  const deleted = await attempt(a.email, a.key);
  assert.deepEqual(deleted.rows, [{ auth_login: null }]);
  assert.deepEqual(shape(deleted), shape(right));
});

test('auth_salt: the stored salt for a live account, otherwise a stable fake that differs per email', async () => {
  const a = await register();
  assert.deepEqual(await salt(a.email), a.salt);

  const [x, y] = [newEmail(), newEmail()];
  const fake = await salt(x);
  assert.equal(fake.length, 16);
  assert.deepEqual(await salt(x), fake);
  assert.notDeepEqual(await salt(y), fake);
  // the stated rule, applied by the owner: first 16 bytes of sha256(pepper || email)
  const expected = (email: string) =>
    db.admin
      .query(
        `SELECT substring(sha256(value || convert_to($1, 'UTF8')) FROM 1 FOR 16) AS v
           FROM app_secrets WHERE name = 'fake_salt_pepper'`,
        [email],
      )
      .then(r => r.rows[0].v as Buffer);
  assert.deepEqual(fake, await expected(x));

  // a deleted account gets the fake of its email, not its stored salt
  await softDelete(a.id);
  assert.deepEqual(await salt(a.email), await expected(a.email));
  assert.notDeepEqual(await salt(a.email), a.salt);
});

test('without the pepper auth_salt raises instead of answering null for an unknown email', async () => {
  const a = await register();
  const owner = await db.admin.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('DELETE FROM app_secrets');
    await owner.query('SET LOCAL ROLE app_anon');
    // login needs no fake: an unknown email is refused, a known one still gets in
    const args = (email: string) => [email, a.key, randomBytes(32)];
    const call3 = 'SELECT auth_login($1, $2, $3) AS v';
    assert.equal((await owner.query(call3, args(newEmail()))).rows[0].v, null);
    assert.equal((await owner.query(call3, args(a.email))).rows[0].v, a.id);
    await expectPgError(owner.query('SELECT auth_salt($1)', [newEmail()]), {
      code: 'P0001',
      messagePrefix: 'auth_salt: app_secrets has no fake_salt_pepper',
    });
  } finally {
    await owner.query('ROLLBACK');
    owner.release();
  }
  assert.deepEqual(await salt(a.email), a.salt);
});

test('the email is trimmed and lower-cased inside every function, non-ASCII letters included', async () => {
  const tag = randomBytes(4).toString('hex');
  const stored = `đặng.văn+${tag}@example.com`;
  const typed = `  ĐẶNG.Văn+${tag.toUpperCase()}@Example.COM `;
  // PostgreSQL lower() under the ICU collation and JavaScript agree on these letters
  assert.equal(typed.trim().toLowerCase(), stored);

  const a = await register(typed);
  const { rows } = await db.admin.query(
    'SELECT email FROM users WHERE id = $1',
    [a.id],
  );
  assert.equal(rows[0].email, stored);
  for (const spelling of [stored, typed, stored.toUpperCase()]) {
    assert.deepEqual(await salt(spelling), a.salt);
    assert.equal(await login(spelling, a.key), a.id);
    await expectPgError(register(spelling), {
      code: HM,
      messagePrefix: 'REGISTRATION_UNAVAILABLE',
    });
  }
  assert.equal(await requestReset(typed, '123456'), true);
  // the hash is the caller's; the email it is checked under is normalised here
  const newKey = randomBytes(32);
  assert.equal(
    await call('auth_reset_confirm', [
      stored.toUpperCase(),
      codeHash(typed, '123456'),
      randomBytes(16),
      newKey,
    ]),
    true,
  );
  assert.equal(await login(stored, newKey), a.id);
});

test('an empty or over-long email is the uniform failure, and leaves no throttle row', async () => {
  const long = `${'a'.repeat(243)}@example.com`; // 255 characters
  assert.equal(long.length, 255);
  const countBefore = await db.admin.query(
    'SELECT count(*) FROM auth_throttle',
  );
  for (const email of ['', '   ', long, null]) {
    assert.equal((await salt(email)).length, 16);
    assert.equal(await login(email, randomBytes(32)), null);
    assert.equal(
      await call('auth_reset_request', [email, randomBytes(32)]),
      false,
    );
    assert.equal(
      await call('auth_reset_confirm', [
        email,
        randomBytes(32),
        randomBytes(16),
        randomBytes(32),
      ]),
      false,
    );
    // register is the one function that raises: the route validated the email before
    const refused = call('auth_register', [
      email,
      'x',
      randomBytes(16),
      randomBytes(32),
      randomBytes(32),
    ]);
    await expectPgError(refused, {
      code: HM,
      messagePrefix: 'VALIDATION_FAILED',
    });
    const { detail } = (await refused.catch(e => e)) as { detail: string };
    assert.deepEqual(JSON.parse(detail), {
      fields: [{ field: 'email', rule: 'format' }],
    });
  }
  const countAfter = await db.admin.query('SELECT count(*) FROM auth_throttle');
  assert.deepEqual(countAfter.rows, countBefore.rows);
  // 254 characters is still an email
  const a = await register(`${'a'.repeat(242)}@example.com`);
  assert.equal(await login(a.email, a.key), a.id);
});

test('register refuses an email in use, also the email of a deleted account', async () => {
  const a = await register();
  const refusal = { code: HM, messagePrefix: 'REGISTRATION_UNAVAILABLE' };
  await expectPgError(register(a.email), refusal);
  await expectPgError(register(a.email.toUpperCase()), refusal);
  await softDelete(a.id);
  await expectPgError(register(a.email), refusal);
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS n FROM users WHERE lower(email) = $1',
    [a.email],
  );
  assert.equal(rows[0].n, 1);
});

test('register checks every argument before it writes anything', async () => {
  const email = newEmail();
  const args = (change: Record<number, unknown>) =>
    Object.assign(
      [email, 'Mầm', randomBytes(16), randomBytes(32), randomBytes(32)],
      change,
    );
  const invalidName = (rule: string) => async (name: string | null) => {
    const refused = call('auth_register', args({ 1: name }));
    await expectPgError(refused, {
      code: HM,
      messagePrefix: 'VALIDATION_FAILED',
    });
    const { detail } = (await refused.catch(e => e)) as { detail: string };
    assert.deepEqual(JSON.parse(detail), {
      fields: [{ field: 'displayName', rule }],
    });
  };
  await invalidName('min')('');
  await invalidName('min')(null);
  await invalidName('max')('x'.repeat(41));
  // a wrong byte length is a bug of the server, not of the user: a plain exception that names
  // the sizes and carries no value
  for (const change of [
    { 2: randomBytes(15) },
    { 3: randomBytes(31) },
    { 4: randomBytes(33) },
    { 2: null },
    { 3: null },
    { 4: null },
  ]) {
    await expectPgError(call('auth_register', args(change)), {
      code: 'P0001',
      messagePrefix:
        'auth_register: salt must be 16 bytes, key and token hash 32 bytes each',
    });
  }
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS n FROM users WHERE email = $1',
    [email],
  );
  assert.equal(rows[0].n, 0);
  // 40 characters (not bytes) is a valid name
  assert.match(
    await call<string>('auth_register', args({ 1: 'ầ'.repeat(40) })),
    /^[0-9a-f-]{36}$/,
  );
});

test('five failed logins lock the email until its 15-minute window ends; a success clears the count', async () => {
  await frozen(async () => {
    const [a, b] = [await register(), await register()];
    const wrong = () => login(a.email, randomBytes(32));

    // four failures, then the right key: in, and the slate is clean
    for (let i = 0; i < 4; i++) {
      assert.equal(await login(b.email, randomBytes(32)), null);
    }
    assert.equal((await throttle(`login:${b.email}`))?.count, 4);
    assert.equal(await login(b.email, b.key), b.id);
    assert.equal(await throttle(`login:${b.email}`), undefined);

    await clock(1 * MINUTE);
    for (let i = 0; i < 5; i++) {
      assert.equal(await wrong(), null);
    }
    assert.equal(await login(a.email, a.key), null);
    // attempts while locked do not move the window
    await clock(15 * MINUTE + 59 * SECOND);
    assert.equal(await login(a.email, a.key), null);
    assert.deepEqual(
      (await throttle(`login:${a.email}`))?.window_start,
      instant(1 * MINUTE),
    );
    await clock(16 * MINUTE);
    assert.equal(await login(a.email, a.key), a.id);
    assert.equal(await throttle(`login:${a.email}`), undefined);
    // no session was opened by the refused attempts: the one of register and the last login
    const { rows } = await db.admin.query(
      'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1',
      [a.id],
    );
    assert.equal(rows[0].n, 2);
  });
});

test('failed logins are counted for an unknown email too, and only when the caller commits', async () => {
  const unknown = newEmail();
  for (let i = 0; i < 3; i++) {
    assert.equal(await login(unknown, randomBytes(32)), null);
  }
  // read from another transaction, after the COMMIT of the failing calls
  assert.equal((await throttle(`login:${unknown}`))?.count, 3);

  // the reason a route returns its 401 instead of throwing it: a rollback forgets the attempt
  await assert.rejects(
    anon(async c => {
      await c.query('SELECT auth_login($1, $2, $3)', [
        unknown,
        randomBytes(32),
        randomBytes(32),
      ]);
      throw new Error('handler threw');
    }),
    /handler threw/,
  );
  assert.equal((await throttle(`login:${unknown}`))?.count, 3);
});

test('failed logins sent at the same moment are all counted', async () => {
  const a = await register();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => login(a.email, randomBytes(32))),
  );
  assert.deepEqual(results, Array(8).fill(null));
  assert.equal((await throttle(`login:${a.email}`))?.count, 8);
  assert.equal(await login(a.email, a.key), null);
});

test('login refuses a key or token hash of the wrong size before it counts anything', async () => {
  const a = await register();
  const refusal = {
    code: 'P0001',
    messagePrefix: 'auth_login: key and token hash must be 32 bytes each',
  };
  await expectPgError(login(a.email, randomBytes(31)), refusal);
  await expectPgError(login(a.email, a.key, randomBytes(16)), refusal);
  await expectPgError(call('auth_login', [a.email, null, null]), refusal);
  assert.equal(await throttle(`login:${a.email}`), undefined);
  // a token hash that already names a session is refused without echoing it
  const reused = login(a.email, a.key, a.token);
  await expectPgError(reused, {
    code: 'P0001',
    messagePrefix: 'auth: this token hash already names a session',
  });
  const error = (await reused.catch(e => e)) as Error;
  const said = JSON.stringify([error.message, ...Object.values(error)]);
  assert.match(said, /already names a session/);
  assert.equal(said.includes(a.token.toString('hex')), false);
});

// ---------------------------------------------------------------- sessions

test('a session is valid for 30 days and slides once less than 29 days remain', async () => {
  await frozen(async () => {
    const [a, b, c, d] = [
      await register(),
      await register(),
      await register(),
      await register(),
    ];
    const expiry = async (token: Buffer) =>
      (
        await db.admin.query(
          'SELECT expires_at FROM sessions WHERE token_hash = $1',
          [token],
        )
      ).rows[0].expires_at as Date;

    await clock(12 * HOUR);
    assert.equal(await session(a.token), a.id);
    assert.deepEqual(await expiry(a.token), instant(30 * DAY));
    await clock(2 * DAY);
    assert.equal(await session(a.token), a.id);
    assert.deepEqual(await expiry(a.token), instant(32 * DAY));

    await clock(30 * DAY - SECOND);
    assert.equal(await session(d.token), d.id);
    await clock(30 * DAY);
    assert.equal(await session(b.token), null);
    await clock(31 * DAY);
    assert.equal(await session(c.token), null);
    // an expired session is not revived by the call that found it expired
    assert.deepEqual(await expiry(c.token), instant(30 * DAY));
    // the one that kept sliding is still alive
    assert.equal(await session(a.token), a.id);
    assert.deepEqual(await expiry(a.token), instant(61 * DAY));
  });
});

test('logout revokes exactly that session, for an anonymous and for a signed-in caller', async () => {
  const a = await register();
  const second = randomBytes(32);
  const third = randomBytes(32);
  assert.equal(await login(a.email, a.key, second), a.id);
  assert.equal(await login(a.email, a.key, third), a.id);

  await call('auth_logout', [a.token]);
  assert.equal(await session(a.token), null);
  assert.equal(await session(second), a.id);
  // the logout route runs with a session, as app_auth
  await call('auth_logout', [second], user(a.id));
  assert.equal(await session(second), null);
  assert.equal(await session(third), a.id);
  // a hash that names no session, or a revoked one: nothing happens, nothing is raised
  await call('auth_logout', [randomBytes(32)]);
  await call('auth_logout', [a.token]);

  const unknown = await anon(c =>
    c.query('SELECT auth_session($1)', [randomBytes(32)]),
  );
  const revoked = await anon(c =>
    c.query('SELECT auth_session($1)', [a.token]),
  );
  const valid = await anon(c => c.query('SELECT auth_session($1)', [third]));
  assert.deepEqual(valid.rows, [{ auth_session: a.id }]);
  for (const refused of [unknown, revoked]) {
    assert.deepEqual(refused.rows, [{ auth_session: null }]);
    assert.deepEqual(shape(refused), shape(valid));
  }
});

test('the session of a deleted user is dead', async () => {
  const a = await register();
  assert.equal(await session(a.token), a.id);
  await softDelete(a.id);
  assert.equal(await session(a.token), null);
});

// ---------------------------------------------------------------- password reset

test('reset: a code confirms once and replaces salt and key', async () => {
  const a = await register();
  assert.equal(await requestReset(a.email, '111111'), true);
  const { rows } = await db.admin.query(
    'SELECT code_hash, attempts, used_at FROM reset_codes WHERE user_id = $1',
    [a.id],
  );
  assert.deepEqual(rows, [
    { code_hash: codeHash(a.email, '111111'), attempts: 0, used_at: null },
  ]);

  const [newSalt, newKey] = [randomBytes(16), randomBytes(32)];
  assert.equal(await confirmReset(a.email, '111111', newSalt, newKey), true);
  assert.deepEqual(await salt(a.email), newSalt);
  assert.equal(await login(a.email, a.key), null);
  assert.equal(await login(a.email, newKey), a.id);
  // the same code a second time
  assert.equal(await confirmReset(a.email, '111111'), false);
  assert.deepEqual(await salt(a.email), newSalt);
});

test('reset: success revokes every session and lifts the login lock', async () => {
  const a = await register();
  const second = randomBytes(32);
  assert.equal(await login(a.email, a.key, second), a.id);
  for (let i = 0; i < 5; i++) {
    assert.equal(await login(a.email, randomBytes(32)), null);
  }
  assert.equal(await login(a.email, a.key), null);

  const newKey = randomBytes(32);
  assert.equal(await requestReset(a.email, '222222'), true);
  assert.equal(
    await confirmReset(a.email, '222222', randomBytes(16), newKey),
    true,
  );
  assert.equal(await session(a.token), null);
  assert.equal(await session(second), null);
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
    [a.id],
  );
  assert.equal(rows[0].n, 0);
  assert.equal(await throttle(`login:${a.email}`), undefined);
  assert.equal(await login(a.email, newKey), a.id);
});

test('reset: a code takes five attempts; from the sixth call on the right code fails too', async () => {
  const attempts = async (id: string) =>
    (
      await db.admin.query(
        'SELECT attempts FROM reset_codes WHERE user_id = $1',
        [id],
      )
    ).rows[0].attempts as number;

  for (const [wrongCalls, outcome] of [
    [4, true],
    [5, false],
    [6, false],
  ] as const) {
    const a = await register();
    assert.equal(await requestReset(a.email, '333333'), true);
    for (let i = 0; i < wrongCalls; i++) {
      assert.equal(await confirmReset(a.email, '000000'), false);
    }
    // each failing call committed its attempt
    assert.equal(await attempts(a.id), wrongCalls);
    assert.equal(await confirmReset(a.email, '333333'), outcome);
    assert.equal(await attempts(a.id), wrongCalls + 1);
    assert.equal(await login(a.email, a.key), outcome ? null : a.id);
  }
});

test('reset: a code expires after ten minutes', async () => {
  await frozen(async () => {
    const [a, b] = [await register(), await register()];
    assert.equal(await requestReset(a.email, '444444'), true);
    assert.equal(await requestReset(b.email, '444444'), true);
    await clock(10 * MINUTE - SECOND);
    assert.equal(await confirmReset(a.email, '444444'), true);
    await clock(10 * MINUTE);
    assert.equal(await confirmReset(b.email, '444444'), false);
    await clock(11 * MINUTE);
    assert.equal(await confirmReset(b.email, '444444'), false);
    assert.equal(await login(b.email, b.key), b.id);
  });
});

test('reset: three requests per email per hour, and a newer code replaces the older one', async () => {
  await frozen(async () => {
    const a = await register();
    assert.equal(await requestReset(a.email, '000001'), true);
    assert.equal(await requestReset(a.email, '000002'), true);
    assert.equal(await requestReset(a.email, '000003'), true);
    assert.equal(await requestReset(a.email, '000004'), false);
    await clock(HOUR - SECOND);
    assert.equal(await requestReset(a.email, '000005'), false);
    assert.equal((await throttle(`reset:${a.email}`))?.count, 5);
    // the refused requests stored nothing and invalidated nothing
    const { rows } = await db.admin.query(
      'SELECT code_hash, used_at IS NULL AS live FROM reset_codes WHERE user_id = $1 ORDER BY created_at, used_at NULLS LAST',
      [a.id],
    );
    assert.deepEqual(
      rows.map(row => row.live),
      [false, false, true],
    );
    assert.deepEqual(rows[2].code_hash, codeHash(a.email, '000003'));

    await clock(HOUR);
    assert.equal(await requestReset(a.email, '000006'), true);
    assert.equal((await throttle(`reset:${a.email}`))?.count, 1);
    // only the newest code counts: an older one is a wrong code
    assert.equal(await confirmReset(a.email, '000003'), false);
    assert.equal(await confirmReset(a.email, '000006'), true);
  });
});

test('reset: an unknown or deleted account gets false, and the request is counted all the same', async () => {
  const unknown = newEmail();
  const gone = await register();
  await softDelete(gone.id);
  const live = await register();

  const request = (email: string) =>
    anon(c =>
      c.query('SELECT auth_reset_request($1, $2)', [
        email,
        codeHash(email, '555555'),
      ]),
    );
  const accepted = await request(live.email);
  assert.deepEqual(accepted.rows, [{ auth_reset_request: true }]);
  for (const email of [unknown, gone.email]) {
    const refused = await request(email);
    assert.deepEqual(refused.rows, [{ auth_reset_request: false }]);
    assert.deepEqual(shape(refused), shape(accepted));
    assert.equal((await throttle(`reset:${email}`))?.count, 1);
    assert.equal(await confirmReset(email, '555555'), false);
  }
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS n FROM reset_codes WHERE user_id = $1',
    [gone.id],
  );
  assert.equal(rows[0].n, 0);
  // a code requested before the account was deleted dies with it
  assert.equal(await softDelete(live.id).then(r => r.rowCount), 1);
  assert.equal(await confirmReset(live.email, '555555'), false);
  // no code was ever requested
  const quiet = await register();
  assert.equal(await confirmReset(quiet.email, '555555'), false);
});

test('reset: a wrong byte length is refused before any attempt is spent', async () => {
  const a = await register();
  assert.equal(await requestReset(a.email, '666666'), true);
  const hash = codeHash(a.email, '666666');
  await expectPgError(call('auth_reset_request', [a.email, randomBytes(31)]), {
    code: 'P0001',
    messagePrefix: 'auth_reset_request: code hash must be 32 bytes',
  });
  for (const args of [
    [a.email, randomBytes(31), randomBytes(16), randomBytes(32)],
    [a.email, hash, randomBytes(17), randomBytes(32)],
    [a.email, hash, randomBytes(16), randomBytes(31)],
    [a.email, hash, null, null],
  ]) {
    await expectPgError(call('auth_reset_confirm', args), {
      code: 'P0001',
      messagePrefix:
        'auth_reset_confirm: code hash and key must be 32 bytes each, salt 16 bytes',
    });
  }
  assert.equal((await throttle(`reset:${a.email}`))?.count, 1);
  assert.equal(await confirmReset(a.email, '666666'), true);
});

test('a login in flight cannot keep its session past a password reset', async () => {
  const a = await register();
  assert.equal(await requestReset(a.email, '777777'), true);
  const token = randomBytes(32);
  let resetDone = false;
  let reset: Promise<boolean> | undefined;

  // the login has returned the user id but its request has not committed yet
  const inFlight = await db.app.connect();
  try {
    await inFlight.query('BEGIN');
    await inFlight.query('SET LOCAL ROLE app_anon');
    const { rows } = await inFlight.query(
      'SELECT auth_login($1, $2, $3) AS v',
      [a.email, a.key, token],
    );
    assert.equal(rows[0].v, a.id);

    reset = confirmReset(a.email, '777777').finally(() => {
      resetDone = true;
    });
    await sleep(300);
    assert.equal(resetDone, false, 'the reset waits for the login');
    await inFlight.query('COMMIT');
  } finally {
    await inFlight.query('ROLLBACK').catch(() => {});
    inFlight.release();
    await reset?.catch(() => {});
  }
  assert.equal(await reset, true);
  assert.equal(await session(token), null);
  assert.equal(await session(a.token), null);
});

// ---------------------------------------------------------------- fences

test('fence: credentials, sessions, reset codes, throttle and secrets are closed to every request role', async () => {
  const a = await register();
  const tables = [
    'credentials',
    'sessions',
    'reset_codes',
    'auth_throttle',
    'app_secrets',
  ];
  for (const table of tables) {
    const refusal = {
      code: DENIED,
      messagePrefix: `permission denied for table ${table}`,
    };
    for (const as of [user(a.id), anon, job]) {
      await expectPgError(
        as(c => c.query(`SELECT * FROM ${table}`)),
        refusal,
      );
      await expectPgError(
        as(c => c.query(`DELETE FROM ${table}`)),
        refusal,
      );
    }
  }
  // a signed-in user cannot mint a session or plant credentials
  await expectPgError(
    user(a.id)(c =>
      c.query(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, app.now() + interval '1 day')",
        [a.id, randomBytes(32)],
      ),
    ),
    { code: DENIED, messagePrefix: 'permission denied for table sessions' },
  );
  await expectPgError(
    user(a.id)(c =>
      c.query('UPDATE credentials SET key = $2 WHERE user_id = $1', [
        a.id,
        randomBytes(32),
      ]),
    ),
    { code: DENIED, messagePrefix: 'permission denied for table credentials' },
  );
});

test('fence: a user sees and edits only the own users row, and only display name and timezone', async () => {
  const [a, b] = [await register(), await register()];
  const asA = user(a.id);
  const denied = {
    code: DENIED,
    messagePrefix: 'permission denied for table users',
  };

  // row level security: B exists, A does not find it
  const { rows } = await asA(c => c.query('SELECT id, email FROM users'));
  assert.deepEqual(rows, [{ id: a.id, email: a.email }]);
  const other = await asA(c =>
    c.query('SELECT 1 FROM users WHERE id = $1', [b.id]),
  );
  assert.equal(other.rowCount, 0);
  const stranger = await user(randomUUID())(c =>
    c.query('SELECT 1 FROM users'),
  );
  assert.equal(stranger.rowCount, 0);

  // column grant: every column but the two is closed, at the GRANT level
  for (const column of [
    'id',
    'email',
    'archetype',
    'archetype_set_at',
    'onboarded_at',
    'terms_accepted_at',
    'deleted_at',
    'purge_after',
    'created_at',
  ]) {
    await expectPgError(
      asA(c => c.query(`UPDATE users SET ${column} = NULL`)),
      denied,
    );
  }
  await expectPgError(
    asA(c => c.query("UPDATE users SET archetype = 'TANKER'")),
    denied,
  );
  await expectPgError(
    asA(c =>
      c.query(
        "INSERT INTO users (email, display_name, terms_accepted_at) VALUES ('x@example.com', 'x', app.now())",
      ),
    ),
    denied,
  );
  await expectPgError(
    asA(c => c.query('DELETE FROM users')),
    denied,
  );

  // the two columns: own row yes, another user's row is not there to update
  const own = await asA(c =>
    c.query("UPDATE users SET display_name = 'A mới'"),
  );
  assert.equal(own.rowCount, 1);
  const foreign = await asA(c =>
    c.query("UPDATE users SET display_name = 'bị sửa' WHERE id = $1", [b.id]),
  );
  assert.equal(foreign.rowCount, 0);
  const names = await db.admin.query(
    'SELECT id, display_name FROM users WHERE id = ANY ($1) ORDER BY display_name',
    [[a.id, b.id]],
  );
  assert.deepEqual(names.rows, [
    { id: a.id, display_name: 'A mới' },
    { id: b.id, display_name: 'Mầm' },
  ]);
  // the length rule holds on this path too
  await expectPgError(
    asA(c => c.query('UPDATE users SET display_name = $1', ['x'.repeat(41)])),
    {
      code: '23514',
      messagePrefix:
        'new row for relation "users" violates check constraint "users_display_name_check"',
    },
  );

  // the other request roles hold nothing on the table
  for (const as of [anon, job]) {
    await expectPgError(
      as(c => c.query('SELECT * FROM users')),
      denied,
    );
  }
});

test('fence: each auth function runs for its roles only; helpers run for none; plain app_conn stops at the schema', async () => {
  const a = await register();
  const email = newEmail();
  const [b16, b32] = [randomBytes(16), randomBytes(32)];
  const anonOnly: [string, unknown[]][] = [
    ['auth_salt', [email]],
    ['auth_register', [email, 'x', b16, b32, b32]],
    ['auth_login', [email, b32, b32]],
    ['auth_session', [b32]],
    ['auth_reset_request', [email, b32]],
    ['auth_reset_confirm', [email, b32, b16, b32]],
  ];
  const helpers: [string, unknown[]][] = [
    ['app._email', [email]],
    ['app._same_bytes', [b32, b32]],
    ['app._throttle_hit', [`login:${a.email}`, '15 minutes']],
    ['app._session_open', [a.id, b32]],
  ];
  const refusal = (fn: string) => ({
    code: DENIED,
    messagePrefix: `permission denied for function ${fn.replace('app.', '')}`,
  });
  for (const [fn, args] of anonOnly) {
    await expectPgError(call(fn, args, user(a.id)), refusal(fn));
    await expectPgError(call(fn, args, job), refusal(fn));
  }
  await expectPgError(call('auth_logout', [b32], job), refusal('auth_logout'));
  for (const [fn, args] of helpers) {
    for (const as of [anon, user(a.id), job]) {
      await expectPgError(call(fn, args, as), refusal(fn));
    }
  }
  // nothing above went through: no account, no session, no counter
  const { rows } = await db.admin.query(
    `SELECT (SELECT count(*) FROM users WHERE email = $1)::int AS users,
            (SELECT count(*) FROM sessions WHERE token_hash = $2)::int AS sessions,
            (SELECT count(*) FROM auth_throttle WHERE key LIKE '%' || $1)::int AS counters`,
    [email, b32],
  );
  assert.deepEqual(rows, [{ users: 0, sessions: 0, counters: 0 }]);

  // without SET LOCAL ROLE the connection cannot even name the function
  await expectPgError(
    db.app.query('SELECT public.auth_login($1, $2, $3)', [a.email, a.key, b32]),
    { code: DENIED, messagePrefix: 'permission denied for schema public' },
  );
  assert.equal(await session(b32), null);
});

test('fence: users.timezone takes only a name PostgreSQL lists, on every write path', async () => {
  const a = await register();
  const asA = user(a.id);
  const refusal = {
    code: '23503',
    messagePrefix:
      'insert or update on table "users" violates foreign key constraint "users_timezone_fkey"',
  };
  for (const zone of [
    '+07:00',
    'ICT',
    'UTC+7',
    'Not/AZone',
    '',
    'asia/ho_chi_minh',
  ]) {
    await expectPgError(
      asA(c => c.query('UPDATE users SET timezone = $1', [zone])),
      refusal,
    );
    // the owner's path too: seeders, decoys, later functions
    await expectPgError(
      db.admin.query(
        'INSERT INTO users (email, display_name, timezone, terms_accepted_at) VALUES ($1, $2, $3, app.now())',
        [newEmail(), 'x', zone],
      ),
      refusal,
    );
  }
  for (const zone of ['Europe/Berlin', 'Asia/Ho_Chi_Minh']) {
    const updated = await asA(c =>
      c.query('UPDATE users SET timezone = $1 RETURNING timezone', [zone]),
    );
    assert.deepEqual(updated.rows, [{ timezone: zone }]);
  }

  // the list is PostgreSQL's own, readable by a signed-in user and writable by no request role
  const drift = await db.admin.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE t.name IS NULL OR z.name IS NULL)::int AS differing
       FROM timezones t FULL JOIN pg_timezone_names z ON z.name = t.name`,
  );
  assert.equal(drift.rows[0].differing, 0);
  assert.ok(drift.rows[0].n > 300);
  const listed = await asA(c =>
    c.query("SELECT name FROM timezones WHERE name = 'Asia/Ho_Chi_Minh'"),
  );
  assert.equal(listed.rowCount, 1);
  const denied = {
    code: DENIED,
    messagePrefix: 'permission denied for table timezones',
  };
  await expectPgError(
    asA(c => c.query("INSERT INTO timezones (name) VALUES ('ICT')")),
    denied,
  );
  await expectPgError(
    asA(c => c.query('DELETE FROM timezones')),
    denied,
  );
  for (const as of [anon, job]) {
    await expectPgError(
      as(c => c.query('SELECT * FROM timezones')),
      denied,
    );
  }
});

test('fence: the owner cannot store an email that is not trimmed and lower-cased', async () => {
  for (const email of [' a@example.com', 'A@example.com', '']) {
    await expectPgError(
      db.admin.query(
        'INSERT INTO users (email, display_name, terms_accepted_at) VALUES ($1, $2, app.now())',
        [email, 'x'],
      ),
      {
        code: '23514',
        messagePrefix:
          'new row for relation "users" violates check constraint "users_email_check"',
      },
    );
  }
});

// ---------------------------------------------------------------- the file itself

test('10-auth.sql applies again on a live database: same pepper, accounts keep working', async () => {
  const peppers = () =>
    db.admin
      .query('SELECT name, value FROM app_secrets')
      .then(r => r.rows as { name: string; value: Buffer }[]);
  const secrets = await peppers();
  assert.deepEqual(
    secrets.map(row => [row.name, row.value.length]),
    [['fake_salt_pepper', 32]],
  );
  const a = await register();
  const fake = await salt('nobody@example.com');

  await db.admin.query(AUTH_SQL);

  assert.deepEqual(await peppers(), secrets);
  assert.deepEqual(await salt('nobody@example.com'), fake);
  assert.equal(await session(a.token), a.id);
  assert.equal(await login(a.email, a.key), a.id);
});

test('10-auth.sql reads time only through app.now() and builds no statement from data', () => {
  const code = AUTH_SQL.replace(/--.*$/gm, '');
  assert.ok(code.includes('app.now()'));
  assert.deepEqual(
    code.match(
      /(?<!app\.)\bnow\s*\(|clock_timestamp|statement_timestamp|transaction_timestamp|timeofday|localtime|current_(timestamp|date|time)/gi,
    ),
    null,
  );
  // dynamic SQL: EXECUTE (other than the privilege name in GRANT EXECUTE ON) and format()
  assert.deepEqual(code.match(/\bEXECUTE\s+(?!ON\b)\S+|\bformat\s*\(/gi), null);
});
