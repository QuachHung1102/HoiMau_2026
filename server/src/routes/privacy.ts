// Privacy (spec 10): the data export and the deletion of the account (61-privacy.sql).
import { normalizePassword, LIMITS } from '../../../domain/validation.ts';
import type { Route } from '../app.ts';
import { withRole } from '../db.ts';
import { AppError, errorResponse } from '../errors.ts';
import { deriveKey } from '../password.ts';
import { buildExport } from '../readModels/export.ts';
import { members } from './auth.ts';

const NUL = String.fromCharCode(0);

/** The password of the request, as a login takes it: NFC, any length up to the maximum. */
export function checkDelete(body: unknown): { password: string } {
  const value = members(body).password;
  if (typeof value !== 'string' || value === '') {
    throw new AppError('VALIDATION_FAILED', { fields: [{ field: 'password', rule: 'required' }] });
  }
  if (value.includes(NUL)) {
    throw new AppError('VALIDATION_FAILED', { fields: [{ field: 'password', rule: 'format' }] });
  }
  const password = normalizePassword(value);
  if ([...password].length > LIMITS.password.max) {
    throw new AppError('VALIDATION_FAILED', { fields: [{ field: 'password', rule: 'max' }] });
  }
  return { password };
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/me/export',
    auth: 'user',
    rateLimit: { perHour: 5 },
    handler: async ctx => ({ status: 200, body: await buildExport(ctx) }),
  },
  {
    method: 'POST',
    path: '/me/delete',
    auth: 'session',
    idempotent: true,
    rateLimit: { perMinute: 10 },
    // the slow derivation outside the request transaction, for a live session only (app.ts)
    prepare: async ({ body, pool, userId }) => {
      const { password } = checkDelete(body);
      const { rows } = await withRole(pool, 'app_auth', userId, db =>
        db.query<{ salt: Buffer | null }>('SELECT account_salt() AS salt'),
      );
      const salt = rows[0].salt;
      // the account went since the session was checked (a concurrent delete): no session now
      if (salt === null) {
        throw new AppError('SESSION_INVALID');
      }
      return { key: await deriveKey(password, salt) };
    },
    handler: async ({ db, prepared }) => {
      const { key } = prepared as { key: Buffer };
      const { rows } = await db.query<{ ok: boolean }>('SELECT account_delete($1) AS ok', [key]);
      // RETURNED, not thrown: the attempt account_delete counted on the login throttle stays
      return rows[0].ok ? { status: 204 } : errorResponse('INVALID_CREDENTIALS');
    },
  },
];

export default routes;
