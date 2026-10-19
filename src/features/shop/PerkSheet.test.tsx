import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { act, fetchMock, FOREST, hold, installTodayTestEnv, landed, openLevels, refuse, queryClient, setLevel, settle, world, writesOf } from './shopTestKit';

installTodayTestEnv();

const UNLOCK = 'POST /perks/unlock';
const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const open = (title: string) => fireEvent.press(row(title));
const unlockButton = () => screen.queryByRole('button', { name: 'Mở khóa' });
/** "Đã mở" is on the sheet and, behind it, on the row of that perk. */
const opened = () => waitFor(() => expect(screen.queryAllByText('Đã mở').length).toBeGreaterThan(0));
const unlocks = () => writesOf('/perks/unlock');
const reads = (path: string) => fetchMock.mock.calls.filter(([url]) => url.endsWith(path)).length;
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) => node.props.accessibilityState?.disabled === true;
const answerOnce = (request: string, make: () => unknown) => {
  let first = true;
  world.answer = asked => {
    if (asked !== request || !first) return undefined;
    first = false;
    return make();
  };
};

/** Levels with `points` perk points, and a perk's sheet open. */
async function openSheet(title: string, points = 3) {
  setLevel(5, 340, { perkPointsAvailable: points });
  const view = await openLevels();
  open(title);
  await screen.findByRole('header', { name: title });
  await landed();
  return view;
}

