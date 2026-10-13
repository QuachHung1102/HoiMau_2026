import type { ErrorCode, ValidationDetails } from '../../../domain/contract/common.ts';
import { OPERATIONS } from '../../../domain/contract/operations.ts';
import { API_BASE_URL } from './config';
import { newActionId } from './uuid';

const TIMEOUT_MS = 10_000;

/** Every failure of a request. `message` is the code only: no URL, header, body or server text. */
export class ApiError extends Error {
  /** HTTP status; 0 when there was no response (NETWORK, TIMEOUT, or a request that could not be built). */
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

type BoundSession = { token: string; userId: string; onInvalid: () => void };
let session: BoundSession | null = null;
// False from the moment the bound user's sign-out begins: the token still goes out (it revokes the session on the
// server), but nothing more is recorded or sent for that user.
let recording = false;

/** For the session store only: the token requests carry, whose it is, and what to do when the server says it is dead. */
export function bindApiSession(next: BoundSession | null) {
  session = next;
  recording = next !== null;
}

/** For the session store only: the bound user's sign-out has begun (see `boundUserId`). */
export function stopRecording() {
  recording = false;
}

/**
 * The user records may be filed and sent for right now: the owner of the bound token, or null when nobody is signed
 * in or that user's sign-out has begun. Read it in the same tick as the request (no `await` in between) to be sure
 * of the account a write is recorded under.
 */
export const boundUserId = () => (recording ? session?.userId ?? null : null);

type Outcome = 'ok' | ApiError['code'];
const outcomeListeners = new Set<(outcome: Outcome) => void>();

/**
 * Tells `listener` how every request ended: `'ok'` for a 2xx, otherwise the code of its `ApiError`. A request its
 * caller aborted has no outcome. Nothing else about the request is passed on. Returns the unsubscribe function.
 */
export function onRequestOutcome(listener: (outcome: Outcome) => void): () => void {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

function report(outcome: Outcome) {
  for (const listener of [...outcomeListeners]) {
    try {
      listener(outcome);
    } catch {
      // a listener's own failure must not turn an answered request into a failed one
    }
  }
}

type Method = 'GET' | 'POST' | 'PATCH';
type RequestOptions = { body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

async function request<T>(method: Method, path: string, options?: RequestOptions): Promise<T> {
  let result: T;
  try {
    result = await exchange<T>(method, path, options);
  } catch (failure) {
    if (failure instanceof ApiError) report(failure.code);
    throw failure;
  }
  report('ok');
  return result;
}

async function exchange<T>(method: Method, path: string, { body, idempotencyKey, signal: callerSignal }: RequestOptions = {}): Promise<T> {
  const sent = session;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (sent) headers.Authorization = `Bearer ${sent.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let json: string | undefined;
  try {
    json = body === undefined ? undefined : JSON.stringify(body);
  } catch {
    throw new ApiError(0, 'INTERNAL'); // a body that cannot be serialised is our bug, not the network's
  }

  // One signal for fetch: aborted by our 10 s timer or by the caller (a cancelled query).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const abortForCaller = () => controller.abort();
  callerSignal?.addEventListener('abort', abortForCaller);
  if (callerSignal?.aborted) controller.abort();
  let status: number;
  let ok: boolean;
  let text: string;
  try {
    const response = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: json,
      // The cast bridges two declarations of the same global (React Native's and Node's, which test files pull in).
      signal: controller.signal as RequestInit['signal'],
    });
    ({ status, ok } = response);
    text = await response.text(); // reading the body is under the same timeout
  } catch (failure) {
    // The caller's own abort is passed on as it is, so TanStack Query sees a cancellation and not an error.
    if (callerSignal?.aborted && !timedOut) throw failure;
    throw new ApiError(0, timedOut ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortForCaller);
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

/** The operation of the API contract a write goes to (`:param` segments match any non-empty segment). */
function operationOf(method: Method, path: string) {
  const segments = path.split('/');
  return OPERATIONS.find(operation => {
    const pattern = operation.path.split('/');
    return (
      operation.method === method &&
      pattern.length === segments.length &&
      pattern.every((part, i) => (part.startsWith(':') ? segments[i] !== '' : part === segments[i]))
    );
  });
}

/** JSON only. Never logs a request or a response; caches nothing. `signal` lets the caller cancel. */
export const api = {
  get<T>(path: string, query?: Record<string, string | number | undefined>, opts?: { signal?: AbortSignal }): Promise<T> {
    return request<T>('GET', path + queryString(query), { signal: opts?.signal });
  },
  /**
   * The contract decides whether a write carries an `Idempotency-Key`: routes marked idempotent always do (pass
   * `idempotencyKey` to repeat the same action, e.g. a retry; without one a new action id is generated), the
   * others (the auth routes) never do.
   */
  write<T>(method: 'POST' | 'PATCH', path: string, body?: unknown, opts?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<T> {
    const operation = operationOf(method, path);
    // Programming errors, reported with the method and path only (never a body or a key).
    if (__DEV__) {
      if (!operation) console.error(`api.write: ${method} ${path} is not an operation of the API contract`);
      else if (!operation.idempotent && opts?.idempotencyKey) console.error(`api.write: ${method} ${path} takes no Idempotency-Key in the API contract`);
    }
    const idempotencyKey = operation?.idempotent ? opts?.idempotencyKey ?? newActionId() : undefined;
    return request<T>(method, path, { body, idempotencyKey, signal: opts?.signal });
  },
};
