import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { DayState, QuestState } from '../../../domain/contract/core.ts';
import { clearUserCache } from '../../shared/storage/cache';
import { dayOf, fetchMock, hold, HIDDEN, installTodayTestEnv, openToday, queryClient, refuse, requested, settle, STAND_UP, USER, world, writes } from '../dashboard/todayTestKit';

// The real registry; the detail screens' `navigate` is recorded on its way to the navigator, so a link to a route that
// no task has registered yet (inert, AR-25) can still be asserted by name.
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
  return { ...actual, detailScreens: actual.detailScreens.map(spied) };
});

installTodayTestEnv();
beforeEach(() => mockNavigate.mockClear());

const MIN = 60_000;
const HOUR = 3_600_000;
const standUpPath = `/day/quests/${STAND_UP}/progress`;
const STAND_UP_TICK = `POST ${standUpPath}`;
const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
afterEach(() => {
  mockedAppState.currentState = appStateAtLoad;
});

const quests = (day: DayState, change: Record<string, Partial<QuestState>>): DayState => ({
  ...day,
  quests: day.quests.map(quest => ({ ...quest, ...change[quest.code] })),
});
const rowOf = (name: string | RegExp) => screen.getByRole('button', { name });
const stand = () => rowOf(/^Đứng dậy một chút/);
const water = () => rowOf(/^Uống nước/);
const standUps = () => writes().filter(request => request.path === standUpPath);

/** Today, then "Xem tất cả nhiệm vụ": the board as a person reaches it. */
async function openBoard(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('button', { name: 'Xem tất cả nhiệm vụ' }));
  await screen.findByRole('header', { name: 'Nhiệm vụ hôm nay' });
  mockNavigate.mockClear();
  return view;
}

