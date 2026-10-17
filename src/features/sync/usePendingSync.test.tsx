import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { api } from '../../shared/api/client';
import { wipeQueries } from '../../shared/api/session';
import { retry, synced, waitingOnDevice } from '../../shared/i18n/vi/sync';
import {
  TOKEN,
  USER,
  app,
  fetchMock,
  idsOnDisk,
  installSyncTestEnv,
  mountApp,
  onboarded,
  pendingKey,
  queryClient,
  refuse,
  rejectedKey,
  requested,
  respond,
  seedQueue,
  server,
  settle,
  stored,
  writes,
} from './syncTestKit';

// The main group without its screens: every tab shows the notice with "Đăng xuất", whatever tabs the app has by now.
jest.mock('../../app/screens', () => ({ ...jest.requireActual('../../app/screens'), tabRoots: [] }));

installSyncTestEnv();

const sentIds = () => writes().map(request => request.id);
/** Offline start with records left from an earlier run: the cached profile lets the user in, the queue waits. */
async function startOffline(ids: string[]) {
  server.down = true;
  await seedQueue(ids.map(id => stored(id)));
  await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(onboarded));
  const view = await mountApp();
  expect(screen.getByText(waitingOnDevice(ids.length))).toBeTruthy();
  return view;
}
/** Which query keys were invalidated, in order. */
function watchInvalidations() {
  const spy = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
  return () => spy.mock.calls.map(call => JSON.stringify(call[0]?.queryKey));
}
// Timers only: a microtask queued by an unmount is not something that keeps Jest alive (as in __tests__/App.test.tsx).
const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });

test('session ready: what an earlier run left is sent in order with its ids, then day, me and progression are refreshed once', async () => {
  await seedQueue([stored('a1'), stored('a2', { path: '/nutrition/log', body: { kcal: 300 } })]);
  const invalidated = watchInvalidations();
  const view = await mountApp({ landed: false });
  await screen.findByText(synced);
  await settle();
  expect(writes()).toEqual([
    { path: '/day/quests/WATER/progress', id: 'a1', body: { amount: 1 } },
    { path: '/nutrition/log', id: 'a2', body: { kcal: 300 } },
  ]);
  expect(fetchMock.mock.calls.every(([, init]) => init.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  expect(await idsOnDisk()).toEqual([]);
  expect(invalidated()).toEqual(['["day"]', '["me"]', '["progression"]', '["mealPlan"]']);
  // GET /me: the gate's first load, then the refresh after the flush
  expect(requested('/me')).toBe(2);
  view.unmount();
});

test('a flush that only refused a record still refreshes day, me and progression: the optimistic value must not stay', async () => {
  await seedQueue([stored('a1')]);
  server.write = () => refuse(409, 'DAY_CLOSED');
  const invalidated = watchInvalidations();
  const view = await mountApp();
  expect(screen.getByRole('header', { name: 'Ghi nhận không được tính' })).toBeTruthy();
  expect(invalidated()).toEqual(['["day"]', '["me"]', '["progression"]', '["mealPlan"]']);
  expect(requested('/me')).toBe(2);
  view.unmount();
});

test('first send committed but its answer lost, retry after 61 s answered 409 IDEMPOTENCY_KEY_REUSED: delivered, no "not counted" notice', async () => {
  const createdAt = new Date(Date.now() - 30_000).toISOString();
  await seedQueue([stored('a1', { createdAt })]);
  const committed = new Map<string, string>(); // Idempotency-Key -> body, as the server's request hash
  server.write = () => {
    const [, init] = fetchMock.mock.calls.at(-1)!;
    const key = init.headers['Idempotency-Key'];
    const had = committed.get(key);
    if (had === undefined) {
      committed.set(key, init.body ?? ''); // the server committed it ...
      throw new TypeError('Network request failed'); // ... and the answer never reached the phone
    }
    return had === init.body ? respond(200, { ok: true }) : refuse(409, 'IDEMPOTENCY_KEY_REUSED');
  };
  const view = await mountApp();
  expect(writes().map(request => request.body)).toEqual([{ amount: 1 }]);
  expect(screen.getByText(waitingOnDevice(1))).toBeTruthy();

  const invalidated = watchInvalidations();
  const now = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now + 61_000);
  fireEvent.press(screen.getByRole('button', { name: retry }));
  await settle();

  expect(writes().map(request => request.body)).toEqual([{ amount: 1 }, { amount: 1, occurredAt: createdAt }]);
  expect(screen.queryByRole('header', { name: 'Ghi nhận không được tính' })).toBeNull();
  expect(await idsOnDisk()).toEqual([]);
  expect(await AsyncStorage.getItem(rejectedKey())).toBeNull();
  expect(invalidated()).toEqual(['["day"]', '["me"]', '["progression"]', '["mealPlan"]']);
  expect(screen.getByText(synced)).toBeTruthy();
  view.unmount();
});

test('a flush that sends nothing refreshes nothing', async () => {
  const invalidated = watchInvalidations();
  const view = await mountApp();
  await act(() => api.get('/settings').then(() => undefined));
  await settle();
  expect(writes()).toEqual([]);
  expect(invalidated()).toEqual([]);
  expect(requested('/me')).toBe(1);
  view.unmount();
});

test("another user's records on this device are not sent in this session, and stay where they are", async () => {
  await seedQueue([stored('other-1', { userId: 'someone-else' })], 'someone-else');
  const view = await mountApp();
  await act(() => api.get('/settings').then(() => undefined));
  await settle();
  expect(writes()).toEqual([]);
  expect(await idsOnDisk('someone-else')).toEqual(['other-1']);
  view.unmount();
});

test('the app returns to the foreground: the queue is flushed', async () => {
  const handlers: ((state: AppStateStatus) => void)[] = [];
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (state: AppStateStatus) => void) => {
    handlers.push(handler);
    return { remove };
  }) as never);
  const view = await startOffline(['a1']);
  expect(sentIds()).toEqual(['a1']);

  server.down = false;
  await act(async () => handlers.forEach(handler => handler('background')));
  await settle();
  expect(sentIds()).toEqual(['a1']);
  await act(async () => handlers.forEach(handler => handler('active')));
  await settle();
  expect(sentIds()).toEqual(['a1', 'a1']);
  expect(await idsOnDisk()).toEqual([]);

  // every subscription made along the way is gone after unmount
  view.unmount();
  expect(handlers.length).toBeGreaterThan(0);
  expect(remove).toHaveBeenCalledTimes(handlers.length);
});

