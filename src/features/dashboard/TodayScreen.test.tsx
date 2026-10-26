import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { DayState } from '../../../domain/contract/core.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { xpRequiredForLevel } from '../../../domain/progression.ts';
import { api } from '../../shared/api/client';
import { wipeQueries } from '../../shared/api/session';
import { app, dayOf, hold, installTodayTestEnv, meOf, openToday, queryClient, refuse, requested, respond, seedQueue, settle, settingsOf, stored, USER, world } from './todayTestKit';

// The real registry; the home tab's `navigate` is recorded on its way to the navigator, so a link to a route that no
// task has registered yet (inert) can still be asserted by name.
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
const NEW_DAY = 'Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.';
const HOUR = 3_600_000;
const record = () => screen.getByRole('button', { name: /^Ghi nhận nước/ });
// Timers only: a microtask queued by an unmount is not something that keeps Jest alive.
const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
/** A day at its end: both tasks done, 8 of 8 parts, bedtime marked. `closesIn` is negative for a day that is already over. */
function finishedDay(closesIn: number): DayState {
  const day = dayOf(
    { closesAt: new Date(Date.now() + closesIn).toISOString(), caloriesIn: 2380, bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString(), story: { done: 2, total: 2 } },
    { progress: 8, completed: true },
  );
  day.quests[0] = { ...day.quests[0], progress: 1, completed: true };
  day.quests[1] = { ...day.quests[1], progress: 1, completed: true };
  return day;
}

