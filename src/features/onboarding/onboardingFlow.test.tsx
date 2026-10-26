import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { calculatePrescription, calorieWindow } from '../../../domain/energy.ts';
import App from '../../app/App';
import { healthVi } from '../../shared/i18n/vi/health';
import { bornAt, choose, diskText, dotted, installOnboardingTestEnv, meOnboarded, never, onStep, press, requests, respond, select, sent, serve, settle, TITLES, TOKEN, type, USER } from './onboardingTestKit';

// The real registry plus one tab root, so "the main app" is a real tab navigator before the Today screen exists.
// The stub links to the Targets detail, which nothing else can open yet.
jest.mock('../../app/screens', () => {
  const actual = jest.requireActual('../../app/screens');
  const { createElement } = require('react');
  const { Text, View } = require('react-native');
  function TodayStub({ navigation }: { navigation: { navigate(name: string): void } }) {
    return createElement(View, null, createElement(Text, null, 'tab root Today'), createElement(Text, { onPress: () => navigation.navigate('Targets') }, 'open Targets'));
  }
  return { ...actual, tabRoots: [{ name: 'Today', component: TodayStub, label: 'Hôm nay', icon: 'Sun' }] };
});

installOnboardingTestEnv();

const person = { heightCm: 171.5, weightKg: 63.25, ageYears: 30, sex: 'MALE', activityLevel: 'MODERATE', archetype: 'SUPPORTER' } as const;
const birthYear = bornAt(30);

test('a new user goes S05 → S06 → S07 → S08 → the main app with one POST /onboarding, and no measurement touches the disk', async () => {
  const preview = calculatePrescription(person);
  // the server is the authority: its numbers differ from the preview here on purpose
  const fromServer = {
    ...preview,
    calorieTarget: preview.calorieTarget + 41,
    proteinG: preview.proteinG + 3,
    safetyClamped: true,
    computedAt: '2026-10-12T03:00:00.000Z',
    archetype: 'SUPPORTER',
    biometrics: { heightCm: 171.5, weightKg: 63.25, birthYear: Number(birthYear), sex: 'MALE', activityLevel: 'MODERATE' },
  };
  serve({ 'POST /onboarding': respond(200, meOnboarded), 'GET /me/prescription': respond(200, fromServer) });
  await Keychain.setGenericPassword(USER, TOKEN);
  render(<App />);

  // S05
  await onStep(TITLES.OnbProfile);
  type('Năm sinh', birthYear);
  type('Chiều cao · cm', '171,5');
  type('Cân nặng · kg', '63.25');
  select('Giới tính dùng trong công thức, Chọn', 'Nam');
  press('Tiếp tục');
  // S06
  await onStep(TITLES.OnbActivity);
  choose(/^Vận động vừa/);
  press('Chọn mục tiêu');
  // S07
  await onStep(TITLES.OnbArchetype);
  choose(/^Cân bằng lại nhịp sống/);
  press('Xem lộ trình của tôi');
  // S08: the preview is the domain's calculation for exactly what was typed
  await onStep(TITLES.OnbTargets);
  expect(screen.getByText('Hỗ Trợ')).toBeTruthy();
  expect(screen.getByText(`${dotted(preview.calorieTarget)} kcal / ngày`)).toBeTruthy();
  expect(screen.getByText(`${dotted(preview.waterMl)} ml / ngày`)).toBeTruthy();
  expect(screen.getByText(`Đạm ${preview.proteinG} g · Béo ${preview.fatG} g · Carb ${preview.carbsG} g`)).toBeTruthy();
  expect(screen.getByText(healthVi.disclaimer)).toBeTruthy();
  // up to here nothing about the person has left the phone
  expect(sent().every(r => r.method === 'GET')).toBe(true);

  press('Đến Hôm nay');
  // the root gate switches by itself: the tab navigator with its (stub) root and the tab bar
  expect(await screen.findByText('tab root Today')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Hôm nay' }).props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.queryByRole('header', { name: TITLES.OnbTargets })).toBeNull();

  const posts = sent().filter(r => r.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].path).toBe('/onboarding');
  expect(posts[0].body).toEqual({
    heightCm: 171.5,
    weightKg: 63.25,
    birthYear: Number(birthYear),
    sex: 'MALE',
    activityLevel: 'MODERATE',
    timezone: 'Asia/Ho_Chi_Minh',
    archetype: 'SUPPORTER',
  });
  expect(Object.keys(posts[0].body ?? {})).toHaveLength(7);

  // the Targets detail shows the server's numbers, not the preview, and explains nothing about the difference
  fireEvent.press(screen.getByText('open Targets'));
  expect(await screen.findByRole('header', { name: 'Mục tiêu cá nhân' })).toBeTruthy();
  expect(await screen.findByText(`${dotted(fromServer.calorieTarget)} kcal / ngày`)).toBeTruthy();
  expect(screen.queryByText(`${dotted(preview.calorieTarget)} kcal / ngày`)).toBeNull();
  const band = calorieWindow(fromServer.calorieTarget);
  expect(screen.getByText(`Nhiệm vụ dinh dưỡng được tính khi bạn ghi nhận từ ${dotted(band.min)} đến ${dotted(band.max)} kcal.`)).toBeTruthy();
  expect(screen.getByText(`Đạm ${fromServer.proteinG} g · Béo ${fromServer.fatG} g · Carb ${fromServer.carbsG} g`)).toBeTruthy();
  expect(screen.getByText(healthVi.safetyClamped.body(fromServer.calorieTarget))).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Chỉnh lại hồ sơ' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Đến Hôm nay' })).toBeNull();
  // the same single closing paragraph as on S08
  expect(screen.getByText(healthVi.disclaimer)).toBeTruthy();
  expect(screen.queryByText(healthVi.estimate.prescription)).toBeNull();
  const prescriptionRequest = sent().findIndex(r => r.path === '/me/prescription');
  expect(prescriptionRequest).toBeGreaterThan(-1);
  await settle();

  // The disk now holds the user's `Me` and nothing else of this flow: no height, weight or birth year in any
  // spelling, although they were typed, sent, and came back inside the prescription answer.
  const disk = await diskText();
  expect(disk).toContain(`cache:v1:${USER}:me`);
  expect(JSON.parse(disk).map(([key]: [string, string]) => key)).toEqual([`cache:v1:${USER}:me`]);
  for (const value of ['171.5', '171,5', '63.25', '63,25', birthYear, 'heightCm', 'weightKg', 'birthYear', 'biometrics', 'calorieTarget']) {
    expect(disk).not.toContain(value);
  }
  // the disk copy of Me agrees with the gate (an offline start will not ask for onboarding again)
  expect(JSON.parse(JSON.parse(disk)[0][1]).user.onboarded).toBe(true);
  expect(disk).not.toContain(TOKEN);
  screen.unmount();
});

