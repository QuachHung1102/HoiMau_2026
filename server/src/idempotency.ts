import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Idempotency-Key header as a lower-case UUID, or null when it is missing or not a UUID. */
export function idempotencyKey(
  header: string | string[] | undefined,
): string | null {
  return typeof header === 'string' && UUID.test(header)
    ? header.toLowerCase()
    : null;
}

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

/** SHA-256 over method, path (with its query) and canonical body: what "the same request" means. */
export function requestHash(
  method: string,
  url: string,
  body: unknown,
): Buffer {
  return createHash('sha256')
    .update(JSON.stringify([method, url]))
    .update(canonical(body))
    .digest();
}

export type KeyState =
  | { state: 'run' }
  | { state: 'reused' }
  | { state: 'replay'; status: number; body: unknown };

/**
 * Claims the key for the user of the open transaction (role app_auth) and keeps its row locked
 * until that transaction ends. It must run inside the request transaction: a second request
 * with the same key waits on the row and then sees what this one committed.
 */
export async function beginKey(
  client: PoolClient,
  key: string,
  hash: Buffer,
): Promise<KeyState> {
  const { rows } = await client.query<{
    same_request: boolean;
    status: number | null;
    response: unknown;
  }>('SELECT same_request, status, response FROM idempotency_begin($1, $2)', [
    key,
    hash,
  ]);
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
