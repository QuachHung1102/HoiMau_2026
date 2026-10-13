import { ApiError, api, bindApiSession, boundUserId, isValidationDetails, onRequestOutcome } from './client';
import { API_BASE_URL } from './config';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = 'tok-secret-1';
const USER = 'user-1';

type Init = { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
const fetchMock = jest.fn<Promise<unknown>, [string, Init]>();
const respond = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
});
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
const caught = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

const realFetch = globalThis.fetch;
let logs: jest.SpyInstance[];
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => jest.spyOn(console, level).mockImplementation(() => undefined));
});
afterEach(() => {
  // The client never logs: not a body, not a header, not an error.
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.useRealTimers();
  bindApiSession(null);
  globalThis.fetch = realFetch;
});

test('the base URL is the dev server behind adb reverse', () => {
  expect(API_BASE_URL).toBe('http://localhost:8787/api/v1');
});

test('get sends the bearer token, the query string and no idempotency key or body', async () => {
  bindApiSession({ token: TOKEN, userId: USER, onInvalid: jest.fn() });
  fetchMock.mockResolvedValue(respond(200, { days: [] }));
  await expect(api.get('/day/history', { from: '2026-10-01', to: '2026-10-07', skipped: undefined, n: 3, q: 'a b&c' })).resolves.toEqual({
    days: [],
  });
  const [url, init] = lastCall();
  expect(url).toBe('http://localhost:8787/api/v1/day/history?from=2026-10-01&to=2026-10-07&n=3&q=a%20b%26c');
  expect(init.method).toBe('GET');
  expect(init.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}` });
  expect(init.body).toBeUndefined();
});

test('a request without a session carries no Authorization header', async () => {
  fetchMock.mockResolvedValue(respond(200, { zones: [] }));
  await api.get('/meta/timezones');
  expect(lastCall()[0]).toBe('http://localhost:8787/api/v1/meta/timezones');
  expect(lastCall()[1].headers).toEqual({ Accept: 'application/json' });
});

test('write sends the bearer token, the given idempotency key and a JSON body', async () => {
  bindApiSession({ token: TOKEN, userId: USER, onInvalid: jest.fn() });
  fetchMock.mockResolvedValue(respond(200, { ok: true }));
  const key = '0b8f4d0e-6a57-4c0e-9d58-2f1f3d1c9a11';
  await expect(api.write('PATCH', '/settings', { motion: 'REDUCED' }, { idempotencyKey: key })).resolves.toEqual({ ok: true });
  const [url, init] = lastCall();
  expect(url).toBe('http://localhost:8787/api/v1/settings');
  expect(init.method).toBe('PATCH');
  expect(init.headers).toEqual({
    Accept: 'application/json',
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  });
  expect(init.body).toBe('{"motion":"REDUCED"}');
});

test('write generates a fresh UUID v4 idempotency key when none is given, also without a body', async () => {
  fetchMock.mockResolvedValue(respond(200, {}));
  await api.write('POST', '/shop/THEME_FOREST/purchase');
  await api.write('POST', '/shop/THEME_FOREST/purchase');
  const [first, second] = fetchMock.mock.calls.map(([, init]) => init.headers['Idempotency-Key']);
  expect(first).toMatch(UUID_V4);
  expect(second).toMatch(UUID_V4);
  expect(second).not.toBe(first);
  expect(lastCall()[1].body).toBeUndefined();
  expect(lastCall()[1].headers['Content-Type']).toBeUndefined();
});

test('204 resolves with undefined', async () => {
  fetchMock.mockResolvedValue(respond(204));
  await expect(api.write('POST', '/auth/logout')).resolves.toBeUndefined();
});

test('a non-2xx error body becomes an ApiError with the server code, status and details', async () => {
  fetchMock.mockResolvedValue(respond(409, { error: { code: 'DAY_CLOSED', message: 'the day is closed', details: { logicalDate: '2026-10-11' } } }));
  const error = await caught(api.write('POST', '/day/bedtime', {}));
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('ApiError');
  expect(error.status).toBe(409);
  expect(error.code).toBe('DAY_CLOSED');
  expect(error.details).toEqual({ logicalDate: '2026-10-11' });
});

test('a rejected fetch is NETWORK with status 0', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  const error = await caught(api.get('/me'));
  expect([error.status, error.code, error.details]).toEqual([0, 'NETWORK', undefined]);
});

test('no answer within 10 s aborts the request and is TIMEOUT', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))),
  );
  const pending = caught(api.get('/me'));
  jest.advanceTimersByTime(9_999);
  expect(lastCall()[1].signal.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  expect(lastCall()[1].signal.aborted).toBe(true);
  const error = await pending;
  expect([error.status, error.code]).toEqual([0, 'TIMEOUT']);
  expect(jest.getTimerCount()).toBe(0);
});

test('a body that stalls after the headers is still under the timeout', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(async (_url, init) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))),
  }));
  const pending = caught(api.get('/me'));
  await jest.advanceTimersByTimeAsync(10_000);
  expect((await pending).code).toBe('TIMEOUT');
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  ['a success', () => fetchMock.mockResolvedValue(respond(200, {})), false],
  ['an HTTP error', () => fetchMock.mockResolvedValue(respond(500, { error: { code: 'INTERNAL', message: 'x' } })), true],
  ['a network error', () => fetchMock.mockRejectedValue(new Error('offline')), true],
])('the timeout timer is cleared after %s', async (_name, arrange, rejects) => {
  jest.useFakeTimers();
  arrange();
  const request = api.get('/me');
  expect(jest.getTimerCount()).toBe(1);
  await request.then(
    () => expect(rejects).toBe(false),
    () => expect(rejects).toBe(true),
  );
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  ['an HTML gateway page', 502, '<html>Bad Gateway</html>'],
  ['JSON without an error object', 500, { message: 'oops' }],
  ['an error object without a string code', 400, { error: { code: 42 } }],
  ['an empty body', 503, undefined],
  ['a 2xx body that is not JSON', 200, 'OK'],
])('%s is INTERNAL with the HTTP status', async (_name, status, body) => {
  fetchMock.mockResolvedValue(respond(status, body));
  const error = await caught(api.get('/me'));
  expect([error.status, error.code, error.details]).toEqual([status, 'INTERNAL', undefined]);
});

test('details that are not an object are dropped', async () => {
  fetchMock.mockResolvedValue(respond(422, { error: { code: 'VALIDATION_FAILED', message: 'x', details: ['nope'] } }));
  expect((await caught(api.get('/me'))).details).toBeUndefined();
});

test('three parallel 401 SESSION_INVALID answers end the session exactly once', async () => {
  const onInvalid = jest.fn();
  bindApiSession({ token: TOKEN, userId: USER, onInvalid });
  fetchMock.mockResolvedValue(respond(401, { error: { code: 'SESSION_INVALID', message: 'session is not valid' } }));
  const errors = await Promise.all([caught(api.get('/me')), caught(api.get('/day')), caught(api.write('POST', '/day/bedtime', {}))]);
  expect(errors.map(e => [e.status, e.code])).toEqual(Array(3).fill([401, 'SESSION_INVALID']));
  expect(fetchMock.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(Array(3).fill(`Bearer ${TOKEN}`));
  expect(onInvalid).toHaveBeenCalledTimes(1);

  // the dead token is not sent again
  await caught(api.get('/me'));
  expect(lastCall()[1].headers.Authorization).toBeUndefined();
  expect(onInvalid).toHaveBeenCalledTimes(1);
});

test('a 401 on a request that carried no token is an ordinary error for the form', async () => {
  fetchMock.mockResolvedValue(respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }));
  expect((await caught(api.write('POST', '/auth/login', { email: 'a@b.vn', password: 'wrong' }))).code).toBe('INVALID_CREDENTIALS');
  fetchMock.mockResolvedValue(respond(401, { error: { code: 'SESSION_INVALID', message: 'x' } }));
  expect((await caught(api.write('POST', '/auth/logout'))).code).toBe('SESSION_INVALID');
});

test('401 INVALID_CREDENTIALS with a token (wrong password on delete) keeps the session', async () => {
  const onInvalid = jest.fn();
  bindApiSession({ token: TOKEN, userId: USER, onInvalid });
  fetchMock.mockResolvedValue(respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }));
  await caught(api.write('POST', '/me/delete', { password: 'wrong' }));
  expect(onInvalid).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(respond(200, {}));
  await api.get('/me');
  expect(lastCall()[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
});

test('a late 401 for an old token does not end a newer session', async () => {
  const oldInvalid = jest.fn();
  const newInvalid = jest.fn();
  bindApiSession({ token: 'old-token', userId: USER, onInvalid: oldInvalid });
  let answer!: (response: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
  const stale = caught(api.get('/me'));
  bindApiSession({ token: 'new-token', userId: USER, onInvalid: newInvalid });
  answer(respond(401, { error: { code: 'SESSION_INVALID', message: 'x' } }));
  await stale;
  expect(oldInvalid).not.toHaveBeenCalled();
  expect(newInvalid).not.toHaveBeenCalled();
});

test('an ApiError never carries the token, the URL or the request', async () => {
  bindApiSession({ token: TOKEN, userId: USER, onInvalid: jest.fn() });
  fetchMock.mockResolvedValue(respond(500, { error: { code: 'INTERNAL', message: `echo Bearer ${TOKEN}` } }));
  const error = await caught(api.write('POST', '/journal', { text: 'private words' }));
  const everything = JSON.stringify([error.message, error.stack, { ...error }, Object.getOwnPropertyNames(error)]);
  expect(everything).not.toContain(TOKEN);
  expect(everything).not.toContain('private words');
  expect(error.message).toBe('INTERNAL');
});

test.each([
  ['/auth/register', { email: 'a@b.vn', password: 'long-enough', displayName: 'An', acceptedTerms: true }],
  ['/auth/login', { email: 'a@b.vn', password: 'long-enough' }],
  ['/auth/logout', undefined],
  ['/auth/password/forgot', { email: 'a@b.vn' }],
  ['/auth/password/reset', { email: 'a@b.vn', code: '123456', newPassword: 'long-enough' }],
])('POST %s is not idempotent in the contract: no Idempotency-Key', async (path, body) => {
  fetchMock.mockResolvedValue(respond(200, {}));
  await api.write('POST', path, body);
  expect('Idempotency-Key' in lastCall()[1].headers).toBe(false);
});

test('a key supplied for a non-idempotent route is a caller bug: reported without the key, and still not sent', async () => {
  fetchMock.mockResolvedValue(respond(200, {}));
  await api.write('POST', '/auth/login', { email: 'a@b.vn', password: 'long-enough' }, { idempotencyKey: 'caller-key-1' });
  expect('Idempotency-Key' in lastCall()[1].headers).toBe(false);
  const error = logs[3];
  expect(error.mock.calls).toEqual([['api.write: POST /auth/login takes no Idempotency-Key in the API contract']]);
  error.mockClear();
});

test('a quest tick (a path with a parameter) carries a key: generated, or the supplied one unchanged', async () => {
  fetchMock.mockResolvedValue(respond(200, {}));
  await api.write('POST', '/day/quests/WATER/progress', {});
  await api.write('POST', '/day/quests/WATER/progress', {}, { idempotencyKey: 'caller-key-1' });
  const [generated, supplied] = fetchMock.mock.calls.map(([, init]) => init.headers['Idempotency-Key']);
  expect(generated).toMatch(UUID_V4);
  expect(supplied).toBe('caller-key-1');
});

test.each([
  ['a path of no operation', 'POST', '/day/quests/WATER/tick'],
  ['the wrong method for a path', 'PATCH', '/day/bedtime'],
  ['an empty path parameter', 'POST', '/day/quests//progress'],
] as const)('%s is a programming error: reported with method and path only, sent without a key', async (_name, method, path) => {
  fetchMock.mockResolvedValue(respond(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
  await caught(api.write(method, path, { secret: 'body text' }, { idempotencyKey: 'caller-key-1' }));
  expect(lastCall()[1].headers['Idempotency-Key']).toBeUndefined();
  const error = logs[3];
  expect(error.mock.calls).toEqual([[`api.write: ${method} ${path} is not an operation of the API contract`]]);
  error.mockClear();
});

test('a body that cannot be serialised is INTERNAL, not NETWORK, and nothing is sent', async () => {
  jest.useFakeTimers();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const error = await caught(api.write('POST', '/journal', circular));
  expect([error.status, error.code]).toEqual([0, 'INTERNAL']);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

describe('a caller signal', () => {
  const abortable = () =>
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
          if (init.signal.aborted) fail();
          else init.signal.addEventListener('abort', fail);
        }),
    );
  const rejection = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (e: unknown) => e as Error,
    );

  test('aborting cancels the request and rejects with the abort itself, not an ApiError', async () => {
    jest.useFakeTimers();
    abortable();
    const caller = new AbortController();
    const pending = rejection(api.get('/me', undefined, { signal: caller.signal }));
    expect(lastCall()[1].signal.aborted).toBe(false);
    caller.abort();
    const error = await pending;
    expect(lastCall()[1].signal.aborted).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error?.name).toBe('AbortError');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a signal that is already aborted cancels at once', async () => {
    jest.useFakeTimers();
    abortable();
    const caller = new AbortController();
    caller.abort();
    const error = await rejection(api.write('POST', '/day/bedtime', {}, { signal: caller.signal }));
    expect(error?.name).toBe('AbortError');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('the 10 s timeout still applies and is still TIMEOUT', async () => {
    jest.useFakeTimers();
    abortable();
    const caller = new AbortController();
    const pending = caught(api.get('/me', undefined, { signal: caller.signal }));
    jest.advanceTimersByTime(10_000);
    expect((await pending).code).toBe('TIMEOUT');
    expect(caller.signal.aborted).toBe(false);
  });

  test('a network failure with a live signal is still NETWORK, and the signal is let go afterwards', async () => {
    const caller = new AbortController();
    const remove = jest.spyOn(caller.signal, 'removeEventListener');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    expect((await caught(api.get('/me', undefined, { signal: caller.signal }))).code).toBe('NETWORK');
    fetchMock.mockResolvedValue(respond(200, {}));
    await api.get('/me', undefined, { signal: caller.signal });
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['abort', 'abort']);
  });
});

test('isValidationDetails narrows VALIDATION_FAILED details and rejects anything else', () => {
  const details: unknown = { fields: [{ field: 'email', rule: 'format' }, { field: 'Idempotency-Key', rule: 'required' }] };
  expect(isValidationDetails(details)).toBe(true);
  if (isValidationDetails(details)) expect(details.fields[0].field).toBe('email');
  expect(isValidationDetails({ fields: [] })).toBe(true);
  for (const bad of [undefined, null, 'x', {}, { fields: 'email' }, { fields: [{ field: 'email' }] }, { fields: [{ field: 1, rule: 'min' }] }, { fields: [{ field: 'a', rule: 'weird' }] }, { fields: [null] }]) {
    expect(isValidationDetails(bad)).toBe(false);
  }
});

describe('onRequestOutcome and boundUserId (Task 24)', () => {
  const network = () => Promise.reject(new TypeError('Network request failed'));

  test('every request reports how it ended, with the outcome and nothing else', async () => {
    const outcomes: unknown[][] = [];
    const stop = onRequestOutcome((...told) => outcomes.push(told));
    bindApiSession({ token: TOKEN, userId: USER, onInvalid: jest.fn() });

    fetchMock.mockResolvedValueOnce(respond(200, { ok: true }));
    await api.get('/day');
    fetchMock.mockResolvedValueOnce(respond(204));
    await api.write('POST', '/day/bedtime', {});
    fetchMock.mockImplementationOnce(network);
    await caught(api.get('/day'));
    fetchMock.mockResolvedValueOnce(respond(409, { error: { code: 'DAY_CLOSED', message: 'x' } }));
    await caught(api.write('POST', '/nutrition/log', { kcal: 1 }));
    fetchMock.mockResolvedValueOnce(respond(500, { error: { code: 'INTERNAL', message: 'x' } }));
    await caught(api.get('/day'));
    fetchMock.mockResolvedValueOnce(respond(200, '<html>'));
    await caught(api.get('/day'));
    expect(outcomes).toEqual([['ok'], ['ok'], ['NETWORK'], ['DAY_CLOSED'], ['INTERNAL'], ['INTERNAL']]);

    stop();
    fetchMock.mockResolvedValueOnce(respond(200, {}));
    await api.get('/day');
    expect(outcomes).toHaveLength(6);
  });

  test('a timeout is reported as TIMEOUT; a request its caller aborted has no outcome', async () => {
    const outcomes: string[] = [];
    const stop = onRequestOutcome(outcome => outcomes.push(outcome));
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))));
    const slow = caught(api.get('/day'));
    await jest.advanceTimersByTimeAsync(10_000);
    await slow;
    expect(outcomes).toEqual(['TIMEOUT']);

    const controller = new AbortController();
    const cancelled = api.get('/day', undefined, { signal: controller.signal }).catch((failure: unknown) => failure);
    controller.abort();
    expect(await cancelled).not.toBeInstanceOf(ApiError);
    expect(outcomes).toEqual(['TIMEOUT']);
    stop();
  });

  test('a listener that throws does not turn an answered request into a failed one, nor silence the others', async () => {
    const heard: string[] = [];
    const stopFirst = onRequestOutcome(() => {
      throw new Error('listener bug');
    });
    const stopSecond = onRequestOutcome(outcome => heard.push(outcome));
    fetchMock.mockResolvedValue(respond(200, { ok: true }));
    await expect(api.get('/day')).resolves.toEqual({ ok: true });
    expect(heard).toEqual(['ok']);
    stopFirst();
    stopSecond();
  });

  test('boundUserId is the user of the bound token, and nobody once the session is unbound or refused', async () => {
    expect(boundUserId()).toBeNull();
    bindApiSession({ token: TOKEN, userId: USER, onInvalid: jest.fn() });
    expect(boundUserId()).toBe(USER);
    bindApiSession({ token: 'other', userId: 'user-2', onInvalid: jest.fn() });
    expect(boundUserId()).toBe('user-2');
    fetchMock.mockResolvedValue(respond(401, { error: { code: 'SESSION_INVALID', message: 'x' } }));
    await caught(api.get('/day'));
    expect(boundUserId()).toBeNull();
    bindApiSession({ token: TOKEN, userId: USER, onInvalid: jest.fn() });
    bindApiSession(null);
    expect(boundUserId()).toBeNull();
  });
});
