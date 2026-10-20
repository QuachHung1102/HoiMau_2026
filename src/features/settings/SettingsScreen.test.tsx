import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { forget, navigated } from '../guild/navigationSpy';
import { fetchMock, fireEvent, installTodayTestEnv, openSettings, requested, screen, seedQueue, settingsOf, settle, stored, world } from './settingsTestKit';

// The real registry, every `navigate` recorded: `Privacy` is Task 48's screen and is not registered yet, so a press on that row is
// asserted by name; the other targets are real screens and are also asserted by what arrives.
jest.mock('../../app/screens', () => require('../guild/navigationSpy').spied(jest.requireActual('../../app/screens')));

installTodayTestEnv();
beforeEach(forget);

const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const linked = () => navigated.filter(([to]) => to !== 'Profile' && to !== 'Settings');

describe('S35', () => {
  test('the title, the subtitle and the rows of the frame in order, each with its words', async () => {
    const view = await openSettings();
    expect(screen.getByRole('header', { name: 'Cài đặt' })).toBeTruthy();
    expect(screen.getByText('Điều chỉnh để ứng dụng hợp với bạn.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hồ sơ & mục tiêu. Cập nhật số đo hoặc hệ phái' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thông báo. Chọn điều bạn muốn nhận' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quyền riêng tư. Xuất dữ liệu và xóa tài khoản' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Giới thiệu & trợ giúp. An toàn sức khỏe, điều khoản' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
    // the order: the profile, the notifications, the sound, the display, the privacy, the help, the way out
    const names = screen.getAllByRole('button').map(button => button.props.accessibilityLabel ?? '');
    const at = (text: RegExp | string) => names.findIndex(name => (typeof text === 'string' ? name === text : text.test(name)));
    expect(at(/^Hồ sơ/)).toBeLessThan(at(/^Thông báo/));
    expect(at(/^Thông báo/)).toBeLessThan(at(/^Hiển thị/));
    expect(at(/^Hiển thị/)).toBeLessThan(at(/^Quyền riêng tư/));
    expect(at(/^Quyền riêng tư/)).toBeLessThan(at(/^Giới thiệu/));
    view.unmount();
  });

  test.each([
    ['Hồ sơ & mục tiêu', 'EditProfile'],
    ['Thông báo', 'NotificationSettings'],
    ['Hiển thị & chuyển động', 'Display'],
    ['Quyền riêng tư', 'Privacy'],
    ['Giới thiệu & trợ giúp', 'Help'],
  ])('"%s" navigates to %s, and to nothing else', async (title, route) => {
    const view = await openSettings();
    navigated.length = 0;
    fireEvent.press(row(title));
    expect(linked()).toEqual([[route]]);
    view.unmount();
  });

  test('the rows that have a screen open it', async () => {
    const view = await openSettings();
    fireEvent.press(row('Thông báo'));
    expect(await screen.findByRole('header', { name: 'Thông báo' })).toBeTruthy();
    view.unmount();
  });

  test('the sound switch is off and cannot be turned on, and its name says why (AR-22); pressing it changes nothing and asks for nothing', async () => {
    const view = await openSettings();
    const sound = screen.getByRole('switch', { name: 'Âm thanh. Bản này chưa có âm thanh', disabled: true, checked: false });
    expect(screen.getByText('Đang tắt')).toBeTruthy();
    const asked = fetchMock.mock.calls.length;
    fireEvent.press(sound);
    await settle();
    expect(screen.getByRole('switch', { name: /^Âm thanh/, checked: false, disabled: true })).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(asked);
    view.unmount();
  });

  test('"Hiển thị & chuyển động" says what the motion setting is, once it is read', async () => {
    world.settings = settingsOf({ motion: 'REDUCED' });
    const view = await openSettings();
    expect(screen.getByRole('button', { name: 'Hiển thị & chuyển động. Giảm chuyển động' })).toBeTruthy();
    view.unmount();
  });
});

describe('"Đăng xuất" goes through the pending-queue guard', () => {
  const QUESTION = 'Còn 1 ghi nhận chưa gửi';
  /** The cached profile lets the user in while the server is out of reach; one record waits on the device. */
  async function offlineWithARecord() {
    world.down = true;
    await seedQueue([stored('a1')]);
    await AsyncStorage.setItem(`cache:v1:${stored('a1').userId}:me`, JSON.stringify(world.me));
    return openSettings();
  }

  test('nothing waits: it signs out at once (the session is revoked, the keychain is emptied) and the way in is back', async () => {
    const view = await openSettings();
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
    expect(requested('/auth/logout')).toBe(1);
    expect(await Keychain.getGenericPassword()).toBe(false);
    await settle();
    view.unmount();
  });

  test('a record is still waiting: the question comes first, "Ở lại" leaves everything as it was and the button works again', async () => {
    const view = await offlineWithARecord();
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('header', { name: QUESTION })).toBeTruthy();
    expect(requested('/auth/logout')).toBe(0);
    fireEvent.press(screen.getByRole('button', { name: 'Ở lại' }));
    await settle();
    expect(screen.queryByRole('header', { name: QUESTION })).toBeNull();
    expect(screen.getByRole('header', { name: 'Cài đặt' })).toBeTruthy();
    expect(requested('/auth/logout')).toBe(0);
    expect(await Keychain.getGenericPassword()).not.toBe(false);
    expect(screen.getByRole('button', { name: 'Đăng xuất' }).props.accessibilityState.busy).toBe(false);
    // it asks again
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('header', { name: QUESTION })).toBeTruthy();
    view.unmount();
  });

  test('"Đăng xuất và bỏ các ghi nhận này": signed out, the queue gone', async () => {
    const view = await offlineWithARecord();
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    await screen.findByRole('header', { name: QUESTION });
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất và bỏ các ghi nhận này' }));
    expect(await screen.findByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
    await settle();
    expect(await Keychain.getGenericPassword()).toBe(false);
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    view.unmount();
  });
});
