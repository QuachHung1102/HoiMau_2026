import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

/** A session token: 32 random bytes in base64url, 43 characters (AR-06). Shown to the client once. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** What the database stores and compares: SHA-256 of the token text. The token itself goes no further. */
export const hashToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

/**
 * The hash of the token of exactly `Authorization: Bearer <token>`; null for a missing header and
 * for anything else (another scheme, extra spaces, a value that cannot be one of our tokens).
 */
export function bearerTokenHash(header: string | undefined): Buffer | null {
  const match = BEARER.exec(header ?? '');
  return match ? hashToken(match[1]) : null;
}

/** The user of a live session, or null. Call it as app_anon: auth_session is closed to app_auth. */
export async function sessionUser(
  client: PoolClient,
  tokenHash: Buffer,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string | null }>(
    'SELECT auth_session($1) AS id',
    [tokenHash],
  );
  return rows[0].id;
}
