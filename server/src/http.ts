import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from './errors.ts';

export const BASE_PATH = '/api/v1';
/** P1.3: a request body is at most 64 KiB. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Deeper than any body of the contract; keeps every recursive walk of a body shallow. */
const MAX_BODY_DEPTH = 32;

// Built from the code point: PostgreSQL cannot store U+0000 in text or jsonb and would answer
// such a value with an error of its own, which is a 500 for the client.
const NUL = String.fromCharCode(0);

/** Thrown when the client went away before its request was complete. */
export class ClientGone extends Error {}

/** The bytes of the request body. Rejects with PAYLOAD_TOO_LARGE as soon as the limit is passed. */
function readBytes(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      reject(new AppError('PAYLOAD_TOO_LARGE'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    // No break out of a `for await` here: that destroys the request and with it the socket the
    // 413 has to be written to. The listener stays and drops what follows.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError('PAYLOAD_TOO_LARGE'));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new ClientGone()));
    req.on('close', () => reject(new ClientGone()));
  });
}

/**
 * False for text PostgreSQL would refuse: U+0000, or a surrogate without its pair (JSON can
 * spell one as an escape; jsonb answers it with 22P02).
 */
const storableText = (text: string): boolean =>
  !text.includes(NUL) &&
  (text as unknown as { isWellFormed(): boolean }).isWellFormed();

/** True for a string or member name that cannot be stored anywhere in `value`, or nesting beyond the limit. */
function unstorable(value: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next.value === 'string') {
      if (!storableText(next.value)) {
        return true;
      }
    } else if (next.value !== null && typeof next.value === 'object') {
      if (next.depth === MAX_BODY_DEPTH) {
        return true;
      }
      for (const [name, member] of Object.entries(next.value)) {
        if (!storableText(name)) {
          return true;
        }
        pending.push({ value: member, depth: next.depth + 1 });
      }
    }
  }
  return false;
}

/**
 * The JSON body of a request, `undefined` when it has none. Throws PAYLOAD_TOO_LARGE over
 * 64 KiB, and BAD_JSON for a body that is not declared `application/json`, is not UTF-8 JSON,
 * holds U+0000 or a lone surrogate in a string or a member name, or is nested deeper than 32
 * levels.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const bytes = await readBytes(req);
  if (bytes.length === 0) {
    return undefined;
  }
  const mediaType = (req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    throw new AppError('BAD_JSON');
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AppError('BAD_JSON');
  }
  if (unstorable(body)) {
    throw new AppError('BAD_JSON');
  }
  return body;
}

/** Path and query of a request target, or null when it is not under the base path. */
export function splitTarget(
  target: string,
): { path: string; query: URLSearchParams } | null {
  const mark = target.indexOf('?');
  const fullPath = mark === -1 ? target : target.slice(0, mark);
  if (!fullPath.startsWith(`${BASE_PATH}/`)) {
    return null;
  }
  return {
    path: fullPath.slice(BASE_PATH.length),
    query: new URLSearchParams(mark === -1 ? '' : target.slice(mark + 1)),
  };
}

/**
 * The parameters of `path` when it matches `pattern` ('/day/quests/:questCode/progress'),
 * else null. Also null for a parameter that is empty, is not valid percent-encoding or decodes
 * to something holding U+0000: such a path names nothing.
 */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [i, segment] of expected.entries()) {
    if (!segment.startsWith(':')) {
      if (segment !== actual[i]) {
        return null;
      }
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(actual[i]);
    } catch {
      return null;
    }
    if (value === '' || value.includes(NUL)) {
      return null;
    }
    params[segment.slice(1)] = value;
  }
  return params;
}

/** The name of the first query parameter whose name or value holds U+0000, or null. */
export function unstorableQueryParam(query: URLSearchParams): string | null {
  for (const [name, value] of query) {
    if (name.includes(NUL) || value.includes(NUL)) {
      return name.replaceAll(NUL, '');
    }
  }
  return null;
}

/** Writes a JSON response; `text` is the already serialised body, or undefined for none. */
export function send(
  res: ServerResponse,
  status: number,
  text: string | undefined,
  headers: Record<string, string> = {},
): void {
  if (text === undefined) {
    res.writeHead(status, { 'cache-control': 'no-store', ...headers }).end();
    return;
  }
  res
    .writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
      ...headers,
    })
    .end(text);
}
