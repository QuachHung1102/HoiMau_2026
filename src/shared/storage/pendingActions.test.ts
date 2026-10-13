import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { OPERATIONS } from '../../../domain/contract/operations.ts';
import { bindApiSession } from '../api/client';
import {
  QUEUE_LIMIT,
  QueueError,
  clearPendingFor,
  deliver,
  dismissRejected,
  enqueueAction,
  flushPending,
  isQueueable,
  onFlushed,
  unsentCount,
  usePendingActions,
  useRejectedActions,
  useWaitingCount,
  type PendingAction,
} from './pendingActions';

const A = 'user-a';
const B = 'user-b';
const BASE = 'http://localhost:8787/api/v1';
const T0 = Date.parse('2026-10-14T08:00:00.000Z');

type Init = { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
const fetchMock = jest.fn<Promise<unknown>, [string, Init]>();
const respond = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
});
const refuse = (status: number, code: string) => respond(status, { error: { code, message: 'diagnostic' } });
const offline = () => Promise.reject(new TypeError('Network request failed'));
/** What went out, in order. */
const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    path: url.replace(BASE, ''),
    key: init.headers['Idempotency-Key'],
    bearer: init.headers.Authorization,
    body: JSON.parse(init.body ?? 'null') as Record<string, unknown>,
  }));
const keysSent = () => sent().map(request => request.key);

const signIn = (userId: string) => bindApiSession({ token: `tok-${userId}`, userId, onInvalid: jest.fn() });
const action = (id: string, userId = A, more: Partial<PendingAction> = {}) => ({
  id,
  userId,
  method: 'POST' as const,
  path: '/day/quests/WATER/progress',
  body: { amount: 1 },
  createdAt: new Date().toISOString(),
  ...more,
});
const onDisk = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? 'null') as { id: string }[] | null;
const idsOnDisk = async (userId: string) => ((await onDisk(`pending:v1:${userId}`)) ?? []).map(item => item.id);

const realFetch = globalThis.fetch;
let logs: jest.SpyInstance[];
beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => respond(200, { ok: true }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => jest.spyOn(console, level).mockImplementation(() => undefined));
  signIn(A);
});
afterEach(async () => {
  const logged = logs.flatMap(spy => spy.mock.calls.map(call => String(call[0])));
  jest.restoreAllMocks();
  bindApiSession(null);
  await clearPendingFor(A);
  await clearPendingFor(B);
  await AsyncStorage.clear();
  jest.useRealTimers();
  globalThis.fetch = realFetch;
  // Nothing in the queue is ever logged, and no write went to a route that takes no Idempotency-Key.
  expect(logged).toEqual([]);
});

/** The same disk, a new JavaScript process: fresh copies of the queue and of the API client. */
function restart(userId: string) {
  let fresh!: typeof import('./pendingActions');
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: AsyncStorage }));
    jest.doMock('react', () => React); // the hooks of the fresh copy must be the renderer's React
    fresh = require('./pendingActions');
    (require('../api/client') as typeof import('../api/client')).bindApiSession({ token: `tok-${userId}`, userId, onInvalid: jest.fn() });
  });
  return fresh;
}

describe('what may be queued', () => {
  test.each(['/day/quests/WATER/progress', '/day/bedtime', '/nutrition/log', '/workout/complete'])(
    '%s is queueable and is a POST the contract marks idempotent',
    path => {
      expect(isQueueable(path)).toBe(true);
      const segments = path.split('/');
      const operation = OPERATIONS.find(candidate => {
        const pattern = candidate.path.split('/');
        return candidate.method === 'POST' && pattern.length === segments.length && pattern.every((part, i) => part.startsWith(':') || part === segments[i]);
      });
      expect(operation).toMatchObject({ method: 'POST', idempotent: true });
    },
  );

  test.each(['/journal', '/day/quests/WATER/undo', '/day/quests//progress', '/day/quests/A/B/progress', '/nutrition/swap', '/auth/login', '/nutrition/log/'])(
    '%s is refused and nothing reaches the disk',
    async path => {
      expect(isQueueable(path)).toBe(false);
      await expect(enqueueAction(action('x', A, { path }))).rejects.toMatchObject({ code: 'NOT_QUEUEABLE' });
      expect(await AsyncStorage.getAllKeys()).toEqual([]);
    },
  );
});