describe('S09: the day as the server gave it', () => {
  test('every block, top to bottom, with the numbers of the day and the profile', async () => {
    world.day = dayOf({ unreadCount: 1 }); // the real day carries none until the server sends celebrations; the bell's dot is still drawn for one
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
    ['button', /^Ăn đủ cho mục tiêu/, 'MealPlan'],
    ['link', 'xem hành trình', 'Journey'],
    ['button', /^Khép lại hôm nay/, 'EndOfDay'],
    ['button', 'Xem tất cả nhiệm vụ', 'QuestBoard'],
  ] as const)('%s "%s" navigates to %s', async (role, name, route) => {
    world.day = dayOf({ unreadCount: 1 }); // the bell is named "có thư mới" only with unread mail
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

  test('a kept day that is over, and no network: a provisional new day (same tasks, nothing done, no streak number) on which the first record waits', async () => {
    world.down = true;
    await AsyncStorage.setItem(meCache, JSON.stringify(world.me));
    await AsyncStorage.setItem(dayCache, JSON.stringify(finishedDay(-60_000)));
    const view = await openToday();
    expect(await screen.findByText(NEW_DAY)).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    // nothing of yesterday is shown as done today
    expect(screen.getByText('0 / 8 phần')).toBeTruthy();
    expect(screen.queryByText('Đã xong')).toBeNull();
    expect(screen.getAllByText('+50 XP')).toHaveLength(2);
    expect(screen.getByRole('button', { name: new RegExp('^Ăn đủ cho mục tiêu. 0 / 2.394 kcal') })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Khép lại hôm nay. Ghi lại ý định nghỉ ngơi' })).toBeTruthy();
    // the streak is not known this morning; level and coins are the kept profile's
    expect(screen.queryByText(/4 ngày/)).toBeNull();
    expect(screen.getByRole('link', { name: 'xem hành trình' })).toBeTruthy();
    expect(screen.getByLabelText('250 xu')).toBeTruthy();

    // the first record of the morning can be made, and stays as waiting
    expect(record().props.accessibilityState.disabled).toBeFalsy();
    fireEvent.press(record());
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    await settle();
    expect(screen.getByText('1 / 8 phần')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    // the guess is kept nowhere: the disk and the query cache still hold the day the server gave
    expect(JSON.parse((await AsyncStorage.getItem(dayCache)) ?? '{}').quests[2].progress).toBe(8);
    expect(queryClient().getQueryData<DayState>(['day'])?.quests[2].progress).toBe(8);

    // the network is back: the queue delivers the record and the server's day replaces the guess
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByText(NEW_DAY)).toBeNull());
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(screen.getByLabelText('4 ngày')).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(dayCache)) ?? '{}').quests[2].progress).toBe(4);
    view.unmount();
  });

  test('a kept day that is over while the request is still out: the first-load state, not yesterday as today', async () => {
    await AsyncStorage.setItem(dayCache, JSON.stringify(finishedDay(-60_000)));
    const day = hold('GET /day');
    const view = await openToday();
    await settle();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('8 / 8 phần')).toBeNull();
    expect(screen.queryByText(NEW_DAY)).toBeNull();
    await act(async () => day.release());
    expect(await screen.findByText('3 / 8 phần')).toBeTruthy();
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

describe('the day changes', () => {
  test('coming back to the app reads the day again, once', async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
      listeners.push(listener);
      return { remove: () => undefined };
    }) as never);
    world.day = finishedDay(6 * HOUR);
    const view = await openToday();
    expect(screen.getByText('8 / 8 phần')).toBeTruthy();
    expect(record().props.accessibilityState.disabled).toBe(true);
    expect(requested('/day')).toBe(1);

    // the night passes in the background; the server has a new day
    world.day = dayOf({ logicalDate: '2026-10-15', streak: { current: 5, best: 9 } }, { progress: 0, lastTick: null });
    await act(async () => listeners.forEach(listener => listener('background')));
    await settle();
    expect(requested('/day')).toBe(1);
    await act(async () => listeners.forEach(listener => listener('active')));
    expect(await screen.findByText('0 / 8 phần')).toBeTruthy();
    expect(record().props.accessibilityState.disabled).toBeFalsy();
    expect(screen.getByLabelText('5 ngày')).toBeTruthy();
    // one request, although every user of the day listens
    expect(listeners.length).toBeGreaterThan(1);
    expect(requested('/day')).toBe(2);
    view.unmount();
  });

  test('at the moment the day closes it is read again: not before, and not again until the next close', async () => {
    fakeTimers();
    world.day = finishedDay(60_000);
    const view = await openToday();
    expect(screen.getByText('8 / 8 phần')).toBeTruthy();
    world.day = dayOf({ logicalDate: '2026-10-15' }, { progress: 0, lastTick: null });
    await act(() => jest.advanceTimersByTimeAsync(50_000));
    expect(requested('/day')).toBe(1);
    expect(screen.getByText('8 / 8 phần')).toBeTruthy();

    await act(() => jest.advanceTimersByTimeAsync(10_000));
    expect(await screen.findByText('0 / 8 phần')).toBeTruthy();
    expect(record().props.accessibilityState.disabled).toBeFalsy();
    expect(requested('/day')).toBe(2);
    // the new day closes in six hours: nothing is asked in the meantime
    await act(() => jest.advanceTimersByTimeAsync(5 * HOUR));
    expect(requested('/day')).toBe(2);
    view.unmount();
  });

  test('the day closes while the app is open and there is no network: a provisional day, not yesterday; a part recorded then stays, waiting', async () => {
    fakeTimers();
    world.day = finishedDay(60_000);
    const view = await openToday();
    expect(record().props.accessibilityState.disabled).toBe(true);
    world.down = true;
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(await screen.findByText(NEW_DAY)).toBeTruthy();
    expect(screen.getByText('0 / 8 phần')).toBeTruthy();
    expect(screen.queryByText('Đã ghi đủ 8 phần hôm nay.')).toBeNull();
    expect(screen.queryByText(/4 ngày/)).toBeNull();

    fireEvent.press(record());
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('1 / 8 phần')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nước hôm nay. 1 / 8 phần. Có phần đang chờ gửi. Chạm để ghi thêm một phần.' })).toBeTruthy();
    view.unmount();
  });

  describe('this device\'s clock runs ahead: the server still gives the same day after its close by this clock', () => {
    /** The close has just passed by this clock, the server has answered with the same day: 2 requests so far. */
    async function pastTheClose() {
      fakeTimers();
      world.day = dayOf({ closesAt: new Date(Date.now() + 60_000).toISOString() });
      const view = await openToday();
      // to a moment just past the close (opening took a few fake milliseconds of the minute)
      await act(() => jest.advanceTimersByTimeAsync(60_000));
      expect(requested('/day')).toBe(2);
      return view;
    }

    test('the day is shown as the server says, and asked for again once a minute, five times at most', async () => {
      const view = await pastTheClose();
      expect(screen.getByText('3 / 8 phần')).toBeTruthy();
      expect(screen.queryByText(NEW_DAY)).toBeNull();
      expect(screen.queryByRole('progressbar', { name: 'Đang tải' })).toBeNull();
      for (const asked of [3, 4, 5, 6, 7]) {
        await act(() => jest.advanceTimersByTimeAsync(59_000));
        expect(requested('/day')).toBe(asked - 1);
        await act(() => jest.advanceTimersByTimeAsync(1_000));
        expect(requested('/day')).toBe(asked);
      }
      expect(screen.getByText('3 / 8 phần')).toBeTruthy();
      // a clock more than five minutes ahead: no further asking on a schedule
      await act(() => jest.advanceTimersByTimeAsync(30 * 60_000));
      expect(requested('/day')).toBe(7);
      view.unmount();
    });

    test('the asking stops as soon as the server gives the new day', async () => {
      const view = await pastTheClose();
      await act(() => jest.advanceTimersByTimeAsync(60_000));
      expect(requested('/day')).toBe(3);
      world.day = dayOf({ logicalDate: '2026-10-15' }, { progress: 0, lastTick: null });
      await act(() => jest.advanceTimersByTimeAsync(60_000));
      expect(requested('/day')).toBe(4);
      expect(await screen.findByText('0 / 8 phần')).toBeTruthy();
      await act(() => jest.advanceTimersByTimeAsync(30 * 60_000));
      expect(requested('/day')).toBe(4);
      view.unmount();
    });

    test('a part recorded then, without a network, stays on the day shown, waiting: the server decides which day it belongs to', async () => {
      const view = await pastTheClose();
      world.down = true;
      fireEvent.press(record());
      expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
      await act(() => jest.advanceTimersByTimeAsync(2_000));
      expect(screen.getByText('4 / 8 phần')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Nước hôm nay. 4 / 8 phần. Có phần đang chờ gửi. Chạm để ghi thêm một phần.' })).toBeTruthy();
      view.unmount();
    });

    test('leaving leaves no timer of that schedule behind', async () => {
      const view = await pastTheClose();
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      view.unmount();
      wipeQueries(queryClient());
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('a provisional day on screen', () => {
    /** Cold start without a network, the kept day over: the provisional day, after one failed `GET /day`. */
    async function provisional() {
      world.down = true;
      await AsyncStorage.setItem(meCache, JSON.stringify(world.me));
      await AsyncStorage.setItem(dayCache, JSON.stringify(finishedDay(-60_000)));
      const view = await openToday();
      await screen.findByText(NEW_DAY);
      await settle();
      expect(requested('/day')).toBe(1);
      return view;
    }

    test('the network returns and any request gets through: the day is read once, and the server day replaces the guess', async () => {
      const view = await provisional();
      world.down = false;
      await act(() => api.get('/settings').then(() => undefined));
      await waitFor(() => expect(screen.queryByText(NEW_DAY)).toBeNull());
      expect(screen.getByText('3 / 8 phần')).toBeTruthy();
      expect(screen.getByLabelText('4 ngày')).toBeTruthy();
      await settle();
      expect(requested('/day')).toBe(2);
      // with the server's day on screen, further requests do not read it again
      await act(() => api.get('/settings').then(() => undefined));
      await settle();
      expect(requested('/day')).toBe(2);
      view.unmount();
    });

    test('a request that fails says nothing about the network being back: the day is not asked for', async () => {
      const view = await provisional();
      await act(() => api.get('/settings').catch(() => undefined));
      await settle();
      expect(requested('/day')).toBe(1);
      expect(screen.getByText(NEW_DAY)).toBeTruthy();
      view.unmount();
    });

    test('coming back to the app reads it again too', async () => {
      const listeners: ((state: string) => void)[] = [];
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
        listeners.push(listener);
        return { remove: () => undefined };
      }) as never);
      const view = await provisional();
      world.down = false;
      await act(async () => listeners.forEach(listener => listener('active')));
      await waitFor(() => expect(screen.queryByText(NEW_DAY)).toBeNull());
      expect(screen.getByText('3 / 8 phần')).toBeTruthy();
      expect(requested('/day')).toBe(2);
      view.unmount();
    });

    test('whether there is unread mail is not known: the bell has no dot and says only what it opens', async () => {
      const view = await provisional();
      expect(screen.getByRole('button', { name: 'Hộp thư' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Hộp thư, có thư mới' })).toBeNull();
      view.unmount();
    });
  });

  test('a read had failed earlier in the day; at the close the day is read again: the loading state while that request is out, not the error state', async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
      listeners.push(listener);
      return { remove: () => undefined };
    }) as never);
    fakeTimers();
    world.day = dayOf({ closesAt: new Date(Date.now() + 60_000).toISOString() });
    const view = await openToday();
    // a failed read in the afternoon: the day stays on screen
    world.down = true;
    await act(async () => listeners.forEach(listener => listener('active')));
    await act(() => jest.advanceTimersByTimeAsync(100));
    expect(requested('/day')).toBe(2);
    expect(screen.getByText('3 / 8 phần')).toBeTruthy();

    // the close: the request for the new day is on its way
    world.down = false;
    const day = hold('GET /day');
    world.day = dayOf({ logicalDate: '2026-10-15' }, { progress: 0, lastTick: null });
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(requested('/day')).toBe(3);
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    expect(screen.queryByText('3 / 8 phần')).toBeNull();
    await act(async () => day.release());
    expect(await screen.findByText('0 / 8 phần')).toBeTruthy();
    view.unmount();
  });

  test('leaving leaves no timer for the close behind', async () => {
    fakeTimers();
    const view = await openToday();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    wipeQueries(queryClient());
    expect(jest.getTimerCount()).toBe(0);
  });
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
    expect(screen.getByRole('button', { name: 'Nước hôm nay. 5 / 8 phần. Có phần đang chờ gửi. Chạm để ghi thêm một phần.' })).toBeTruthy();
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
