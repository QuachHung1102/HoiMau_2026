import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import { findBannedTerms } from '../../../domain/language.ts';
import { allText, dayOf, FRIDAY, installTodayTestEnv, meOf, openJourney, requested, setHistory, setLevel, settle, USER, world } from './progressionTestKit';
import { refuse } from '../sync/syncTestKit';

// The real registry; `navigate` of the detail screens is recorded on its way to the navigator, so a link to a route that
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
  return { ...actual, tabRoots: actual.tabRoots.map(spied), detailScreens: actual.detailScreens.map(spied) };
});

installTodayTestEnv();
beforeEach(() => mockNavigate.mockClear());

/** The server's day is a Friday (the device's own calendar says something else: it is never asked). */
function fridayWithHistory() {
  world.day = dayOf({ logicalDate: FRIDAY, streak: { current: 4, best: 12 } });
  setLevel(5, 340, { streakCurrent: 4, streakBest: 12 });
  setHistory('2026-10-12', 'COMPLETED');
  setHistory('2026-10-13', 'FROZEN');
  setHistory('2026-10-14', 'MISSED');
  setHistory('2026-10-15', 'COMPLETED');
}
const mark = (label: string) => screen.getByLabelText(label);

describe('S21: the week', () => {
  test('seven marks T2 to CN from the server\'s date; each names its day and its state; the history is asked for that week only', async () => {
    fridayWithHistory();
    const view = await openJourney();
    expect(requested('/day/history?from=2026-10-12&to=2026-10-16')).toBe(1);
    expect(mark('Thứ Hai, 12/10: đã hoàn thành việc chính')).toBeTruthy();
    expect(mark('Thứ Ba, 13/10: Ngày dùng vé')).toBeTruthy();
    expect(mark('Thứ Tư, 14/10: chưa hoàn thành việc chính')).toBeTruthy();
    expect(mark('Thứ Năm, 15/10: đã hoàn thành việc chính')).toBeTruthy();
    expect(mark('Thứ Sáu, 16/10: hôm nay, ngày còn mở')).toBeTruthy();
    expect(mark('Thứ Bảy, 17/10: chưa tới')).toBeTruthy();
    expect(mark('Chủ nhật, 18/10: chưa tới')).toBeTruthy();
    for (const short of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']) expect(screen.getByText(short)).toBeTruthy();
    // a frozen day carries its own words (not the colour of the dot), and the legend explains both marks
    expect(screen.getAllByLabelText('Đã dùng vé').length).toBeGreaterThan(0);
    expect(screen.getByText('Ngày hoàn thành việc chính')).toBeTruthy();
    expect(screen.getByText('Ngày dùng vé')).toBeTruthy();
    view.unmount();
  });

  test('the streak, the record and the state line', async () => {
    fridayWithHistory();
    const view = await openJourney();
    expect(screen.getByRole('header', { name: 'Đang giữ nhịp' })).toBeTruthy();
    expect(screen.getByText('4 ngày')).toBeTruthy();
    expect(screen.getByText('Kỷ lục: 12 ngày')).toBeTruthy();
    expect(screen.getByText('Mỗi dấu là một ngày bạn hoàn thành việc chính.')).toBeTruthy();
    expect(screen.getByText('Kỷ lục vẫn ở lại kể cả khi một chuỗi kết thúc.')).toBeTruthy();
    view.unmount();
  });

  test('a day the history has not delivered is "chưa có dữ liệu", and the card offers "Thử lại"', async () => {
    fridayWithHistory();
    world.answer = request => (request.startsWith('GET /day/history') ? refuse(500, 'INTERNAL') : undefined);
    const view = await openJourney();
    expect(mark('Thứ Hai, 12/10: chưa có dữ liệu')).toBeTruthy();
    expect(mark('Thứ Sáu, 16/10: hôm nay, ngày còn mở')).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByLabelText('Thứ Hai, 12/10: đã hoàn thành việc chính')).toBeTruthy();
    view.unmount();
  });

  test('the profile cannot be read: the error state with "Thử lại", then the screen', async () => {
    fridayWithHistory();
    world.answer = request => (request === 'GET /progression' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openJourney();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Đang giữ nhịp' })).toBeNull();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Đang giữ nhịp' })).toBeTruthy();
    view.unmount();
  });
});

