import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, AppState, StyleSheet } from 'react-native';
import { api } from '../../shared/api/client';
import { saved } from '../../shared/i18n/vi/common';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { PendingBannerView } from './PendingBanner';
import { USER, app, fetchMock, installSyncTestEnv, mountApp, onboarded, refuse, requested, respond, seedQueue, server, settle, stored, writes } from './syncTestKit';

// The main group without its screens: every tab shows the notice with "Đăng xuất", whatever tabs the app has by now.
jest.mock('../../app/screens', () => ({ ...jest.requireActual('../../app/screens'), tabRoots: [] }));

installSyncTestEnv();

const OFFLINE = 'Bạn đang ngoại tuyến';
const waitingText = (count: number) => `${count} ghi nhận đang chờ gửi — đã lưu trên máy`;
const SYNCED = 'Đã đồng bộ';
const retryButton = () => screen.queryByRole('button', { name: 'Thử lại' });

/** The app is open on the last known profile, the network is down and `count` records wait from an earlier run. */
async function offlineWith(count: number, motion: 'REDUCED' | 'FULL' = 'REDUCED') {
  server.down = true;
  if (count) await seedQueue(Array.from({ length: count }, (_, i) => stored(`a${i + 1}`)));
  await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(onboarded));
  return mountApp({ motion });
}

test('offline with records waiting: says so, with the count, "saved on this device" and "Thử lại" as a button', async () => {
  const view = await offlineWith(2);
  expect(screen.getByText(OFFLINE)).toBeTruthy();
  expect(screen.getByText(waitingText(2))).toBeTruthy();
  expect(retryButton()).toBeTruthy();
  // saved on this device is not "saved": neither word for a confirmed record appears while records wait
  expect(screen.queryByText(SYNCED)).toBeNull();
  expect(screen.queryByText(saved)).toBeNull();
  // the wording is announced when it changes, and nothing here spins
  let node: ReturnType<typeof screen.getByText> | null = screen.getByText(OFFLINE);
  while (node && !node.props.accessibilityLiveRegion) node = node.parent;
  expect(node?.props.accessibilityLiveRegion).toBe('polite');
  expect(screen.queryByRole('progressbar')).toBeNull();
  view.unmount();
});

test('the count follows the queue', async () => {
  const view = await offlineWith(3);
  expect(screen.getByText(waitingText(3))).toBeTruthy();
  // the first goes through, then the network drops again
  let answered = 0;
  server.down = false;
  server.write = () => {
    answered += 1;
    if (answered > 1) throw new TypeError('Network request failed');
    return respond(200, { ok: true });
  };
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  await settle();
  expect(screen.getByText(waitingText(2))).toBeTruthy();
  expect(screen.queryByText(waitingText(3))).toBeNull();
  view.unmount();
});

test('three waiting, the first goes through and the second fails: the two that remain are shown all along, never an empty row', async () => {
  const view = await offlineWith(3);
  let fail!: (reason: unknown) => void;
  server.down = false;
  server.write = () => (writes().at(-1)?.id === 'a1' ? respond(200, { ok: true }) : new Promise((_resolve, reject) => (fail = reject)));
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  await settle();
  // a1 is confirmed, a2 is on its way: a2 and a3 are still only on this device
  expect(writes().map(request => request.id)).toEqual(['a1', 'a1', 'a2']);
  expect(screen.getByText(waitingText(2))).toBeTruthy();
  expect(screen.queryByText(SYNCED)).toBeNull();

  server.down = true; // the network is gone again: a2 fails, and so does whatever is tried next
  await act(async () => fail(new TypeError('Network request failed')));
  await settle();
  expect(screen.getByText(waitingText(2))).toBeTruthy();
  expect(screen.getByText(OFFLINE)).toBeTruthy();
  expect(retryButton()).toBeTruthy();
  view.unmount();
});

test('"Thử lại" is a full 48 dp target of its own (not hit slop that the row would clip)', async () => {
  const view = await offlineWith(1);
  const style = StyleSheet.flatten(screen.getByRole('button', { name: 'Thử lại' }).props.style);
  expect(style).toMatchObject({ minHeight: 48, minWidth: 48 });
  view.unmount();
});

test('the server answers but cannot take the records (500): they wait, and the row does not claim the phone is offline', async () => {
  server.write = () => refuse(500, 'INTERNAL');
  await seedQueue([stored('a1')]);
  const view = await mountApp();
  expect(screen.getByText(waitingText(1))).toBeTruthy();
  expect(screen.queryByText(OFFLINE)).toBeNull();
  expect(retryButton()).toBeTruthy();
  view.unmount();
});

test('offline with nothing waiting: the offline line only, no button (the failing screen owns its retry); gone with the next request that gets through', async () => {
  const view = await offlineWith(0);
  expect(screen.getByText(OFFLINE)).toBeTruthy();
  expect(screen.queryByText(/ghi nhận đang chờ gửi/)).toBeNull();
  expect(retryButton()).toBeNull();
  expect(screen.queryAllByRole('button', { name: 'Thử lại' })).toHaveLength(0);

  // a request that fails for another reason than the network also means the server was reached
  await act(() => api.get('/settings').catch(() => undefined));
  expect(screen.getByText(OFFLINE)).toBeTruthy(); // still down

  server.down = false;
  const before = requested('/me');
  await act(() => api.get('/settings').then(() => undefined));
  await settle();
  expect(screen.queryByText(OFFLINE)).toBeNull();
  expect(retryButton()).toBeNull();
  expect(requested('/me')).toBe(before); // nothing was refetched on the banner's account
  expect(writes()).toEqual([]);
  view.unmount();
});

