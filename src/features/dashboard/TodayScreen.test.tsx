import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { calorieWindow } from '../../../domain/energy.ts';
import { xpRequiredForLevel } from '../../../domain/progression.ts';
import { api } from '../../shared/api/client';
import { app, dayOf, hold, installTodayTestEnv, meOf, openToday, queryClient, refuse, requested, respond, seedQueue, settle, settingsOf, stored, USER, world } from './todayTestKit';

// The real registry; the home tab's `navigate` is recorded on its way to the navigator, so a link to a route that no
// task has registered yet (inert, AR-25) can still be asserted by name.
const mockNavigate = jest.fn();
jest.mock('../../app/screens', () => {
  const actual = jest.requireActual('../../app/screens');
  const { createElement } = require('react');
  const spied = (entry: { component: unknown }) => {
    function Spied(props: { navigation: { navigate(...to: unknown[]): void } }) {
      const navigate = (...to: unknown[]) => {
        mockNavigate(...to);
        props.navigation.navigate(...to);
      };
      return createElement(entry.component as never, { ...props, navigation: { ...props.navigation, navigate } } as never);
    }
    return { ...entry, component: Spied };
  };
  return { ...actual, tabRoots: actual.tabRoots.map(spied) };
});

installTodayTestEnv();
beforeEach(() => mockNavigate.mockClear());

/** 1118 -> "1.118", written independently of the app's own grouping. */
const dotted = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dayCache = `cache:v1:${USER}:day`;
const meCache = `cache:v1:${USER}:me`;
const bar = (name: string) => screen.getByRole('progressbar', { name });