describe('S10: the quests of the day', () => {
  test('two sections from the day: the tasks the streak depends on, then the small habits', async () => {
    const view = await openBoard();
    expect(screen.getByText('Ghi điều bạn đã làm, từng chút một.')).toBeTruthy();

    expect(screen.getByRole('header', { name: 'Giữ nhịp hôm nay' })).toBeTruthy();
    expect(rowOf('Buổi tập chính. Chưa bắt đầu. +50 XP')).toBeTruthy();
    expect(rowOf('Bữa ăn theo mục tiêu. 1.650 / 2.394 kcal · hoàn thành khi trong 2.155–2.633 kcal. +50 XP')).toBeTruthy();
    expect(screen.getByText('1.650 / 2.394 kcal · hoàn thành khi trong 2.155–2.633 kcal')).toBeTruthy();

    expect(screen.getByRole('header', { name: 'Thói quen nhỏ' })).toBeTruthy();
    expect(water().props.accessibilityLabel).toBe('Uống nước. 3 / 8 phần. +10 XP mỗi phần. Chạm để ghi thêm một phần.');
    expect(screen.getByText('+10 XP mỗi phần')).toBeTruthy();
    expect(stand().props.accessibilityLabel).toBe('Đứng dậy một chút. 0 / 6 lần. +10 XP mỗi lần. Chạm để ghi thêm một lần.');

    // the hidden quest while it is locked: a lock, its name withheld, and not a control
    expect(screen.getByLabelText('Nhiệm vụ ẩn. Mở vào buổi tối')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Nhiệm vụ ẩn/ })).toBeNull();
    expect(screen.queryByText('Khép lại hôm nay trước 23:00')).toBeNull();

    expect(screen.getByText('Ngày của bạn khép lại theo múi giờ hồ sơ. Không cần thức chờ để giữ chuỗi.')).toBeTruthy();
    // nothing is promised or shown as done, and opening the board records nothing
    expect(screen.queryByText('Đã xong')).toBeNull();
    expect(writes()).toEqual([]);
    view.unmount();
  });

  test('the hidden quest, once it is open, is named, offers +30 XP and opens the end of the day', async () => {
    world.day = quests(dayOf(), { [HIDDEN]: { locked: false } });
    const view = await openBoard();
    expect(screen.queryByLabelText('Nhiệm vụ ẩn. Mở vào buổi tối')).toBeNull();
    const row = rowOf('Khép lại hôm nay trước 23:00. +30 XP');
    expect(within(row).getByText('+30 XP')).toBeTruthy();
    fireEvent.press(row);
    expect(mockNavigate.mock.calls).toEqual([['EndOfDay']]);
    expect(await screen.findByRole('header', { name: 'Khép lại hôm nay' })).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('a completed quest says so in words and with a check, and offers no reward and no way to record more', async () => {
    world.day = quests(dayOf({ story: { done: 1, total: 2 }, bedtimeMarkedAt: new Date().toISOString() }), {
      WORKOUT_MAIN: { completed: true, progress: 1 },
      WATER_8: { completed: true, progress: 8 },
      [HIDDEN]: { locked: false, completed: true, progress: 1 },
    });
    const view = await openBoard();
    const workout = rowOf('Buổi tập chính. Đã hoàn thành buổi tập. Đã xong');
    expect(within(workout).getByText('Đã xong')).toBeTruthy();
    expect(within(workout).queryByText('+50 XP')).toBeNull();
    // the water row: complete, off, nothing to tap
    expect(water().props.accessibilityState.disabled).toBe(true);
    expect(within(water()).getByText('Đã xong')).toBeTruthy();
    expect(within(water()).queryByText('+10 XP mỗi phần')).toBeNull();
    expect(within(rowOf('Khép lại hôm nay trước 23:00. Đã xong')).getByText('Đã xong')).toBeTruthy();
    // the one still open keeps its reward
    expect(within(rowOf(/^Bữa ăn theo mục tiêu/)).getByText('+50 XP')).toBeTruthy();
    view.unmount();
  });

  test('every row goes where it says: the workout to the catalog, the meal to S13, the hidden quest to S45', async () => {
    const view = await openBoard();
    fireEvent.press(rowOf(/^Buổi tập chính/));
    expect(mockNavigate.mock.calls).toEqual([['WorkoutCatalog']]);
    // the catalog opens; back on the board for the next row
    expect(await screen.findByRole('header', { name: 'Chọn buổi tập' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    fireEvent.press(await screen.findByRole('button', { name: /^Bữa ăn theo mục tiêu/ }));
    expect(mockNavigate.mock.calls).toEqual([['WorkoutCatalog'], ['MealPlan']]);
    expect(await screen.findByRole('header', { name: 'Thực đơn hôm nay' })).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('Back returns to Hôm nay', async () => {
    const view = await openBoard();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('the day cannot be read and nothing is kept: the error state, and "Thử lại" reads it again', async () => {
    const view = await openBoard();
    world.answer = request => (request === 'GET /day' ? refuse(500, 'INTERNAL') : undefined);
    await clearUserCache(USER);
    await act(async () => queryClient().resetQueries({ queryKey: ['day'] }));
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.queryByText('Thói quen nhỏ')).toBeNull();
    world.answer = undefined;
    const before = requested('/day');
    fireEvent.press(screen.getAllByRole('button', { name: 'Thử lại' })[0]);
    expect(await screen.findByText('Thói quen nhỏ')).toBeTruthy();
    expect(requested('/day')).toBeGreaterThan(before);
    view.unmount();
  });
});

describe('ticks from the board (S11)', () => {
  test('the stand-up row is one STAND_UP tick: the count moves, the S11 snackbar says "Đã ghi nhận" with "Hoàn tác"', async () => {
    const view = await openBoard();
    fireEvent.press(stand());
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeTruthy();
    expect(standUps()).toHaveLength(1);
    expect(standUps()[0].body).toEqual({});
    expect(screen.getByText('1 / 6 lần')).toBeTruthy();
    expect(world.day.quests.find(quest => quest.code === STAND_UP)?.progress).toBe(1);
    view.unmount();
  });

  test('"Hoàn tác" takes back that very tick: the undo of the STAND_UP quest carries the tick id', async () => {
    const view = await openBoard();
    fireEvent.press(stand());
    fireEvent.press(await screen.findByRole('button', { name: 'Hoàn tác' }));
    await settle();
    const undone = fetchMock.mock.calls.filter(([url]) => url.endsWith(`/day/quests/${STAND_UP}/undo`));
    expect(undone).toHaveLength(1);
    expect(JSON.parse(undone[0][1].body ?? 'null')).toEqual({ tickId: standUps()[0].id });
    view.unmount();
  });

  test('the water row records a part the same way, and the number is the server\'s', async () => {
    const view = await openBoard();
    fireEvent.press(water());
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(writes().filter(request => request.path.endsWith('WATER_8/progress'))).toHaveLength(1);
    view.unmount();
  });

  test('before the answer the row says "đang lưu" and claims nothing; with the answer, the reward', async () => {
    const answer = hold(STAND_UP_TICK);
    const view = await openBoard();
    fireEvent.press(stand());
    expect(screen.getByText('1 / 6 lần · đang lưu')).toBeTruthy();
    await settle();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    await act(async () => answer.release());
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    view.unmount();
  });

  test('without a network the tick is kept: "Đang chờ gửi", the count includes it, no reward and no Undo', async () => {
    const view = await openBoard();
    world.down = true;
    fireEvent.press(stand());
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    expect(screen.getByText('1 / 6 lần')).toBeTruthy();
    expect(stand().props.accessibilityLabel).toContain('Có phần đang chờ gửi');
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    expect(screen.queryByText(/đã lưu$/)).toBeNull();
    view.unmount();
  });

  test('a refusal rolls the count back next to the row, with the reason and "Thử lại" as a new action', async () => {
    world.answer = request => (request === STAND_UP_TICK ? refuse(409, 'QUEST_ALREADY_COMPLETE') : undefined);
    const view = await openBoard();
    fireEvent.press(stand());
    expect(await screen.findByText('Chưa lưu được lần đứng dậy vừa ghi. Nhiệm vụ này đã hoàn thành từ trước.')).toBeTruthy();
    expect(screen.getByText('0 / 6 lần')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();

    world.answer = undefined;
    // the board's own "Thử lại": the only one on this screen
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    const ids = standUps().map(request => request.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(screen.queryByText(/Chưa lưu được/)).toBeNull();
    view.unmount();
  });

  test('the last part is recorded, then the row is off with its reason until the server says "Đã xong"', async () => {
    world.day = quests(dayOf(), { STAND_UP: { progress: 5 } });
    const view = await openBoard();
    expect(screen.getByText('5 / 6 lần')).toBeTruthy();
    fireEvent.press(stand());
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(await screen.findByText('Đã xong', { includeHiddenElements: false })).toBeTruthy();
    expect(stand().props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('6 / 6 lần')).toBeTruthy();
    view.unmount();
  });

  test('a part waiting on this device counts toward the target: the sixth is on its way, the row is off and says why', async () => {
    world.day = quests(dayOf(), { STAND_UP: { progress: 5 } });
    const view = await openBoard();
    world.down = true;
    fireEvent.press(stand());
    expect(await screen.findByText('Đã ghi đủ 6 lần hôm nay.')).toBeTruthy();
    expect(stand().props.accessibilityState.disabled).toBe(true);
    expect(stand().props.accessibilityLabel).toContain('Đã ghi đủ 6 lần hôm nay.');
    // not done until the server says so
    expect(screen.queryByText('Đã xong')).toBeNull();
    expect(standUps()).toHaveLength(1);
    fireEvent.press(stand());
    await settle();
    expect(standUps()).toHaveLength(1);
    view.unmount();
  });
});

describe('the stand-up reminder on the board', () => {
  test('"Lần nhắc tới sau M phút" follows the countdown, and a part recorded here begins a new hour', async () => {
    fakeTimers();
    mockedAppState.currentState = 'active';
    const view = await openBoard();
    expect(screen.getByText('Lần nhắc tới sau 60 phút')).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(18 * MIN));
    expect(screen.getByText('Lần nhắc tới sau 42 phút')).toBeTruthy();

    // a part recorded from the board: 60 minutes again, and the prompt is not at the old time
    fireEvent.press(stand());
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(30 * MIN));
    expect(screen.getByText('Lần nhắc tới sau 30 phút')).toBeTruthy();
    expect(screen.queryByText('Đến lúc đứng dậy vươn vai một chút')).toBeNull();
    await act(() => jest.advanceTimersByTimeAsync(30 * MIN));
    expect(screen.getByText('Đến lúc đứng dậy vươn vai một chút')).toBeTruthy();
    view.unmount();
  });

  test('no line about the reminder while no countdown runs (the app is not in the foreground)', async () => {
    const view = await openBoard();
    expect(screen.queryByText(/^Lần nhắc tới sau/)).toBeNull();
    view.unmount();
  });
});

describe('a provisional new day (the server cannot be asked)', () => {
  const finished = (): DayState =>
    quests(dayOf({ closesAt: new Date(Date.now() - 60_000).toISOString(), caloriesIn: 2380, story: { done: 2, total: 2 }, bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString() }), {
      WORKOUT_MAIN: { completed: true, progress: 1 },
      NUTRITION_TARGET: { completed: true, progress: 1 },
      WATER_8: { completed: true, progress: 8 },
    });

  test('same quests, nothing done, a line that says the numbers are not synced; a part recorded waits, with no reward', async () => {
    await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(world.me));
    await AsyncStorage.setItem(`cache:v1:${USER}:day`, JSON.stringify(finished()));
    world.down = true;
    const view = await openBoard();
    expect(await screen.findByText('Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.')).toBeTruthy();
    expect(screen.queryByText('Đã xong')).toBeNull();
    expect(screen.getByText('0 / 6 lần')).toBeTruthy();
    expect(screen.getByText('0 / 8 phần')).toBeTruthy();
    fireEvent.press(stand());
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    // no control of its own to ask the server again: the app does that when any request gets through
    view.unmount();
  });
});
