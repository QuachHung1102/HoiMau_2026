import { fireEvent, screen } from '@testing-library/react-native';
import type { DayDetail } from '../../../domain/contract/core.ts';
import { addDays } from '../../../domain/logicalDate.ts';
import { refuse } from '../sync/syncTestKit';
import { dayOf, FRIDAY, installTodayTestEnv, openHistory, requested, setHistory, settle, world } from './progressionTestKit';

// The real registry; `navigate` is recorded on its way to the navigator, and S51 can be opened with a date asked for, as a
// link from another screen does (`params.date`).
const mockNavigate = jest.fn();
let mockDate: string | undefined;
jest.mock('../../app/screens', () => {
  const actual = jest.requireActual('../../app/screens');
  const { createElement } = require('react');
  const spied = (entry: { name: string; component: unknown }) => {
    function Spied(props: { navigation: { navigate(...to: unknown[]): void }; route: { params?: object } }) {
      const navigate = (...to: unknown[]) => {
        mockNavigate(...to);
        props.navigation.navigate(...to);
      };
      const route = entry.name === 'DayHistory' && mockDate ? { ...props.route, params: { date: mockDate } } : props.route;
      return createElement(entry.component as never, { ...props, route, navigation: { ...props.navigation, navigate } } as never);
    }
    return { ...entry, component: Spied };
  };
  return { ...actual, tabRoots: actual.tabRoots.map(spied), detailScreens: actual.detailScreens.map(spied) };
});

installTodayTestEnv();
beforeEach(() => {
  mockNavigate.mockClear();
  mockDate = undefined;
});

const TODAY = '2026-10-14'; // what `dayOf()` says: a Wednesday
const button = (name: string) => screen.getByRole('button', { name });
const heading = (name: string) => screen.getByRole('header', { name });
const FIXTURE_AT = '2026-10-14T00:45:00.000Z'; // 07:45 in Asia/Ho_Chi_Minh
const at = (time: string) => `2026-10-14T${time}:00.000Z`;

const actions: DayDetail['actions'] = [
  { id: 'a1', kind: 'BEDTIME', at: at('15:30'), mealSlot: null, label: null, value: null, undone: false },
  { id: 'a2', kind: 'WORKOUT', at: at('10:10'), mealSlot: null, label: 'Đi bộ nhanh', value: 1500, undone: false },
  { id: 'a3', kind: 'NUTRITION', at: at('05:00'), mealSlot: 'LUNCH', label: 'Bún gà', value: 450, undone: false },
  { id: 'a4', kind: 'NUTRITION', at: at('02:30'), mealSlot: null, label: null, value: 300, undone: false },
  { id: 'a5', kind: 'TICK', at: at('01:10'), mealSlot: null, label: 'WATER_8', value: null, undone: true },
  { id: 'a6', kind: 'TICK', at: FIXTURE_AT, mealSlot: null, label: 'WATER_8', value: null, undone: false },
];