test('any request that gets through flushes the queue', async () => {
  const view = await startOffline(['a1', 'a2']);
  server.down = false;
  await act(() => api.get('/settings').then(() => undefined));
  await settle();
  expect(sentIds()).toEqual(['a1', 'a1', 'a2']);
  expect(await idsOnDisk()).toEqual([]);
  expect(screen.queryByText(waitingOnDevice(2))).toBeNull();
  view.unmount();
});

test('every 30 s while something is queued, not at all once the queue is empty, and no timer after unmount', async () => {
  fakeTimers();
  const view = await startOffline(['a1']);
  expect(sentIds()).toEqual(['a1']);
  await act(() => jest.advanceTimersByTimeAsync(29_000));
  expect(sentIds()).toEqual(['a1']);
  await act(() => jest.advanceTimersByTimeAsync(1_000));
  expect(sentIds()).toEqual(['a1', 'a1']);
  await act(() => jest.advanceTimersByTimeAsync(30_000));
  expect(sentIds()).toEqual(['a1', 'a1', 'a1']);

  server.down = false;
  await act(() => jest.advanceTimersByTimeAsync(30_000));
  expect(sentIds()).toEqual(['a1', 'a1', 'a1', 'a1']);
  expect(await idsOnDisk()).toEqual([]);
  // "Đã đồng bộ" is shown for a moment, then the row is gone and so is the interval
  expect(screen.getByText(synced)).toBeTruthy();
  await act(() => jest.advanceTimersByTimeAsync(4_000));
  expect(screen.queryByText(synced)).toBeNull();
  const quiet = fetchMock.mock.calls.length;
  await act(() => jest.advanceTimersByTimeAsync(120_000));
  expect(fetchMock.mock.calls.length).toBe(quiet);

  view.unmount();
  wipeQueries(queryClient());
  expect(jest.getTimerCount()).toBe(0);
});

test('unmounting while records wait leaves no timer behind', async () => {
  fakeTimers();
  const view = await startOffline(['a1']);
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  wipeQueries(queryClient());
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(sentIds()).toEqual(['a1']);
});

test('"Thử lại" sends the queue again with the same ids', async () => {
  const view = await startOffline(['a1', 'a2']);
  fireEvent.press(screen.getByRole('button', { name: retry }));
  await settle();
  expect(sentIds()).toEqual(['a1', 'a1']); // still offline: the flush stops at the first again

  server.down = false;
  fireEvent.press(screen.getByRole('button', { name: retry }));
  await settle();
  expect(sentIds()).toEqual(['a1', 'a1', 'a1', 'a2']);
  expect(await idsOnDisk()).toEqual([]);
  view.unmount();
});

