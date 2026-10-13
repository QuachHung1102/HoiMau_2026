/**
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import type { Me } from '../domain/contract/core.ts';
import App from '../src/app/App';
import { resetSystemMotionForTests } from '../src/shared/motion/useReducedMotion';
import { writeCache } from '../src/shared/storage/cache';

const USER = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';
const TOKEN = 'tok-secret-app-1';
const meOf = (onboarded: boolean): Me => ({
  user: {
    id: USER,
    email: 'an@example.vn',
    displayName: 'An',
    timezone: 'Asia/Ho_Chi_Minh',
    archetype: null,
    archetypeChangeAvailableAt: null,
    onboarded,
  },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
});

type Init = { method: string; headers: Record<string, string> };
const fetchMock = jest.fn<Promise<unknown>, [string, Init]>();
const respond = (status: number, body?: unknown) => ({
  ok: status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url.replace('http://localhost:8787/api/v1', '')}`);
const signedIn = () => Keychain.setGenericPassword(USER, TOKEN);
/** Onboarding is on its first step (S05) and the request that step starts (the zone list) has landed inside act(). */
async function onboardingOpened() {
  const header = await screen.findByRole('header', { name: 'Bắt đầu từ bạn' });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  return header;
}

const realFetch = globalThis.fetch;
let errors: jest.SpyInstance;
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // The OS "reduce motion" value stays unknown, so the app renders its static (reduced) state.
  const { AccessibilityInfo } = require('react-native');
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
  errors = jest.spyOn(console, 'error');
});
afterEach(async () => {
  const complaints = errors.mock.calls.map(call => String(call[0]));
  jest.restoreAllMocks();
  jest.useRealTimers();
  resetSystemMotionForTests();
  await Keychain.resetGenericPassword();
  await AsyncStorage.clear();
  globalThis.fetch = realFetch;
  expect(complaints).toEqual([]);
});

test('signed out: Welcome is visible and nothing is requested', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Hồi Máu' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tôi đã có tài khoản' })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  screen.unmount();
});

test('while the session and GET /me load: the S39 loading state', async () => {
  await signedIn();
  // never answers, and ends when its signal is aborted (as a real fetch does) so no timer outlives the test
  fetchMock.mockImplementation(
    (_url, init) => new Promise((_resolve, reject) => (init as unknown as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('Aborted')))),
  );
  render(<App />);
  expect(screen.getByRole('header', { name: 'Đang lấy hành trình' })).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Đang tải' }).props.accessibilityState).toMatchObject({ busy: true });
  // still loading once the session is restored and GET /me is on its way
  await screen.findByText('Dữ liệu của bạn đang được tải.');
  expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
  screen.unmount();
});

test('signed in and not onboarded: onboarding opens on its first step (S05), with a way out', async () => {
  await signedIn();
  fetchMock.mockResolvedValue(respond(200, meOf(false)));
  render(<App />);
  expect(await onboardingOpened()).toBeTruthy();
  expect(screen.getByText('Hồ sơ · Bước 1 trong 3')).toBeTruthy();
  expect(requests()[0]).toBe('GET /me');
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);

  fetchMock.mockResolvedValue(respond(204));
  fireEvent.press(screen.getByRole('link', { name: 'Đăng xuất' }));
  expect(await screen.findByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
  expect(requests().filter(request => request === 'POST /auth/logout')).toHaveLength(1);
  expect(requests().at(-1)).toBe('POST /auth/logout');
  expect(await Keychain.getGenericPassword()).toBe(false);
  screen.unmount();
});

test('signed in and onboarded: the four tabs, opened on Hôm nay', async () => {
  await signedIn();
  // this server knows the profile only: Hôm nay shows its own load failure (that screen has its own tests)
  fetchMock.mockImplementation(async url => (url.endsWith('/me') ? respond(200, meOf(true)) : respond(404)));
  render(<App />);
  expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
  expect(screen.getAllByRole('tab').map(tab => tab.props.accessibilityLabel)).toEqual(['Hôm nay', 'Lộ trình', 'Tổ đội', 'Cá nhân']);
  expect(screen.getByRole('header', { name: 'Hôm nay' })).toBeTruthy();
  expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
  // a tab that has no screen yet, and the way out it offers: src/app/pendingTabs.test.tsx
  screen.unmount();
});

