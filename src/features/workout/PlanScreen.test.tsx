import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { DayState } from '../../../domain/contract/core.ts';
import { clearUserCache } from '../../shared/storage/cache';
import { app, dayOf, hold, idsOnDisk, meOf, queryClient, seedQueue, settle, stored, TICK, USER, world } from '../dashboard/todayTestKit';
import { tickPath, WATER } from '../quests/api';
import { COMPLETE, detail, installWorkoutTestEnv, openPlan } from './workoutTestKit';

// The real registry; `navigate` of the tab roots and detail screens is recorded on its way to the navigator, so a link
// to a route that no task has registered yet (inert, AR-25) can still be asserted by name.
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
  return { ...actual, tabRoots: actual.tabRoots.map(spied), detailScreens: actual.detailScreens.map(spied) };
});

installWorkoutTestEnv();
beforeEach(() => mockNavigate.mockClear());

const row = (name: string) => screen.getByRole('button', { name });
const workoutDone = (day: DayState): DayState => ({ ...day, quests: day.quests.map(quest => (quest.code === 'WORKOUT_MAIN' ? { ...quest, completed: true, progress: 1 } : quest)) });

describe('S12: the plan tab', () => {
  test('where today stands, from the day, and the three ways in', async () => {
    const view = await openPlan();
    expect(screen.getByRole('tab', { name: 'Lộ trình', selected: true })).toBeTruthy();
    expect(screen.getByText('Ăn đủ, vận động vừa sức, nghỉ ngơi đều.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Hôm nay của bạn' })).toBeTruthy();
    expect(screen.getByText('Buổi tập chính: chưa bắt đầu')).toBeTruthy();
    expect(screen.getByText('Bữa ăn: 1.650 / 2.394 kcal · cần trong 2.155–2.633')).toBeTruthy();
    expect(row('Thực đơn hôm nay. Gợi ý phù hợp mục tiêu của bạn')).toBeTruthy();
    expect(row('Chọn buổi tập. Chọn thời lượng, không gian, dụng cụ')).toBeTruthy();
    expect(row('Mục tiêu của bạn. Năng lượng, nước và phân bổ ước tính')).toBeTruthy();
    expect(screen.getByText('Một ngày không như kế hoạch cũng không xóa đi những gì bạn đã làm.')).toBeTruthy();
    // nothing is claimed, and the tab is not where one signs out
    expect(screen.queryByText(/đã hoàn thành/)).toBeNull();
    expect(screen.queryByText(/chờ gửi/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull();
    view.unmount();
  });

  test.each([
    ['Thực đơn hôm nay. Gợi ý phù hợp mục tiêu của bạn', 'MealPlan'],
    ['Chọn buổi tập. Chọn thời lượng, không gian, dụng cụ', 'WorkoutCatalog'],
    ['Mục tiêu của bạn. Năng lượng, nước và phân bổ ước tính', 'Targets'],
  ])('"%s" navigates to %s', async (name, route) => {
    const view = await openPlan();
    fireEvent.press(row(name));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(route);
    await act(async () => undefined);
    view.unmount();
  });

  test('"Chọn buổi tập" opens the catalog in this tab, and Back returns to the tab', async () => {
    const view = await openPlan();
    fireEvent.press(row('Chọn buổi tập. Chọn thời lượng, không gian, dụng cụ'));
    expect(await screen.findByRole('header', { name: 'Chọn buổi tập' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Lộ trình' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lộ trình', selected: true })).toBeTruthy();
    view.unmount();
  });

  test('a workout the server has as done is named done, in words', async () => {
    world.day = workoutDone(dayOf());
    const view = await openPlan();
    expect(screen.getByText('Buổi tập chính: đã hoàn thành')).toBeTruthy();
    expect(screen.queryByText('Buổi tập chính: chưa bắt đầu')).toBeNull();
    view.unmount();
  });

  test('a session that waits on this device is named as waiting, and nothing is called done', async () => {
    // left by an earlier run of the app; the send that starts with the session gets no answer
    await seedQueue([stored('3f0e8a52-6c1b-4d7e-9a34-2b5c7d8e9f01', { path: '/workout/complete', body: { exerciseItemId: detail.id, elapsedSec: 600 } })]);
    const server = world.answer;
    world.answer = (request, init) => {
      if (request === COMPLETE) throw new TypeError('Network request failed');
      return server?.(request, init);
    };
    const view = await openPlan();
    expect(await screen.findByText('Có buổi tập đã lưu trên máy, đang chờ gửi')).toBeTruthy();
    expect(screen.getByText('Buổi tập chính: chưa bắt đầu')).toBeTruthy();
    expect(screen.queryByText(/đã hoàn thành/)).toBeNull();
    expect(screen.queryByText(/XP/)).toBeNull();
    view.unmount();
  });
});

describe('S12 and a session that is on its way', () => {
  test('a session behind another record in flight is not called waiting: nothing is, until a send gets no answer', async () => {
    const view = await openPlan();
    const tick = hold(TICK);
    let sends: Promise<unknown>[] = [];
    await act(async () => {
      sends = [app.send({ path: tickPath(WATER), body: {} }), app.send({ path: '/workout/complete', body: { exerciseItemId: detail.id, elapsedSec: 600 } })];
    });
    await settle();
    // both are on this device; the first is out, the session stands behind it, untouched
    expect(await idsOnDisk()).toHaveLength(2);
    expect(screen.queryByText('Có buổi tập đã lưu trên máy, đang chờ gửi')).toBeNull();
    expect(screen.queryByText(/chờ gửi/)).toBeNull();

    await act(async () => {
      tick.release();
      await Promise.all(sends);
    });
    expect(await screen.findByText('Buổi tập chính: đã hoàn thành')).toBeTruthy();
    expect(screen.queryByText('Có buổi tập đã lưu trên máy, đang chờ gửi')).toBeNull();
    view.unmount();
  });
});

describe('S12 without the day', () => {
  test('while the day is being read: a skeleton in place of the numbers, the ways in already there', async () => {
    const view = await openPlan();
    const day = hold('GET /day');
    await clearUserCache(USER);
    await act(async () => {
      queryClient().resetQueries({ queryKey: ['day'] });
    });
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    expect(row('Chọn buổi tập. Chọn thời lượng, không gian, dụng cụ')).toBeTruthy();
    await act(async () => day.release());
    expect(await screen.findByText('Buổi tập chính: chưa bắt đầu')).toBeTruthy();
    view.unmount();
  });

  test('the day cannot be read: that is said, with "Thử lại", and the ways in still work', async () => {
    const view = await openPlan();
    world.down = true;
    await clearUserCache(USER);
    await act(async () => {
      queryClient().resetQueries({ queryKey: ['day'] });
    });
    expect(await screen.findByText(/^Chưa tải được dữ liệu\. Không kết nối được mạng/)).toBeTruthy();
    expect(screen.queryByText(/Buổi tập chính/)).toBeNull();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Buổi tập chính: chưa bắt đầu')).toBeTruthy();
    view.unmount();
  });

  test('the new day cannot be read yet: the line that says so, and nothing of yesterday shown as done', async () => {
    const kept = workoutDone(dayOf({ closesAt: new Date(Date.now() - 60_000).toISOString(), story: { done: 2, total: 2 }, caloriesIn: 2380 }));
    await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(meOf()));
    await AsyncStorage.setItem(`cache:v1:${USER}:day`, JSON.stringify(kept));
    world.down = true;
    const view = await openPlan();
    expect(await screen.findByText('Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.')).toBeTruthy();
    expect(screen.getByText('Buổi tập chính: chưa bắt đầu')).toBeTruthy();
    expect(screen.getByText('Bữa ăn: 0 / 2.394 kcal · cần trong 2.155–2.633')).toBeTruthy();
    expect(screen.queryByText(/đã hoàn thành/)).toBeNull();
    view.unmount();
  });
});

describe('the way out of the account', () => {
  test('"Đăng xuất" is within reach of an onboarded person: on the Settings screen the Cá nhân tab opens, and on no tab root', async () => {
    const view = await openPlan();
    for (const tab of ['Hôm nay', 'Lộ trình', 'Tổ đội', 'Cá nhân']) {
      fireEvent.press(screen.getByRole('tab', { name: tab }));
      await screen.findByRole('tab', { name: tab, selected: true });
      await act(async () => undefined);
      expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull();
    }
    fireEvent.press(screen.getByRole('button', { name: /^Cài đặt\./ }));
    expect(await screen.findByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
    view.unmount();
  });
});
