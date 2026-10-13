import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { healthVi } from '../../shared/i18n/vi/health';
import { dayOf, installTodayTestEnv, openToday, settle, USER, world } from './todayTestKit';

// The real registry; the explainer's `navigate` is recorded on its way to the navigator, so a link to a route that no
// task has registered yet (inert, AR-25) can still be asserted by name.
const mockNavigate = jest.fn();
jest.mock('../../app/screens', () => {
  const actual = jest.requireActual('../../app/screens');
  const { createElement } = require('react');
  const spied = (entry: { name: string; component: unknown }) => {
    if (entry.name !== 'StatsExplainer') return entry;
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

/** S47, opened the way a person gets there: from the stats of the home tab. */
async function openExplainer() {
  const view = await openToday();
  fireEvent.press(screen.getByRole('link', { name: 'Hiểu các chỉ số' }));
  await screen.findByRole('header', { name: 'Hiểu chỉ số của bạn' });
  await settle();
  return view;
}
const bar = (name: string) => screen.getByRole('progressbar', { name });

test('S47: the four stats, each with its number, what it is made of and what goes into it now', async () => {
  world.day = dayOf({ bedtimeMarkedAt: null });
  const view = await openExplainer();
  expect(screen.getByText('Phản ánh hành vi, không đánh giá con người.')).toBeTruthy();
  for (const [name, value] of [['Sức sống', 26], ['Năng lượng', 69], ['Sức mạnh', 40], ['Sức bền', 30]] as const) {
    expect(bar(name).props.accessibilityValue).toEqual({ min: 0, max: 100, now: value });
    expect(within(bar(name)).getByText(`${value}/100`)).toBeTruthy();
  }
  // water, the bedtime mark and the streak
  expect(screen.getByText('Từ phần nước đã ghi, dấu ghi giờ nghỉ và chuỗi ngày giữ nhịp.')).toBeTruthy();
  expect(screen.getByText('Hôm nay: 750 / 2.000 ml nước, chưa ghi giờ nghỉ, chuỗi 4 ngày.')).toBeTruthy();
  // the calorie balance
  expect(screen.getByText('Từ lượng kcal đã ghi so với mục tiêu trong ngày.')).toBeTruthy();
  expect(screen.getByText('Hôm nay: đã ghi 1.650 / 2.394 kcal.')).toBeTruthy();
  // resistance minutes, and cardio + HIIT minutes, of the last 7 days
  expect(screen.getByText('Từ số phút vận động kháng lực trong 7 ngày gần nhất.')).toBeTruthy();
  expect(screen.getByText('Hiện tại 40/100. Thanh đầy khi đủ 150 phút trong 7 ngày gần nhất.')).toBeTruthy();
  expect(screen.getByText('Từ số phút cardio và HIIT trong 7 ngày gần nhất.')).toBeTruthy();
  expect(screen.getByText('Hiện tại 30/100. Thanh đầy khi đủ 150 phút trong 7 ngày gần nhất.')).toBeTruthy();

  // estimates from recorded behaviour, not a diagnosis; read-only
  expect(screen.getByText(healthVi.estimate.stats)).toBeTruthy();
  expect(healthVi.estimate.stats).toContain('Đây là ước tính, không phải chẩn đoán');
  expect(screen.getByText('Chỉ số được tính từ những gì bạn ghi nhận: không mua được và không chỉnh sửa được.')).toBeTruthy();
  // a detail screen: no tab bar, and it costs no request of its own
  expect(screen.queryAllByRole('tab')).toEqual([]);
  view.unmount();
});

test('S47: a bedtime mark the server has is said in words', async () => {
  world.day = dayOf({ bedtimeMarkedAt: new Date().toISOString(), waterMl: 2000, streak: { current: 12, best: 12 } });
  const view = await openExplainer();
  expect(screen.getByText('Hôm nay: 2.000 / 2.000 ml nước, đã ghi giờ nghỉ, chuỗi 12 ngày.')).toBeTruthy();
  view.unmount();
});

test('S47 on a provisional day (the kept one is over, no network): no inputs are stated as if they were known', async () => {
  world.down = true;
  await AsyncStorage.setItem('cache:v1:' + USER + ':me', JSON.stringify(world.me));
  await AsyncStorage.setItem('cache:v1:' + USER + ':day', JSON.stringify(dayOf({ closesAt: new Date(Date.now() - 60_000).toISOString() })));
  const view = await openToday();
  await screen.findByText('Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.');
  fireEvent.press(screen.getByRole('link', { name: 'Hiểu các chỉ số' }));
  await screen.findByRole('header', { name: 'Hiểu chỉ số của bạn' });
  await settle();
  expect(screen.queryByText(/^Hôm nay:/)).toBeNull();
  // what each stat is made of, and the kept profile's numbers, are still there
  expect(screen.getByText('Từ phần nước đã ghi, dấu ghi giờ nghỉ và chuỗi ngày giữ nhịp.')).toBeTruthy();
  expect(within(bar('Sức sống')).getByText('26/100')).toBeTruthy();
  view.unmount();
});

test.each([
  ['link', 'Ghi nhận bữa ăn', ['ManualKcal']],
  ['link', 'Chọn bài tập kháng lực', ['WorkoutCatalog']],
  ['link', 'Chọn bài cardio hoặc HIIT', ['WorkoutCatalog']],
  ['button', 'Xem lịch sử ghi nhận', ['DayHistory']],
] as const)('S47: %s "%s" navigates to %j', async (role, name, call) => {
  const view = await openExplainer();
  fireEvent.press(screen.getByRole(role, { name }));
  expect(mockNavigate.mock.calls).toEqual([call]);
  await settle();
  view.unmount();
});

test('S47: "Ghi nhận nước ở Hôm nay" goes to the root of the home tab, where the water is recorded', async () => {
  const view = await openExplainer();
  fireEvent.press(screen.getByRole('link', { name: 'Ghi nhận nước ở Hôm nay' }));
  expect(mockNavigate.mock.calls).toEqual([['Today']]);
  expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Ghi nhận nước' })).toBeTruthy();
  await settle();
  view.unmount();
});