describe('S09: the day as the server gave it', () => {
  test('every block, top to bottom, with the numbers of the day and the profile', async () => {
    const view = await openToday();
    expect(screen.getByText('Chào An, mình bắt đầu từ việc nhỏ nhé.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hộp thư, có thư mới' })).toBeTruthy();

    // level and coins
    expect(screen.getByRole('button', { name: `Cấp 5 · Người kiên trì. 340 / ${dotted(xpRequiredForLevel(5))} XP` })).toBeTruthy();
    expect(screen.getByLabelText('250 xu')).toBeTruthy();

    // the companion card: Mầm's mood in words, and the one-tap action
    expect(screen.getByRole('header', { name: 'Uống nước.\nGiữ nhịp.' })).toBeTruthy();
    expect(screen.getByText('Mầm ở đây cùng bạn.')).toBeTruthy();
    expect(screen.getByText('Mầm đang vui')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ghi nhận nước' }).props.accessibilityState.disabled).toBeFalsy();

    // water: the count and one cell per part, as one button
    expect(screen.getByRole('header', { name: 'Nước hôm nay' })).toBeTruthy();
    expect(screen.getByText('3 / 8 phần')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nước hôm nay. 3 / 8 phần. Chạm để ghi thêm một phần.' })).toBeTruthy();
    expect(screen.getByText('Mỗi phần theo mục tiêu nước của bạn.')).toBeTruthy();

    // the four stats, each with its number as text
    expect(screen.getByRole('header', { name: 'Chỉ số của bạn' })).toBeTruthy();
    for (const [name, value] of [['Sức sống', 26], ['Năng lượng', 69], ['Sức mạnh', 40], ['Sức bền', 30]] as const) {
      expect(bar(name).props.accessibilityValue).toEqual({ min: 0, max: 100, now: value });
      expect(within(bar(name)).getByText(`${value}/100`)).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Hiểu các chỉ số' })).toBeTruthy();

    // the two tasks the streak depends on, with what each gives
    expect(screen.getByRole('header', { name: 'Việc chính hôm nay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vận động vừa sức. Chưa bắt đầu. +50 XP' })).toBeTruthy();
    const band = calorieWindow(2394);
    const kcal = `1.650 / 2.394 kcal · cần trong ${dotted(band.min)}–${dotted(band.max)}`;
    expect(screen.getByRole('button', { name: `Ăn đủ cho mục tiêu. ${kcal}. +50 XP` })).toBeTruthy();
    expect(screen.getAllByText('+50 XP')).toHaveLength(2);

    expect(screen.getByLabelText('4 ngày')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'xem hành trình' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Khép lại hôm nay. Ghi lại ý định nghỉ ngơi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem tất cả nhiệm vụ' })).toBeTruthy();

    // the shell: four tabs, this one selected; nothing here counts what is waiting (the row above the app does)
    expect(screen.getAllByRole('tab').map(tab => tab.props.accessibilityLabel)).toEqual(['Hôm nay', 'Lộ trình', 'Tổ đội', 'Cá nhân']);
    expect(screen.getByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    expect(screen.queryByText(/ghi nhận đang chờ gửi/)).toBeNull();
    expect(requested('/day')).toBe(1);
    view.unmount();
  });

  test('no unread mail: the bell says only what it opens; a task that is done says so instead of its reward', async () => {
    world.day = dayOf({ unreadCount: 0, story: { done: 1, total: 2 } });
    world.day.quests[0] = { ...world.day.quests[0], progress: 1, completed: true };
    const view = await openToday();
    expect(screen.getByRole('button', { name: 'Hộp thư' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hộp thư, có thư mới' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Vận động vừa sức. Đã hoàn thành buổi tập. Đã xong' })).toBeTruthy();
    expect(screen.getByText('Đã xong')).toBeTruthy();
    expect(screen.getAllByText('+50 XP')).toHaveLength(1);
    view.unmount();
  });

  test.each([
    [2, false],
    [3, true],
    [41, true],
  ])('a streak of %i days: the flame chip is shown = %s (from 3 days on, always with the number)', async (days, shown) => {
    world.day = dayOf({ streak: { current: days, best: 41 } });
    const view = await openToday();
    expect(screen.queryByLabelText(`${days} ngày`) !== null).toBe(shown);
    expect(screen.getByRole('link', { name: 'xem hành trình' })).toBeTruthy();
    view.unmount();
  });

  test('"hide the streak" in the settings hides the number here; the way to the journey stays', async () => {
    world.settings = settingsOf({ hideStreak: true });
    const view = await openToday();
    await settle();
    expect(requested('/settings')).toBe(1);
    expect(screen.queryByLabelText('4 ngày')).toBeNull();
    expect(screen.queryByText(/4 ngày/)).toBeNull();
    expect(screen.getByRole('link', { name: 'xem hành trình' })).toBeTruthy();
    view.unmount();
  });

  test('the settings cannot be read: the streak shows as by default, and nothing complains', async () => {
    world.answer = request => (request === 'GET /settings' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openToday();
    await settle();
    expect(screen.getByLabelText('4 ngày')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    view.unmount();
  });

  test('a day without the water quest: no tracker and no button that could record nothing', async () => {
    world.day = dayOf();
    world.day.quests = world.day.quests.filter(item => item.code !== 'WATER_8');
    const view = await openToday();
    expect(screen.getByText('Mầm đang vui')).toBeTruthy();
    expect(screen.queryByText('Nước hôm nay')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ghi nhận nước/ })).toBeNull();
    expect(screen.getByRole('header', { name: 'Việc chính hôm nay' })).toBeTruthy();
    view.unmount();
  });

  test('Mầm is tired: the tired mood in words and an invitation, no reproach, and the action is still there', async () => {
    world.me = meOf({ pet: { stage: 'JUVENILE', stageIndex: 2, growthPercent: 10, mood: 'TIRED', skinCode: 'SKIN_FOX', nextStage: 'ADULT' } });
    world.day = dayOf({ streak: { current: 0, best: 9 } });
    const view = await openToday();
    expect(screen.getByText('Mầm hơi buồn ngủ, đang chờ bạn quay lại')).toBeTruthy();
    expect(screen.getByText('Mầm vẫn ở đây. Một việc nhỏ hôm nay là đủ để bắt đầu lại.')).toBeTruthy();
    expect(screen.queryByText('Mầm ở đây cùng bạn.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ghi nhận nước' })).toBeTruthy();
    // the picture is decorative: the line beside it carries the mood
    expect(screen.queryByRole('image')).toBeNull();
    view.unmount();
  });
});

describe('S09: links', () => {
  test.each([
    ['button', 'Hộp thư, có thư mới', 'Inbox'],
    ['button', /^Cấp 5 · Người kiên trì/, 'Levels'],
    ['link', 'Hiểu các chỉ số', 'StatsExplainer'],
    ['button', /^Vận động vừa sức/, 'WorkoutCatalog'],
    ['button', /^Ăn đủ cho mục tiêu/, 'ManualKcal'],
    ['link', 'xem hành trình', 'Journey'],
    ['button', /^Khép lại hôm nay/, 'EndOfDay'],
    ['button', 'Xem tất cả nhiệm vụ', 'QuestBoard'],
  ] as const)('%s "%s" navigates to %s', async (role, name, route) => {
    const view = await openToday();
    fireEvent.press(screen.getByRole(role, { name }));
    expect(mockNavigate.mock.calls).toEqual([[route]]);
    await settle();
    view.unmount();
  });

  test('"Hiểu các chỉ số" opens the explainer in this tab, and Back returns here', async () => {
    const view = await openToday();
    fireEvent.press(screen.getByRole('link', { name: 'Hiểu các chỉ số' }));
    expect(await screen.findByRole('header', { name: 'Hiểu chỉ số của bạn' })).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toEqual([]);
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    await settle();
    view.unmount();
  });
});

describe('loading, failing and starting without a network', () => {
  test('first load: the title and a skeleton, no numbers yet; then the day', async () => {
    const day = hold('GET /day');
    const view = await openToday();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Nước hôm nay')).toBeNull();
    await act(async () => day.release());
    expect(await screen.findByText('3 / 8 phần')).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Đang tải' })).toBeNull();
    view.unmount();
  });

  test('the day cannot be loaded and nothing is kept on this device: the error state, and "Thử lại" loads it', async () => {
    world.answer = request => (request === 'GET /day' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openToday();
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.getByText('Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
    expect(screen.queryByText('Nước hôm nay')).toBeNull();

    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('3 / 8 phần')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    expect(requested('/day')).toBe(2);
    view.unmount();
  });

  test('cold start without a network: the day kept on this device and the offline row, not an error screen', async () => {
    world.down = true;
    await AsyncStorage.setItem(meCache, JSON.stringify(world.me));
    await AsyncStorage.setItem(dayCache, JSON.stringify(dayOf({}, { progress: 5 })));
    const view = await openToday();
    expect(await screen.findByText('5 / 8 phần')).toBeTruthy();
    expect(screen.getByText('Bạn đang ngoại tuyến')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ghi nhận nước' }).props.accessibilityState.disabled).toBeFalsy();
    expect(requested('/day')).toBe(1);
    view.unmount();
  });

  test('a slow network: the kept day shows while the request is still out, then the server day replaces it', async () => {
    await AsyncStorage.setItem(dayCache, JSON.stringify(dayOf({}, { progress: 5 })));
    const day = hold('GET /day');
    const view = await openToday();
    expect(await screen.findByText('5 / 8 phần')).toBeTruthy();
    await act(async () => day.release());
    expect(await screen.findByText('3 / 8 phần')).toBeTruthy();
    // the newest day is what stays on this device
    expect(JSON.parse((await AsyncStorage.getItem(dayCache)) ?? '{}').quests[2].progress).toBe(3);
    view.unmount();
  });

  test('a kept day that is already over is not shown as today (no network after the day changed)', async () => {
    world.down = true;
    await AsyncStorage.setItem(meCache, JSON.stringify(world.me));
    await AsyncStorage.setItem(dayCache, JSON.stringify(dayOf({ closesAt: new Date(Date.now() - 60_000).toISOString() }, { progress: 5 })));
    const view = await openToday();
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.queryByText('5 / 8 phần')).toBeNull();
    view.unmount();
  });

  test('a kept day of another account is never read', async () => {
    world.down = true;
    await AsyncStorage.setItem(meCache, JSON.stringify(world.me));
    await AsyncStorage.setItem('cache:v1:someone-else:day', JSON.stringify(dayOf({}, { progress: 7 })));
    const view = await openToday();
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.queryByText('7 / 8 phần')).toBeNull();
    view.unmount();
  });

  test('the day arrives after the session has ended: it reaches neither this device nor the next screen', async () => {
    const day = hold('GET /day');
    const view = await openToday();
    // another request is told the session is dead: the app is back on the signed-out screens, the kept data is gone
    world.answer = request => (request === 'GET /me' ? refuse(401, 'SESSION_INVALID') : undefined);
    await act(() => api.get('/me').catch(() => undefined));
    await screen.findByRole('header', { name: 'Chào bạn trở lại' });
    expect(app.session.status).toBe('signedOut');
    await act(async () => day.release(respond(200, world.day)));
    await settle();
    expect((await AsyncStorage.getAllKeys()).filter(key => key.startsWith('cache:'))).toEqual([]);
    view.unmount();
  });
});

test('the kept day comes off the disk only after the session has ended: it is not left for whoever signs in next', async () => {
  await AsyncStorage.setItem(dayCache, JSON.stringify(dayOf({}, { progress: 5 })));
  const day = hold('GET /day');
  // the read of the kept day takes its time; its value is the one that was on disk before the sign-out
  let finishRead!: () => void;
  const read = AsyncStorage.getItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key => {
    const value = await read(key);
    if (key === dayCache) await new Promise<void>(resolve => (finishRead = resolve));
    return value;
  });
  const view = await openToday();
  world.answer = request => (request === 'GET /me' ? refuse(401, 'SESSION_INVALID') : undefined);
  await act(() => api.get('/me').catch(() => undefined));
  await screen.findByRole('header', { name: 'Chào bạn trở lại' });

  await act(async () => finishRead());
  await act(async () => day.release(respond(200, world.day)));
  await settle();
  expect(queryClient().getQueryData(['day'])).toBeUndefined();
  view.unmount();
});

describe('what this device has not sent yet is laid over the day', () => {
  test('waiting records from an earlier run: parts, a bedtime mark and manual kcal show as waiting, without any reward', async () => {
    world.down = true;
    await AsyncStorage.setItem(meCache, JSON.stringify(world.me));
    await AsyncStorage.setItem(dayCache, JSON.stringify(world.day));
    await seedQueue([
      stored('w1', { path: '/day/quests/WATER_8/progress', body: {} }),
      stored('w2', { path: '/day/quests/WATER_8/progress', body: {} }),
      stored('b1', { path: '/day/bedtime', body: {} }),
      stored('k1', { path: '/nutrition/log', body: { kcal: 300 } }),
    ]);
    const view = await openToday();
    expect(await screen.findByText('5 / 8 phần')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nước hôm nay. 5 / 8 phần. 2 phần đang chờ gửi. Chạm để ghi thêm một phần.' })).toBeTruthy();
    // per record marks only: the count of waiting records is the row above the app, once
    expect(screen.getAllByText('4 ghi nhận đang chờ gửi — đã lưu trên máy')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Khép lại hôm nay. Đã ghi ý định nghỉ ngơi. Đang chờ gửi' })).toBeTruthy();
    const band = calorieWindow(2394);
    expect(screen.getByText(`1.950 / 2.394 kcal · cần trong ${dotted(band.min)}–${dotted(band.max)} · Đang chờ gửi`)).toBeTruthy();
    // nothing the server grants is shown for them
    expect(screen.getByLabelText('250 xu')).toBeTruthy();
    expect(screen.queryByText(/đã lưu$/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    expect(screen.getAllByText('+50 XP')).toHaveLength(2);
    view.unmount();
  });
});
