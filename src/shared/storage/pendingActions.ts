import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { ApiError, api, boundUserId } from '../api/client';

/**
 * The pending-action queue: a record made without a network is written to this device first, sent later with the
 * id it was given once, and delivered under the account that made it or not at all.
 * Nothing here is logged. Journal text never comes through here: it is not a queueable path.
 */
export type PendingAction = {
  /** The action id = `Idempotency-Key`. Given once by the caller, never regenerated. */
  id: string;
  userId: string;
  method: 'POST';
  /** One of the queueable paths, see `isQueueable`. */
  path: string;
  body: Record<string, unknown>;
  /** ISO, device clock. Sent as `occurredAt` when the action leaves more than 60 s after it. */
  createdAt: string;
  attempts: number;
  /** `sending` only while a request for it is out; on disk it has no meaning. */
  status: 'queued' | 'sending';
};
export type FlushReport = { sent: string[]; rejected: { id: string; code: string }[]; remaining: number };
/** An action the server refused, kept until the person has read the notice. Never its body. */
export type RejectedAction = { id: string; path: string; code: string; at: string };
/** What became of one action, for the caller that is waiting for it. */
export type Settled =
  | { state: 'confirmed'; result: unknown }
  | { state: 'failed'; code: string; details?: Record<string, unknown> };

export class QueueError extends Error {
  /** `QUEUE_FULL`: the cap is reached. `STORAGE_FAILED`: this device could not keep it. `NOT_QUEUEABLE`: a caller bug. */
  code: 'QUEUE_FULL' | 'STORAGE_FAILED' | 'NOT_QUEUEABLE';

  constructor(code: QueueError['code']) {
    super(code);
    this.name = 'QueueError';
    this.code = code;
  }
}

export const QUEUE_LIMIT = 500;
const LATE_AFTER_MS = 60_000;

// NFR-03: the only writes that may wait for the network. Each is a POST the API contract marks idempotent.
const QUEUEABLE = new RegExp('^/(?:day/quests/[^/]+/progress|day/bedtime|nutrition/log|workout/complete)$');
export const isQueueable = (path: string) => QUEUEABLE.test(path);

const pendingKey = (userId: string) => `pending:v1:${userId}`;
const rejectedKey = (userId: string) => `rejected:v1:${userId}`;
const corruptKey = (userId: string) => `${pendingKey(userId)}:corrupt`;
const KEY = { pending: pendingKey, rejected: rejectedKey };

type Queue = {
  pending: PendingAction[];
  rejected: RejectedAction[];
  /** The stored queue could not be read: shown once, until dismissed. */
  corrupt: boolean;
  /** The last attempt got no usable answer, so everything in `pending` is waiting for the network. */
  stalled: boolean;
  loading: Promise<void> | null;
  /** Disk operations of this user, one at a time and in call order. */
  tail: Promise<unknown>;
  flight: Promise<FlushReport> | null;
  /** Aborted when the queue is wiped: whatever was under way for it then stops and writes nothing more. */
  abort: AbortController;
};

const queues = new Map<string, Queue>();
const subscribers = new Set<() => void>();
const publish = () => subscribers.forEach(notify => notify());
const subscribe = (notify: () => void) => {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
};

function queueOf(userId: string): Queue {
  let queue = queues.get(userId);
  if (!queue) {
    queue = { pending: [], rejected: [], corrupt: false, stalled: false, loading: null, tail: Promise.resolve(), flight: null, abort: new AbortController() };
    queues.set(userId, queue);
  }
  return queue;
}

function inTurn<T>(queue: Queue, step: () => Promise<T>): Promise<T> {
  const turn = queue.tail.then(step);
  queue.tail = turn.catch(() => undefined);
  return turn;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isAction = (userId: string) => (value: unknown) =>
  isObject(value) &&
  typeof value.id === 'string' &&
  value.userId === userId && // a list filed under one account that names another is not sent for either
  value.method === 'POST' &&
  typeof value.path === 'string' &&
  isQueueable(value.path) &&
  isObject(value.body) &&
  typeof value.createdAt === 'string' &&
  !Number.isNaN(Date.parse(value.createdAt));
const isRejection = (value: unknown) =>
  isObject(value) && typeof value.id === 'string' && typeof value.path === 'string' && typeof value.code === 'string' && typeof value.at === 'string';

/** The stored list; `[]` when nothing is stored; `undefined` when what is stored is not such a list. */
function parse(raw: string | null | undefined, valid: (item: unknown) => boolean): unknown[] | undefined {
  if (raw === null || raw === undefined) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) && list.every(valid) ? list : undefined;
  } catch {
    return undefined;
  }
}

