import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { failureText, offlineTitle, queueFull, rejectedTitle, retry, waitingOnDevice } from '../../shared/i18n/vi/sync';
import { QUEUE_LIMIT } from '../../shared/storage/pendingActions';
import {
  USER,
  WATER,
  app,
  fetchMock,
  idsOnDisk,
  installSyncTestEnv,
  mountApp,
  onboarded,
  refuse,
  rejectedKey,
  respond,
  seedQueue,
  server,
  settle,
  stored,
  writes,
} from './syncTestKit';
import type { QueuedWriteResult } from './useQueuedWrite';

installSyncTestEnv();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tick = { path: WATER, body: { amount: 1 } };
async function send(input: { path: string; body: Record<string, unknown> } = tick) {
  let result!: QueuedWriteResult<unknown>;
  await act(async () => {
    result = await app.send(input);
  });
  return result;
}

test('confirmed: the record was on this device before it was sent, went out once with its id, and is then gone from the queue', async () => {
  const view = await mountApp();
  let diskAtSend: string[] = [];
  server.write = async () => {
    diskAtSend = await idsOnDisk();
    return respond(200, { actionId: 'from-server', delta: { xp: 5 } });
  };
  const result = await send();
  expect(result).toEqual({ state: 'confirmed', id: expect.stringMatching(UUID_V4), result: { actionId: 'from-server', delta: { xp: 5 } } });
  expect(writes()).toEqual([{ path: WATER, id: result.id, body: { amount: 1 } }]);
  expect(diskAtSend).toEqual([result.id]);
  expect(await idsOnDisk()).toEqual([]);
  // an ordinary online write never shows the waiting row
  expect(screen.queryByText(waitingOnDevice(1))).toBeNull();
  expect(screen.queryByText(offlineTitle)).toBeNull();
  view.unmount();
});

test('queued: without a network the record stays on this device, and the retry carries the same id', async () => {
  const view = await mountApp();
  server.down = true;
  const result = await send();
  expect(result).toEqual({ state: 'queued', id: expect.stringMatching(UUID_V4) });
  expect(await idsOnDisk()).toEqual([result.id]);
  expect(screen.getByText(offlineTitle)).toBeTruthy();
  expect(screen.getByText(waitingOnDevice(1))).toBeTruthy();

  server.down = false;
  fireEvent.press(screen.getByRole('button', { name: retry }));
  await settle();
  expect(writes().map(request => request.id)).toEqual([result.id, result.id]);
  expect(writes()[1].body).toEqual({ amount: 1 }); // sent within 60 s: no occurredAt
  expect(await idsOnDisk()).toEqual([]);
  view.unmount();
});

test('records made offline keep their order and each its own id; the next write goes out behind them', async () => {
  const view = await mountApp();
  server.down = true;
  const first = await send({ path: WATER, body: { amount: 1 } });
  const second = await send({ path: '/nutrition/log', body: { kcal: 320 } });
  expect(first.id).not.toBe(second.id);
  expect(await idsOnDisk()).toEqual([first.id, second.id]);
  expect(screen.getByText(waitingOnDevice(2))).toBeTruthy();

  server.down = false;
  const third = await send({ path: '/day/bedtime', body: {} });
  expect(third.state).toBe('confirmed');
  expect(
    writes()
      .slice(-3)
      .map(request => [request.id, request.path]),
  ).toEqual([
    [first.id, WATER],
    [second.id, '/nutrition/log'],
    [third.id, '/day/bedtime'],
  ]);
  await settle();
  view.unmount();
});

test.each([
  ['409 DAY_CLOSED', () => refuse(409, 'DAY_CLOSED'), { code: 'DAY_CLOSED' }],
  [
    '422 VALIDATION_FAILED with its details',
    () => refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'amount', rule: 'max' }] }),
    { code: 'VALIDATION_FAILED', details: { fields: [{ field: 'amount', rule: 'max' }] } },
  ],
])('failed on %s: removed from the queue and told to the caller, not to the app-wide notice', async (_name, answer, expected) => {
  const view = await mountApp();
  server.write = answer;
  const result = await send();
  expect(result).toEqual({ state: 'failed', id: expect.stringMatching(UUID_V4), ...expected });
  expect(writes()).toHaveLength(1);
  expect(await idsOnDisk()).toEqual([]);
  expect(await AsyncStorage.getItem(rejectedKey())).toBeNull();
  expect(screen.queryByText(rejectedTitle)).toBeNull();

  // a refused record is final: nothing sends it again
  server.write = () => respond(200, { ok: true });
  await send();
  expect(writes()).toHaveLength(2);
  expect(writes()[1].id).not.toBe(result.id);
  await settle();
  view.unmount();
});

test(`a full queue (${QUEUE_LIMIT}) refuses the next record with QUEUE_FULL: nothing stored, nothing sent`, async () => {
  server.down = true;
  await seedQueue(Array.from({ length: QUEUE_LIMIT }, (_, i) => stored(`old-${i}`)));
  // offline start: the last known profile lets the user in
  await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(onboarded));
  const view = await mountApp();
  expect(screen.getByText(waitingOnDevice(QUEUE_LIMIT))).toBeTruthy();
  const sentBefore = fetchMock.mock.calls.length;

  const result = await send();
  expect(result).toEqual({ state: 'failed', id: expect.stringMatching(UUID_V4), code: 'QUEUE_FULL' });
  expect(failureText('QUEUE_FULL')).toBe(queueFull);
  expect(queueFull).toBe('Hàng chờ đã đầy, cần kết nối mạng để ghi tiếp');
  expect(fetchMock.mock.calls.length).toBe(sentBefore);
  expect((await idsOnDisk()).length).toBe(QUEUE_LIMIT);
  expect(await idsOnDisk()).not.toContain(result.id);
  view.unmount();
});

test('a path that is not queueable (journal text) is refused before anything is stored or sent', async () => {
  const view = await mountApp();
  const result = await send({ path: '/journal', body: { text: 'private words' } });
  expect(result).toMatchObject({ state: 'failed', code: 'NOT_QUEUEABLE' });
  expect(writes()).toEqual([]);
  expect(JSON.stringify(Object.entries(await AsyncStorage.getMany(await AsyncStorage.getAllKeys())))).not.toContain('private words');
  view.unmount();
});

test('nobody signed in: nothing is stored and nothing is sent', async () => {
  const view = await mountApp({ signedIn: false });
  const result = await send();
  expect(result).toMatchObject({ state: 'failed', code: 'SESSION_INVALID' });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
  view.unmount();
});

test('a screen that outlived its session files nothing for the user who left', async () => {
  const view = await mountApp();
  const staleSend = app.send;
  await act(() => app.session.signOut());
  let result!: QueuedWriteResult<unknown>;
  await act(async () => {
    result = await staleSend(tick);
  });
  expect(result).toMatchObject({ state: 'failed', code: 'SESSION_INVALID' });
  expect(writes()).toEqual([]);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
  view.unmount();
});
