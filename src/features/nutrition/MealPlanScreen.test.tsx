import { fireEvent, screen, within } from '@testing-library/react-native';
import { Image } from 'react-native';
import { act, app, fetchMock, installTodayTestEnv, landed, noUndo, openMealPlan, refuse, requested, rowName, settle, world } from './mealTestKit';

installTodayTestEnv();

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('S13: the plan', () => {
  test('the title, the card, the day total against the target with the band that completes the task, four rows in order', async () => {
    const view = await openMealPlan();
    expect(screen.getByRole('header', { name: 'Thực đơn hôm nay' })).toBeTruthy();
    expect(screen.getByText('Bạn có thể đổi từng món theo sở thích.')).toBeTruthy();
    expect(screen.getByText('Ăn đủ để có năng lượng')).toBeTruthy();
    expect(screen.getByText('Chọn món phù hợp với bạn. Món ngoài thực đơn vẫn có thể ghi lại.')).toBeTruthy();
    // the numbers are the server's (the stand-in holds the day: 1.650 of 2.394, band 2.155-2.633)
    expect(screen.getByText('Đã ăn 1.650 / 2.394 kcal')).toBeTruthy();
    expect(screen.getByText('Việc chính hoàn thành khi tổng cả ngày trong 2.155–2.633 kcal')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 2394, now: 1650 });
    expect(bar.props.accessibilityLabel).toBe('Đã ăn 1.650 / 2.394 kcal. Việc chính hoàn thành khi tổng cả ngày trong 2.155–2.633 kcal');
    const rows = screen.getAllByRole('button', { name: /^Bữa (sáng|trưa|tối|phụ)\./ });
    expect(rows.map(each => each.props.accessibilityLabel)).toEqual([
      'Bữa sáng. Yến mạch và trái cây · gợi ý khoảng 540 kcal',
      'Bữa trưa. Cơm gà, rau củ · gợi ý khoảng 820 kcal',
      'Bữa tối. Cá áp chảo, cơm và rau · gợi ý khoảng 720 kcal',
      'Bữa phụ. Sữa chua và hạt · gợi ý khoảng 290 kcal',
    ]);
    expect(screen.getByRole('button', { name: 'Ghi món đã ăn' })).toBeTruthy();
    noUndo();
    view.unmount();
  });

  test('a logged slot says "đã ghi" in words (and with a mark); the others still say what is suggested', async () => {
    world.plan.logged.BREAKFAST = true;
    const view = await openMealPlan();
    expect(row(rowName('BREAKFAST')).props.accessibilityLabel).toBe('Bữa sáng. Yến mạch và trái cây · 540 kcal · đã ghi');
    expect(within(row(rowName('BREAKFAST'))).getByText('Yến mạch và trái cây · 540 kcal · đã ghi')).toBeTruthy();
    expect(row(rowName('LUNCH')).props.accessibilityLabel).toBe('Bữa trưa. Cơm gà, rau củ · gợi ý khoảng 820 kcal');
    expect(screen.queryAllByText(/đã ghi/)).toHaveLength(1);
    view.unmount();
  });

  test('a slot whose meal is the nearest there is, not a near one, carries the warning; the others do not', async () => {
    world.plan.warning.DINNER = true;
    const view = await openMealPlan();
    expect(screen.getAllByText('Món gần nhất hiện có, lệch so với mục tiêu của bữa')).toHaveLength(1);
    expect(within(row(rowName('DINNER'))).getByText('Món gần nhất hiện có, lệch so với mục tiêu của bữa')).toBeTruthy();
    expect(row(rowName('DINNER')).props.accessibilityLabel).toMatch(/Món gần nhất hiện có, lệch so với mục tiêu của bữa$/);
    view.unmount();
  });

  test('pictures: a meal with an image key shows it, the others show the icon of their slot (no image)', async () => {
    const view = await openMealPlan();
    // the header, plus the pictures of lunch (Fr7yg), breakfast (e1ZpZ) and dinner (xZxDr); the snack has none
    expect(screen.UNSAFE_getAllByType(Image)).toHaveLength(1 + 3);
    expect(within(row(rowName('SNACK'))).UNSAFE_queryAllByType(Image)).toHaveLength(0);
    expect(within(row(rowName('LUNCH'))).UNSAFE_queryAllByType(Image)).toHaveLength(1);
    view.unmount();
  });

  test('a slot without a meal (every one of its meals is excluded) says so and still opens', async () => {
    world.plan.planned.SNACK = null;
    const view = await openMealPlan();
    expect(row(rowName('SNACK')).props.accessibilityLabel).toBe('Bữa phụ. Chưa có gợi ý cho bữa này');
    fireEvent.press(row(rowName('SNACK')));
    expect(await screen.findByRole('header', { name: 'Bữa phụ' })).toBeTruthy();
    expect(screen.getByText('Chưa có món cho bữa này')).toBeTruthy();
    await landed();
    view.unmount();
  });

  test('a row opens that slot; "Ghi món đã ăn" opens the manual form', async () => {
    const view = await openMealPlan();
    fireEvent.press(row(rowName('DINNER')));
    expect(await screen.findByRole('header', { name: 'Cá áp chảo, cơm và rau' })).toBeTruthy();
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Ghi món đã ăn' }));
    expect(await screen.findByRole('header', { name: 'Ghi bữa ăn' })).toBeTruthy();
    await landed();
    view.unmount();
  });

  test('a planned meal sent from this device and not yet confirmed is "đang chờ gửi", not "đã ghi"', async () => {
    const view = await openMealPlan();
    world.answer = request => {
      if (request === 'POST /nutrition/log') throw new TypeError('Network request failed');
      return undefined;
    };
    // what a screen would have filed while offline
    await act(async () => {
      await app.send({ path: '/nutrition/log', body: { mealSlot: 'LUNCH' } });
    });
    expect(row(rowName('LUNCH')).props.accessibilityLabel).toBe('Bữa trưa. Cơm gà, rau củ · 820 kcal · đang chờ gửi');
    expect(screen.queryByText(/đã ghi/)).toBeNull();
    // the total is still the server's: nothing was added for it
    expect(screen.getByText('Đã ăn 1.650 / 2.394 kcal')).toBeTruthy();
    view.unmount();
  });
});