test('GET /me 500: the error state, "Thử lại" refetches, "Đăng xuất" is offered', async () => {
  await signedIn();
  fetchMock.mockResolvedValue(respond(500, { error: { code: 'INTERNAL', message: 'boom' } }));
  render(<App />);
  expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Đang lấy hành trình' })).toBeTruthy();
  expect(screen.getByText('Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
  expect(requests()).toEqual(['GET /me']);

  fetchMock.mockResolvedValue(respond(200, meOf(false)));
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await onboardingOpened()).toBeTruthy();
  expect(requests().filter(request => request === 'GET /me')).toHaveLength(2);
  expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
  screen.unmount();
});

test('offline start with a cached Me: the user gets in from the cache', async () => {
  await signedIn();
  await writeCache(USER, 'me', meOf(false));
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  render(<App />);
  expect(await onboardingOpened()).toBeTruthy();
  expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
  screen.unmount();
});

test.each([
  ['the network is down', () => fetchMock.mockRejectedValue(new TypeError('Network request failed'))],
  [
    'the server does not answer in 10 s',
    () => fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => (init as unknown as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('Aborted'))))),
  ],
])('start-up without a cache when %s: the frame wording of S39', async (name, arrange) => {
  await signedIn();
  arrange();
  // under fake timers the query waits through the client's 10 s in no real time
  if (name.includes('10 s')) jest.useFakeTimers();
  render(<App />);
  expect(await screen.findByText('Kiểm tra kết nối rồi thử lại. Những ghi nhận đã lưu vẫn còn.', {}, { timeout: 12_000 })).toBeTruthy();
  expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Đang lấy hành trình' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
  screen.unmount();
});

test('offline start with another user cache on disk: that cache is not used', async () => {
  await signedIn();
  await writeCache('someone-else', 'me', meOf(true));
  await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify({ ...meOf(true), user: { ...meOf(true).user, id: 'someone-else' } }));
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  render(<App />);
  expect(await screen.findByText('Kiểm tra kết nối rồi thử lại. Những ghi nhận đã lưu vẫn còn.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  screen.unmount();
});

test('a server error is not papered over with the cache', async () => {
  await signedIn();
  await writeCache(USER, 'me', meOf(false));
  fetchMock.mockResolvedValue(respond(500, { error: { code: 'INTERNAL', message: 'boom' } }));
  render(<App />);
  expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
  screen.unmount();
});

test('a successful GET /me is written to this user cache', async () => {
  await signedIn();
  fetchMock.mockResolvedValue(respond(200, meOf(false)));
  render(<App />);
  await onboardingOpened();
  expect(JSON.parse((await AsyncStorage.getItem(`cache:v1:${USER}:me`)) ?? 'null')).toEqual(meOf(false));
  // and the token is nowhere on disk
  const disk = JSON.stringify(Object.entries(await AsyncStorage.getMany(await AsyncStorage.getAllKeys())));
  expect(disk).not.toContain(TOKEN);
  screen.unmount();
});

test('GET /me 401 SESSION_INVALID: the session ends and the app is back on the signed-out screens', async () => {
  await signedIn();
  await writeCache(USER, 'me', meOf(true));
  fetchMock.mockResolvedValue(respond(401, { error: { code: 'SESSION_INVALID', message: 'session is not valid' } }));
  render(<App />);
  // the landing is S02, with the notice that the session ended
  expect(await screen.findByRole('header', { name: 'Chào bạn trở lại' })).toBeTruthy();
  expect(screen.getByText('Phiên đăng nhập đã hết hạn. Bạn đăng nhập lại nhé.')).toBeTruthy();
  expect(await Keychain.getGenericPassword()).toBe(false);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
  expect(requests()).toEqual(['GET /me']);
  screen.unmount();
});

test('unmounting the app leaves no timer behind', async () => {
  await signedIn();
  fetchMock.mockResolvedValue(respond(200, meOf(false)));
  render(<App />);
  await onboardingOpened();
  // Timers only: a microtask queued by the unmount itself is not something that keeps Jest alive.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  screen.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
