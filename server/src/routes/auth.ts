import { createHash, randomInt } from 'node:crypto';
import type { AuthSession } from '../../../domain/contract/core.ts';
import { findBannedTerms } from '../../../domain/language.ts';
import {
  LIMITS,
  isDisplayName,
  isEmail,
  normalizeEmail,
} from '../../../domain/validation.ts';
import type { FieldError } from '../../../domain/validation.ts';
import type { Route } from '../app.ts';
import { setRole, withRole } from '../db.ts';
import { AppError, errorResponse } from '../errors.ts';
import { deriveKey, newSalt } from '../password.ts';
import { hashToken, newToken } from '../session.ts';

// ---- validation (rules of domain/validation.ts; names of the fields as in the contract) ----

const NUL = String.fromCharCode(0);
const RESET_CODE = new RegExp(`^[0-9]{${LIMITS.resetCode.length}}$`);

/** 10 a minute per client address on each of the four anonymous routes; per account on logout. */
const AUTH_RATE = { perMinute: 10 } as const;

const members = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

/** Code points, as the database and the app count. */
const size = (text: string): number => [...text].length;

/** `min` / `max` by code points; null when inside. */
function sizeRule(
  text: string,
  limit: { min: number; max: number },
): 'min' | 'max' | null {
  const length = size(text);
  if (length < limit.min) {
    return 'min';
  }
  return length > limit.max ? 'max' : null;
}

/**
 * A string member that is present and has no U+0000 (PostgreSQL text cannot hold it, and the
 * body reader already refuses it: this is the second fence), else null with the problem noted.
 */
function member(
  body: Record<string, unknown>,
  field: string,
  problems: FieldError[],
): string | null {
  const value = body[field];
  if (typeof value !== 'string' || value === '') {
    problems.push({ field, rule: 'required' });
    return null;
  }
  if (value.includes(NUL)) {
    problems.push({ field, rule: 'format' });
    return null;
  }
  return value;
}

/** The normalised address: what the database looks up, what the code is bound to, where mail goes. */
function emailOf(
  body: Record<string, unknown>,
  problems: FieldError[],
): string | null {
  const raw = member(body, 'email', problems);
  if (raw === null) {
    return null;
  }
  const email = normalizeEmail(raw);
  if (email === '') {
    problems.push({ field: 'email', rule: 'required' });
    return null;
  }
  if (!isEmail(email)) {
    problems.push({ field: 'email', rule: 'format' });
    return null;
  }
  return email;
}

/** A password to be stored: LIMITS.password, never trimmed. */
function newPasswordOf(
  body: Record<string, unknown>,
  field: 'password' | 'newPassword',
  problems: FieldError[],
): string | null {
  const password = member(body, field, problems);
  const rule = password === null ? null : sizeRule(password, LIMITS.password);
  if (rule !== null) {
    problems.push({ field, rule });
    return null;
  }
  return password;
}

function refuse(problems: FieldError[]): void {
  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', { fields: problems });
  }
}

export function checkRegister(body: unknown): {
  email: string;
  password: string;
  displayName: string;
} {
  const input = members(body);
  const problems: FieldError[] = [];

  let displayName: string | null = null;
  const rawName = member(input, 'displayName', problems);
  if (rawName !== null) {
    const name = rawName.trim();
    const rule = name === '' ? 'required' : sizeRule(name, LIMITS.displayName);
    if (rule !== null) {
      problems.push({ field: 'displayName', rule });
    } else if (!isDisplayName(name)) {
      problems.push({ field: 'displayName', rule: 'format' });
    } else {
      displayName = name;
    }
  }
  const email = emailOf(input, problems);
  const password = newPasswordOf(input, 'password', problems);
  if (input.acceptedTerms !== true) {
    problems.push({ field: 'acceptedTerms', rule: 'required' });
  }
  refuse(problems);

  if (findBannedTerms(displayName as string).length > 0) {
    throw new AppError('NAME_NOT_ALLOWED');
  }
  return {
    email: email as string,
    password: password as string,
    displayName: displayName as string,
  };
}

/**
 * Any non-empty password up to the maximum: the length rule of a new password does not apply
 * to one that is only being tried (a short one is simply wrong, as 401), but a 64 KiB "password"
 * is not worth a derivation.
 */
export function checkLogin(body: unknown): { email: string; password: string } {
  const input = members(body);
  const problems: FieldError[] = [];
  const email = emailOf(input, problems);
  const password = member(input, 'password', problems);
  if (password !== null && size(password) > LIMITS.password.max) {
    problems.push({ field: 'password', rule: 'max' });
  }
  refuse(problems);
  return { email: email as string, password: password as string };
}

export function checkForgot(body: unknown): { email: string } {
  const problems: FieldError[] = [];
  const email = emailOf(members(body), problems);
  refuse(problems);
  return { email: email as string };
}

export function checkReset(body: unknown): {
  email: string;
  code: string;
  newPassword: string;
} {
  const input = members(body);
  const problems: FieldError[] = [];
  const email = emailOf(input, problems);
  const code = member(input, 'code', problems);
  if (code !== null && !RESET_CODE.test(code)) {
    problems.push({ field: 'code', rule: 'format' });
  }
  const newPassword = newPasswordOf(input, 'newPassword', problems);
  refuse(problems);
  return {
    email: email as string,
    code: code as string,
    newPassword: newPassword as string,
  };
}

// ---- reset code and mail ----

