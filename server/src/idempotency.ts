import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An Idempotency-Key header value as a lower-case UUID, or null when it is not a UUID. */
export function idempotencyKey(
  header: string | string[] | undefined,
): string | null {
  return typeof header === 'string' && UUID.test(header)
    ? header.toLowerCase()
    : null;
}

/** A stored answer is at most this long (UTF-8 bytes of its JSON). */
export const MAX_STORED_BYTES = 256 * 1024;

/**
 * The key of the request hash, derived from the journal key under a label of its own: the
 * journal key itself is never used for anything but the journal.
 */
export const requestHashKey = (journalKey: Buffer): Buffer =>
  createHmac('sha256', journalKey)
    .update('idempotency-request-hash-v1')
    .digest();

/** JSON with the members of every object in code-unit order: two spellings of one body are one text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(name => `${JSON.stringify(name)}:${canonical(object[name])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * What "the same request" means: HMAC-SHA-256, under `hashKey`, over method, path (with its
 * query) and canonical body. Keyed because a body can hold a password (account deletion): a
 * plain hash of it, kept for days, could be guessed at hundreds of thousands of tries a second
 * by whoever reads the table. With another journal key every stored hash stops matching.
 */
export function requestHash(
  hashKey: Buffer,
  method: string,
  url: string,
  body: unknown,
): Buffer {
  return createHmac('sha256', hashKey)
    .update(JSON.stringify([method, url]))
    .update(canonical(body))
    .digest();
}

/** The key is held by a request that is still running (or its row just went away): retry. */
export class KeyBusy extends Error {}

export type KeyState =
  | { state: 'run' }
  | { state: 'reused' }
  | { state: 'replay'; status: number; body: unknown };

/**
 * Claims the key for the user of the open transaction (role app_auth). It must run inside the
 * request transaction: a second request with the same key waits here until this one commits or
 * rolls back, and then sees what it left. The wait ends after lock_timeout with `KeyBusy`.
 * After 'run' the caller owes one of `storeKey` and `releaseKey` before it commits.
 */
export async function beginKey(
  client: PoolClient,
  key: string,
  hash: Buffer,
): Promise<KeyState> {
  const { rows } = await client
    .query<{
      same_request: boolean;
      status: number | null;
      response: unknown;
    }>('SELECT same_request, status, response FROM idempotency_begin($1, $2)', [
      key,
      hash,
    ])
    .catch((e: { code?: unknown }) => {
      // 55P03 lock_not_available: the wait for the request in flight ran into lock_timeout
      throw e.code === '55P03' ? new KeyBusy() : e;
    });
  if (rows.length === 0) {
    throw new KeyBusy();
  }
  const { same_request, status, response } = rows[0];
  if (!same_request) {
    return { state: 'reused' };
  }
  return status === null
    ? { state: 'run' }
    : { state: 'replay', status, body: response ?? undefined };
}

/**
 * Stores a 2xx answer under the key claimed by `beginKey` in this transaction. `text` is the
 * serialised JSON body exactly as it is sent, or undefined for an answer without a body.
 */
export async function storeKey(
  client: PoolClient,
  key: string,
  status: number,
  text: string | undefined,
): Promise<void> {
  await client.query('SELECT idempotency_store($1, $2, $3::jsonb)', [
    key,
    status,
    text ?? null,
  ]);
}

/** Gives the key back: the request ended without a 2xx answer, and only a 2xx is remembered. */
export async function releaseKey(
  client: PoolClient,
  key: string,
): Promise<void> {
  await client.query('SELECT idempotency_release($1)', [key]);
}