describe('S13: when the plan cannot be read', () => {
  test('the error state with "Thử lại"; "Ghi món đã ăn" is still there; the retry brings the plan', async () => {
    world.answer = request => (request === 'GET /nutrition/plan' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openMealPlan();
    expect(screen.getByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: rowName('LUNCH') })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ghi món đã ăn' })).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: rowName('LUNCH') })).toBeTruthy();
    view.unmount();
  });

  test('409 DAY_CLOSED (the date turned between the read and the save) is read once more by itself', async () => {
    let asked = 0;
    world.answer = request => {
      if (request !== 'GET /nutrition/plan') return undefined;
      asked += 1;
      return asked === 1 ? refuse(409, 'DAY_CLOSED') : undefined;
    };
    const view = await openMealPlan();
    expect(await screen.findByRole('button', { name: rowName('LUNCH') })).toBeTruthy();
    expect(asked).toBe(2);
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    await settle();
    view.unmount();
  });

  test('DAY_CLOSED twice: the error state says the day turned, not that a record was refused', async () => {
    world.answer = request => (request === 'GET /nutrition/plan' ? refuse(409, 'DAY_CLOSED') : undefined);
    const view = await openMealPlan();
    expect(await screen.findByText('Ngày mới vừa bắt đầu nên thực đơn đang được làm mới. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText(/không được tính/)).toBeNull();
    expect(requested('/nutrition/plan')).toBe(2);
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: rowName('LUNCH') })).toBeTruthy();
    view.unmount();
  });

  test('the plan is read once for a visit, not once per render', async () => {
    const view = await openMealPlan();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/nutrition/plan'))).toHaveLength(1);
    view.unmount();
  });
});
