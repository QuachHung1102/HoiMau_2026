import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { colors } from '../../shared/theme/tokens';
import { fetchMock, FOREST, FOX, hold, installTodayTestEnv, landed, openItem, primary, queryClient, refuse, serverAnswer, setLevel, setWallet, settle, world, writesOf } from './shopTestKit';

installTodayTestEnv();

const PURCHASE = `POST /shop/${FOREST}/purchase`;
const buyPath = `/shop/${FOREST}/purchase`;
const confirm = () => screen.getByRole('button', { name: 'Xác nhận mua' });
const draws = (what: string) => JSON.stringify(screen.toJSON()).includes(what);
const reads = (path: string) => fetchMock.mock.calls.filter(([url]) => url.endsWith(path)).length;
/** The answer of the stand-in server, with the Idempotency-Key it was asked under. */
const answerOnce = (request: string, make: () => unknown) => {
  let first = true;
  world.answer = asked => {
    if (asked !== request || !first) return undefined;
    first = false;
    return make();
  };
};

describe('S40: look first, then confirm', () => {
  test('a theme: its title, a sample card in ITS colours, the price against the balance of the server, "Xác nhận mua" and "Chưa mua"', async () => {
    const view = await openItem('Rừng xanh');
    expect(screen.getByRole('header', { name: 'Chủ đề Rừng xanh' })).toBeTruthy();
    expect(screen.getByText('Xem trước trước khi dùng xu.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Đổi không khí cho hành trình' })).toBeTruthy();
    expect(screen.getByText('Giá: 80 xu · bạn đang có 250 xu. Chỉ thay diện mạo, không thay đổi tiến trình.')).toBeTruthy();
    // the sample is drawn with the forest palette (the sample button is its `primary`), not with the palette of the app
    expect(StyleSheet.flatten(screen.getByTestId('theme-sample-button').props.style)).toMatchObject({ backgroundColor: colors.forestPrimary });
    expect(primary()).toBe(colors.primary);
    expect(confirm()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chưa mua' })).toBeTruthy();
    view.unmount();
  });

  test('the other palette has its own sample: the sky theme is drawn with the sky colours', async () => {
    setLevel(8, 10);
    const view = await openItem('Bầu trời');
    expect(StyleSheet.flatten(screen.getByTestId('theme-sample-button').props.style)).toMatchObject({ backgroundColor: colors.skyPrimary });
    expect(screen.getByText('Giá: 300 xu · bạn đang có 250 xu', { exact: false })).toBeTruthy();
    // 300 against 250: it is S71 already, with no way to press anything that spends
    expect(screen.queryByRole('button', { name: 'Xác nhận mua' })).toBeNull();
    view.unmount();
  });

  test('a skin: Mầm wearing it; a theme shows no skin', async () => {
    const view = await openItem('Mũ cáo nhỏ', 'PET_SKIN');
    expect(screen.getByRole('header', { name: 'Mũ cáo nhỏ' })).toBeTruthy();
    expect(screen.getByText('Trang phục cho Mầm')).toBeTruthy();
    expect(draws('"name":"skin"')).toBe(true);
    expect(screen.getByText('Giá: 120 xu · bạn đang có 250 xu. Chỉ thay diện mạo, không thay đổi tiến trình.')).toBeTruthy();
    expect(screen.queryByTestId('theme-sample-button')).toBeNull();
    view.unmount();

    const second = await openItem('Rừng xanh');
    expect(draws('"name":"skin"')).toBe(false);
    second.unmount();
  });

  test('a badge: the badge itself, and its price', async () => {
    const view = await openItem('Chào ngày mới', 'BADGE');
    expect(screen.getByText('Huy hiệu thành tích')).toBeTruthy();
    expect(screen.getByText('Giá: 60 xu · bạn đang có 250 xu. Chỉ thay diện mạo, không thay đổi tiến trình.')).toBeTruthy();
    expect(draws('"name":"skin"')).toBe(false);
    view.unmount();
  });

  test('"Chưa mua" goes back to the shop and nothing is sent', async () => {
    const view = await openItem('Rừng xanh');
    fireEvent.press(screen.getByRole('button', { name: 'Chưa mua' }));
    expect(await screen.findByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    expect(writesOf(buyPath)).toEqual([]);
    view.unmount();
  });
});

describe('S72: the purchase', () => {
  test('success: "Đã mở khóa", the balance in the ANSWER of the server, the item is the person\'s; the shop and the profile are read again', async () => {
    const view = await openItem('Rừng xanh');
    const shopReads = reads('/shop');
    const meReads = reads('/me');
    fireEvent.press(confirm());
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    expect(screen.getByText('Còn 170 xu')).toBeTruthy();
    expect(screen.getByText('Rừng xanh đã là của bạn')).toBeTruthy();
    expect(screen.getByText('Đã sở hữu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dùng ngay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Về cửa hàng' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận mua' })).toBeNull();
    // exactly one request, with a key and no body
    const sent = writesOf(buyPath);
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0].body).toBeNull();
    await landed();
    expect(reads('/shop')).toBeGreaterThan(shopReads);
    expect(reads('/me')).toBeGreaterThan(meReads);
    view.unmount();
  });

  test('the balance is the one the server answered, not 250 - 80: an answer of 169 shows 169', async () => {
    const view = await openItem('Rừng xanh');
    world.answer = (request, init) => {
      if (request !== PURCHASE) return undefined;
      const real = serverAnswer(request, init) as { text(): Promise<string> };
      return real.text().then(text => ({ ok: true, status: 200, text: async () => JSON.stringify({ ...JSON.parse(text), coin: 169 }) }));
    };
    fireEvent.press(confirm());
    expect(await screen.findByText('Còn 169 xu')).toBeTruthy();
    view.unmount();
  });

  test('coins and inventory change on screen only after the server confirms: while the request is out the price line, the button and the shop are as they were', async () => {
    const view = await openItem('Rừng xanh');
    const gate = hold(PURCHASE);
    fireEvent.press(confirm());
    await settle();
    expect(screen.getByText('Giá: 80 xu · bạn đang có 250 xu. Chỉ thay diện mạo, không thay đổi tiến trình.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xác nhận mua' }).props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.queryByText('Đã mở khóa')).toBeNull();
    gate.release();
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    view.unmount();
  });

  test('a double press is ONE request', async () => {
    const view = await openItem('Rừng xanh');
    const gate = hold(PURCHASE);
    const button = confirm();
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);
    await settle();
    gate.release();
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    await settle();
    expect(writesOf(buyPath)).toHaveLength(1);
    view.unmount();
  });

  test('after a purchase the shop shows the balance read from the server and the item as owned', async () => {
    const view = await openItem('Rừng xanh');
    fireEvent.press(confirm());
    await screen.findByRole('header', { name: 'Đã mở khóa' });
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Về cửa hàng' }));
    expect(await screen.findByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    expect(await screen.findByText('170 xu · không dùng tiền thật')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xem Rừng xanh' })).toBeNull();
    expect(screen.getByText('Đã sở hữu')).toBeTruthy();
    view.unmount();
  });

  test('"Dùng ngay" equips it (POST /inventory/{code}/equip), then opens the inventory with the palette switched', async () => {
    const view = await openItem('Rừng xanh');
    fireEvent.press(confirm());
    await screen.findByRole('header', { name: 'Đã mở khóa' });
    await landed();
    expect(primary()).toBe(colors.primary);
    fireEvent.press(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(await screen.findByRole('header', { name: 'Kho đồ của bạn' })).toBeTruthy();
    const sent = writesOf(`/inventory/${FOREST}/equip`);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBeNull();
    await waitFor(() => expect(primary()).toBe(colors.forestPrimary));
    view.unmount();
  });

  test('"Dùng ngay" refused or lost: the explanation is on the screen with "Thử lại", and nothing moved', async () => {
    const view = await openItem('Rừng xanh');
    fireEvent.press(confirm());
    await screen.findByRole('header', { name: 'Đã mở khóa' });
    await landed();
    world.down = true;
    fireEvent.press(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(await screen.findByText('Chưa áp dụng được. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    expect(primary()).toBe(colors.primary);
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Kho đồ của bạn' })).toBeTruthy();
    // a request the server never got is the SAME request: one key
    const sent = writesOf(`/inventory/${FOREST}/equip`);
    expect(sent).toHaveLength(2);
    expect(sent[0].id).toBe(sent[1].id);
    view.unmount();
  });

  test('"Về cửa hàng" goes back to the shop', async () => {
    const view = await openItem('Rừng xanh');
    fireEvent.press(confirm());
    await screen.findByRole('header', { name: 'Đã mở khóa' });
    fireEvent.press(screen.getByRole('button', { name: 'Về cửa hàng' }));
    expect(await screen.findByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    view.unmount();
  });
});

describe('with motion on (purchase-unlock, number-roll of the catalog)', () => {
  test('the item pops once the server has confirmed, and the balance of the shop counts to the number of the server and ends on it', async () => {
    const view = await openItem('Rừng xanh', 'THEME', { motion: 'FULL' });
    fireEvent.press(confirm());
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    expect(screen.getByText('Còn 170 xu')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Về cửa hàng' }));
    expect(await screen.findByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    expect(await screen.findByText('170 xu · không dùng tiền thật')).toBeTruthy();
    view.unmount();
  });
});

describe('S71: not enough coins', () => {
  test('known before pressing: no buy button, the shortfall from the balance of the server, a way to earn more', async () => {
    setWallet(100);
    const view = await openItem('Mũ cáo nhỏ', 'PET_SKIN');
    expect(screen.getByText('Còn thiếu 20 xu. Hoàn thành nhiệm vụ để nhận thêm xu.')).toBeTruthy();
    expect(screen.getByText('Giá: 120 xu · bạn đang có 100 xu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận mua' })).toBeNull();
    expect(writesOf(`/shop/${FOX}/purchase`)).toEqual([]);
    fireEvent.press(screen.getByRole('button', { name: 'Xem nhiệm vụ' }));
    expect(await screen.findByRole('header', { name: 'Nhiệm vụ hôm nay' })).toBeTruthy();
    view.unmount();
  });

  test('INSUFFICIENT_COINS from the server: S71 with the shortfall worked out from `details` (price - coin), and no buy button', async () => {
    const view = await openItem('Rừng xanh');
    answerOnce(PURCHASE, () => refuse(409, 'INSUFFICIENT_COINS', { price: 80, coin: 30 }));
    fireEvent.press(confirm());
    expect(await screen.findByText('Còn thiếu 50 xu. Hoàn thành nhiệm vụ để nhận thêm xu.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận mua' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem nhiệm vụ' })).toBeTruthy();
    expect(screen.queryByText('Đã mở khóa')).toBeNull();
    expect(writesOf(buyPath)).toHaveLength(1);
    view.unmount();
  });
});

describe('the other refusals are explained where they happen', () => {
  test.each([
    ['ALREADY_OWNED', undefined, 'Bạn đã sở hữu vật phẩm này rồi, xu của bạn không bị trừ thêm.'],
    ['ITEM_NOT_PURCHASABLE', undefined, 'Vật phẩm này không bán bằng xu. Nó đến từ hành trình của bạn.'],
    ['ITEM_NOT_FOUND', undefined, 'Vật phẩm này không còn trong cửa hàng.'],
    ['ITEM_LOCKED_LEVEL', { minLevel: 8 }, 'Vật phẩm này mở ở cấp 8. Xu của bạn chưa bị trừ.'],
  ])('%s: the words, no success, nothing spent, the shop read again', async (code, details, words) => {
    const view = await openItem('Rừng xanh');
    answerOnce(PURCHASE, () => refuse(code === 'ITEM_NOT_FOUND' ? 404 : 409, code, details));
    const shopReads = reads('/shop');
    fireEvent.press(confirm());
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByText('Đã mở khóa')).toBeNull();
    await landed();
    expect(reads('/shop')).toBe(shopReads + 1);
    view.unmount();
  });

  test('ALREADY_OWNED: the shop that is read again says it is owned, and the screen follows it', async () => {
    const view = await openItem('Rừng xanh');
    world.shop.owned.push(FOREST); // bought on another device meanwhile
    fireEvent.press(confirm());
    expect(await screen.findByText('Bạn đã sở hữu vật phẩm này rồi, xu của bạn không bị trừ thêm.')).toBeTruthy();
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dùng ngay' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận mua' })).toBeNull();
    view.unmount();
  });

  test('no connection: the words and "Thử lại"; the same request again goes under the SAME key and the purchase is made once', async () => {
    const view = await openItem('Rừng xanh');
    world.down = true;
    fireEvent.press(confirm());
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Đã mở khóa')).toBeNull();
    expect(screen.getByText('Giá: 80 xu · bạn đang có 250 xu. Chỉ thay diện mạo, không thay đổi tiến trình.')).toBeTruthy();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    const sent = writesOf(buyPath);
    expect(sent).toHaveLength(2);
    expect(sent[0].id).toBe(sent[1].id);
    expect(world.shop.owned.filter(code => code === FOREST)).toHaveLength(1);
    view.unmount();
  });

  test('the answer is lost but the server did buy: the retry under the same key gets the stored answer, never a second charge', async () => {
    const view = await openItem('Rừng xanh');
    let lost = true;
    world.answer = (request, init) => {
      if (request !== PURCHASE || !lost) return undefined;
      lost = false;
      serverAnswer(request, init); // bought, and its answer is stored under the key
      throw new TypeError('Network request failed');
    };
    fireEvent.press(confirm());
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Còn 170 xu')).toBeTruthy();
    expect(world.me.progression?.coin).toBe(170);
    const sent = writesOf(buyPath);
    expect(sent[0].id).toBe(sent[1].id);
    view.unmount();
  });

  test('after ANY answer of the server a new press is a NEW request: another key', async () => {
    const view = await openItem('Rừng xanh');
    answerOnce(PURCHASE, () => refuse(409, 'ITEM_LOCKED_LEVEL', { minLevel: 8 }));
    fireEvent.press(confirm());
    await screen.findByText('Vật phẩm này mở ở cấp 8. Xu của bạn chưa bị trừ.');
    await landed();
    fireEvent.press(confirm());
    expect(await screen.findByRole('header', { name: 'Đã mở khóa' })).toBeTruthy();
    const sent = writesOf(buyPath);
    expect(sent).toHaveLength(2);
    expect(sent[0].id).not.toBe(sent[1].id);
    view.unmount();
  });

  test('an item the shop no longer has: a short explanation and the way back', async () => {
    const view = await openItem('Rừng xanh');
    // the server drops it from the catalog while the screen is open: the next read of the shop has no such item
    world.answer = request => (request === 'GET /shop' ? serverShopWithout(FOREST) : undefined);
    await act(() => queryClient().invalidateQueries({ queryKey: ['shop'] }));
    expect(await screen.findByText('Không thấy vật phẩm này')).toBeTruthy();
    expect(screen.getByText('Vật phẩm này không còn trong cửa hàng.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Về cửa hàng' }));
    expect(await screen.findByRole('header', { name: 'Cửa hàng' })).toBeTruthy();
    view.unmount();
  });
});

function serverShopWithout(code: string) {
  const real = serverAnswer('GET /shop', undefined as never) as { text(): Promise<string> };
  return real.text().then(text => {
    const shop = JSON.parse(text) as { items: { code: string }[] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ...shop, items: shop.items.filter(item => item.code !== code) }) };
  });
}