describe('persist before send', () => {
  test('the action is on disk, under its user, before fetch is called', async () => {
    let diskAtSend: string[] | undefined;
    fetchMock.mockImplementation(async () => {
      diskAtSend = await idsOnDisk(A);
      return respond(200, { ok: true });
    });
    await enqueueAction(action('a1'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([`pending:v1:${A}`]);
    expect(await onDisk(`pending:v1:${A}`)).toEqual([{ ...action('a1'), attempts: 0, status: 'queued' }]);

    expect(await flushPending(A)).toEqual({ sent: ['a1'], rejected: [], remaining: 0 });
    expect(diskAtSend).toEqual(['a1']);
    expect(await idsOnDisk(A)).toEqual([]);
  });

  test('while the write to disk is still under way the action cannot be sent', async () => {
    let written!: () => void;
    const setItem = AsyncStorage.setItem;
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      await new Promise<void>(resolve => (written = resolve));
      return setItem(key, value);
    });
    const enqueued = enqueueAction(action('a1'));
    await jest.advanceTimersByTimeAsync(0);
    const early = flushPending(A);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await idsOnDisk(A)).toEqual([]);

    written();
    await enqueued;
    await early;
    expect(await idsOnDisk(A)).toEqual(['a1']);
    expect(await flushPending(A)).toEqual({ sent: ['a1'], rejected: [], remaining: 0 });
    expect(keysSent()).toEqual(['a1']);
  });

  test('a restart reads the same actions in the same order and sends them with their ids', async () => {
    fetchMock.mockImplementation(offline);
    for (const id of ['a1', 'a2', 'a3']) await enqueueAction(action(id, A, { path: id === 'a2' ? '/day/bedtime' : '/nutrition/log' }));
    await flushPending(A); // one failed attempt, so `attempts` and `sending` have been through memory

    const fresh = restart(A);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => respond(200, { ok: true }));
    expect(await fresh.flushPending(A)).toEqual({ sent: ['a1', 'a2', 'a3'], rejected: [], remaining: 0 });
    expect(sent().map(request => [request.key, request.path])).toEqual([
      ['a1', '/nutrition/log'],
      ['a2', '/day/bedtime'],
      ['a3', '/nutrition/log'],
    ]);
  });

  test('an action that could not be written is refused, and what was on disk is left alone', async () => {
    await enqueueAction(action('a1'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(enqueueAction(action('a2'))).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect(await idsOnDisk(A)).toEqual(['a1']);
    await flushPending(A);
    expect(keysSent()).toEqual(['a1']);
  });

  test('unsentCount: the length of the queue, and "cannot tell" (not 0) while the disk cannot be read', async () => {
    await AsyncStorage.setItem(`pending:v1:${A}`, JSON.stringify([{ ...action('old'), attempts: 0, status: 'queued' }]));
    const fresh = restart(A);
    const read = jest.spyOn(AsyncStorage, 'getMany').mockRejectedValue(new Error('io'));
    expect(await fresh.flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 0 });
    expect(await fresh.unsentCount(A)).toBeUndefined();
    read.mockRestore();
    expect(await fresh.unsentCount(A)).toBe(1);
    expect(await unsentCount(B)).toBe(0);
  });

  test('a disk that cannot be read is not mistaken for an empty queue', async () => {
    await AsyncStorage.setItem(`pending:v1:${A}`, JSON.stringify([{ ...action('old'), attempts: 0, status: 'queued' }]));
    const fresh = restart(A);
    jest.spyOn(AsyncStorage, 'getMany').mockRejectedValueOnce(new Error('io'));
    await expect(fresh.enqueueAction(action('new'))).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
    expect(await idsOnDisk(A)).toEqual(['old']);
    // the next attempt reads again
    await fresh.enqueueAction(action('new'));
    expect(await idsOnDisk(A)).toEqual(['old', 'new']);
  });
});

