import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { prefsKey } from '../../shared/storage/prefs';
import { serverAnswer } from '../dashboard/todayTestKit';
import { ACCOUNT_PURGE_DAYS } from './rules';
import { act, app, fetchMock, fireEvent, hold, installTodayTestEnv, openDeleteAccount, queryClient, refuse, requested, screen, seedQueue, sent, settle, stored, USER, waitFor, world } from './settingsTestKit';

installTodayTestEnv();

const PASSWORD = 'mat-khau-dung-1';
const WRONG = 'mat-khau-sai-9';
const REFUSED = 'Mật khẩu chưa đúng, hoặc bạn đã thử quá nhiều lần. Kiểm tra lại mật khẩu; nếu vẫn chưa được, chờ một lúc rồi thử lại. Tài khoản của bạn chưa bị xóa.';
const deleteButton = () => screen.getByRole('button', { name: 'Xóa tài khoản' });
const keepButton = () => screen.getByRole('button', { name: 'Giữ tài khoản' });
const field = () => screen.getByLabelText(/^Mật khẩu của bạn/);
const type = (text: string) => fireEvent.changeText(field(), text);
const removals = () => sent('POST', '/me/delete');
const mine = async () => (await AsyncStorage.getAllKeys()).filter(key => key.includes(USER)).sort();
/** The queries that still hold something (the signed-out shell keeps empty, disabled ones). */
const cachedData = () => queryClient().getQueryCache().getAll().filter(query => query.state.data !== undefined).map(query => query.queryKey);
const closed = () => screen.findByText('Tài khoản đã được đóng.');

/** The account has a profile cached, a motion word, and one record that has not been sent: everything the deletion must take away. */
async function withTraces() {
  world.down = true;
  await seedQueue([stored('a1')]);
  await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(world.me));
  const view = await openDeleteAccount();
  world.down = false;
  await AsyncStorage.setItem(prefsKey(USER), JSON.stringify({ motion: 'FULL' }));
  return view;
}

describe('S52: the screen', () => {
  test('the frame: the title, what it means as a list of five (the days are the server\'s), the field, the safe button first and both of one size', async () => {
    const view = await openDeleteAccount();
    expect(screen.getByRole('header', { name: 'Xóa tài khoản?' })).toBeTruthy();
    expect(screen.getByText('Hãy đọc kỹ trước khi xác nhận.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Bạn sẽ không thể tiếp tục sử dụng tài khoản này.' })).toBeTruthy();
    const lines = [
      'Tài khoản ngừng hoạt động ngay lập tức.',
      `Toàn bộ dữ liệu của bạn được xóa sau ${ACCOUNT_PURGE_DAYS} ngày.`,
      'Nếu bạn đang là trưởng tổ đội, vai trò trưởng nhóm chuyển cho thành viên tham gia lâu nhất.',
      'Các ghi nhận đang chờ gửi trên máy này sẽ bị bỏ.',
      'Bạn không thể hoàn tác việc này trong ứng dụng.',
    ];
    for (const line of lines) expect(screen.getByText(line)).toBeTruthy();
    expect(field().props.secureTextEntry).toBe(true);
    expect(screen.getByText('Muốn giữ lại dữ liệu? Hãy tải bản sao ở màn hình Dữ liệu & quyền riêng tư trước.')).toBeTruthy();
    // in the order of the screen: the safe one, then the one that deletes
    const [first, second] = screen.getAllByRole('button', { name: /^(Giữ|Xóa) tài khoản$/ });
    expect(first).toBe(keepButton());
    expect(second).toBe(deleteButton());
    const size = (button: ReturnType<typeof keepButton>) => {
      const { minHeight, paddingVertical, paddingHorizontal, borderRadius } = StyleSheet.flatten(button.props.style as never) as Record<string, number>;
      return { minHeight, paddingVertical, paddingHorizontal, borderRadius };
    };
    expect(size(keepButton())).toEqual(size(deleteButton()));
    expect(size(keepButton()).minHeight).toBeGreaterThanOrEqual(48);
    view.unmount();
  });

  test('without a password the button is off and the reason is on screen; typing turns it on, and clearing the field turns it off again', async () => {
    const view = await openDeleteAccount();
    expect(deleteButton()).toBeDisabled();
    expect(screen.getByText('Nhập mật khẩu để xác nhận. Nút xóa chỉ bật khi đã nhập.')).toBeTruthy();
    fireEvent.press(deleteButton());
    await settle();
    expect(removals()).toEqual([]);
    type('a');
    expect(deleteButton()).not.toBeDisabled();
    expect(screen.queryByText('Nhập mật khẩu để xác nhận. Nút xóa chỉ bật khi đã nhập.')).toBeNull();
    type('');
    expect(deleteButton()).toBeDisabled();
    view.unmount();
  });

  test('"Giữ tài khoản" goes back to S44 and sends nothing', async () => {
    const view = await openDeleteAccount();
    const before = fetchMock.mock.calls.length;
    type(PASSWORD);
    fireEvent.press(keepButton());
    expect(await screen.findByRole('header', { name: 'Dữ liệu & quyền riêng tư' })).toBeTruthy();
    await settle();
    expect(fetchMock.mock.calls.slice(before).filter(([, init]) => init.method !== 'GET')).toEqual([]);
    expect(world.privacy.deleted).toBe(false);
    view.unmount();
  });
});

