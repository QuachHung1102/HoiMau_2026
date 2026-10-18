import { fireEvent, screen } from '@testing-library/react-native';
import { PERKS, SWAPS_PER_SLOT, TICKET_CAP } from '../../../domain/economy.ts';
import { fetchMock, installTodayTestEnv, openLevels, openToday, setLevel, settle, world } from './progressionTestKit';
import { refuse } from '../sync/syncTestKit';

installTodayTestEnv();

const titleRow = (text: string) => screen.getByLabelText(new RegExp(`^${text}`));

describe('S46: levels', () => {
  test('the level card: the title, the bar with its numbers, the perk points', async () => {
    setLevel(5, 340, { perkPointsAvailable: 1 });
    const view = await openLevels();
    expect(screen.getByRole('header', { name: 'Cấp độ & tiện ích' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Cấp 5 · Người kiên trì' })).toBeTruthy();
    expect(screen.getByText('Mỗi lần lên cấp mở thêm lựa chọn cho hành trình.')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: '340 / 1.118 XP tới cấp 6' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 1118, now: 340 });
    expect(screen.getByText('340 / 1.118 XP tới cấp 6')).toBeTruthy();
    expect(screen.getByText('1 điểm tiện ích')).toBeTruthy();
    view.unmount();
  });

  test('the five titles with their levels; only the current one is marked, in words', async () => {
    setLevel(5, 340);
    const view = await openLevels();
    expect(screen.getByRole('header', { name: 'Danh hiệu' })).toBeTruthy();
    for (const text of ['Tân binh · cấp 1–4', 'Người kiên trì · cấp 5–9', 'Chiến binh kỷ luật · cấp 10–19', 'Kiện tướng · cấp 20–34', 'Huyền thoại thể hình · cấp 35+']) {
      expect(titleRow(text)).toBeTruthy();
    }
    expect(titleRow('Người kiên trì').props.accessibilityLabel).toBe('Người kiên trì · cấp 5–9. Hiện tại');
    expect(titleRow('Người kiên trì').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getAllByText('Hiện tại')).toHaveLength(1);
    for (const other of ['Tân binh', 'Chiến binh kỷ luật', 'Kiện tướng', 'Huyền thoại thể hình']) {
      expect(titleRow(other).props.accessibilityLabel).not.toMatch(/Hiện tại/);
      expect(titleRow(other).props.accessibilityState).toEqual({ selected: false });
    }
    view.unmount();
  });

  test.each([
    [1, 'Tân binh', 'Cấp 1 · Tân binh'],
    [20, 'Kiện tướng', 'Cấp 20 · Kiện tướng'],
    [35, 'Huyền thoại thể hình', 'Cấp 35 · Huyền thoại thể hình'],
  ])('at level %i the current title is "%s"', async (level, title, heading) => {
    setLevel(level, 10);
    const view = await openLevels();
    expect(screen.getByRole('header', { name: heading })).toBeTruthy();
    expect(titleRow(title).props.accessibilityLabel).toMatch(/\. Hiện tại$/);
    expect(screen.getAllByText('Hiện tại')).toHaveLength(1);
    view.unmount();
  });

  test('the three perks are rows with their cost from PERKS; each one opens its sheet (the unlock itself is in PerkSheet.test.tsx)', async () => {
    const view = await openLevels();
    const rows: [string, string, string][] = [
      ['Thêm lựa chọn đổi món', `Mỗi bữa đổi được ${SWAPS_PER_SLOT.withPerk} lần thay vì ${SWAPS_PER_SLOT.base}`, `${PERKS.MEAL_SWAP_PLUS.cost} điểm`],
      ['Thêm chỗ giữ vé', `Giữ được ${TICKET_CAP.withPerk} vé thay vì ${TICKET_CAP.base}`, `${PERKS.TICKET_CAP_PLUS.cost} điểm`],
      ['Chủ đề mới', 'Thay đổi diện mạo', `${PERKS.THEME_UNLOCK.cost} điểm`],
    ];
    for (const [title, description, cost] of rows) {
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.getByText(cost)).toBeTruthy();
    }
    // the costs are the ones of the economy: 2, 3 and 1 points
    expect([PERKS.MEAL_SWAP_PLUS.cost, PERKS.TICKET_CAP_PLUS.cost, PERKS.THEME_UNLOCK.cost]).toEqual([2, 3, 1]);
    expect(screen.getByRole('button', { name: /Thêm lựa chọn đổi món/ })).toBeTruthy();
    expect(screen.getByText('Điểm tiện ích không cộng vào chỉ số cơ thể hoặc điểm tổ đội.')).toBeTruthy();
    view.unmount();
  });

  test('the profile cannot be read: the error state with "Thử lại", then the screen', async () => {
    world.answer = request => (request === 'GET /progression' ? refuse(500, 'INTERNAL') : undefined);
    // from the level strip of the home tab, which does not read /progression itself
    const view = await openToday();
    fireEvent.press(screen.getByRole('button', { name: /^Cấp 5 · Người kiên trì\./ }));
    await screen.findByRole('header', { name: 'Cấp độ & tiện ích' });
    await settle();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Cấp 5 · Người kiên trì' })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/progression')).length).toBeGreaterThanOrEqual(2);
    await settle();
    view.unmount();
  });
});
