import { fireEvent, screen } from '@testing-library/react-native';
import { act, hold, installTodayTestEnv, landed, logs, noUndo, openMealDetail, queryClient, refuse, requested, respond, settle, world } from './mealTestKit';

installTodayTestEnv();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOG = 'Ghi nhận món này';
const logButton = () => screen.getByRole('button', { name: LOG });
const offline = () => {
  world.answer = request => {
    if (request === 'POST /nutrition/log') throw new TypeError('Network request failed');
    return undefined;
  };
};

describe('S14: the meal', () => {
  test('name, slot, description, kcal and the three macros as labelled numbers, portion, tags in words', async () => {
    const view = await openMealDetail('LUNCH');
    expect(screen.getByRole('header', { name: 'Cơm gà, rau củ' })).toBeTruthy();
    expect(screen.getByText('Bữa trưa · gợi ý từ thư viện')).toBeTruthy();
    expect(screen.getByText('Mô tả của cơm gà, rau củ.')).toBeTruthy();
    expect(screen.getByText('Dinh dưỡng mỗi phần')).toBeTruthy();
    expect(screen.getByText('820 kcal')).toBeTruthy();
    for (const text of ['Đạm 50 g', 'Carb 100 g', 'Béo 24 g']) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText('1 phần của cơm gà, rau củ. Số liệu ước tính, không phải số đo chính xác.')).toBeTruthy();
    // style first, then what it contains
    expect(screen.getByText('Thành phần & dị ứng')).toBeTruthy();
    expect(screen.getByText('dễ mua ngoài · có gia cầm')).toBeTruthy();
    expect(screen.getByText('Nhãn chỉ giúp nhận biết nhanh. Nếu bạn dị ứng, hãy tự kiểm tra nguyên liệu.')).toBeTruthy();
    view.unmount();
  });

  test('the picture of a meal that has one; an icon, and no image at all, when the key is null', async () => {
    const withPicture = await openMealDetail('LUNCH');
    expect(screen.getByTestId('meal-picture')).toBeTruthy();
    expect(screen.queryByTestId('meal-icon')).toBeNull();
    withPicture.unmount();
    const without = await openMealDetail('SNACK');
    expect(screen.queryByTestId('meal-picture')).toBeNull();
    expect(screen.getByTestId('meal-icon')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Sữa chua và hạt' })).toBeTruthy();
    without.unmount();
  });

  test('before saving: the sentence that a logged meal cannot be removed, the two buttons, no Undo anywhere', async () => {
    const view = await openMealDetail('LUNCH');
    expect(screen.getByText('Bữa đã ghi không xóa được, nên bạn xem lại món trước khi ghi nhận nhé.')).toBeTruthy();
    expect(logButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đổi món khác' })).toBeTruthy();
    noUndo();
    expect(logs()).toEqual([]);
    view.unmount();
  });

  test('a slot without a meal: the empty state with the way to the manual form and to the suggestions', async () => {
    world.plan.planned.DINNER = null;
    const view = await openMealDetail('DINNER');
    expect(screen.getByText('Chưa có món cho bữa này')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Xem gợi ý khác' }));
    expect(await screen.findByRole('header', { name: 'Đổi món bữa tối' })).toBeTruthy();
    await landed();
    view.unmount();
  });
});

describe('S14: recording the meal', () => {
  test('one request with the slot and an id, nothing else; the server\'s total and reward; then "Đã ghi" and no more buttons', async () => {
    const view = await openMealDetail('LUNCH');
    fireEvent.press(logButton());
    // two presses inside one frame are one record
    fireEvent.press(logButton());
    // 1.650 + 820 = 2.470: inside the band, so the server completes the task
    expect(await screen.findByText(/Đã ghi\. Tổng hôm nay: 2\.470 kcal\s+\+50 XP · Bữa ăn theo mục tiêu đã xong/)).toBeTruthy();
    expect(logs()).toHaveLength(1);
    expect(logs()[0].body).toEqual({ mealSlot: 'LUNCH' });
    expect(logs()[0].id).toMatch(UUID_V4);
    await landed();
    expect(screen.getByRole('header', { name: 'Đã ghi' })).toBeTruthy();
    expect(screen.getByText('Bữa trưa · đã ghi')).toBeTruthy();
    expect(screen.queryByRole('button', { name: LOG })).toBeNull();
    // "Đổi món" is gone once logged
    expect(screen.queryByRole('button', { name: 'Đổi món khác' })).toBeNull();
    noUndo();
    view.unmount();
  });

  test('the total shown is the server\'s answer, not the sum on this device', async () => {
    world.answer = (request, init) => {
      if (request !== 'POST /nutrition/log') return undefined;
      world.day = { ...world.day, caloriesIn: 2100 };
      world.plan.logged.LUNCH = true;
      return respond(200, { actionId: init.headers['Idempotency-Key'], day: world.day, delta: { xp: 0, coin: 0, events: [] } });
    };
    const view = await openMealDetail('LUNCH');
    fireEvent.press(logButton());
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.100 kcal')).toBeTruthy();
    expect(screen.queryByText(/2\.470/)).toBeNull();
    // 2.100 is outside the band: no reward is claimed
    expect(screen.queryByText(/Bữa ăn theo mục tiêu đã xong/)).toBeNull();
    await landed();
    view.unmount();
  });

  test('while the answer is awaited the button is busy and the meal still waits to be logged', async () => {
    const answer = hold('POST /nutrition/log');
    const view = await openMealDetail('LUNCH');
    fireEvent.press(logButton());
    await settle();
    expect(logButton().props.accessibilityState.busy).toBe(true);
    expect(screen.queryByRole('header', { name: 'Đã ghi' })).toBeNull();
    expect(screen.queryByText(/Tổng hôm nay/)).toBeNull();
    await act(async () => answer.release());
    expect(await screen.findByText(/^Đã ghi\. Tổng hôm nay/)).toBeTruthy();
    await landed();
    view.unmount();
  });

  test('MEAL_ALREADY_LOGGED (logged from somewhere else): the sentence says so, the plan is read again and shows "Đã ghi"', async () => {
    const view = await openMealDetail('LUNCH');
    world.plan.logged.LUNCH = true;
    const reads = requested('/nutrition/plan');
    fireEvent.press(logButton());
    expect(await screen.findByText('Bữa này đã được ghi từ trước.')).toBeTruthy();
    expect(await screen.findByRole('header', { name: 'Đã ghi' })).toBeTruthy();
    expect(requested('/nutrition/plan')).toBeGreaterThan(reads);
    // nothing was granted
    expect(screen.queryByText(/XP/)).toBeNull();
    await landed();
    view.unmount();
  });

  test('no network: "Đang chờ gửi", kept on this device; no total, no reward, nothing to press again', async () => {
    const view = await openMealDetail('LUNCH');
    offline();
    fireEvent.press(logButton());
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.getByText('Bữa ăn đã lưu trên máy và sẽ được gửi khi có mạng. Tổng hôm nay cập nhật sau đó.')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi\./)).toBeNull();
    expect(screen.queryByText(/XP/)).toBeNull();
    expect(screen.queryByRole('header', { name: 'Đã ghi' })).toBeNull();
    // a second meal for the same slot would be a duplicate
    expect(screen.queryByRole('button', { name: LOG })).toBeNull();
    noUndo();
    view.unmount();
  });

  test('refused by the server (409): the reason beside the button, the meal stays to be logged, and "Thử lại" records it', async () => {
    world.answer = request => (request === 'POST /nutrition/log' ? refuse(409, 'PLAN_NOT_FOUND') : undefined);
    const view = await openMealDetail('LUNCH');
    fireEvent.press(logButton());
    expect(await screen.findByText('Chưa ghi được bữa ăn. Thực đơn của ngày đó chưa sẵn sàng.')).toBeTruthy();
    expect(screen.queryByText(/Tổng hôm nay/)).toBeNull();
    expect(screen.queryByRole('header', { name: 'Đã ghi' })).toBeNull();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(/^Đã ghi\. Tổng hôm nay/)).toBeTruthy();
    // the refused record is over: the new try is a new record, with a new id
    expect(logs()).toHaveLength(2);
    expect(logs()[1].id).not.toBe(logs()[0].id);
    expect(logs()[1].body).toEqual(logs()[0].body);
    await landed();
    view.unmount();
  });

  test('a 500 is kept on the device like a lost connection: "Đang chờ gửi", no reward', async () => {
    world.answer = request => (request === 'POST /nutrition/log' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openMealDetail('LUNCH');
    fireEvent.press(logButton());
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.queryByText(/XP/)).toBeNull();
    view.unmount();
  });

  test('a slot already logged when the screen opens: "Đã ghi" at once, no buttons to log or swap', async () => {
    world.plan.logged.LUNCH = true;
    const view = await openMealDetail('LUNCH');
    expect(screen.getByRole('header', { name: 'Đã ghi' })).toBeTruthy();
    expect(screen.getByText('Món này đã nằm trong tổng hôm nay.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: LOG })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đổi món khác' })).toBeNull();
    view.unmount();
  });

  test('the logged state reaches the plan too (its cache was updated, not only this screen)', async () => {
    const view = await openMealDetail('LUNCH');
    fireEvent.press(logButton());
    await screen.findByText(/^Đã ghi\. Tổng hôm nay/);
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('button', { name: 'Bữa trưa. Cơm gà, rau củ · 820 kcal · đã ghi' })).toBeTruthy();
    expect(screen.getByText('Đã ăn 2.470 / 2.394 kcal')).toBeTruthy();
    expect(queryClient().getQueryState(['mealPlan'])).toBeDefined();
    view.unmount();
  });
});