describe('flush', () => {
  test('FIFO with the original ids; NETWORK on the second stops there and the next flush resumes with the same ids', async () => {
    for (const id of ['a1', 'a2', 'a3']) await enqueueAction(action(id));
    fetchMock.mockImplementation((_url, init) => (init.headers['Idempotency-Key'] === 'a2' ? offline() : Promise.resolve(respond(200, { ok: true }))));

    expect(await flushPending(A)).toEqual({ sent: ['a1'], rejected: [], remaining: 2 });
    expect(keysSent()).toEqual(['a1', 'a2']);
    expect(await idsOnDisk(A)).toEqual(['a2', 'a3']);

    fetchMock.mockImplementation(async () => respond(200, { ok: true }));
    expect(await flushPending(A)).toEqual({ sent: ['a2', 'a3'], rejected: [], remaining: 0 });
    expect(keysSent()).toEqual(['a1', 'a2', 'a2', 'a3']);
    expect(sent().every(request => request.bearer === `Bearer tok-${A}`)).toBe(true);
    expect(await idsOnDisk(A)).toEqual([]);
  });

  test.each([
    ['500 INTERNAL', () => Promise.resolve(refuse(500, 'INTERNAL'))],
    ['503 from a proxy, not JSON', () => Promise.resolve(respond(503, '<html>'))],
    ['429 RATE_LIMITED (the key is still in flight on the server)', () => Promise.resolve(refuse(429, 'RATE_LIMITED'))],
    ['401 SESSION_INVALID (the session was refused, not the record)', () => Promise.resolve(refuse(401, 'SESSION_INVALID'))],
    ['a 403 page that is not an API answer', () => Promise.resolve(respond(403, '<html>captive portal</html>'))],
    ['a 200 that is not JSON', () => Promise.resolve(respond(200, '<html>captive portal</html>'))],
    ['NETWORK', offline],
  ])('%s keeps the action and stops the flush', async (_name, answer) => {
    await enqueueAction(action('a1'));
    await enqueueAction(action('a2'));
    fetchMock.mockImplementation(answer);
    expect(await flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 2 });
    expect(keysSent()).toEqual(['a1']);
    expect(await idsOnDisk(A)).toEqual(['a1', 'a2']);
    expect(await AsyncStorage.getItem(`rejected:v1:${A}`)).toBeNull();
  });

  test('TIMEOUT keeps the action', async () => {
    await enqueueAction(action('a1'));
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))));
    const flushing = flushPending(A);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await flushing).toEqual({ sent: [], rejected: [], remaining: 1 });
    expect(await idsOnDisk(A)).toEqual(['a1']);
  });

  test.each([
    [409, 'DAY_CLOSED'],
    [422, 'VALIDATION_FAILED'],
    [404, 'QUEST_NOT_FOUND'],
  ])('%i %s removes the action, records the rejection without its body and goes on', async (status, code) => {
    await enqueueAction(action('a1', A, { path: '/nutrition/log', body: { kcal: 640 } }));
    await enqueueAction(action('a2'));
    fetchMock.mockImplementation((_url, init) => Promise.resolve(init.headers['Idempotency-Key'] === 'a1' ? refuse(status, code) : respond(200, { ok: true })));

    expect(await flushPending(A)).toEqual({ sent: ['a2'], rejected: [{ id: 'a1', code }], remaining: 0 });
    expect(await idsOnDisk(A)).toEqual([]);
    expect(await onDisk(`rejected:v1:${A}`)).toEqual([{ id: 'a1', path: '/nutrition/log', code, at: new Date(T0).toISOString() }]);
    expect(await AsyncStorage.getItem(`rejected:v1:${A}`)).not.toContain('640');

    // a removed action is final: nothing is sent again
    await flushPending(A);
    expect(keysSent()).toEqual(['a1', 'a2']);
  });

  describe('an answer that was lost (the server compares the body per key, as docs/backend.md says)', () => {
    /** Commits what it has not seen and answers; a repeated key answers the same again only for the same body. */
    function bodyComparingServer(loseFirstAnswer: boolean) {
      const committed = new Map<string, string>();
      fetchMock.mockImplementation(async (_url, init) => {
        const key = init.headers['Idempotency-Key'];
        const had = committed.get(key);
        if (had === undefined) {
          committed.set(key, init.body ?? '');
          if (loseFirstAnswer && committed.size === 1) throw new TypeError('Network request failed');
          return respond(200, { ok: true });
        }
        return had === init.body ? respond(200, { ok: true }) : refuse(409, 'IDEMPOTENCY_KEY_REUSED');
      });
      return committed;
    }

    test('committed inside 60 s, answer lost, retried after 61 s with occurredAt: 409 IDEMPOTENCY_KEY_REUSED means delivered', async () => {
      const committed = bodyComparingServer(true);
      await enqueueAction(action('a1'));
      await enqueueAction(action('a2'));
      expect(await flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 2 });
      expect([...committed.keys()]).toEqual(['a1']); // the server has it; the phone does not know

      jest.setSystemTime(T0 + 61_000);
      expect(await flushPending(A)).toEqual({ sent: ['a1', 'a2'], rejected: [], remaining: 0 });
      expect(sent().map(request => [request.key, 'occurredAt' in request.body])).toEqual([
        ['a1', false],
        ['a1', true],
        ['a2', true],
      ]);
      expect(await idsOnDisk(A)).toEqual([]);
      expect(await AsyncStorage.getItem(`rejected:v1:${A}`)).toBeNull();
    });

    test('the flush listener is told it was delivered (so the screens are refreshed) and, after a wait, that the queue caught up', async () => {
      bodyComparingServer(true);
      const heard: unknown[] = [];
      const stop = onFlushed((userId, report, caughtUp) => heard.push([userId, report, caughtUp]));
      await enqueueAction(action('a1'));
      await flushPending(A);
      jest.setSystemTime(T0 + 61_000);
      await flushPending(A);
      stop();
      expect(heard).toEqual([
        [A, { sent: [], rejected: [], remaining: 1 }, false],
        [A, { sent: ['a1'], rejected: [], remaining: 0 }, true],
      ]);
    });

    test('a caller still waiting for such an action is told "queued" (delivered, no answer to hand over), never "failed"', async () => {
      await enqueueAction(action('a1'));
      fetchMock.mockImplementation(async () => refuse(409, 'IDEMPOTENCY_KEY_REUSED'));
      expect(await deliver(A, 'a1')).toEqual({ state: 'queued' });
      expect(await idsOnDisk(A)).toEqual([]);
      expect(await AsyncStorage.getItem(`rejected:v1:${A}`)).toBeNull();
    });
  });

  test('two concurrent flushes send each action once', async () => {
    for (const id of ['a1', 'a2', 'a3']) await enqueueAction(action(id));
    const reports = await Promise.all([flushPending(A), flushPending(A)]);
    expect(keysSent()).toEqual(['a1', 'a2', 'a3']);
    expect(reports[0]).toEqual({ sent: ['a1', 'a2', 'a3'], rejected: [], remaining: 0 });
    expect(reports[1]).toBe(reports[0]);
  });

  test('a flush that starts while another is in flight sends nothing twice, and one after it starts afresh', async () => {
    await enqueueAction(action('a1'));
    let finish!: (response: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)));
    const first = flushPending(A);
    await jest.advanceTimersByTimeAsync(0);
    const second = flushPending(A);
    await enqueueAction(action('a2')); // arrives during the flight: the same flight takes it
    finish(respond(200, { ok: true }));
    expect(await second).toBe(await first);
    expect(keysSent()).toEqual(['a1', 'a2']);
    await enqueueAction(action('a3'));
    expect(await flushPending(A)).toEqual({ sent: ['a3'], rejected: [], remaining: 0 });
  });

  test('after a 2xx the action is gone even when the disk refuses the write, so it is not sent in a loop', async () => {
    await enqueueAction(action('a1'));
    await enqueueAction(action('a2'));
    const setItem = AsyncStorage.setItem;
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation((key, value) => (fetchMock.mock.calls.length === 1 ? Promise.reject(new Error('disk full')) : setItem(key, value)));
    expect(await flushPending(A)).toEqual({ sent: ['a1', 'a2'], rejected: [], remaining: 0 });
    expect(keysSent()).toEqual(['a1', 'a2']);
    expect(await idsOnDisk(A)).toEqual([]);
  });
});