async function load(userId: string, queue: Queue) {
  // A read that fails rejects here and is tried again later: an unread queue must never be taken for an empty one.
  const stored = await AsyncStorage.getMany([pendingKey(userId), rejectedKey(userId)]);
  const rawPending = stored[pendingKey(userId)];
  const pending = parse(rawPending, isAction(userId)) as PendingAction[] | undefined;
  const rejected = parse(stored[rejectedKey(userId)], isRejection) as RejectedAction[] | undefined;
  if (!pending && typeof rawPending === 'string') {
    // Not readable, not thrown away: the text is kept beside the queue and the person is told once.
    // ponytail: one copy per user, a second corruption overwrites the first; keep a list if support ever reads these.
    await AsyncStorage.setItem(corruptKey(userId), rawPending);
    await AsyncStorage.removeItem(pendingKey(userId));
  }
  if (!rejected) await AsyncStorage.removeItem(rejectedKey(userId));
  queue.pending = (pending ?? []).map(action => ({ ...action, attempts: Number(action.attempts) || 0, status: 'queued' }));
  queue.rejected = rejected ?? [];
  queue.corrupt = !pending || !rejected;
  queue.stalled = queue.pending.length > 0; // left from an earlier run: they have been waiting
  publish();
}

function ready(userId: string): Promise<Queue> {
  const queue = queueOf(userId);
  queue.loading ??= inTurn(queue, () => load(userId, queue)).catch((failure: unknown) => {
    queue.loading = null;
    throw failure;
  });
  return queue.loading.then(() => queue);
}

/**
 * Applies `change` to one of the two lists: on disk first, then in memory, in turn with every other write of this
 * user. `change` runs twice (for the disk, then on the list as it is afterwards), so it must be pure.
 * With `mustPersist` a failed disk write rejects and changes nothing; without it the memory still moves on.
 */
function commit<K extends 'pending' | 'rejected'>(
  userId: string,
  queue: Queue,
  list: K,
  change: (items: Queue[K]) => Queue[K],
  { signal, mustPersist = false }: { signal: AbortSignal; mustPersist?: boolean },
): Promise<void> {
  return inTurn(queue, async () => {
    // The queue was wiped after this was asked for (sign-out): a late answer must not put anything back.
    if (signal.aborted) {
      if (mustPersist) throw new QueueError('STORAGE_FAILED');
      return;
    }
    try {
      await AsyncStorage.setItem(KEY[list](userId), JSON.stringify(change(queue[list])));
    } catch (failure) {
      if (mustPersist) throw failure;
    }
    queue[list] = change(queue[list]);
    publish();
  });
}

/** Writes the action to this device. Resolves once it is on disk; rejects with a `QueueError` when it is not. */
export async function enqueueAction(action: Omit<PendingAction, 'attempts' | 'status'>): Promise<void> {
  if (action.method !== 'POST' || !isQueueable(action.path)) throw new QueueError('NOT_QUEUEABLE');
  try {
    const queue = await ready(action.userId);
    await commit(
      action.userId,
      queue,
      'pending',
      items => {
        if (items.length >= QUEUE_LIMIT) throw new QueueError('QUEUE_FULL');
        return [...items, { ...action, attempts: 0, status: 'queued' }];
      },
      { signal: queue.abort.signal, mustPersist: true },
    );
  } catch (failure) {
    throw failure instanceof QueueError ? failure : new QueueError('STORAGE_FAILED');
  }
}

function mark(queue: Queue, id: string, status: PendingAction['status']) {
  queue.pending = queue.pending.map(action => (action.id === id ? { ...action, status, attempts: action.attempts + (status === 'sending' ? 1 : 0) } : action));
  publish();
}

/**
 * Only a refusal the API itself gave removes an action. No answer (NETWORK, TIMEOUT), 5xx and 429 mean "later";
 * 401 means the session was refused, not the record; and an answer that is not the API's (`INTERNAL` below 500:
 * a captive portal, a proxy page) says nothing about the record at all.
 */
const isRefusal = (failure: unknown): failure is ApiError =>
  failure instanceof ApiError && failure.status >= 400 && failure.status < 500 && failure.status !== 401 && failure.status !== 429 && failure.code !== 'INTERNAL';

// Ids a caller is waiting for (`deliver`), and what became of them.
const awaited = new Map<string, Settled | null>();

type FlushListener = (userId: string, report: FlushReport, caughtUp: boolean) => void;
const flushListeners = new Set<FlushListener>();

/**
 * Tells `listener` about every flush that has ended, whoever started it. `caughtUp`: the queue had been waiting
 * for the network and this flush delivered the last of it. A flush cut short by a wipe (sign-out) is not reported.
 * Returns the unsubscribe function.
 */
export function onFlushed(listener: FlushListener): () => void {
  flushListeners.add(listener);
  return () => {
    flushListeners.delete(listener);
  };
}

