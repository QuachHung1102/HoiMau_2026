import { fireEvent, screen } from '@testing-library/react-native';
import { fetchMock, FOREST, FOX, installTodayTestEnv, landed, openShop, refuse, setLevel, world } from './shopTestKit';

installTodayTestEnv();

const view = (name: string) => screen.queryByRole('button', { name: `Xem ${name}` });
const tab = (name: string) => fireEvent.press(screen.getByRole('radio', { name }));
const shopReads = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/shop')).length;

describe('S23: the shop', () => {
  test('the coin card with the balance of the server, the three kinds, the footer, and the way to the inventory', async () => {
    const screenView = await openShop();
    expect(screen.getByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    expect(screen.getByText('Một chút cá tính cho hành trình của bạn.')).toBeTruthy();
    expect(screen.getByText('Xu của bạn')).toBeTruthy();
    expect(screen.getByText('250 xu · không dùng tiền thật')).toBeTruthy();
    for (const kind of ['Chủ đề', 'Trang phục', 'Huy hiệu']) expect(screen.getByRole('radio', { name: kind })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Chủ đề' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByText('Vật phẩm chỉ đổi diện mạo. Không bán XP, chuỗi hoặc lợi thế tổ đội.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Mở kho đồ' }));
    expect(await screen.findByRole('header', { name: 'Kho đồ của bạn' })).toBeTruthy();
    screenView.unmount();
  });

  test('every card has exactly ONE affordance: buyable "Xem", locked chip + level + disabled "Chưa mở", owned or in use a chip', async () => {
    const screenView = await openShop();
    // themes at level 5: the default is in use, the forest can be looked at, the sky opens at level 8
    expect(screen.getByText('Hồi Máu nguyên bản')).toBeTruthy();
    expect(screen.getAllByText('Đang dùng')).toHaveLength(1);
    expect(view('Rừng xanh')).toBeTruthy();
    expect(screen.getByText('Chủ đề giao diện · 80 xu')).toBeTruthy();
    expect(view('Bầu trời')).toBeNull();
    expect(screen.getByText('Cấp 8')).toBeTruthy();
    expect(screen.getByText('Mở ở cấp 8')).toBeTruthy();
    const notYet = screen.getByRole('button', { name: 'Chưa mở Bầu trời' });
    expect(notYet.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Chủ đề giao diện · 300 xu')).toBeTruthy();
    // one "Xem", one lock, one chip: three cards, three affordances
    expect(screen.getAllByRole('button', { name: /^Xem / })).toHaveLength(1);
    expect(screen.queryAllByText('Đã sở hữu')).toHaveLength(0);
    screenView.unmount();
  });

  test('an owned item shows "Đã sở hữu" and no "Xem"; the one equipped shows "Đang dùng" and the default stops saying it', async () => {
    world.shop.owned = [FOREST];
    world.shop.equipped.THEME = FOREST;
    const screenView = await openShop();
    expect(view('Rừng xanh')).toBeNull();
    expect(screen.getAllByText('Đang dùng')).toHaveLength(1);
    expect(screen.getAllByText('Đã sở hữu')).toHaveLength(1);
    // the item in use is the forest: its card is the one with the chip
    expect(screen.getAllByText('Rừng xanh')).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /^Xem / })).toHaveLength(0);
    screenView.unmount();
  });

  test('"Trang phục" and "Huy hiệu": the same single affordance per card, a level the person has not reached is a lock', async () => {
    setLevel(2, 10);
    const screenView = await openShop();
    tab('Trang phục');
    expect(screen.getByText('Mầm nguyên bản')).toBeTruthy();
    expect(screen.getAllByText('Đang dùng')).toHaveLength(1);
    expect(screen.getByText('Mũ cáo nhỏ')).toBeTruthy();
    expect(screen.getByText('Trang phục cho Mầm · 120 xu')).toBeTruthy();
    expect(view('Mũ cáo nhỏ')).toBeNull();
    expect(screen.getByText('Cấp 3')).toBeTruthy();
    expect(screen.getByText('Mở ở cấp 3')).toBeTruthy();
    tab('Huy hiệu');
    // earned badges are not for sale, so they are not here; the two for sale are
    expect(screen.queryByText('Người giữ nhịp')).toBeNull();
    expect(view('Chào ngày mới')).toBeTruthy();
    expect(screen.getByText('Huy hiệu · 60 xu')).toBeTruthy();
    expect(view('Từng bước một')).toBeNull();
    expect(screen.getByText('Cấp 5')).toBeTruthy();
    screenView.unmount();
  });

  test('"Xem" opens that item', async () => {
    const screenView = await openShop();
    fireEvent.press(view('Rừng xanh') as never);
    expect(await screen.findByRole('header', { name: 'Chủ đề Rừng xanh' })).toBeTruthy();
    screenView.unmount();
  });

  test('a card of a skin shows the same words in its own tab; the default skin is the one in use', async () => {
    world.shop.owned = [FOX];
    const screenView = await openShop();
    tab('Trang phục');
    expect(screen.getAllByText('Đang dùng')).toHaveLength(1);
    expect(screen.getAllByText('Đã sở hữu')).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /^Xem / })).toHaveLength(0);
    screenView.unmount();
  });

  test('the shop cannot be read: the error state and "Thử lại", then the shop', async () => {
    world.answer = request => (request === 'GET /shop' ? refuse(500, 'INTERNAL') : undefined);
    const screenView = await openShop();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.queryByText('Xu của bạn')).toBeNull();
    world.answer = undefined;
    const reads = shopReads();
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Xu của bạn')).toBeTruthy();
    expect(shopReads()).toBe(reads + 1);
    await landed();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    screenView.unmount();
  });
});