test('a record made while the offline line shows brings the count and the button', async () => {
  const view = await offlineWith(0);
  expect(retryButton()).toBeNull();
  await act(async () => {
    await app.send({ path: '/day/bedtime', body: {} });
  });
  expect(screen.getByText(OFFLINE)).toBeTruthy();
  expect(screen.getByText(waitingText(1))).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
  view.unmount();
});

test('once everything that waited is confirmed: "Đã đồng bộ", with nothing left to retry', async () => {
  const view = await offlineWith(2);
  server.down = false;
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  await settle();
  expect(screen.getByText(SYNCED)).toBeTruthy();
  expect(screen.queryByText(OFFLINE)).toBeNull();
  expect(screen.queryByText(/đã lưu trên máy/)).toBeNull();
  expect(retryButton()).toBeNull();
  view.unmount();
});

test('while a retry is on its way the button is busy and a second press sends nothing more', async () => {
  const view = await offlineWith(1);
  let finish!: (response: unknown) => void;
  server.down = false;
  server.write = () => new Promise(resolve => (finish = resolve));
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  await settle();
  expect(screen.getByRole('button', { name: 'Thử lại' }).props.accessibilityState).toMatchObject({ busy: true });
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  await settle();
  expect(writes().map(request => request.id)).toEqual(['a1', 'a1']); // the failed start, then one retry

  await act(async () => finish(respond(200, { ok: true })));
  await settle();
  expect(screen.getByText(SYNCED)).toBeTruthy();
  view.unmount();
});

test('start-up without a network and without a cache (S39): its own "Thử lại" is the only one, the row stays away', async () => {
  server.down = true;
  await seedQueue([stored('a1')]);
  const view = await mountApp({ landed: false });
  await screen.findByText('Chưa tải được dữ liệu');
  expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
  expect(screen.queryByText(OFFLINE)).toBeNull();
  expect(screen.queryByText(waitingText(1))).toBeNull();
  view.unmount();
});

test('signed out: no row, whatever the network does', async () => {
  const view = await mountApp({ signedIn: false });
  server.down = true;
  await act(() => api.get('/meta/timezones').catch(() => undefined));
  await settle();
  expect(screen.queryByText(OFFLINE)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  view.unmount();
});

describe('pending-pulse', () => {
  // Jest's AppState mock has no real state; a pulse runs in the foreground only (useLoopGate).
  const appState = AppState as unknown as { currentState: unknown };
  const atLoad = appState.currentState;
  afterEach(() => {
    appState.currentState = atLoad;
  });
  const stub = () => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn(), _isUsingNativeDriver: () => false } as unknown as Animated.CompositeAnimation);
  const beats = (timing: jest.SpyInstance) => timing.mock.calls.filter(([, config]) => config.duration === 450 && config.toValue === 1);
  // other parts of the screen loop too (the skeleton, the mascot): the pulse is the one that ends after two rounds
  const pulses = (loop: jest.SpyInstance) => loop.mock.calls.filter(([, config]) => config?.iterations === 2);

  test('full motion in the foreground: the dot beats twice when records wait (450 ms each, native driver) and stops with the row', async () => {
    appState.currentState = 'active';
    const pulse = stub();
    const timing = jest.spyOn(Animated, 'timing').mockReturnValue(stub());
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue(pulse);
    const view = await offlineWith(1, 'FULL');
    expect(beats(timing)).toHaveLength(1);
    expect(beats(timing)[0][1]).toMatchObject({ useNativeDriver: true });
    expect(pulses(loop)).toHaveLength(1);
    const started = (pulse.start as jest.Mock).mock.calls.length;
    const stopped = (pulse.stop as jest.Mock).mock.calls.length;
    expect(started).toBeGreaterThan(0);
    view.unmount();
    expect((pulse.stop as jest.Mock).mock.calls.length).toBeGreaterThan(stopped);
  });

  test('reduced motion: a still dot and the words', async () => {
    appState.currentState = 'active';
    const loop = jest.spyOn(Animated, 'loop');
    const view = await offlineWith(1);
    expect(screen.getByText(waitingText(1))).toBeTruthy();
    expect(pulses(loop)).toHaveLength(0);
    view.unmount();
  });

  test('offline with nothing waiting: nothing beats', async () => {
    appState.currentState = 'active';
    jest.spyOn(Animated, 'timing').mockReturnValue(stub());
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue(stub());
    const view = await offlineWith(0, 'FULL');
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(pulses(loop)).toHaveLength(0);
    view.unmount();
  });
});

test('the row alone, at a large count', () => {
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <PendingBannerView waiting={500} offline onRetry={async () => undefined} />
    </MotionPreferenceProvider>,
  );
  expect(screen.getByText(OFFLINE)).toBeTruthy();
  expect(screen.getByText(waitingText(500))).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  view.rerender(
    <MotionPreferenceProvider value="REDUCED">
      <PendingBannerView waiting={0} offline onRetry={async () => undefined} />
    </MotionPreferenceProvider>,
  );
  expect(screen.getByText(OFFLINE)).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  view.unmount();
});