async function run(userId: string, queue: Queue): Promise<FlushReport> {
  const report: FlushReport = { sent: [], rejected: [], remaining: 0 };
  const { signal } = queue.abort;
  let wasWaiting = false;
  try {
    await ready(userId);
    wasWaiting = queue.stalled;
    for (;;) {
      const action = queue.pending[0];
      // Never under another account: this check and the request below, which reads the bound token as it starts,
      // run in the same tick.
      if (!action || signal.aborted || boundUserId() !== userId) break;
      const { id, path, body, createdAt } = action;
      mark(queue, id, 'sending');
      try {
        const late = Date.now() - Date.parse(createdAt) > LATE_AFTER_MS;
        const result = await api.write<unknown>('POST', path, late ? { ...body, occurredAt: createdAt } : body, { idempotencyKey: id, signal });
        if (signal.aborted) break;
        queue.stalled = false;
        if (awaited.has(id)) awaited.set(id, { state: 'confirmed', result });
        await commit(userId, queue, 'pending', items => items.filter(item => item.id !== id), { signal });
        report.sent.push(id);
      } catch (failure) {
        if (signal.aborted) break;
        if (!isRefusal(failure)) {
          queue.stalled = true;
          mark(queue, id, 'queued');
          break;
        }
        const { code, details } = failure;
        queue.stalled = false;
        if (awaited.has(id)) {
          awaited.set(id, { state: 'failed', code, details });
        } else {
          // Nobody is waiting for the answer: keep it for the notice. Recorded before the action is removed, so
          // a crash in between repeats the refusal instead of losing it.
          const rejection = { id, path, code, at: new Date().toISOString() };
          await commit(userId, queue, 'rejected', items => (items.some(item => item.id === id) ? items : [...items, rejection]), { signal });
        }
        await commit(userId, queue, 'pending', items => items.filter(item => item.id !== id), { signal });
        report.rejected.push({ id, code });
      }
    }
  } catch {
    // the stored queue could not be read: nothing was sent, and the next flush reads again
  } finally {
    report.remaining = queue.pending.length;
    // Cleared in the same tick as the decision to stop: a caller that enqueues after it starts a new flight
    // instead of joining one that has already looked at the queue for the last time.
    queue.flight = null;
  }
  if (!signal.aborted) {
    const caughtUp = wasWaiting && report.sent.length > 0 && report.remaining === 0;
    for (const listener of [...flushListeners]) {
      try {
        listener(userId, report, caughtUp);
      } catch {
        // a listener's own failure is not the queue's
      }
    }
  }
  return report;
}

/**
 * Sends this user's queue in order, one flight at a time (a second call joins the flight and gets its report).
 * Stops at the first action that cannot leave now; sends nothing unless `userId` is the signed-in user. Never rejects.
 */
export function flushPending(userId: string): Promise<FlushReport> {
  const queue = queueOf(userId);
  queue.flight ??= run(userId, queue); // `run` awaits before it can end, so this assignment comes first
  return queue.flight;
}

/** For `useQueuedWrite`: flushes now and tells what became of this one action. A refusal goes to this caller only. */
export async function deliver(userId: string, id: string): Promise<Settled | { state: 'queued' }> {
  awaited.set(id, null);
  try {
    await flushPending(userId);
    return awaited.get(id) ?? { state: 'queued' };
  } finally {
    awaited.delete(id);
  }
}

/** Sign-out: forgets everything kept for this user (queue, rejections, corrupt copy) and stops its flush. */
export function clearPendingFor(userId: string): Promise<void> {
  const queue = queueOf(userId);
  queue.abort.abort();
  queue.abort = new AbortController();
  return inTurn(queue, async () => {
    queue.pending = [];
    queue.rejected = [];
    queue.corrupt = false;
    queue.stalled = false;
    publish();
    await AsyncStorage.removeMany([pendingKey(userId), rejectedKey(userId), corruptKey(userId)]);
  });
}

/** The person has read the notice about this refused action. */
export function dismissRejected(userId: string, id: string): Promise<void> {
  const queue = queueOf(userId);
  return commit(userId, queue, 'rejected', items => items.filter(item => item.id !== id), { signal: queue.abort.signal });
}

/** The person has read the notice about the unreadable queue. The stored copy stays until sign-out. */
export function dismissCorruptNotice(userId: string) {
  queueOf(userId).corrupt = false;
  publish();
}

/** Test hook only: forget what is in memory, so the next use reads the disk again as a cold start does. */
export function resetPendingForTests() {
  for (const queue of queues.values()) queue.abort.abort();
  queues.clear();
  awaited.clear();
}

const NONE: never[] = [];

function useQueue<T>(userId: string | null, read: (queue: Queue | undefined) => T): T {
  useEffect(() => {
    if (userId) ready(userId).catch(() => undefined);
  }, [userId]);
  return useSyncExternalStore(subscribe, () => read(userId ? queues.get(userId) : undefined));
}

/** Everything of this user that has not been confirmed yet, oldest first, including what is being sent right now. */
export const usePendingActions = (userId: string | null): PendingAction[] => useQueue(userId, queue => queue?.pending ?? NONE);
/**
 * How many actions are waiting for the network: 0 while requests are simply on their way, the whole queue once an
 * attempt got no answer. This, not the length of `usePendingActions`, is the number to show as "đang chờ gửi".
 */
export const useWaitingCount = (userId: string | null): number => useQueue(userId, queue => (queue?.stalled ? queue.pending.length : 0));
export const useRejectedActions = (userId: string | null): RejectedAction[] => useQueue(userId, queue => queue?.rejected ?? NONE);
export const useQueueCorrupted = (userId: string | null): boolean => useQueue(userId, queue => queue?.corrupt ?? false);
