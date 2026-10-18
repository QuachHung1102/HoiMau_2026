import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { colors } from '../../shared/theme/tokens';
import { FOREST, FOX, hold, installTodayTestEnv, landed, openInventory, primary, queryClient, refuse, settle, world, writesOf } from './shopTestKit';

installTodayTestEnv();

const row = (name: RegExp | string) => screen.getByRole('radio', { name });
const apply = () => screen.getByRole('button', { name: 'Áp dụng diện mạo' });
const equipPath = (code: string) => `/inventory/${code}/equip`;
const EQUIP = (code: string) => `POST ${equipPath(code)}`;
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) => node.props.accessibilityState?.disabled === true;

describe('S24: the inventory', () => {
  test('owned items by kind, the defaults and an earned badge among them, the one in use marked in words', async () => {
    world.shop.owned = [FOREST, 'BADGE_STREAK_7'];
    const view = await openInventory();
    expect(screen.getByRole('header', { name: 'Kho đồ của bạn' })).toBeTruthy();
    expect(screen.getByText('Những điều bạn đã mở khóa.')).toBeTruthy();
    for (const group of ['Chủ đề', 'Trang phục', 'Huy hiệu']) expect(screen.getByRole('header', { name: group })).toBeTruthy();
    expect(row(/^Hồi Máu nguyên bản/).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText('Hồi Máu nguyên bản')).toBeTruthy();
    expect(screen.getByText('Rừng xanh')).toBeTruthy();
    expect(screen.getByText('Mầm nguyên bản')).toBeTruthy();
    expect(screen.getByText('Người giữ nhịp')).toBeTruthy();
    expect(screen.getByText('Huy hiệu thành tích')).toBeTruthy();
    // the two defaults are in use; the forest and the badge are only owned
    expect(screen.getAllByText('Đang dùng')).toHaveLength(2);
    expect(screen.getByText('Đã sở hữu')).toBeTruthy();
    // what is not owned is not here
    expect(screen.queryByText('Bầu trời')).toBeNull();
    expect(screen.queryByText('Mũ cáo nhỏ')).toBeNull();
    expect(screen.getByText('Bạn có thể đổi lại diện mạo bất cứ lúc nào.')).toBeTruthy();
    view.unmount();
  });

  test('the item equipped is the one marked "Đang dùng", and its kind\'s default is only owned', async () => {
    world.shop.owned = [FOREST, FOX];
    world.shop.equipped.THEME = FOREST;
    const view = await openInventory();
    expect(screen.getAllByText('Đang dùng')).toHaveLength(2); // the forest and the default skin
    expect(row(/^Rừng xanh/).props.accessibilityLabel ?? '').not.toContain('Đã sở hữu');
    expect(screen.getAllByText('Đã sở hữu')).toHaveLength(2); // the default theme and the fox
    view.unmount();
  });

  test('no badge yet: a short explanation, not an error', async () => {
    const view = await openInventory();
    expect(screen.getByText('Chưa có huy hiệu')).toBeTruthy();
    expect(screen.getByText('Huy hiệu đến từ những cột mốc bạn đạt được, như giữ nhịp 7 ngày.')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    view.unmount();
  });

  test('choosing a row changes nothing; "Áp dụng diện mạo" waits for a different item, and says why', async () => {
    const view = await openInventory();
    expect(isDisabled(apply())).toBe(true);
    expect(screen.getByText('Chọn một vật phẩm khác để áp dụng.')).toBeTruthy();
    // the one in use is not "another"
    fireEvent.press(row(/^Hồi Máu nguyên bản/));
    expect(isDisabled(apply())).toBe(true);
    world.shop.owned = [FOREST];
    view.unmount();

    world.shop.owned = [FOREST];
    const second = await openInventory();
    fireEvent.press(row(/^Rừng xanh/));
    expect(row(/^Rừng xanh/).props.accessibilityState).toMatchObject({ checked: true });
    expect(isDisabled(apply())).toBe(false);
    expect(screen.queryByText('Chọn một vật phẩm khác để áp dụng.')).toBeNull();
    expect(writesOf(equipPath(FOREST))).toEqual([]);
    expect(primary()).toBe(colors.primary);
    second.unmount();
  });

  test('equip posts the item code; the palette switches when the server\'s appearance says so, and the lists follow', async () => {
    world.shop.owned = [FOREST];
    const view = await openInventory();
    expect(primary()).toBe(colors.primary);
    fireEvent.press(row(/^Rừng xanh/));
    fireEvent.press(apply());
    expect(await screen.findByText('Đã áp dụng diện mạo')).toBeTruthy();
    const sent = writesOf(equipPath(FOREST));
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBeNull();
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    // the theme tokens change: the app's primary colour is now the forest's
    await waitFor(() => expect(primary()).toBe(colors.forestPrimary));
    await landed();
    expect(world.me.appearance?.themeCode).toBe(FOREST);
    expect(screen.getAllByText('Đang dùng')).toHaveLength(2); // the forest and the default skin
    expect(screen.getAllByText('Đã sở hữu')).toHaveLength(1); // the default theme, no longer in use
    view.unmount();
  });

  test('equipping the default theme goes back to the default palette', async () => {
    world.shop.owned = [FOREST];
    world.shop.equipped.THEME = FOREST;
    world.me = { ...world.me, appearance: { themeCode: FOREST, petSkinCode: 'SKIN_DEFAULT', badgeCode: null } };
    const view = await openInventory();
    await waitFor(() => expect(primary()).toBe(colors.forestPrimary));
    fireEvent.press(row(/^Hồi Máu nguyên bản/));
    fireEvent.press(apply());
    expect(await screen.findByText('Đã áp dụng diện mạo')).toBeTruthy();
    expect(writesOf(equipPath('THEME_DEFAULT'))).toHaveLength(1);
    await waitFor(() => expect(primary()).toBe(colors.primary));
    expect(world.shop.equipped.THEME).toBeNull();
    view.unmount();
  });

  test('the palette is the server\'s word only: while the equip is out nothing changes, and it changes when the profile is read', async () => {
    world.shop.owned = [FOREST];
    const view = await openInventory();
    const gate = hold(EQUIP(FOREST));
    fireEvent.press(row(/^Rừng xanh/));
    fireEvent.press(apply());
    await settle();
    expect(primary()).toBe(colors.primary);
    expect(screen.queryByText('Đã áp dụng diện mạo')).toBeNull();
    gate.release();
    await screen.findByText('Đã áp dụng diện mạo');
    await waitFor(() => expect(primary()).toBe(colors.forestPrimary));
    view.unmount();
  });

  test('a double press is ONE request', async () => {
    world.shop.owned = [FOREST];
    const view = await openInventory();
    const gate = hold(EQUIP(FOREST));
    fireEvent.press(row(/^Rừng xanh/));
    const button = apply();
    fireEvent.press(button);
    fireEvent.press(button);
    await settle();
    gate.release();
    await screen.findByText('Đã áp dụng diện mạo');
    await settle();
    expect(writesOf(equipPath(FOREST))).toHaveLength(1);
    view.unmount();
  });

  test('an item that is not owned (ITEM_NOT_OWNED): the words, the list read again, the palette unchanged', async () => {
    world.shop.owned = [FOREST];
    const view = await openInventory();
    world.shop.owned = []; // gone from the server's side
    fireEvent.press(row(/^Rừng xanh/));
    fireEvent.press(apply());
    expect(await screen.findByText('Bạn chưa sở hữu vật phẩm này.')).toBeTruthy();
    await landed();
    expect(screen.queryByText('Rừng xanh')).toBeNull();
    expect(primary()).toBe(colors.primary);
    view.unmount();
  });

  test('no connection: the words and "Thử lại"; the retry is the SAME request (one key), and after an answer a new press is a NEW one', async () => {
    world.shop.owned = [FOREST];
    const view = await openInventory();
    world.down = true;
    fireEvent.press(row(/^Rừng xanh/));
    fireEvent.press(apply());
    expect(await screen.findByText(/Chưa áp dụng được/)).toBeTruthy();
    expect(primary()).toBe(colors.primary);
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã áp dụng diện mạo')).toBeTruthy();
    let sent = writesOf(equipPath(FOREST));
    expect(sent).toHaveLength(2);
    expect(sent[0].id).toBe(sent[1].id);
    await landed();

    // another item, refused by the server this time; pressing again is another request
    world.shop.owned = [FOREST, FOX];
    let first = true;
    world.answer = request => {
      if (request !== EQUIP(FOX) || !first) return undefined;
      first = false;
      return refuse(409, 'ITEM_NOT_OWNED');
    };
    await act(() => queryClient().invalidateQueries({ queryKey: ['inventory'] }));
    fireEvent.press(await screen.findByRole('radio', { name: /^Mũ cáo nhỏ/ }));
    fireEvent.press(apply());
    await screen.findByText('Bạn chưa sở hữu vật phẩm này.');
    await landed();
    fireEvent.press(await screen.findByRole('radio', { name: /^Mũ cáo nhỏ/ }));
    fireEvent.press(apply());
    await screen.findByText('Đã áp dụng diện mạo');
    sent = writesOf(equipPath(FOX));
    expect(sent).toHaveLength(2);
    expect(sent[0].id).not.toBe(sent[1].id);
    view.unmount();
  });

  test('the inventory cannot be read: the error state and "Thử lại"', async () => {
    world.answer = request => (request === 'GET /inventory' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openInventory();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Hồi Máu nguyên bản')).toBeTruthy();
    view.unmount();
  });
});