test('a record that is 61 s old when it finally leaves carries occurredAt = its createdAt', async () => {
  const createdAt = new Date(Date.now() - 61_000).toISOString();
  await seedQueue([stored('late', { createdAt }), stored('fresh')]);
  const view = await mountApp();
  expect(writes().map(request => request.body)).toEqual([{ amount: 1, occurredAt: createdAt }, { amount: 1 }]);
  view.unmount();
});

test('the session expires while a record is on its way: the queue is kept for that user, and nothing touches the cache afterwards', async () => {
  await seedQueue([stored('a1'), stored('a2')]);
  let finish!: (response: unknown) => void;
  server.write = () => new Promise(resolve => (finish = resolve));
  const view = await mountApp();
  expect(sentIds()).toEqual(['a1']);
  const invalidated = watchInvalidations();

  // another request is told the session is dead: the app is back on the signed-out screens
  server.me = () => refuse(401, 'SESSION_INVALID');
  await act(() => api.get('/me').catch(() => undefined));
  await screen.findByRole('header', { name: 'Chào bạn trở lại' });
  expect(await idsOnDisk()).toEqual(['a1', 'a2']);

  // a1 had reached the server: it is taken off its owner's queue, a2 is not sent without a session
  await act(async () => finish(respond(200, { ok: true })));
  await settle();
  expect(sentIds()).toEqual(['a1']);
  expect(await idsOnDisk()).toEqual(['a2']);
  expect(invalidated()).toEqual([]);
  expect(await AsyncStorage.getAllKeys()).toEqual([pendingKey()]);

  // the same user signs in again: the rest goes out, with its id
  server.me = () => respond(200, onboarded);
  server.write = () => respond(200, { ok: true });
  await act(() => app.session.signIn('tok-second-session', USER));
  await settle();
  expect(sentIds()).toEqual(['a1', 'a2']);
  expect(fetchMock.mock.calls.at(-1)?.[1].headers.Authorization).not.toBe(`Bearer ${TOKEN}`);
  expect(await idsOnDisk()).toEqual([]);
  view.unmount();
});

test('a flush that ends while its user is on the way out (token already unbound, screens not yet told) refreshes nothing', async () => {
  await seedQueue([stored('a1')]);
  let finish!: (response: unknown) => void;
  server.write = () => new Promise(resolve => (finish = resolve));
  const view = await mountApp();
  expect(sentIds()).toEqual(['a1']);

  // a slow keychain holds the sign-out that the 401 starts right after the client has dropped the token
  let forget!: () => void;
  (Keychain.resetGenericPassword as jest.Mock).mockImplementationOnce(() => new Promise(resolve => (forget = () => resolve(true))));
  server.me = () => refuse(401, 'SESSION_INVALID');
  await act(() => api.get('/me').catch(() => undefined));
  expect(app.session.status).toBe('signedIn');

  const invalidated = watchInvalidations();
  await act(async () => finish(respond(200, { ok: true })));
  await settle();
  expect(invalidated()).toEqual([]);

  await act(async () => forget());
  await screen.findByRole('header', { name: 'Chào bạn trở lại' });
  await settle();
  view.unmount();
});

describe('"Đăng xuất" in the app while records wait', () => {
  const QUESTION = 'Còn 2 ghi nhận chưa gửi';

  test('the question comes first; "Ở lại" leaves the app, the session and the queue as they were', async () => {
    const view = await startOffline(['a1', 'a2']);
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('header', { name: QUESTION })).toBeTruthy();
    expect(requested('/auth/logout')).toBe(0);

    fireEvent.press(screen.getByRole('button', { name: 'Ở lại' }));
    await settle();
    expect(screen.queryByRole('header', { name: QUESTION })).toBeNull();
    expect(app.session.status).toBe('signedIn');
    expect(screen.getByText(waitingOnDevice(2))).toBeTruthy();
    expect(await idsOnDisk()).toEqual(['a1', 'a2']);
    expect(requested('/auth/logout')).toBe(0);
    view.unmount();
  });

  test('"Đăng xuất và bỏ các ghi nhận này": signed out, the queue gone, and the row with it', async () => {
    const view = await startOffline(['a1', 'a2']);
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    await screen.findByRole('header', { name: QUESTION });
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất và bỏ các ghi nhận này' }));
    expect(await screen.findByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
    await settle();
    expect(app.session.status).toBe('signedOut');
    expect(screen.queryByText(waitingOnDevice(2))).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    view.unmount();
  });
});