describe('S46: the perk sheet', () => {
  test('what the perk does, its cost and the points of the server; "Mở khóa" unlocks it, and the points and the row follow the server', async () => {
    const view = await openSheet('Thêm lựa chọn đổi món');
    expect(screen.getByText('Mỗi bữa đổi được 5 lần mỗi ngày thay vì 3.')).toBeTruthy();
    expect(screen.getByText('Cần 2 điểm · bạn có 3 điểm')).toBeTruthy();
    fireEvent.press(unlockButton() as never);
    await opened();
    expect(unlockButton()).toBeNull();
    // one request: the perk code and nothing else, under a key
    const sent = unlocks();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ perkCode: 'MEAL_SWAP_PLUS' });
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('Cần 2 điểm · bạn có 1 điểm')).toBeTruthy();
    // the sheet closed: the points on the levels card are the profile read again, and the row says "Đã mở"
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    await landed();
    expect(screen.getByText('1 điểm tiện ích')).toBeTruthy();
    expect(row('Thêm lựa chọn đổi món').props.accessibilityLabel).toMatch(/Đã mở$/);
    expect(row('Thêm chỗ giữ vé').props.accessibilityLabel).toMatch(/3 điểm$/);
    view.unmount();
  });

  test('the profile and the perks are read again after an unlock; nothing is worked out on the device', async () => {
    const view = await openSheet('Thêm lựa chọn đổi món');
    const progressions = reads('/progression');
    const mes = reads('/me');
    fireEvent.press(unlockButton() as never);
    await opened();
    await landed();
    expect(reads('/progression')).toBeGreaterThan(progressions);
    expect(reads('/me')).toBeGreaterThan(mes);
    view.unmount();
  });

  test('THEME_UNLOCK asks which theme first: only themes not owned, one the level has not opened is off; the choice and its code go to the server', async () => {
    const view = await openSheet('Chủ đề mới');
    expect(screen.getByText('Chọn chủ đề muốn mở')).toBeTruthy();
    expect(screen.getByText('Cần 1 điểm · bạn có 3 điểm')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Mở khóa' }))).toBe(true);
    const sky = screen.getByRole('radio', { name: /Bầu trời/ });
    expect(isDisabled(sky)).toBe(true);
    expect(screen.getByText('Mở ở cấp 8')).toBeTruthy();
    expect(screen.queryByText('Hồi Máu nguyên bản')).toBeNull();
    fireEvent.press(screen.getByRole('radio', { name: /Rừng xanh/ }));
    expect(isDisabled(screen.getByRole('button', { name: 'Mở khóa' }))).toBe(false);
    fireEvent.press(unlockButton() as never);
    expect(await screen.findByText('Đã mở chủ đề Rừng xanh')).toBeTruthy();
    expect(unlocks()).toHaveLength(1);
    expect(unlocks()[0].body).toEqual({ perkCode: 'THEME_UNLOCK', itemCode: FOREST });
    // the theme is the person's, no coin was touched, a point was spent
    await landed();
    expect(world.shop.owned).toContain(FOREST);
    expect(world.me.progression?.coin).toBe(250);
    expect(screen.getByText('Cần 1 điểm · bạn có 2 điểm')).toBeTruthy();
    // the theme perk can be used again: the forest is gone from the list, the button is still a button
    expect(screen.queryByRole('radio', { name: /Rừng xanh/ })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    await landed();
    expect(screen.getByText('2 điểm tiện ích')).toBeTruthy();
    expect(row('Chủ đề mới').props.accessibilityLabel).toMatch(/1 điểm$/);
    view.unmount();
  });

  test('MEAL_SWAP_PLUS: the meal plan the app holds is read again (its swaps come from the perk)', async () => {
    const view = await openSheet('Thêm lựa chọn đổi món');
    act(() => queryClient().setQueryData(['mealPlan'], { swapsAllowed: 3 }));
    expect(queryClient().getQueryState(['mealPlan'])?.isInvalidated).toBe(false);
    fireEvent.press(unlockButton() as never);
    await opened();
    await landed();
    expect(queryClient().getQueryState(['mealPlan'])?.isInvalidated).toBe(true);
    view.unmount();
  });

  test('THEME_UNLOCK while the shop is loading: the loading state, not "every theme is owned"; once it lands, the choice', async () => {
    setLevel(5, 340, { perkPointsAvailable: 3 });
    const view = await openLevels();
    const gate = hold('GET /shop');
    open('Chủ đề mới');
    await screen.findByRole('header', { name: 'Chủ đề mới' });
    await landed();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Bạn đã có mọi chủ đề đang mở. Chủ đề mới sẽ có khi bạn lên cấp.')).toBeNull();
    gate.release();
    expect(await screen.findByRole('radio', { name: /Rừng xanh/ })).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Đang tải' })).toBeNull();
    view.unmount();
  });

  test('THEME_UNLOCK while the shop cannot be read (offline): the error and "Thử lại", not "every theme is owned"; the retry brings the choice', async () => {
    setLevel(5, 340, { perkPointsAvailable: 3 });
    const view = await openLevels();
    world.answer = asked => (asked === 'GET /shop' ? refuse(500, 'INTERNAL') : undefined);
    open('Chủ đề mới');
    expect(await screen.findByText('Chưa tải được cửa hàng. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Bạn đã có mọi chủ đề đang mở. Chủ đề mới sẽ có khi bạn lên cấp.')).toBeNull();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('radio', { name: /Rừng xanh/ })).toBeTruthy();
    view.unmount();
  });

  test('every theme is owned: no choice to make, no button', async () => {
    world.shop.owned = [FOREST, 'THEME_SKY'];
    const view = await openSheet('Chủ đề mới');
    expect(screen.getByText('Bạn đã có mọi chủ đề đang mở. Chủ đề mới sẽ có khi bạn lên cấp.')).toBeTruthy();
    view.unmount();
  });

  test('PERK_POINTS_INSUFFICIENT from the server: the copy that says how points are earned, nothing is marked "Đã mở"', async () => {
    const view = await openSheet('Thêm chỗ giữ vé');
    answerOnce(UNLOCK, () => refuse(409, 'PERK_POINTS_INSUFFICIENT'));
    const perkReads = reads('/perks');
    fireEvent.press(unlockButton() as never);
    expect(await screen.findByText('Mỗi lần lên cấp bạn nhận 1 điểm tiện ích. Cứ giữ nhịp, điểm sẽ đến.')).toBeTruthy();
    expect(screen.queryByText('Đã mở')).toBeNull();
    expect(unlocks()).toHaveLength(1);
    // the sheet reads the server again
    await landed();
    expect(reads('/perks')).toBe(perkReads + 1);
    view.unmount();
  });

  test('known before pressing: too few points, no "Mở khóa", the same copy beside it, nothing sent', async () => {
    const view = await openSheet('Thêm chỗ giữ vé', 1);
    expect(screen.getByText('Cần 3 điểm · bạn có 1 điểm')).toBeTruthy();
    expect(unlockButton()).toBeNull();
    expect(screen.getByText('Mỗi lần lên cấp bạn nhận 1 điểm tiện ích. Cứ giữ nhịp, điểm sẽ đến.')).toBeTruthy();
    expect(unlocks()).toEqual([]);
    view.unmount();
  });

  test.each([
    ['PERK_ALREADY_UNLOCKED', undefined, 'Tiện ích này đã được mở khóa từ trước, điểm của bạn không bị trừ thêm.'],
    ['ALREADY_OWNED', undefined, 'Bạn đã sở hữu vật phẩm này rồi, xu của bạn không bị trừ thêm.'],
    ['ITEM_LOCKED_LEVEL', { minLevel: 8 }, 'Vật phẩm này mở ở cấp 8. Xu của bạn chưa bị trừ.'],
  ])('%s is explained in the sheet, and the sheet is read again', async (code, details, words) => {
    const view = await openSheet('Thêm lựa chọn đổi món');
    answerOnce(UNLOCK, () => refuse(409, code, details));
    const perkReads = reads('/perks');
    fireEvent.press(unlockButton() as never);
    expect(await screen.findByText(words)).toBeTruthy();
    await landed();
    expect(reads('/perks')).toBe(perkReads + 1);
    view.unmount();
  });

  test('a double press is ONE request', async () => {
    const view = await openSheet('Thêm lựa chọn đổi món');
    const gate = hold(UNLOCK);
    const button = unlockButton() as never;
    fireEvent.press(button);
    fireEvent.press(button);
    await settle();
    gate.release();
    await opened();
    await settle();
    expect(unlocks()).toHaveLength(1);
    view.unmount();
  });

  test('no connection: the retry is the SAME request, so the perk is unlocked once; after an answer of the server a new press is a NEW request', async () => {
    const view = await openSheet('Thêm lựa chọn đổi món');
    world.down = true;
    fireEvent.press(unlockButton() as never);
    expect(await screen.findByText(/Không kết nối được mạng/)).toBeTruthy();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await opened();
    expect(unlocks()).toHaveLength(2);
    expect(unlocks()[0].id).toBe(unlocks()[1].id);
    expect(world.shop.unlocked).toHaveLength(1);
    view.unmount();

    // a refusal ends the request: the next press carries another key
    world.shop = { ...world.shop, unlocked: [] };
    const second = await openSheet('Thêm chỗ giữ vé');
    answerOnce(UNLOCK, () => refuse(409, 'PERK_POINTS_INSUFFICIENT'));
    const before = unlocks().length;
    fireEvent.press(unlockButton() as never);
    await screen.findByText('Mỗi lần lên cấp bạn nhận 1 điểm tiện ích. Cứ giữ nhịp, điểm sẽ đến.');
    await landed();
    fireEvent.press(unlockButton() as never);
    await opened();
    const mine = unlocks().slice(before);
    expect(mine).toHaveLength(2);
    expect(mine[0].id).not.toBe(mine[1].id);
    second.unmount();
  });
});
