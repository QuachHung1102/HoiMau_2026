import type { ErrorCode, ValidationDetails } from '../../../domain/contract/common.ts';
import { API_BASE_URL } from './config';
import { newActionId } from './uuid';

const TIMEOUT_MS = 10_000;

/** Every failure of a request. `message` is the code only: no URL, header, body or server text. */
export class ApiError extends Error {
  /** HTTP status; 0 for NETWORK / TIMEOUT. */
  status: number;
  code: ErrorCode | 'NETWORK' | 'TIMEOUT';
  details?: Record<string, unknown>;

  constructor(status: number, code: ApiError['code'], details?: Record<string, unknown>) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const RULES: readonly string[] = ['required', 'min', 'max', 'format', 'enum'] satisfies ValidationDetails['fields'][number]['rule'][];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Narrows `ApiError.details` of a `VALIDATION_FAILED` so a form can map each field error without a cast. */
export function isValidationDetails(details: unknown): details is ValidationDetails {
  return (
    isObject(details) &&
    Array.isArray(details.fields) &&
    details.fields.every(f => isObject(f) && typeof f.field === 'string' && typeof f.rule === 'string' && RULES.includes(f.rule))
  );
}

type BoundSession = { token: string; onInvalid: () => void };
let session: BoundSession | null = null;

/** For the session store only: the token requests carry, and what to do when the server says it is dead. */
export function bindApiSession(next: BoundSession | null) {
  session = next;
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const sent = session;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (sent) headers.Authorization = `Bearer ${sent.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let status: number;
  let ok: boolean;
  let text: string;
  try {
    const response = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // The cast bridges two declarations of the same global (React Native's and Node's, which test files pull in).
      signal: controller.signal as RequestInit['signal'],
    });
    ({ status, ok } = response);
    text = await response.text(); // reading the body is under the same timeout
  } catch {
    throw new ApiError(0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown;
  try {
    payload = text === '' ? undefined : JSON.parse(text);
  } catch {
    throw new ApiError(status, 'INTERNAL');
  }
  if (ok) return payload as T;

  const error = isObject(payload) ? payload.error : undefined;
  if (!isObject(error) || typeof error.code !== 'string') throw new ApiError(status, 'INTERNAL');
  // A dead session ends once: only for a request that carried the token, and only if that token is still the
  // current one, so parallel 401s (or a late 401 for an old token) cannot sign out twice.
  if (status === 401 && error.code === 'SESSION_INVALID' && sent && sent === session) {
    session = null;
    sent.onInvalid();
  }
  throw new ApiError(status, error.code as ErrorCode, isObject(error.details) ? error.details : undefined);
}

const queryString = (query: Record<string, string | number | undefined> = {}) => {
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
};

/** JSON over HTTPS-or-dev-HTTP. Never logs; caches nothing; every write carries an `Idempotency-Key`. */
export const api = {
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return request<T>('GET', path + queryString(query));
  },
  /** Pass `idempotencyKey` to repeat the same action (a retry); without one a new action id is generated. */
  write<T>(method: 'POST' | 'PATCH', path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
    return request<T>(method, path, body, opts?.idempotencyKey ?? newActionId());
  },
};