test('coming back to the app during onboarding keeps what was typed for the session', async () => {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
    listeners.push(args[1] as (state: string) => void);
    return { remove: () => undefined };
  });
  await Keychain.setGenericPassword(USER, TOKEN);
  render(<App />);
  await onStep(TITLES.OnbProfile);
  type('Chiều cao · cm', '168');
  act(() => listeners.forEach(notify => notify('background')));
  act(() => listeners.forEach(notify => notify('active')));
  await settle();
  expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe('168');
  expect(await diskText()).not.toContain('168');
  screen.unmount();
});

describe('the Targets screen (opened later, from the main app)', () => {
  const answer = {
    ...calculatePrescription(person),
    computedAt: '2026-10-12T03:00:00.000Z',
    archetype: 'TANKER',
    biometrics: { heightCm: 171.5, weightKg: 63.25, birthYear: Number(birthYear), sex: 'MALE', activityLevel: 'MODERATE' },
  };
  const openTargets = async () => {
    await Keychain.setGenericPassword(USER, TOKEN);
    render(<App />);
    fireEvent.press(await screen.findByText('open Targets'));
    return screen.findByRole('header', { name: 'Mục tiêu cá nhân' });
  };

  test('while GET /me/prescription is on its way: the loading state; the request carries the query signal', async () => {
    serve({ 'GET /me': respond(200, meOnboarded), 'GET /me/prescription': never });
    expect(await openTargets()).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText(/kcal/)).toBeNull();
    expect(requests('/me/prescription')[0][1].signal).toBeInstanceOf(AbortSignal);
    screen.unmount();
  });

  test('no connection: the error state with "Thử lại", which loads the targets', async () => {
    let online = false;
    serve({
      'GET /me': respond(200, meOnboarded),
      'GET /me/prescription': () => (online ? respond(200, answer) : Promise.reject(new TypeError('Network request failed'))),
    });
    await openTargets();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    online = true;
    press('Thử lại');
    expect(await screen.findByText(`${dotted(answer.calorieTarget)} kcal / ngày`)).toBeTruthy();
    expect(screen.getByText('Đỡ Đòn')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    // the measurements that came back with the answer are not shown here and are not written anywhere
    expect(screen.queryByText(/171|63[.,]25/)).toBeNull();
    expect(await diskText()).not.toContain('biometrics');
    screen.unmount();
  });

  test('a server error: the general message, never the raw code', async () => {
    serve({ 'GET /me': respond(200, meOnboarded), 'GET /me/prescription': respond(500, { error: { code: 'INTERNAL', message: 'boom' } }) });
    await openTargets();
    expect(await screen.findByText('Có lỗi xảy ra. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText(/INTERNAL|boom/)).toBeNull();
    screen.unmount();
  });

  test('"Chỉnh lại hồ sơ" opens the profile editor (S37), and Back returns to the targets, then to where they were opened from', async () => {
    serve({ 'GET /me': respond(200, meOnboarded), 'GET /me/prescription': respond(200, answer) });
    await openTargets();
    await screen.findByText(`${dotted(answer.calorieTarget)} kcal / ngày`);
    press('Chỉnh lại hồ sơ');
    expect(await screen.findByRole('header', { name: 'Hồ sơ & mục tiêu' })).toBeTruthy();
    press('Quay lại');
    expect(await screen.findByRole('header', { name: 'Mục tiêu cá nhân' })).toBeTruthy();
    press('Quay lại');
    expect(await screen.findByText('tab root Today')).toBeTruthy();
    screen.unmount();
  });
});
