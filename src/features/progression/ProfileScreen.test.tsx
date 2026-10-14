import { fireEvent, screen, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import { installTodayTestEnv, openProfile, requested, settle } from './progressionTestKit';

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

installTodayTestEnv();
beforeEach(() => mockNavigate.mockClear());

const row = (name: RegExp | string) => screen.getByRole('button', { name });

describe('S31: the profile tab', () => {
  test('who the person is, their level and coins, and the five ways in', async () => {
    const view = await openProfile();
    expect(screen.getByRole('tab', { name: 'Cá nhân', selected: true })).toBeTruthy();
    expect(screen.getByText('Hành trình này là của bạn.')).toBeTruthy();
    expect(screen.getByText('An')).toBeTruthy();
    expect(screen.getByText('Đỡ Đòn')).toBeTruthy();
    expect(screen.getByText('Cấp 5 · Người kiên trì')).toBeTruthy();
    expect(screen.getByText('340 / 1.118 XP')).toBeTruthy();
    expect(screen.getByLabelText('250 xu')).toBeTruthy();
    // Mầm, with its stage and mood as the accessible name of the picture
    expect(screen.getByRole('image', { name: 'Mầm nhú. Mầm đang vui' })).toBeTruthy();
    for (const [title, description] of [
      ['Hành trình & chỉ số', 'Lịch sử, XP và huy hiệu'],
      ['Mầm của bạn', 'Linh vật và diện mạo'],
      ['Cấp độ & tiện ích', 'Điểm tiện ích và danh hiệu'],
      ['Góc giải tỏa', 'Một khoảng riêng để viết'],
      ['Cài đặt', 'Hồ sơ, thông báo và quyền dữ liệu'],
    ]) {
      expect(row(`${title}. ${description}`)).toBeTruthy();
    }
    view.unmount();
  });

  test.each([
    ['Hành trình & chỉ số', 'Journey'],
    ['Mầm của bạn', 'Pet'],
    ['Cấp độ & tiện ích', 'Levels'],
    ['Góc giải tỏa', 'JournalWrite'],
    ['Cài đặt', 'Settings'],
  ])('the row "%s" navigates to %s', async (title, route) => {
    const view = await openProfile();
    fireEvent.press(row(new RegExp(`^${title}\\.`)));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(route);
    view.unmount();
  });

  test('the registered ones open (a link to a route nobody has registered yet is inert and silent)', async () => {
    const view = await openProfile();
    fireEvent.press(row(/^Cấp độ & tiện ích\./));
    expect(await screen.findByRole('header', { name: 'Cấp độ & tiện ích' })).toBeTruthy();
    view.unmount();
    const again = await openProfile();
    fireEvent.press(row(/^Cài đặt\./));
    expect(screen.getByRole('header', { name: 'Cá nhân' })).toBeTruthy();
    again.unmount();
  });

  test('"Đăng xuất" is the quiet last row, and it signs out through the session (the keychain is emptied)', async () => {
    const view = await openProfile();
    expect(within(screen.getAllByRole('button').at(-1)!).getByText('Đăng xuất')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText('Hồi Máu')).toBeTruthy();
    expect(requested('/auth/logout')).toBe(1);
    expect(await Keychain.getGenericPassword()).toBe(false);
    await settle();
    view.unmount();
  });
});