/** LIMITS.resetCode.length digits, zero-padded, from the system CSPRNG. */
export const newResetCode = (): string =>
  String(randomInt(0, 10 ** LIMITS.resetCode.length)).padStart(
    LIMITS.resetCode.length,
    '0',
  );

/** What the database keeps of a code: bound to the normalised address it was sent to. */
export const resetCodeHash = (email: string, code: string): Buffer =>
  createHash('sha256').update(`${email}:${code}`).digest();

export const RESET_MAIL_SUBJECT = 'Mã đặt lại mật khẩu Hồi Máu';

/** Vietnamese text, no link: the code is typed into the app (S55). */
export const resetMailText = (code: string): string =>
  [
    `Mã đặt lại mật khẩu Hồi Máu của bạn là: ${code}`,
    'Mã có hiệu lực trong 10 phút.',
    'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua thư này; mật khẩu của bạn không thay đổi.',
  ].join('\n');

// ---- routes ----

type Credential = { email: string; key: Buffer };

const routes: Route[] = [
  {
    method: 'POST',
    path: '/auth/register',
    auth: 'anon',
    rateLimit: AUTH_RATE,
    // validate, then the slow derivation: the request holds no pooled client for either
    prepare: async ({ body }) => {
      const { email, password, displayName } = checkRegister(body);
      const salt = newSalt();
      return { email, displayName, salt, key: await deriveKey(password, salt) };
    },
    handler: async ({ db, prepared }) => {
      const { email, displayName, salt, key } = prepared as Credential & {
        displayName: string;
        salt: Buffer;
      };
      const token = newToken();
      const { rows } = await db.query<{ id: string }>(
        'SELECT auth_register($1, $2, $3, $4, $5) AS id',
        [email, displayName, salt, key, hashToken(token)],
      );
      const session: AuthSession = {
        token,
        userId: rows[0].id,
        onboarded: false,
      };
      return { status: 201, body: session };
    },
  },
  {
    method: 'POST',
    path: '/auth/login',
    auth: 'anon',
    rateLimit: AUTH_RATE,
    // Same work for every email, known or not: the stored salt or the fake one, one derivation.
    prepare: async ({ body, pool }) => {
      const { email, password } = checkLogin(body);
      const { rows } = await withRole(pool, 'app_anon', null, db =>
        db.query<{ salt: Buffer }>('SELECT auth_salt($1) AS salt', [email]),
      );
      return { email, key: await deriveKey(password, rows[0].salt) };
    },
    handler: async ({ db, prepared }) => {
      const { email, key } = prepared as Credential;
      const token = newToken();
      const { rows } = await db.query<{ id: string | null }>(
        'SELECT auth_login($1, $2, $3) AS id',
        [email, key, hashToken(token)],
      );
      const userId = rows[0].id;
      if (userId === null) {
        // RETURNED, not thrown: the transaction commits with the attempt auth_login counted.
        // One answer for an unknown email, a wrong password, a locked and a deleted account.
        return errorResponse('INVALID_CREDENTIALS');
      }
      await setRole(db, 'app_auth', userId);
      const onboarded = await db.query<{ onboarded: boolean }>(
        'SELECT onboarded_at IS NOT NULL AS onboarded FROM users WHERE id = app.current_user_id()',
      );
      const session: AuthSession = {
        token,
        userId,
        onboarded: onboarded.rows[0].onboarded,
      };
      return { status: 200, body: session };
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    auth: 'session',
    // a session route: counted per account, the address-wide write limit applies as always
    rateLimit: AUTH_RATE,
    handler: async ({ db, tokenHash }) => {
      if (tokenHash === null) {
        throw new Error('a session route runs with a token hash');
      }
      await db.query('SELECT auth_logout($1)', [tokenHash]);
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    path: '/auth/password/forgot',
    auth: 'anon',
    rateLimit: AUTH_RATE,
    prepare: async ({ body }) => checkForgot(body),
    handler: async ({ db, prepared, mailer, afterCommit }) => {
      const { email } = prepared as { email: string };
      // generated and hashed whether or not the account exists: the same work for both
      const code = newResetCode();
      const { rows } = await db.query<{ sent: boolean }>(
        'SELECT auth_reset_request($1, $2) AS sent',
        [email, resetCodeHash(email, code)],
      );
      if (rows[0].sent) {
        // after the answer: an unknown address and a known one take the same time to answer
        afterCommit(() =>
          mailer({
            to: email,
            subject: RESET_MAIL_SUBJECT,
            text: resetMailText(code),
          }),
        );
      }
      return { status: 202, body: {} };
    },
  },
  {
    method: 'POST',
    path: '/auth/password/reset',
    auth: 'anon',
    rateLimit: AUTH_RATE,
    prepare: async ({ body }) => {
      const { email, code, newPassword } = checkReset(body);
      const salt = newSalt();
      return {
        email,
        codeHash: resetCodeHash(email, code),
        salt,
        key: await deriveKey(newPassword, salt),
      };
    },
    handler: async ({ db, prepared }) => {
      const { email, codeHash, salt, key } = prepared as Credential & {
        codeHash: Buffer;
        salt: Buffer;
      };
      const { rows } = await db.query<{ ok: boolean }>(
        'SELECT auth_reset_confirm($1, $2, $3, $4) AS ok',
        [email, codeHash, salt, key],
      );
      // RETURNED: the attempt auth_reset_confirm spent stays spent
      return rows[0].ok
        ? { status: 204 }
        : errorResponse('RESET_CODE_INVALID');
    },
  },
];

export default routes;