describe('S51: one day', () => {
  test('today: the summary in words and the recorded actions, newest first, each with its time and value', async () => {
    setHistory(TODAY, 'OPEN', actions, { storyDone: 1, waterMl: 750, caloriesIn: 1650, workoutMinutes: 25 });
    const view = await openHistory();
    expect(requested(`/day/history/${TODAY}`)).toBe(1);
    expect(heading('Hôm nay')).toBeTruthy();
    expect(screen.getByText('Ngày đang mở')).toBeTruthy();
    expect(screen.getByText('Việc chính: 1/2')).toBeTruthy();
    expect(screen.getByText('Nước: 750 ml')).toBeTruthy();
    expect(screen.getByText('Năng lượng đã ghi: 1.650 kcal')).toBeTruthy();
    expect(screen.getByText('Vận động: 25 phút')).toBeTruthy();
    // the list, in the server's order (newest first), neutral about what was eaten and how much
    expect(screen.getByText('Kết thúc ngày')).toBeTruthy();
    expect(screen.getByText('22:30')).toBeTruthy(); // 15:30 UTC
    expect(screen.getByText('Đi bộ nhanh')).toBeTruthy();
    expect(screen.getByText('17:10 · 25 phút')).toBeTruthy(); // 1500 s
    expect(screen.getByText('Bún gà')).toBeTruthy();
    expect(screen.getByText('12:00 · Bữa trưa · 450 kcal')).toBeTruthy();
    expect(screen.getByText('Bữa ăn')).toBeTruthy(); // a manual entry without a label
    expect(screen.getByText('09:30 · 300 kcal')).toBeTruthy();
    expect(screen.getAllByText('Uống nước')).toHaveLength(2);
    view.unmount();
  });

  test('an undone tick reads "đã hoàn tác"; a live one does not', async () => {
    setHistory(TODAY, 'OPEN', actions);
    const view = await openHistory();
    expect(screen.getAllByText('đã hoàn tác')).toHaveLength(1);
    expect(screen.getByText('08:10')).toBeTruthy(); // the undone tick, 01:10 UTC
    expect(screen.getByText('07:45')).toBeTruthy(); // the live one
    view.unmount();
  });

  test('a workout of a few seconds still reads as one minute; no kcal and no label fall back to neutral words', async () => {
    setHistory(TODAY, 'OPEN', [
      { id: 'w', kind: 'WORKOUT', at: FIXTURE_AT, mealSlot: null, label: null, value: 20, undone: false },
      { id: 'n', kind: 'NUTRITION', at: FIXTURE_AT, mealSlot: 'SNACK', label: null, value: null, undone: false },
      { id: 't', kind: 'TICK', at: FIXTURE_AT, mealSlot: null, label: 'SOMETHING_NEW', value: null, undone: false },
    ]);
    const view = await openHistory();
    expect(screen.getByText('Buổi tập')).toBeTruthy();
    expect(screen.getByText('07:45 · 1 phút')).toBeTruthy();
    expect(screen.getByText('Bữa phụ')).toBeTruthy();
    expect(screen.getByText('Ghi nhận')).toBeTruthy();
    view.unmount();
  });

  test('a day with nothing recorded is the empty state, not an error', async () => {
    setHistory(TODAY, 'OPEN', []);
    const view = await openHistory();
    expect(screen.getByText('Chưa có ghi nhận')).toBeTruthy();
    expect(screen.getByText('Ngày này chưa có gì được ghi lại.')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    view.unmount();
  });

  test('the outcome of a closed day is told in words', async () => {
    setHistory(addDays(TODAY, -1), 'FROZEN');
    setHistory(addDays(TODAY, -2), 'COMPLETED', [], { storyDone: 2 });
    const view = await openHistory();
    fireEvent.press(button('Ngày trước'));
    expect(await screen.findByText('Ngày dùng vé')).toBeTruthy();
    fireEvent.press(button('Ngày trước'));
    expect(await screen.findByText('Đã hoàn thành việc chính')).toBeTruthy();
    expect(screen.getByText('Việc chính: 2/2')).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('the detail cannot be read: the error state with "Thử lại"; the arrows stay', async () => {
    world.answer = request => (request.startsWith('GET /day/history/') ? refuse(500, 'INTERNAL') : undefined);
    const view = await openHistory();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(button('Ngày trước')).toBeTruthy();
    world.answer = undefined;
    setHistory(TODAY, 'OPEN', actions);
    fireEvent.press(button('Thử lại'));
    expect(await screen.findByText('Kết thúc ngày')).toBeTruthy();
    await settle();
    view.unmount();
  });
});

describe('S51: previous and next', () => {
  test('today has no next day, and says why; the day before has both', async () => {
    const view = await openHistory();
    expect(button('Ngày sau').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Đây là ngày hôm nay.')).toBeTruthy();
    fireEvent.press(button('Ngày trước'));
    expect(await screen.findByRole('header', { name: 'Thứ Ba, 13/10/2026' })).toBeTruthy();
    expect(requested('/day/history/2026-10-13')).toBe(1);
    expect(button('Ngày sau').props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByText('Đây là ngày hôm nay.')).toBeNull();
    fireEvent.press(button('Ngày sau'));
    expect(await screen.findByRole('header', { name: 'Hôm nay' })).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('the earliest day is 92 days before the server\'s today: nothing further back is asked for', async () => {
    const view = await openHistory();
    for (let step = 0; step < 92; step += 1) fireEvent.press(button('Ngày trước'));
    const oldest = addDays(TODAY, -92);
    // 2026-07-14, a Tuesday (taken with Date, not by hand: 92 days before 2026-10-14)
    expect(await screen.findByRole('header', { name: 'Thứ Ba, 14/07/2026' })).toBeTruthy();
    expect(button('Ngày trước').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Chỉ xem được 92 ngày gần nhất.')).toBeTruthy();
    // a further press does nothing
    fireEvent.press(button('Ngày trước'));
    await settle();
    expect(requested(`/day/history/${oldest}`)).toBe(1);
    expect(requested(`/day/history/${addDays(TODAY, -93)}`)).toBe(0);
    expect(requested(`/day/history/${addDays(TODAY, 1)}`)).toBe(0);
    await settle();
    view.unmount();
  }, 30_000);

  test.each([
    ['a date in the future', addDays(TODAY, 3), TODAY],
    ['a date more than 92 days back', addDays(TODAY, -200), addDays(TODAY, -92)],
    ['a date inside the range', addDays(TODAY, -5), addDays(TODAY, -5)],
  ])('%s that a link asks for is brought into the range', async (_name, asked, shown) => {
    mockDate = asked;
    const view = await openHistory();
    expect(requested(`/day/history/${shown}`)).toBe(1);
    expect(requested(`/day/history/${asked}`)).toBe(shown === asked ? 1 : 0);
    await settle();
    view.unmount();
  });
});

describe('S51: the day is the server\'s', () => {
  test('"today" is the server\'s logical date, not this device\'s calendar', async () => {
    world.day = dayOf({ logicalDate: FRIDAY });
    const view = await openHistory();
    expect(requested(`/day/history/${FRIDAY}`)).toBe(1);
    fireEvent.press(button('Ngày trước'));
    expect(await screen.findByRole('header', { name: 'Thứ Năm, 15/10/2026' })).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('"Về Hôm nay" goes to the first tab', async () => {
    const view = await openHistory();
    mockNavigate.mockClear();
    fireEvent.press(button('Về Hôm nay'));
    expect(mockNavigate).toHaveBeenCalledWith('Today');
    await settle();
    view.unmount();
  });
});