describe('never under another account', () => {
  test("flushPending('B') sends nothing and leaves A's actions alone; signed in as A again they go out", async () => {
    await enqueueAction(action('a1'));
    await enqueueAction(action('a2'));
    signIn(B);
    expect(await flushPending(B)).toEqual({ sent: [], rejected: [], remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await idsOnDisk(A)).toEqual(['a1', 'a2']);

    signIn(A);
    expect(await flushPending(A)).toEqual({ sent: ['a1', 'a2'], rejected: [], remaining: 0 });
    expect(sent().map(request => request.bearer)).toEqual([`Bearer tok-${A}`, `Bearer tok-${A}`]);
  });

  test("A's queue is not flushed while B is the signed-in user, nor while nobody is", async () => {
    await enqueueAction(action('a1'));
    signIn(B);
    expect(await flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 1 });
    bindApiSession(null);
    expect(await flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await idsOnDisk(A)).toEqual(['a1']);
  });

  test('the account changes in the middle of a flush: the rest of the queue stays, nothing goes out with the other token', async () => {
    for (const id of ['a1', 'a2', 'a3']) await enqueueAction(action(id));
    fetchMock.mockImplementation(async () => {
      signIn(B); // A's session ended and B signed in while a1 was on its way
      return respond(200, { ok: true });
    });
    expect(await flushPending(A)).toEqual({ sent: ['a1'], rejected: [], remaining: 2 });
    expect(sent().map(request => [request.key, request.bearer])).toEqual([['a1', `Bearer tok-${A}`]]);
    expect(await idsOnDisk(A)).toEqual(['a2', 'a3']);
    expect(await AsyncStorage.getItem(`pending:v1:${B}`)).toBeNull();
  });

  test('actions stored under one user but naming another are not trusted', async () => {
    await AsyncStorage.setItem(`pending:v1:${A}`, JSON.stringify([{ ...action('b1', B), attempts: 0, status: 'queued' }]));
    const fresh = restart(A);
    expect(await fresh.flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('occurredAt (AR-08)', () => {
  test('absent when the action leaves within 60 s of its creation', async () => {
    await enqueueAction(action('a1'));
    jest.setSystemTime(T0 + 60_000);
    await flushPending(A);
    expect(sent()[0].body).toEqual({ amount: 1 });
  });

  test('equal to createdAt when it leaves later, on the first send and on a retry alike', async () => {
    const createdAt = new Date(T0).toISOString();
    await enqueueAction(action('a1'));
    fetchMock.mockImplementationOnce(offline);
    await flushPending(A); // within 60 s, fails
    jest.setSystemTime(T0 + 60_001);
    await flushPending(A);
    expect(sent().map(request => request.body)).toEqual([{ amount: 1 }, { amount: 1, occurredAt: createdAt }]);
    expect(keysSent()).toEqual(['a1', 'a1']);
  });
});

describe('limits and damage', () => {
  test(`the queue holds ${QUEUE_LIMIT} actions; one more is refused with QUEUE_FULL and is not stored`, async () => {
    const full = Array.from({ length: QUEUE_LIMIT }, (_, i) => ({ ...action(`a${i}`), attempts: 0, status: 'queued' }));
    await AsyncStorage.setItem(`pending:v1:${A}`, JSON.stringify(full.slice(0, QUEUE_LIMIT - 1)));
    const fresh = restart(A);
    await fresh.enqueueAction(action(`a${QUEUE_LIMIT - 1}`));
    expect((await idsOnDisk(A)).length).toBe(QUEUE_LIMIT);

    const refused = await fresh.enqueueAction(action('one-too-many')).catch((failure: unknown) => failure);
    expect(refused).toBeInstanceOf(fresh.QueueError);
    expect(refused).toMatchObject({ code: 'QUEUE_FULL' });
    expect(new QueueError('QUEUE_FULL').message).toBe('QUEUE_FULL');
    expect(await idsOnDisk(A)).toEqual(full.map(item => item.id));
  });

  test.each([
    ['broken JSON', '[{"id":"a1","pa'],
    ['not a list', '{"id":"a1"}'],
    ['a list with something that is not an action', JSON.stringify([{ id: 'a1', path: '/journal', body: {} }])],
  ])('corrupted storage (%s): empty queue, the corrupt text kept, the notice raised once', async (_name, damaged) => {
    await AsyncStorage.setItem(`pending:v1:${A}`, damaged);
    const fresh = restart(A);
    const corrupted = renderHook(() => fresh.useQueueCorrupted(A));
    const pending = renderHook(() => fresh.usePendingActions(A));
    await act(async () => {
      expect(await fresh.flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 0 });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pending.result.current).toEqual([]);
    expect(corrupted.result.current).toBe(true);
    expect(await AsyncStorage.getItem(`pending:v1:${A}:corrupt`)).toBe(damaged);
    expect(await AsyncStorage.getItem(`pending:v1:${A}`)).toBeNull();

    // new actions are stored and sent as usual
    await act(() => fresh.enqueueAction(action('a9')));
    expect(await idsOnDisk(A)).toEqual(['a9']);

    act(() => fresh.dismissCorruptNotice(A));
    expect(corrupted.result.current).toBe(false);
    // the copy stays for a later look; the next start does not raise the notice again
    expect(await AsyncStorage.getItem(`pending:v1:${A}:corrupt`)).toBe(damaged);
    const again = restart(A);
    const next = renderHook(() => again.useQueueCorrupted(A));
    await act(() => again.flushPending(A).then(() => undefined));
    expect(next.result.current).toBe(false);
    corrupted.unmount();
    pending.unmount();
    next.unmount();
  });
});

describe('sign-out and late answers', () => {
  test('clearPendingFor removes the queue, the rejections and the corrupt copy of that user only', async () => {
    await enqueueAction(action('a1'));
    await enqueueAction(action('b1', B));
    await AsyncStorage.setItem(`rejected:v1:${A}`, '[]');
    await AsyncStorage.setItem(`pending:v1:${A}:corrupt`, 'x');
    await AsyncStorage.setItem(`cache:v1:${A}:me`, '1');
    await clearPendingFor(A);
    expect((await AsyncStorage.getAllKeys()).sort()).toEqual([`cache:v1:${A}:me`, `pending:v1:${B}`]);
    expect(await flushPending(A)).toEqual({ sent: [], rejected: [], remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['a 2xx', () => respond(200, { ok: true })],
    ['a refusal', () => refuse(409, 'DAY_CLOSED')],
  ])('%s that arrives after the queue was wiped writes nothing back', async (_name, answer) => {
    await enqueueAction(action('a1'));
    await enqueueAction(action('a2'));
    let aborted = false;
    let finish!: (response: unknown) => void;
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise(resolve => {
          finish = resolve;
          init.signal.addEventListener('abort', () => (aborted = true));
        }),
    );
    const flushing = flushPending(A);
    await jest.advanceTimersByTimeAsync(0);
    expect(keysSent()).toEqual(['a1']);

    await clearPendingFor(A); // the user signed out and chose to drop what was waiting
    expect(aborted).toBe(true);
    finish(answer());
    expect(await flushing).toEqual({ sent: [], rejected: [], remaining: 0 });
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(keysSent()).toEqual(['a1']);
  });
});

describe('what the screens read', () => {
  test('usePendingActions follows the queue, with `sending` while a request is out', async () => {
    const view = renderHook(() => ({ pending: usePendingActions(A), waiting: useWaitingCount(A), nobody: usePendingActions(null) }));
    await act(() => enqueueAction(action('a1')));
    await act(() => enqueueAction(action('a2')));
    expect(view.result.current.pending.map(item => [item.id, item.status, item.attempts])).toEqual([
      ['a1', 'queued', 0],
      ['a2', 'queued', 0],
    ]);
    expect(view.result.current.nobody).toEqual([]);
    // nothing has failed yet: these are on their way, not waiting for the network
    expect(view.result.current.waiting).toBe(0);

    let fail!: (reason: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
    let flushing!: Promise<unknown>;
    await act(async () => {
      flushing = flushPending(A);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current.pending.map(item => [item.id, item.status, item.attempts])).toEqual([
      ['a1', 'sending', 1],
      ['a2', 'queued', 0],
    ]);
    await act(async () => {
      fail(new TypeError('Network request failed'));
      await flushing;
    });
    expect(view.result.current.pending.map(item => [item.id, item.status, item.attempts])).toEqual([
      ['a1', 'queued', 1],
      ['a2', 'queued', 0],
    ]);
    expect(view.result.current.waiting).toBe(2);

    // the count does not flicker while the retry is out, and drops to nothing once the path works again
    await act(() => flushPending(A).then(() => undefined));
    expect(view.result.current.pending).toEqual([]);
    expect(view.result.current.waiting).toBe(0);
    view.unmount();
  });

  test('what is left behind a first success is still waiting: the count is the rest of the queue, during the flush and after it stops', async () => {
    const view = renderHook(() => useWaitingCount(A));
    fetchMock.mockImplementation(offline);
    for (const id of ['a1', 'a2', 'a3']) await act(() => enqueueAction(action(id)));
    await act(() => flushPending(A).then(() => undefined));
    expect(view.result.current).toBe(3);

    let fail!: (reason: unknown) => void;
    fetchMock.mockImplementation((_url, init) =>
      init.headers['Idempotency-Key'] === 'a1' ? Promise.resolve(respond(200, { ok: true })) : new Promise((_resolve, reject) => (fail = reject)),
    );
    let flushing!: Promise<unknown>;
    await act(async () => {
      flushing = flushPending(A);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(keysSent().slice(-2)).toEqual(['a1', 'a2']); // a1 delivered, a2 on its way
    expect(view.result.current).toBe(2);
    await act(async () => {
      fail(new TypeError('Network request failed'));
      await flushing;
    });
    expect(view.result.current).toBe(2);
    view.unmount();
  });

  test('actions left from an earlier run are waiting from the start', async () => {
    await AsyncStorage.setItem(`pending:v1:${A}`, JSON.stringify([{ ...action('old'), attempts: 3, status: 'sending' }]));
    const fresh = restart(A);
    const view = renderHook(() => ({ pending: fresh.usePendingActions(A), waiting: fresh.useWaitingCount(A) }));
    await act(async () => undefined);
    expect(view.result.current.pending.map(item => [item.id, item.status, item.attempts])).toEqual([['old', 'queued', 3]]);
    expect(view.result.current.waiting).toBe(1);
    view.unmount();
  });

  test('a rejection is shown until it is dismissed, and survives a restart', async () => {
    const view = renderHook(() => useRejectedActions(A));
    await enqueueAction(action('a1'));
    fetchMock.mockImplementation(async () => refuse(409, 'DAY_CLOSED'));
    await act(() => flushPending(A).then(() => undefined));
    expect(view.result.current).toEqual([{ id: 'a1', path: '/day/quests/WATER/progress', code: 'DAY_CLOSED', at: new Date(T0).toISOString() }]);

    const fresh = restart(A);
    const later = renderHook(() => fresh.useRejectedActions(A));
    await act(async () => undefined);
    expect(later.result.current.map(item => item.id)).toEqual(['a1']);

    await act(() => dismissRejected(A, 'a1'));
    expect(view.result.current).toEqual([]);
    expect(await onDisk(`rejected:v1:${A}`)).toEqual([]);
    view.unmount();
    later.unmount();
  });
});

describe('deliver (what useQueuedWrite is told)', () => {
  test('confirmed with the answer; nothing is recorded as rejected', async () => {
    await enqueueAction(action('a1'));
    fetchMock.mockImplementation(async () => respond(200, { actionId: 'a1' }));
    expect(await deliver(A, 'a1')).toEqual({ state: 'confirmed', result: { actionId: 'a1' } });
  });

  test('queued when the network is down, also behind an older action that cannot leave', async () => {
    await enqueueAction(action('a1'));
    fetchMock.mockImplementation(offline);
    expect(await deliver(A, 'a1')).toEqual({ state: 'queued' });
    await enqueueAction(action('a2'));
    expect(await deliver(A, 'a2')).toEqual({ state: 'queued' });
    expect(keysSent()).toEqual(['a1', 'a1']); // FIFO: a2 does not jump the queue
  });

  test('failed with the code and details goes to the caller only; a rejection nobody waits for goes to the notice', async () => {
    await enqueueAction(action('a1'));
    const details = { fields: [{ field: 'amount', rule: 'max' }] };
    fetchMock.mockImplementation(async () => respond(422, { error: { code: 'VALIDATION_FAILED', message: 'x', details } }));
    expect(await deliver(A, 'a1')).toEqual({ state: 'failed', code: 'VALIDATION_FAILED', details });
    expect(await AsyncStorage.getItem(`rejected:v1:${A}`)).toBeNull();
    expect(await idsOnDisk(A)).toEqual([]);

    await enqueueAction(action('a2'));
    await flushPending(A);
    expect((await onDisk(`rejected:v1:${A}`))?.map(item => item.id)).toEqual(['a2']);
  });
});