describe('S21: the milestones', () => {
  test('achieved from the profile, the rest as the days still to go; the next one is named', async () => {
    fridayWithHistory();
    const view = await openJourney();
    expect(screen.getByLabelText('7 ngày. Đã đạt')).toBeTruthy();
    expect(screen.getByLabelText('30 ngày. Còn 26 ngày')).toBeTruthy();
    expect(screen.getByLabelText('100 ngày. Còn 96 ngày')).toBeTruthy();
    expect(screen.getByText('Còn 26 ngày tới huy hiệu 30 ngày')).toBeTruthy();
    view.unmount();
  });

  test('with 7 and 30 reached only 100 is left; with all three there is no line of days to go', async () => {
    fridayWithHistory();
    setLevel(5, 340, {
      streakCurrent: 31,
      streakBest: 31,
      milestones: [
        { days: 7, achieved: true },
        { days: 30, achieved: true },
        { days: 100, achieved: false },
      ],
    });
    const view = await openJourney();
    expect(screen.getByLabelText('30 ngày. Đã đạt')).toBeTruthy();
    expect(screen.getByLabelText('100 ngày. Còn 69 ngày')).toBeTruthy();
    expect(screen.getByText('Còn 69 ngày tới huy hiệu 100 ngày')).toBeTruthy();
    view.unmount();
  });
});

describe('S21: the rows', () => {
  test.each([
    [/^Lịch sử ghi nhận\./, 'DayHistory'],
    [/^Cấp độ & huy hiệu\./, 'Levels'],
    [/^Vé giữ nhịp\./, 'Tickets'],
  ])('%s navigates to %s', async (name, route) => {
    fridayWithHistory();
    const view = await openJourney();
    mockNavigate.mockClear();
    fireEvent.press(screen.getByRole('button', { name }));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(route);
    view.unmount();
  });
});

describe('S67: the streak has ended', () => {
  function ended() {
    fridayWithHistory();
    setLevel(5, 340, { streakCurrent: 0, streakBest: 12, breakNotice: { previous: 12, date: '2026-10-14' } });
    world.day = dayOf({ logicalDate: FRIDAY, streak: { current: 0, best: 12 } });
  }

  test('"Bắt đầu lại": the record stays, there is a small first step, and no word of blame', async () => {
    ended();
    const view = await openJourney();
    expect(screen.getByRole('header', { name: 'Bắt đầu lại' })).toBeTruthy();
    expect(screen.getByText('Chuỗi hiện tại: 0 ngày. Kỷ lục 12 ngày vẫn ở đây.')).toBeTruthy();
    expect(screen.getByText('Kỷ lục vẫn ở lại kể cả khi một chuỗi kết thúc.')).toBeTruthy();
    // the other state's card is gone: no flame, no state line, no milestones
    expect(screen.queryByRole('header', { name: 'Đang giữ nhịp' })).toBeNull();
    expect(screen.queryByText('Cột mốc chuỗi')).toBeNull();
    // what is drawn says neither "mất" nor "thất bại" (the banned list as well)
    const text = allText().join(' ');
    expect(text).not.toMatch(/mất/i);
    expect(text).not.toMatch(/thất bại/i);
    expect(findBannedTerms(text)).toEqual([]);
    view.unmount();
  });

  test.each([
    ['Bắt đầu một việc nhỏ', 'QuestBoard'],
    ['Xem vé giữ nhịp', 'Tickets'],
  ])('"%s" navigates to %s', async (name, route) => {
    ended();
    const view = await openJourney();
    mockNavigate.mockClear();
    fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(route);
    await settle();
    await settle();
    view.unmount();
  });
});

describe('a provisional day (the kept one is over and the server cannot be asked)', () => {
  test('no streak number, no state line, no days to go; today is open, never completed; the record stays', async () => {
    fridayWithHistory();
    // the day on this device ended an hour ago and the server cannot be asked about the new one
    await AsyncStorage.setItem(`cache:v1:${USER}:day`, JSON.stringify(dayOf({ logicalDate: '2026-10-15', closesAt: new Date(Date.now() - 3_600_000).toISOString() })));
    await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(meOf()));
    world.answer = request => {
      if (request === 'GET /day') throw new TypeError('Network request failed');
      return undefined;
    };
    const view = await openJourney();
    expect(screen.getAllByText('Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('header', { name: 'Đang giữ nhịp' })).toBeNull();
    expect(screen.queryByText('4 ngày')).toBeNull();
    expect(screen.queryByText(/Còn \d+ ngày/)).toBeNull();
    expect(screen.getByLabelText('30 ngày. Chưa đạt')).toBeTruthy();
    expect(screen.getByText('Kỷ lục: 12 ngày')).toBeTruthy();
    // the guessed date is the 16th (the kept 15th plus a day); it is open, not completed
    expect(screen.getByLabelText('Thứ Sáu, 16/10: hôm nay, ngày còn mở')).toBeTruthy();
    expect(screen.queryByLabelText(/Thứ Sáu, 16\/10: đã hoàn thành/)).toBeNull();
    await settle();
    view.unmount();
  });
});
