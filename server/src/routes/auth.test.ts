// The five auth routes over HTTP, on the real database. Every test registers its own users.
import assert from 'node:assert/strict';
import crypto, { randomBytes } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { after, before, mock, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { LIMITS, normalizePassword } from '../../../domain/validation.ts';
import { setTestClock } from '../../test/helpers.ts';
import { newUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import type { Route } from '../app.ts';
import { deriveKey, scryptGate } from '../password.ts';
import { hashToken, newToken } from '../session.ts';
import {
  RESET_MAIL_SUBJECT,
  checkForgot,
  checkLogin,
  checkRegister,
  checkReset,
  newResetCode,
  resetCodeHash,
} from './auth.ts';

const NUL = String.fromCharCode(0);
const RLM = String.fromCharCode(0x200f); // right-to-left mark: invisible
const BEL = String.fromCharCode(7);
const NBSP = String.fromCharCode(0xa0);
const FULLWIDTH_AT = String.fromCharCode(0xff20);
const SOFT_HYPHEN = String.fromCharCode(0xad);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const PASSWORD = 'mật-khẩu-của-tôi-1';
const NEW_PASSWORD = 'mật-khẩu-mới-của-tôi-2';
const MINUTE = 60_000;

/** Everything that must appear in no log line: passwords, tokens, codes, addresses. */
const secrets: string[] = [PASSWORD, NEW_PASSWORD];

const probe: Route = {
  method: 'GET',
  path: '/_t/session',
  auth: 'session',
  handler: async () => ({ status: 200, body: {} }),
};

let db: TestDb;
let app: TestApp;
let limited: TestApp;
let failing: TestApp;
/** How many pooled clients were checked out each time scrypt started. */
const scryptSeen: number[] = [];

before(async () => {
  db = await createTestDb();
  app = await startTestApp(db, { routes: [probe] });
  limited = await startTestApp(db, { routes: [probe], rateLimits: true });
  failing = await startTestApp(db, {
    mailer: async () => {
      throw new Error('550 mailbox unavailable');
    },
  });
  const real = crypto.scrypt;
  mock.method(crypto, 'scrypt', function (this: unknown, ...args: unknown[]) {
    scryptSeen.push(db.app.totalCount - db.app.idleCount);
    return (real as (...a: unknown[]) => void).apply(this, args);
  });
  syncBuiltinESMExports();
});
after(async () => {
  try {
    // everything every test of this file did, on every app: none of it in any log
    assertNoSecrets([app.logText(), limited.logText(), failing.logText()].join('\n'), secrets);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await setTestClock(db.admin, null);
    await Promise.all([app.close(), limited.close(), failing.close()]);
    await db.drop();
  }
});

const fresh = () => `u${randomBytes(6).toString('hex')}@example.com`;

async function register(
  over: Record<string, unknown> = {},
  caller: TestApp = app,
) {
  const email = fresh();
  const body = {
    email,
    password: PASSWORD,
    displayName: 'Lan Anh',
    acceptedTerms: true,
    ...over,
  };
  const res = await caller.call('POST', '/auth/register', { body });
  if (res.status === 201) {
    secrets.push(res.body.token);
  }
  return { email: String(body.email), res };
}

async function login(email: string, password = PASSWORD, caller = app) {
  const res = await caller.call('POST', '/auth/login', {
    body: { email, password },
  });
  if (res.status === 200) {
    secrets.push(res.body.token);
  }
  return res;
}

/** The exact bytes of an answer, for "byte-identical". */
async function raw(path: string, body: unknown) {
  const res = await fetch(app.baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    text: await res.text(),
    type: res.headers.get('content-type'),
  };
}

const session = (token: string) => app.call('GET', '/_t/session', { token });

const until = async (done: () => boolean, ms = 3000) => {
  for (let waited = 0; !done() && waited < ms; waited += 10) {
    await sleep(10);
  }
};

/** The code mailed to `email` after the first `from` messages; waits for the mail (sent after the answer). */
async function mailedCode(email: string, from: number, caller = app) {
  await until(() => caller.mail.slice(from).some(m => m.to === email));
  const mail = caller.mail.slice(from).find(m => m.to === email);
  assert.ok(mail, `no mail to ${email}`);
  const code = /([0-9]{8})/.exec(mail.text)?.[1];
  assert.ok(code, 'the mail holds an 8-digit code');
  secrets.push(code);
  return code;
}

/**
 * Resolves once every mail queued by the requests answered so far has reached the mailer. A
 * sentinel account asks for a code through the same route and the same queue; its own mail is
 * the signal. A mail that is late, for anyone, has arrived before it, so "no mail for X" can be
 * asserted right after this without waiting a guessed time.
 */
async function mailsSettled(caller: TestApp = app) {
  const sentinel = await newUser(db);
  const from = caller.mail.length;
  await caller.call('POST', '/auth/password/forgot', { body: { email: sentinel.email } });
  await mailedCode(sentinel.email, from, caller);
}

const wrongCodeFor = (code: string) =>
  String((Number(code) + 1) % 10 ** LIMITS.resetCode.length).padStart(
    LIMITS.resetCode.length,
    '0',
  );

const fieldsOf = (res: { status: number; body: any }) => {
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  return res.body.error.details.fields;
};

const INVALID_CREDENTIALS = JSON.stringify({
  error: { code: 'INVALID_CREDENTIALS', message: 'invalid credentials' },
});
const RESET_CODE_INVALID = JSON.stringify({
  error: { code: 'RESET_CODE_INVALID', message: 'reset code invalid' },
});

// ---------------------------------------------------------------------------------------------

test('register: 201 with a session, the account and its credentials stored, the token only as a hash', async () => {
  const { email, res } = await register({
    email: ` ${fresh().toUpperCase()} `,
    displayName: '  Lan Anh  ',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['onboarded', 'token', 'userId']);
  const { token, userId, onboarded } = res.body;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(onboarded, false);

  const { rows: users } = await db.admin.query(
    'SELECT email, display_name, terms_accepted_at FROM users WHERE id = $1',
    [userId],
  );
  assert.equal(users[0].email, email.trim().toLowerCase());
  assert.equal(users[0].display_name, 'Lan Anh');
  assert.ok(users[0].terms_accepted_at);

  const { rows: sessions } = await db.admin.query(
    'SELECT user_id FROM sessions WHERE token_hash = $1',
    [hashToken(token)],
  );
  assert.equal(sessions[0].user_id, userId);
  const { rows: credentials } = await db.admin.query(
    'SELECT salt, key FROM credentials WHERE user_id = $1',
    [userId],
  );
  assert.deepEqual(
    credentials[0].key,
    await deriveKey(normalizePassword(PASSWORD), credentials[0].salt),
  );

  // the token works; /healthz does not care about it
  assert.equal((await session(token)).status, 200);
  const health = await app.call('GET', '/healthz', { token });
  assert.deepEqual([health.status, health.body.ok], [200, true]);
});

test('login: 200 with a new session, onboarded follows the account, the other session is untouched', async () => {
  const { email, res: made } = await register();
  const first = made.body.token;
  const res = await login(email);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['onboarded', 'token', 'userId']);
  assert.equal(res.body.userId, made.body.userId);
  assert.notEqual(res.body.token, first);
  assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(res.body.onboarded, false);
  assert.equal((await session(first)).status, 200);
  assert.equal((await session(res.body.token)).status, 200);

  await db.admin.query('UPDATE users SET onboarded_at = now() WHERE id = $1', [
    made.body.userId,
  ]);
  const again = await login(` ${email.toUpperCase()} `);
  assert.deepEqual([again.status, again.body.onboarded], [200, true]);
});

test('logout: 204 without a body revokes that session only; the token is dead afterwards', async () => {
  const { email, res: made } = await register();
  const other = (await login(email)).body.token;
  const res = await app.call('POST', '/auth/logout', { token: made.body.token });
  assert.deepEqual([res.status, res.body], [204, undefined]);
  assert.equal((await session(made.body.token)).status, 401);
  assert.equal((await session(other)).status, 200, 'another session of the account lives');
  const again = await app.call('POST', '/auth/logout', { token: made.body.token });
  assert.deepEqual([again.status, again.body.error.code], [401, 'SESSION_INVALID']);
  assert.equal((await app.call('POST', '/auth/logout')).status, 401);
});

test('register twice with the same email (spelt differently, or of a deleted account): 409 REGISTRATION_UNAVAILABLE and nothing else', async () => {
  const { email, res: first } = await register();
  assert.equal(first.status, 201);
  for (const spelling of [email, email.toUpperCase(), `  ${email}  `]) {
    const { res } = await register({ email: spelling, password: NEW_PASSWORD });
    assert.deepEqual(
      [res.status, res.body],
      [
        409,
        { error: { code: 'REGISTRATION_UNAVAILABLE', message: 'registration unavailable' } },
      ],
    );
  }
  const { rows } = await db.admin.query(
    'SELECT count(*)::int AS n FROM users WHERE email = $1',
    [email],
  );
  assert.equal(rows[0].n, 1);
  // the old password still signs in: the failed attempt changed no credentials
  assert.equal((await login(email)).status, 200);

  await db.admin.query(
    "UPDATE users SET deleted_at = now(), purge_after = now() + interval '30 days' WHERE email = $1",
    [email],
  );
  const { res: reuse } = await register({ email });
  assert.equal(reuse.body.error.code, 'REGISTRATION_UNAVAILABLE');
});

test('register validation: every failing field is named with its rule, nothing is created', async () => {
  const usersBefore = (await db.admin.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const cases: [string, Record<string, unknown>, unknown[]][] = [
    ['nothing', { email: undefined, password: undefined, displayName: undefined, acceptedTerms: undefined }, [
      { field: 'displayName', rule: 'required' },
      { field: 'email', rule: 'required' },
      { field: 'password', rule: 'required' },
      { field: 'acceptedTerms', rule: 'required' },
    ]],
    ['wrong types', { email: 5, password: [], displayName: {}, acceptedTerms: 'true' }, [
      { field: 'displayName', rule: 'required' },
      { field: 'email', rule: 'required' },
      { field: 'password', rule: 'required' },
      { field: 'acceptedTerms', rule: 'required' },
    ]],
    ['terms refused', { acceptedTerms: false }, [{ field: 'acceptedTerms', rule: 'required' }]],
    ['blank name', { displayName: '   ' }, [{ field: 'displayName', rule: 'required' }]],
    ['name of only a no-break space', { displayName: NBSP }, [{ field: 'displayName', rule: 'required' }]],
    ['name too long', { displayName: 'a'.repeat(LIMITS.displayName.max + 1) }, [{ field: 'displayName', rule: 'max' }]],
    ['41 emoji', { displayName: '😀'.repeat(LIMITS.displayName.max + 1) }, [{ field: 'displayName', rule: 'max' }]],
    ['name with an invisible mark', { displayName: `a${RLM}b` }, [{ field: 'displayName', rule: 'format' }]],
    ['name with a control character', { displayName: `a${BEL}b` }, [{ field: 'displayName', rule: 'format' }]],
    ['email without a domain', { email: 'lan.anh' }, [{ field: 'email', rule: 'format' }]],
    ['email without a dot', { email: 'a@b' }, [{ field: 'email', rule: 'format' }]],
    ['blank email', { email: '   ' }, [{ field: 'email', rule: 'required' }]],
    ['email over 254', { email: `${'a'.repeat(250)}@example.com` }, [{ field: 'email', rule: 'format' }]],
    ['look-alike email', { email: `a${FULLWIDTH_AT}example.com` }, [{ field: 'email', rule: 'format' }]],
    ['password too short', { password: 'a'.repeat(LIMITS.password.min - 1) }, [{ field: 'password', rule: 'min' }]],
    ['password too long', { password: 'a'.repeat(LIMITS.password.max + 1) }, [{ field: 'password', rule: 'max' }]],
    ['seven emoji count as seven', { password: '🔑'.repeat(LIMITS.password.min - 1) }, [{ field: 'password', rule: 'min' }]],
    ['several at once', { email: 'x', password: 'short', displayName: '' }, [
      { field: 'displayName', rule: 'required' },
      { field: 'email', rule: 'format' },
      { field: 'password', rule: 'min' },
    ]],
  ];
  for (const [name, over, expected] of cases) {
    const { res } = await register(over);
    assert.deepEqual(fieldsOf(res), expected, name);
  }
  for (const body of [null, [], 'text', 7]) {
    const res = await app.call('POST', '/auth/register', { body });
    assert.equal(fieldsOf(res).length, 4, JSON.stringify(body));
  }
  assert.equal((await app.call('POST', '/auth/register')).status, 422, 'no body at all');
  const usersAfter = (await db.admin.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  assert.equal(usersAfter, usersBefore);

  // at the limits: accepted. A property the server does not know is ignored.
  for (const over of [
    { password: 'p'.repeat(LIMITS.password.min) },
    { password: 'p'.repeat(LIMITS.password.max) },
    { password: '🔑'.repeat(LIMITS.password.max) },
    { password: `  ${'p'.repeat(LIMITS.password.min)}  ` },
    { displayName: 'a' + '😀'.repeat(LIMITS.displayName.max - 1) },
    { displayName: 'x', unknownProperty: { deep: true } },
  ]) {
    const { res } = await register(over);
    assert.equal(res.status, 201, JSON.stringify(over).slice(0, 80));
  }
});

test('a display name with a banned term: 422 NAME_NOT_ALLOWED, also without diacritics; a field error comes first; no account', async () => {
  const usersBefore = (await db.admin.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  for (const displayName of ['Lười biếng', 'tôi là kẻ LƯỜI', 'tội lỗi', 'luoi bieng']) {
    const { res } = await register({ displayName });
    assert.deepEqual(
      [res.status, res.body],
      [422, { error: { code: 'NAME_NOT_ALLOWED', message: 'name not allowed' } }],
      displayName,
    );
  }
  assert.equal((await register({ displayName: 'Lười' })).res.status, 201, 'a part of a phrase is no term');
  const { res: mixed } = await register({ displayName: 'Lười biếng', email: 'x' });
  assert.deepEqual(fieldsOf(mixed), [{ field: 'email', rule: 'format' }]);
  const count = (await db.admin.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  assert.equal(count, usersBefore + 1, 'only the one that is not a banned term exists');
});

test('login, forgot and reset validation: the fields as the contract names them', async () => {
  const loginWith = (body: unknown) => app.call('POST', '/auth/login', { body });
  assert.deepEqual(fieldsOf(await loginWith({})), [
    { field: 'email', rule: 'required' },
    { field: 'password', rule: 'required' },
  ]);
  assert.deepEqual(fieldsOf(await loginWith({ email: 'nope', password: 'x' })), [
    { field: 'email', rule: 'format' },
  ]);
  assert.deepEqual(
    fieldsOf(await loginWith({ email: fresh(), password: 'p'.repeat(LIMITS.password.max + 1) })),
    [{ field: 'password', rule: 'max' }],
  );

  const forgot = (body: unknown) => app.call('POST', '/auth/password/forgot', { body });
  assert.deepEqual(fieldsOf(await forgot({})), [{ field: 'email', rule: 'required' }]);
  assert.deepEqual(fieldsOf(await forgot({ email: 'nope' })), [{ field: 'email', rule: 'format' }]);
  assert.deepEqual(fieldsOf(await forgot(null)), [{ field: 'email', rule: 'required' }]);

  const reset = (over: Record<string, unknown>) =>
    app.call('POST', '/auth/password/reset', {
      body: { email: fresh(), code: '12345678', newPassword: NEW_PASSWORD, ...over },
    });
  assert.deepEqual(fieldsOf(await reset({ email: undefined, code: undefined, newPassword: undefined })), [
    { field: 'email', rule: 'required' },
    { field: 'code', rule: 'required' },
    { field: 'newPassword', rule: 'required' },
  ]);
  const digits = LIMITS.resetCode.length;
  for (const code of [
    '1'.repeat(digits - 1),
    '1'.repeat(digits + 1),
    `${'1'.repeat(digits - 1)}a`,
    ` ${'1'.repeat(digits)}`,
    '١'.repeat(digits), // Arabic-indic digits
    `${'1'.repeat(digits)}\n`,
  ]) {
    assert.deepEqual(fieldsOf(await reset({ code })), [{ field: 'code', rule: 'format' }], JSON.stringify(code));
  }
  assert.deepEqual(fieldsOf(await reset({ code: 12345678 })), [{ field: 'code', rule: 'required' }]);
  assert.deepEqual(fieldsOf(await reset({ newPassword: 'short' })), [{ field: 'newPassword', rule: 'min' }]);
  assert.deepEqual(
    fieldsOf(await reset({ newPassword: 'p'.repeat(LIMITS.password.max + 1) })),
    [{ field: 'newPassword', rule: 'max' }],
  );
});

test('U+0000 in any string of any route is a validation failure of its field, never a database error', () => {
  const ok = { email: 'a@example.com', password: 'p'.repeat(8), displayName: 'Lan', acceptedTerms: true };
  const rule = (run: () => unknown) => {
    try {
      run();
    } catch (e) {
      return (e as { details?: { fields?: unknown } }).details?.fields;
    }
    return 'accepted';
  };
  const nul = (text: string) => `${text.slice(0, 1)}${NUL}${text.slice(1)}`;
  assert.deepEqual(rule(() => checkRegister({ ...ok, email: nul(ok.email) })), [{ field: 'email', rule: 'format' }]);
  assert.deepEqual(rule(() => checkRegister({ ...ok, password: nul(ok.password) })), [{ field: 'password', rule: 'format' }]);
  assert.deepEqual(rule(() => checkRegister({ ...ok, displayName: nul('Lan') })), [{ field: 'displayName', rule: 'format' }]);
  assert.deepEqual(rule(() => checkLogin({ email: nul(ok.email), password: ok.password })), [{ field: 'email', rule: 'format' }]);
  assert.deepEqual(rule(() => checkLogin({ email: ok.email, password: nul(ok.password) })), [{ field: 'password', rule: 'format' }]);
  assert.deepEqual(rule(() => checkForgot({ email: nul(ok.email) })), [{ field: 'email', rule: 'format' }]);
  const reset = { email: ok.email, code: '12345678', newPassword: ok.password };
  assert.deepEqual(rule(() => checkReset({ ...reset, code: nul(reset.code) })), [{ field: 'code', rule: 'format' }]);
  assert.deepEqual(rule(() => checkReset({ ...reset, newPassword: nul(ok.password) })), [{ field: 'newPassword', rule: 'format' }]);
  assert.equal(rule(() => checkReset(reset)), 'accepted');
});

test('login: a wrong password, an unknown email, a short password, a deleted and a locked account get byte-identical answers', async () => {
  const { email } = await register();
  const { email: deleted } = await register();
  await db.admin.query(
    "UPDATE users SET deleted_at = now(), purge_after = now() + interval '30 days' WHERE email = $1",
    [deleted],
  );
  const { email: locked } = await register();
  for (let i = 0; i < 5; i++) {
    await login(locked, 'wrong-password-x');
  }
  const answers = [
    await raw('/auth/login', { email, password: 'wrong-password-x' }),
    await raw('/auth/login', { email, password: 'abc' }),
    await raw('/auth/login', { email: fresh(), password: PASSWORD }),
    await raw('/auth/login', { email: fresh(), password: 'abc' }),
    await raw('/auth/login', { email: deleted, password: PASSWORD }),
    await raw('/auth/login', { email: locked, password: PASSWORD }), // the right one, but locked
  ];
  for (const answer of answers) {
    assert.deepEqual(answer, { status: 401, text: INVALID_CREDENTIALS, type: answers[0].type });
  }
  assert.match(answers[0].type ?? '', /^application\/json/);
});

test('scrypt runs once per register, login and reset, for known and unknown emails alike, never for a refused body, never for forgot, and never while a pooled client is held', async () => {
  const count = async (work: () => Promise<unknown>) => {
    scryptSeen.length = 0;
    await work();
    assert.ok(scryptSeen.every(held => held === 0), `pooled clients held during scrypt: ${scryptSeen}`);
    return scryptSeen.length;
  };
  const { email } = await register();
  const post = (path: string, body: unknown) => app.call('POST', path, { body });
  const base = { acceptedTerms: true, displayName: 'Lan' };

  assert.equal(await count(() => register()), 1, 'register');
  assert.equal(await count(() => register({ email })), 1, 'register, email taken');
  assert.equal(await count(() => register({ displayName: 'Lười biếng' })), 0, 'banned name');
  assert.equal(await count(() => post('/auth/register', { ...base, email: 'x', password: PASSWORD })), 0, 'register, invalid');

  assert.equal(await count(() => login(email)), 1, 'login');
  assert.equal(await count(() => login(email, 'wrong-password-x')), 1, 'login, wrong password');
  assert.equal(await count(() => login(fresh())), 1, 'login, unknown email');
  assert.equal(await count(() => post('/auth/login', { email: 'x', password: PASSWORD })), 0, 'login, invalid');

  assert.equal(await count(() => post('/auth/password/forgot', { email })), 0, 'forgot, known');
  assert.equal(await count(() => post('/auth/password/forgot', { email: fresh() })), 0, 'forgot, unknown');

  const reset = (over: Record<string, unknown>) =>
    post('/auth/password/reset', { email, code: '00000000', newPassword: NEW_PASSWORD, ...over });
  assert.equal(await count(() => reset({})), 1, 'reset, wrong code');
  assert.equal(await count(() => reset({ email: fresh() })), 1, 'reset, unknown email');
  assert.equal(await count(() => reset({ code: '1' })), 0, 'reset, invalid');
});

test('five wrong passwords lock the account for 15 minutes, also against the right one; the lock ends with the window', async () => {
  const { email } = await register();
  for (let i = 0; i < 5; i++) {
    const res = await login(email, 'wrong-password-x');
    assert.equal(res.status, 401, `attempt ${i + 1}`);
  }
  const locked = await login(email);
  assert.deepEqual([locked.status, JSON.stringify(locked.body)], [401, INVALID_CREDENTIALS]);
  try {
    await setTestClock(db.admin, new Date(Date.now() + 14 * MINUTE).toISOString());
    assert.equal((await login(email)).status, 401, 'still inside the window');
    await setTestClock(db.admin, new Date(Date.now() + 31 * MINUTE).toISOString());
    const open = await login(email);
    assert.equal(open.status, 200, JSON.stringify(open.body));
  } finally {
    await setTestClock(db.admin, null);
  }
});

test('forgot: always 202 {}, the mail goes to the normalised address of an account only, after the answer, and its code resets the password', async () => {
  const { email, res: made } = await register({ email: `Mixed${fresh().toUpperCase()}` });
  const normalised = email.trim().toLowerCase();
  const old = made.body.token;
  const start = app.mail.length;

  const stranger = fresh();
  const unknown = await raw('/auth/password/forgot', { email: stranger });
  const known = await raw('/auth/password/forgot', { email: `  ${email}  ` });
  assert.deepEqual(unknown, { status: 202, text: '{}', type: unknown.type });
  assert.deepEqual(known, unknown);

  const code = await mailedCode(normalised, start);
  await mailsSettled();
  assert.equal(app.mail.filter(m => m.to === normalised).length, 1, 'one mail for the account');
  assert.equal(app.mail.filter(m => m.to === stranger).length, 0, 'none for an address that is no account');
  const mail = app.mail.filter(m => m.to === normalised)[0];
  assert.equal(mail.to, normalised);
  assert.equal(mail.subject, RESET_MAIL_SUBJECT);
  assert.equal(mail.subject, 'Mã đặt lại mật khẩu Hồi Máu');
  assert.ok(mail.text.includes(code));
  assert.ok(mail.text.includes('Mã có hiệu lực trong 10 phút'));
  assert.ok(!/https?:|www\./i.test(mail.text), 'no link');
  assert.match(code, new RegExp(`^[0-9]{${LIMITS.resetCode.length}}$`));
  const { rows } = await db.admin.query(
    'SELECT code_hash FROM reset_codes WHERE user_id = $1',
    [made.body.userId],
  );
  assert.deepEqual(rows[0].code_hash, resetCodeHash(normalised, code));

  const reset = await app.call('POST', '/auth/password/reset', {
    body: { email: email.toUpperCase(), code, newPassword: NEW_PASSWORD },
  });
  assert.deepEqual([reset.status, reset.body], [204, undefined]);
  assert.equal((await login(email)).status, 401, 'the old password is gone');
  assert.equal((await login(email, NEW_PASSWORD)).status, 200);
  assert.equal((await session(old)).status, 401, 'the old session is revoked');
  const again = await raw('/auth/password/reset', { email, code, newPassword: NEW_PASSWORD });
  assert.deepEqual(again, { status: 400, text: RESET_CODE_INVALID, type: again.type }, 'a code is good once');
});

test('forgot for a decoy account (an address under .invalid): the same 202 {}, the code is stored, no mail reaches the mailer', async () => {
  const decoy = 'decoy-1@decoy.invalid';
  const liveCodes = async () =>
    (
      await db.admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM reset_codes r JOIN users u ON u.id = r.user_id
          WHERE u.email = $1 AND r.used_at IS NULL AND r.expires_at > app.now()`,
        [decoy],
      )
    ).rows[0].n;
  assert.equal(await liveCodes(), 0);
  const start = app.mail.length;

  const answer = await raw('/auth/password/forgot', { email: decoy });
  const stranger = await raw('/auth/password/forgot', { email: fresh() });
  assert.deepEqual(answer, { status: 202, text: '{}', type: answer.type });
  assert.deepEqual(answer, stranger);
  assert.equal(await liveCodes(), 1, 'the account is treated as any other up to the mail');

  // the mailer is reached after the answer: wait for everything queued so far
  await mailsSettled();
  assert.deepEqual(
    app.mail.slice(start).filter(m => m.to.endsWith('.invalid')),
    [],
    'no mail to a reserved address',
  );
});

test('forgot past the hourly cap: still the same 202 {}, no mail beyond the cap', async () => {
  const { email } = await register();
  const answers = [];
  for (let i = 0; i < 5; i++) {
    answers.push(await raw('/auth/password/forgot', { email }));
  }
  assert.ok(answers.every(a => a.status === 202 && a.text === '{}'));
  const mails = () => app.mail.filter(m => m.to === email);
  await until(() => mails().length >= 3);
  await mailsSettled();
  assert.equal(mails().length, 3, 'three an hour');
  for (const mail of mails()) {
    secrets.push(/([0-9]{8})/.exec(mail.text)?.[1] as string);
  }
});

test('a mailer that fails changes nothing of the answer; the failure is logged without its message', async () => {
  const { email } = await register({}, failing);
  const res = await failing.call('POST', '/auth/password/forgot', { body: { email } });
  assert.deepEqual([res.status, res.body], [202, {}]);
  await until(() => failing.logs.some(l => l.evt === 'after_commit'));
  const lines = failing.logs.filter(l => l.evt === 'after_commit');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].route, '/auth/password/forgot');
  assert.ok(!failing.logText().includes('mailbox unavailable'));
  assert.ok(!failing.logText().includes(email));
});

test('reset: wrong, unknown, unrequested and expired codes get one and the same 400; five wrong codes spend the right one', async () => {
  const body = (email: string, code: string) => ({ email, code, newPassword: NEW_PASSWORD });
  const answerOf = async (email: string, code: string) => raw('/auth/password/reset', body(email, code));
  const expectInvalid = (answer: { status: number; text: string }, what: string) =>
    assert.deepEqual([answer.status, answer.text], [400, RESET_CODE_INVALID], what);

  // no code was ever requested, and an address that is no account
  const { email: quiet } = await register();
  expectInvalid(await answerOf(quiet, '12345678'), 'no code requested');
  expectInvalid(await answerOf(fresh(), '12345678'), 'unknown email');

  // five wrong codes, then the right one: spent
  const { email: guessed } = await register();
  let start = app.mail.length;
  await app.call('POST', '/auth/password/forgot', { body: { email: guessed } });
  const code = await mailedCode(guessed, start);
  for (let i = 0; i < 5; i++) {
    expectInvalid(await answerOf(guessed, wrongCodeFor(code)), `wrong code ${i + 1}`);
  }
  expectInvalid(await answerOf(guessed, code), 'the right code after five wrong ones');
  assert.equal((await login(guessed)).status, 200, 'the password did not change');

  // the right code, too late
  const { email: late } = await register();
  start = app.mail.length;
  await app.call('POST', '/auth/password/forgot', { body: { email: late } });
  const lateCode = await mailedCode(late, start);
  try {
    await setTestClock(db.admin, new Date(Date.now() + 11 * MINUTE).toISOString());
    expectInvalid(await answerOf(late, lateCode), 'expired');
  } finally {
    await setTestClock(db.admin, null);
  }

  // four wrong codes leave the right one working
  const { email: careful } = await register();
  start = app.mail.length;
  await app.call('POST', '/auth/password/forgot', { body: { email: careful } });
  const carefulCode = await mailedCode(careful, start);
  for (let i = 0; i < 4; i++) {
    expectInvalid(await answerOf(careful, wrongCodeFor(carefulCode)), `wrong code ${i + 1}`);
  }
  assert.equal((await answerOf(careful, carefulCode)).status, 204);
});

test('a new reset code makes the one before it useless', async () => {
  const { email } = await register();
  const start = app.mail.length;
  await app.call('POST', '/auth/password/forgot', { body: { email } });
  const first = await mailedCode(email, start);
  await app.call('POST', '/auth/password/forgot', { body: { email } });
  const mails = () => app.mail.slice(start).filter(m => m.to === email);
  await until(() => mails().length === 2);
  const second = /([0-9]{8})/.exec(mails()[1].text)?.[1] ?? '';
  secrets.push(second);
  assert.notEqual(first, second);
  const reset = (code: string) =>
    raw('/auth/password/reset', { email, code, newPassword: NEW_PASSWORD });
  assert.equal((await reset(first)).status, 400);
  assert.equal((await reset(second)).status, 204);
});

test('rate limit: 10 a minute per client address on each anonymous route, 10 per account on logout', async () => {
  for (const path of ['/auth/register', '/auth/login', '/auth/password/forgot', '/auth/password/reset']) {
    for (let i = 0; i < 10; i++) {
      const res = await limited.call('POST', path, { body: {} });
      assert.equal(res.status, 422, `${path} #${i + 1}`);
    }
    const over = await limited.call('POST', path, { body: {} });
    assert.equal(over.status, 429, path);
    assert.equal(over.body.error.code, 'RATE_LIMITED');
    assert.match(over.headers.get('retry-after') ?? '', /^[0-9]+$/);
  }
  const { rows } = await db.admin.query<{ id: string }>(
    "INSERT INTO users (email, display_name, terms_accepted_at) VALUES ($1, 'Lan', now()) RETURNING id",
    [fresh()],
  );
  const tokens: string[] = [];
  for (let i = 0; i < 11; i++) {
    const token = newToken();
    tokens.push(token);
    await db.admin.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [rows[0].id, hashToken(token)],
    );
  }
  const statuses = [];
  for (const token of tokens) {
    statuses.push((await limited.call('POST', '/auth/logout', { token })).status);
  }
  assert.deepEqual(statuses, [...Array(10).fill(204), 429]);
});

test('a password is NFC before it is judged and derived: typed decomposed or composed, it is the same password', async () => {
  const composed = 'm\u1EADt-kh\u1EA9u-th\u1EED-3';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(decomposed, composed);
  assert.notEqual(normalizePassword(decomposed), decomposed);
  secrets.push(composed, decomposed);

  // registered decomposed, signs in composed and decomposed
  const first = await register({ password: decomposed });
  assert.equal(first.res.status, 201, JSON.stringify(first.res.body));
  assert.equal((await login(first.email, composed)).status, 200);
  assert.equal((await login(first.email, decomposed)).status, 200);
  assert.equal((await login(first.email, composed.toUpperCase())).status, 401, 'case is not folded');
  assert.equal((await login(first.email, `${composed} `)).status, 401, 'nothing is trimmed');
  // registered composed, signs in decomposed
  const second = await register({ password: composed });
  assert.equal((await login(second.email, decomposed)).status, 200);

  // a reset: new password typed decomposed, then used composed; and the other way round
  for (const [typed, used] of [[decomposed, composed], [composed, decomposed]]) {
    const { email } = await register();
    const start = app.mail.length;
    await app.call('POST', '/auth/password/forgot', { body: { email } });
    const code = await mailedCode(email, start);
    const reset = await app.call('POST', '/auth/password/reset', {
      body: { email, code, newPassword: typed },
    });
    assert.equal(reset.status, 204);
    assert.equal((await login(email, used)).status, 200);
    assert.equal((await login(email, PASSWORD)).status, 401);
  }

  // the length is the length of the NFC text: 128 composed characters typed as 384 code points
  // are accepted, 7 typed as 21 are too short
  const edge = '\u1EBF';
  assert.equal(edge.normalize('NFD').length, 3);
  const longest = await register({ password: edge.repeat(LIMITS.password.max).normalize('NFD') });
  assert.equal(longest.res.status, 201, JSON.stringify(longest.res.body));
  const tooLong = await register({ password: edge.repeat(LIMITS.password.max + 1).normalize('NFD') });
  assert.deepEqual(fieldsOf(tooLong.res), [{ field: 'password', rule: 'max' }]);
  const tooShort = await register({ password: edge.repeat(LIMITS.password.min - 1).normalize('NFD') });
  assert.deepEqual(fieldsOf(tooShort.res), [{ field: 'password', rule: 'min' }]);
  // and the validators hand on the NFC text
  assert.equal(
    checkRegister({ email: 'a@example.com', password: decomposed, displayName: 'Lan', acceptedTerms: true }).password,
    composed,
  );
  assert.equal(checkLogin({ email: 'a@example.com', password: decomposed }).password, composed);
  assert.equal(
    checkReset({ email: 'a@example.com', code: '12345678', newPassword: decomposed }).newPassword,
    composed,
  );
});

test('characters a reader cannot see are refused in an email and in a display name: soft hyphen, line and paragraph separator', async () => {
  for (const [name, mark] of [
    ['soft hyphen', SOFT_HYPHEN],
    ['line separator', LINE_SEPARATOR],
    ['paragraph separator', PARAGRAPH_SEPARATOR],
  ]) {
    const inEmail = await register({ email: `lan${mark}anh${fresh()}` });
    assert.deepEqual(fieldsOf(inEmail.res), [{ field: 'email', rule: 'format' }], `${name} in an email`);
    const inName = await register({ displayName: `Lan${mark}Anh` });
    assert.deepEqual(fieldsOf(inName.res), [{ field: 'displayName', rule: 'format' }], `${name} in a name`);
    const signIn = await app.call('POST', '/auth/login', {
      body: { email: `lan${mark}anh@example.com`, password: PASSWORD },
    });
    assert.deepEqual(fieldsOf(signIn), [{ field: 'email', rule: 'format' }], `${name} at login`);
  }
});

test('the scrypt gate over HTTP: when it is full, register, login and reset get 429 with Retry-After, nothing is counted, forgot is untouched, and it recovers', async () => {
  const { email } = await register();
  // 4 derivations running and 32 waiting: held by promises that finish only when released
  const releases: (() => void)[] = [];
  const held = Array.from({ length: 36 }, () =>
    scryptGate.run(() => new Promise<void>(resolve => releases.push(resolve))),
  );
  try {
    await sleep(20);
    assert.equal(releases.length, 4, 'four running, the rest waiting');
    const stranger = fresh();
    const answers = [
      await app.call('POST', '/auth/login', { body: { email: stranger, password: PASSWORD } }),
      await app.call('POST', '/auth/register', {
        body: { email: fresh(), password: PASSWORD, displayName: 'Lan', acceptedTerms: true },
      }),
      await app.call('POST', '/auth/password/reset', {
        body: { email, code: '12345678', newPassword: NEW_PASSWORD },
      }),
    ];
    for (const answer of answers) {
      assert.equal(answer.status, 429);
      assert.deepEqual(answer.body, { error: { code: 'RATE_LIMITED', message: 'rate limited' } });
      assert.equal(answer.headers.get('retry-after'), '1');
    }
    // refused before the transaction: no failed attempt was written for anyone
    const { rows } = await db.admin.query('SELECT key FROM auth_throttle WHERE key = $1 OR key = $2', [
      `login:${stranger}`,
      `login:${email}`,
    ]);
    assert.equal(rows.length, 0);
    assert.equal((await app.call('POST', '/auth/password/forgot', { body: { email } })).status, 202);
  } finally {
    // release the running ones; each hands its slot on to a waiter, which is released in turn
    while (releases.length > 0) {
      (releases.shift() as () => void)();
      await sleep(1);
    }
    await Promise.all(held);
  }
  assert.equal((await login(email)).status, 200, 'the gate is free again');
});

test('a mailer that never finishes does not hold the answer: 202 {} promptly, nothing unhandled, nothing logged', async () => {
  let started = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const hanging = await startTestApp(db, {
    mailer: () => {
      started++;
      return new Promise<void>(() => {});
    },
  });
  try {
    const user = await newUser(db);
    const began = performance.now();
    const res = await hanging.call('POST', '/auth/password/forgot', { body: { email: user.email } });
    const took = performance.now() - began;
    assert.deepEqual([res.status, res.body], [202, {}]);
    assert.ok(took < 1500, `answered in ${Math.round(took)} ms`);
    await until(() => started === 1);
    assert.equal(started, 1, 'the mailer was started');
    // the next request is served as usual while the first mail hangs
    assert.equal((await hanging.call('POST', '/auth/password/forgot', { body: { email: fresh() } })).status, 202);
    await sleep(50);
    assert.deepEqual(unhandled, []);
    assert.equal(hanging.logs.filter(l => l.level === 'error').length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await hanging.close();
  }
});

test('a COMMIT that fails is a 500 and no mail: the code is not stored either', async () => {
  const user = await newUser(db);
  await db.admin.query(`
    CREATE FUNCTION t9_refuse_at_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 't9: refused at commit'; END $$;
    CREATE CONSTRAINT TRIGGER t9_refuse_at_commit AFTER INSERT ON reset_codes
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION t9_refuse_at_commit();
  `);
  let res;
  try {
    res = await app.call('POST', '/auth/password/forgot', { body: { email: user.email } });
  } finally {
    await db.admin.query('DROP TRIGGER t9_refuse_at_commit ON reset_codes; DROP FUNCTION t9_refuse_at_commit();');
  }
  assert.deepEqual([res.status, res.body], [500, { error: { code: 'INTERNAL', message: 'internal' } }]);
  await mailsSettled();
  assert.equal(app.mail.filter(m => m.to === user.email).length, 0, 'no mail for a code that was not stored');
  const { rows } = await db.admin.query('SELECT 1 FROM reset_codes WHERE user_id = $1', [user.userId]);
  assert.equal(rows.length, 0);
  // the failure is logged without a message and the account can ask again
  assert.equal(app.logs.filter(l => l.status === 500 && l.route === '/auth/password/forgot').length, 1);
  const start = app.mail.length;
  assert.equal((await app.call('POST', '/auth/password/forgot', { body: { email: user.email } })).status, 202);
  await mailedCode(user.email, start);
});

test('the reset code: LIMITS.resetCode.length digits, zero-padded, spread over the whole range', () => {
  const digits = LIMITS.resetCode.length;
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const code = newResetCode();
    assert.match(code, new RegExp(`^[0-9]{${digits}}$`));
    seen.add(code);
  }
  assert.ok(seen.size > 1990, `2000 codes, ${seen.size} different`);
  // leading zeros are digits too (a 1-in-10 chance each, so 2000 codes would show them)
  assert.ok([...seen].some(code => code.startsWith('0')));
});

/** A log text must hold none of the secrets and no address. */
function assertNoSecrets(text: string, own: string[]) {
  assert.ok(text.length > 0, 'there is a log to look at');
  for (const secret of own) {
    assert.ok(secret.length > 0);
    assert.ok(!text.includes(secret), 'a secret reached the log');
  }
  assert.ok(!/@example\.com/i.test(text), 'an email address reached the log');
}

test('no log line holds a password, a code, a token or an address (own app, own flow: runs alone as well as in order)', async () => {
  const quiet = await startTestApp(db, { routes: [probe] });
  try {
    const own: string[] = [];
    const email = fresh();
    const password = 'ghi-nho-mat-khau-9';
    const newPassword = 'ghi-nho-mat-khau-10';
    own.push(password, newPassword);
    const made = await quiet.call('POST', '/auth/register', {
      body: { email, password, displayName: 'Lan', acceptedTerms: true },
    });
    assert.equal(made.status, 201);
    own.push(made.body.token);
    assert.equal(
      (await quiet.call('POST', '/auth/login', { body: { email, password: 'sai-mat-khau-0' } })).status,
      401,
    );
    const again = await quiet.call('POST', '/auth/login', { body: { email, password } });
    own.push(again.body.token);
    assert.equal((await quiet.call('POST', '/auth/password/forgot', { body: { email } })).status, 202);
    await until(() => quiet.mail.length === 1);
    const code = /([0-9]{8})/.exec(quiet.mail[0].text)?.[1] as string;
    own.push(code);
    const reset = await quiet.call('POST', '/auth/password/reset', {
      body: { email, code, newPassword },
    });
    assert.equal(reset.status, 204);
    assert.equal((await quiet.call('POST', '/auth/logout', { token: made.body.token })).status, 401);
    assert.equal((await quiet.call('POST', '/auth/register', { body: { email } })).status, 422);
    assertNoSecrets(quiet.logText(), own);
  } finally {
    await quiet.close();
  }
});