describe('S52: the deletion', () => {
  test('204: one request with the password and a key; the keychain, the query cache, the cache on disk, the preferences and the waiting records go; Welcome says the account was closed', async () => {
    const view = await withTraces();
    expect(await mine()).toEqual(expect.arrayContaining([`cache:v1:${USER}:me`, `pending:v1:${USER}`, prefsKey(USER)]));
    expect(await Keychain.getGenericPassword()).not.toBe(false);
    type(PASSWORD);
    fireEvent.press(deleteButton());
    expect(await closed()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
    await settle();
    expect(removals()).toHaveLength(1);
    expect(removals()[0].body).toEqual({ password: PASSWORD });
    expect(removals()[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(world.privacy.deleted).toBe(true);
    expect(await Keychain.getGenericPassword()).toBe(false);
    expect(cachedData()).toEqual([]);
    expect(await mine()).toEqual([]);
    // the session of the server is gone already: no sign-out request is made for it
    expect(requested('/auth/logout')).toBe(0);
    // and it is not the notice of a session that ended
    expect(screen.queryByText(/Phiên đăng nhập đã hết hạn/)).toBeNull();
    view.unmount();
  });

  test('the password goes out as the server compares it (NFC), whichever way the keyboard composed it', async () => {
    world.privacy.password = 'Mật-khẩu-1';
    const view = await openDeleteAccount();
    type('Mật-khẩu-1'.normalize('NFD'));
    fireEvent.press(deleteButton());
    expect(await closed()).toBeTruthy();
    expect(removals()[0].body).toEqual({ password: 'Mật-khẩu-1'.normalize('NFC') });
    expect(removals()[0].body.password).not.toBe('Mật-khẩu-1'.normalize('NFD'));
    view.unmount();
  });

  test('a double press sends one request, the button shows it is working, and "Giữ tài khoản" waits too', async () => {
    const gate = hold('POST /me/delete');
    const view = await openDeleteAccount();
    type(PASSWORD);
    fireEvent.press(deleteButton());
    fireEvent.press(deleteButton());
    await settle();
    expect(removals()).toHaveLength(1);
    expect(deleteButton().props.accessibilityState).toMatchObject({ busy: true });
    expect(keepButton()).toBeDisabled();
    await act(async () => gate.release());
    expect(await closed()).toBeTruthy();
    expect(removals()).toHaveLength(1);
    view.unmount();
  });

  test('two presses before the screen has re-rendered (a stale handler) are still one request', async () => {
    const view = await openDeleteAccount();
    type(PASSWORD);
    act(() => {
      fireEvent.press(deleteButton());
      fireEvent.press(deleteButton());
    });
    expect(await closed()).toBeTruthy();
    expect(removals()).toHaveLength(1);
    view.unmount();
  });

  test('the password is not right: said at the field without claiming to know why, and nothing was cleared, nothing left the screen', async () => {
    const view = await withTraces();
    const before = await mine();
    type(WRONG);
    fireEvent.press(deleteButton());
    expect(await screen.findByText(REFUSED)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Xóa tài khoản?' })).toBeTruthy();
    expect(world.privacy.deleted).toBe(false);
    expect(await Keychain.getGenericPassword()).not.toBe(false);
    expect(await mine()).toEqual(before);
    expect(cachedData().length).toBeGreaterThan(0);
    // what was typed stays to be corrected, the button works again, and it does not say the password is certainly wrong
    expect(field().props.value).toBe(WRONG);
    expect(deleteButton()).not.toBeDisabled();
    expect(screen.queryByText(/^Mật khẩu (sai|không đúng)/)).toBeNull();
    // a new try is a new request with a new key, and the right password ends it
    type(PASSWORD);
    expect(screen.queryByText(REFUSED)).toBeNull();
    fireEvent.press(deleteButton());
    expect(await closed()).toBeTruthy();
    expect(removals()).toHaveLength(2);
    expect(removals()[1].key).not.toBe(removals()[0].key);
    view.unmount();
  });

  test('the sixth try within a quarter of an hour is 401 as well, with the right password: the same words, and the account is still there', async () => {
    const now = Date.now();
    world.privacy.attempts = [now - 60_000, now - 50_000, now - 40_000, now - 30_000, now - 20_000];
    const view = await openDeleteAccount();
    type(PASSWORD);
    fireEvent.press(deleteButton());
    expect(await screen.findByText(REFUSED)).toBeTruthy();
    expect(world.privacy.deleted).toBe(false);
    expect(await Keychain.getGenericPassword()).not.toBe(false);
    view.unmount();
  });

  test('the account\'s own limit (429): the account stays, the reason is said beside the buttons, and trying later is a new request', async () => {
    const now = Date.now();
    world.privacy.deleteCalls = Array.from({ length: 10 }, (_, n) => now - n * 1000);
    const view = await openDeleteAccount();
    type(PASSWORD);
    fireEvent.press(deleteButton());
    expect(await screen.findByText('Chưa xóa được tài khoản. Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.')).toBeTruthy();
    expect(world.privacy.deleted).toBe(false);
    expect(await Keychain.getGenericPassword()).not.toBe(false);
    expect(deleteButton()).not.toBeDisabled();
    view.unmount();
  });

  test('the answer is lost and the account was deleted: nothing is cleared yet and it is said that nobody knows; the same request again gets 401, which ends as a closed account (same key, Welcome, not "session expired")', async () => {
    const view = await withTraces();
    world.answer = async (request, init) => {
      if (request !== 'POST /me/delete') return undefined;
      // the server did it, the answer never arrived
      world.answer = undefined;
      serverAnswer(request, init);
      throw new TypeError('Network request failed');
    };
    type(PASSWORD);
    fireEvent.press(deleteButton());
    expect(await screen.findByText(/^Chưa nhận được trả lời nên chưa rõ yêu cầu xóa đã được xử lý chưa\./)).toBeTruthy();
    expect(world.privacy.deleted).toBe(true);
    expect(await Keychain.getGenericPassword()).not.toBe(false);
    expect(screen.getByRole('header', { name: 'Xóa tài khoản?' })).toBeTruthy();
    fireEvent.press(deleteButton());
    expect(await closed()).toBeTruthy();
    expect(removals()).toHaveLength(2);
    expect(removals()[1].key).toBe(removals()[0].key);
    expect(screen.queryByText(/Phiên đăng nhập đã hết hạn/)).toBeNull();
    await settle();
    expect(await Keychain.getGenericPassword()).toBe(false);
    expect(await mine()).toEqual([]);
    expect(cachedData()).toEqual([]);
    view.unmount();
  });

  test('the answer is lost and the account was NOT deleted: the retry carries the same key and is answered as the first would have been', async () => {
    const view = await openDeleteAccount();
    world.answer = async request => {
      if (request !== 'POST /me/delete') return undefined;
      world.answer = undefined;
      throw new TypeError('Network request failed');
    };
    type(PASSWORD);
    fireEvent.press(deleteButton());
    await screen.findByText(/^Chưa nhận được trả lời/);
    expect(world.privacy.deleted).toBe(false);
    fireEvent.press(deleteButton());
    expect(await closed()).toBeTruthy();
    expect(removals()).toHaveLength(2);
    expect(removals()[1].key).toBe(removals()[0].key);
    view.unmount();
  });

  test('401 SESSION_INVALID with no lost answer before it is a session that ended, not a deleted account: SignIn with its notice, the queue kept, and no claim that the account was closed', async () => {
    const view = await withTraces();
    world.answer = request => (request === 'POST /me/delete' ? refuse(401, 'SESSION_INVALID') : undefined);
    type(PASSWORD);
    fireEvent.press(deleteButton());
    expect(await screen.findByText('Phiên đăng nhập đã hết hạn. Bạn đăng nhập lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Tài khoản đã được đóng.')).toBeNull();
    await settle();
    expect(await AsyncStorage.getItem(`pending:v1:${USER}`)).not.toBeNull();
    expect(world.privacy.deleted).toBe(false);
    view.unmount();
  });

  test('a person who signed out while the request was out: the server deleted the account all the same, and Welcome says so', async () => {
    const gate = hold('POST /me/delete');
    const view = await openDeleteAccount();
    type(PASSWORD);
    fireEvent.press(deleteButton());
    await waitFor(() => expect(removals()).toHaveLength(1));
    await act(() => app.session.signOut());
    await act(async () => gate.release());
    expect(await closed()).toBeTruthy();
    expect(world.privacy.deleted).toBe(true);
    expect(removals()).toHaveLength(1);
    view.unmount();
  });
});
