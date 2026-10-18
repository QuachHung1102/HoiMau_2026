import { fireEvent, screen, within } from '@testing-library/react-native';
import type { MealPlanState } from '../../../domain/contract/content.ts';
import { INGREDIENT_TAGS } from '../../../domain/types.ts';
import * as vi from '../../shared/i18n/vi/nutrition';
import { act, fetchMock, hold, installTodayTestEnv, landed, mealByCode, noUndo, openMealDetail, openMealSwap, queryClient, refuse, requested, settle, swaps, world } from './mealTestKit';

installTodayTestEnv();

const CHOOSE = 'Chọn món này';
const chooseButton = () => screen.getByRole('button', { name: CHOOSE });
const option = (name: RegExp | string) => screen.getByRole('radio', { name });
const candidateReads = () => fetchMock.mock.calls.filter(([url]) => url.includes('/nutrition/swap-candidates')).length;
const patches = () => fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH').map(([, init]) => ({ key: init.headers['Idempotency-Key'], body: JSON.parse(init.body ?? 'null') }));
const field = () => screen.getByRole('button', { name: /^Loại trừ nguyên liệu\./ });

describe('S15: choosing among the suggestions', () => {
  test('the swaps left, the three suggestions with their kcal against the planned meal, and a button that waits for a choice', async () => {
    const view = await openMealSwap('LUNCH');
    expect(screen.getByRole('header', { name: 'Đổi món bữa trưa' })).toBeTruthy();
    expect(screen.getByText('Chọn một gợi ý khác phù hợp với bạn.')).toBeTruthy();
    expect(screen.getByText('Còn 3 lượt đổi cho bữa trưa hôm nay')).toBeTruthy();
    expect(screen.getByText('Loại trừ nguyên liệu')).toBeTruthy();
    expect(screen.getByText('Chọn thực phẩm cần tránh')).toBeTruthy();
    const rows = within(screen.getByLabelText('Gợi ý thay thế')).getAllByRole('radio');
    expect(rows).toHaveLength(3);
    // frame S15: 790, 760 and 745 against the planned 820; tags in words
    for (const [name, line] of [
      ['Cơm cá và rau luộc', '790 kcal · ít hơn 30 kcal · có hải sản'],
      ['Bún gà rau thơm', '760 kcal · ít hơn 60 kcal · dễ mua ngoài · có gia cầm'],
      ['Đậu hũ, cơm và nấm', '745 kcal · ít hơn 75 kcal · không thịt · có đậu nành'],
    ]) {
      expect(within(option(new RegExp(name))).getByText(line)).toBeTruthy();
    }
    expect(screen.getByText('Chọn món thay thế để xem thay đổi năng lượng trước khi xác nhận.')).toBeTruthy();
    // nothing chosen: the button is off; choosing one turns it on and marks the row (a dot, not colour alone)
    expect(chooseButton().props.accessibilityState.disabled).toBe(true);
    fireEvent.press(option(/Bún gà rau thơm/));
    expect(chooseButton().props.accessibilityState.disabled).toBe(false);
    expect(option(/Bún gà rau thơm/).props.accessibilityState.checked).toBe(true);
    expect(option(/Cơm cá và rau luộc/).props.accessibilityState.checked).toBe(false);
    expect(within(option(/Bún gà rau thơm/)).getByTestId('radio-dot')).toBeTruthy();
    noUndo();
    view.unmount();
  });

  test('choosing sends the slot and the meal once; the new meal is shown on the meal screen; one swap fewer is left', async () => {
    const view = await openMealSwap('LUNCH');
    fireEvent.press(option(/Bún gà rau thơm/));
    fireEvent.press(chooseButton());
    expect(await screen.findByRole('header', { name: 'Bún gà rau thơm' })).toBeTruthy();
    expect(swaps()).toHaveLength(1);
    expect(swaps()[0].body).toEqual({ mealSlot: 'LUNCH', mealId: mealByCode('BUN_GA').id });
    expect(swaps()[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await landed();
    expect(screen.getByText('760 kcal')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Cơm gà, rau củ' })).toBeNull();
    // the plan behind it holds the new meal too
    fireEvent.press(screen.getByRole('button', { name: 'Đổi món khác' }));
    expect(await screen.findByText('Còn 2 lượt đổi cho bữa trưa hôm nay')).toBeTruthy();
    await landed();
    // the list is read anew: the meal just chosen, and the one it replaced, are not offered
    expect(screen.queryByRole('radio', { name: /Bún gà rau thơm/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Cơm gà, rau củ/ })).toBeNull();
    view.unmount();
  });

  test('while the answer is awaited the old meal stays and the button is busy; the rows cannot be changed', async () => {
    const answer = hold('POST /nutrition/swap');
    const view = await openMealSwap('LUNCH');
    fireEvent.press(option(/Cơm cá và rau luộc/));
    fireEvent.press(chooseButton());
    await settle();
    expect(chooseButton().props.accessibilityState.busy).toBe(true);
    expect(option(/Bún gà rau thơm/).props.accessibilityState.disabled).toBe(true);
    // the plan (which the meal screen under this one shows) still holds the old meal
    const held = queryClient().getQueryData<MealPlanState>(['mealPlan']);
    expect(held?.slots[1].meal?.id).toBe(mealByCode('COM_GA').id);
    // a second press while it is out is the same request
    fireEvent.press(chooseButton());
    await act(async () => answer.release());
    expect(await screen.findByRole('header', { name: 'Cơm cá và rau luộc' })).toBeTruthy();
    expect(swaps()).toHaveLength(1);
    await landed();
    view.unmount();
  });

  test('SWAP_CANDIDATE_INVALID: the old meal stays, the list is read again, the choice is cleared and the reason is said', async () => {
    const view = await openMealSwap('LUNCH');
    // another device swapped meanwhile: the three offered are not the three the server ranks now
    world.plan.shown.LUNCH = [...world.plan.shown.LUNCH, mealByCode('COM_CA').id];
    const reads = candidateReads();
    fireEvent.press(option(/Cơm cá và rau luộc/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText('Gợi ý vừa thay đổi. Bạn chọn lại từ danh sách mới nhé.')).toBeTruthy();
    await landed();
    expect(candidateReads()).toBeGreaterThan(reads);
    expect(screen.queryByRole('radio', { name: /Cơm cá và rau luộc/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Bún gà rau thơm/ })).toBeTruthy();
    expect(chooseButton().props.accessibilityState.disabled).toBe(true);
    // the plan was not touched
    expect(world.plan.planned.LUNCH).toBe(mealByCode('COM_GA').id);
    expect(world.plan.used.LUNCH).toBe(0);
    view.unmount();
  });

  test('SWAP_CANDIDATE_INVALID: the choice is cleared at once, not only when the new list lands (the button cannot send the stale choice again)', async () => {
    const view = await openMealSwap('LUNCH');
    world.plan.shown.LUNCH = [...world.plan.shown.LUNCH, mealByCode('COM_CA').id];
    const reread = hold('GET /nutrition/swap-candidates?mealSlot=LUNCH');
    fireEvent.press(option(/Cơm cá và rau luộc/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText('Gợi ý vừa thay đổi. Bạn chọn lại từ danh sách mới nhé.')).toBeTruthy();
    // the list on screen is still the old one, with the refused meal in it
    expect(option(/Cơm cá và rau luộc/).props.accessibilityState.checked).toBe(false);
    expect(chooseButton().props.accessibilityState.disabled).toBe(true);
    await act(async () => reread.release());
    await landed();
    expect(swaps()).toHaveLength(1);
    view.unmount();
  });

  test('409 DAY_CLOSED on a choice: the day-turned words (no "Thử lại": it would meet the same answer), the plan is read again, the old meal stays', async () => {
    const view = await openMealSwap('LUNCH');
    world.closedDate = world.day.logicalDate;
    const reads = requested('/nutrition/plan');
    fireEvent.press(option(/Cơm cá và rau luộc/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText('Ngày mới vừa bắt đầu nên thực đơn đang được làm mới. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText(/^Chưa đổi được món/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    await landed();
    expect(requested('/nutrition/plan')).toBeGreaterThan(reads);
    expect(chooseButton().props.accessibilityState.disabled).toBe(true);
    expect(swaps()).toHaveLength(1);
    expect(world.plan.planned.LUNCH).toBe(mealByCode('COM_GA').id);
    view.unmount();
  });

  test('a request the server answered (even with a 500) is over: "Thử lại" sends a NEW request id; after a lost connection it repeats the old one', async () => {
    const view = await openMealSwap('LUNCH');
    world.answer = request => (request === 'POST /nutrition/swap' ? refuse(500, 'INTERNAL') : undefined);
    fireEvent.press(option(/Bún gà rau thơm/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText(/^Chưa đổi được món\./)).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Bún gà rau thơm' })).toBeTruthy();
    const sent = swaps();
    expect(sent).toHaveLength(2);
    expect(sent[1].id).not.toBe(sent[0].id);
    expect(sent[1].body).toEqual(sent[0].body);
    await landed();
    view.unmount();
  });

  test('a lost connection: the reason and "Thử lại" beside the button, the old meal kept; the retry repeats the same request id', async () => {
    const view = await openMealSwap('LUNCH');
    world.answer = request => {
      if (request === 'POST /nutrition/swap') throw new TypeError('Network request failed');
      return undefined;
    };
    fireEvent.press(option(/Bún gà rau thơm/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText(/^Chưa đổi được món\. Không kết nối được mạng\./)).toBeTruthy();
    expect(screen.getByText(/Món cũ vẫn được giữ\.$/)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Đổi món bữa trưa' })).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Bún gà rau thơm' })).toBeTruthy();
    const sent = swaps();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sent.map(request => request.id)).size).toBe(1);
    await landed();
    view.unmount();
  });
});

describe('S59: no swap left', () => {
  test('explained without blame; the manual form and the perks are the ways on; no suggestion rows, no choose button', async () => {
    world.plan.used.LUNCH = 3;
    const view = await openMealSwap('LUNCH');
    expect(screen.getByText('Đã dùng 3/3 lượt đổi cho bữa trưa')).toBeTruthy();
    expect(screen.getByText('Bữa trưa đã đổi đủ lượt hôm nay. Ngày mai thực đơn sẽ có gợi ý mới.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: CHOOSE })).toBeNull();
    expect(screen.queryByText(/Còn \d lượt đổi/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Ghi món ngoài thực đơn' }));
    expect(await screen.findByRole('header', { name: 'Ghi bữa ăn' })).toBeTruthy();
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    fireEvent.press(await screen.findByRole('button', { name: /^Xem tiện ích\. Tiện ích cấp độ/ }));
    expect(await screen.findByRole('header', { name: 'Cấp độ & tiện ích' })).toBeTruthy();
    await landed();
    view.unmount();
  });

  test('with the perk the limit is 5: "Đã dùng 5/5"', async () => {
    world.plan.allowed = 5;
    world.plan.used.LUNCH = 5;
    const view = await openMealSwap('LUNCH');
    expect(screen.getByText('Đã dùng 5/5 lượt đổi cho bữa trưa')).toBeTruthy();
    view.unmount();
  });

  test('409 SWAP_LIMIT_REACHED from the server (swapped elsewhere meanwhile) leads to the same state; the old meal stays', async () => {
    const view = await openMealSwap('LUNCH');
    world.plan.used.LUNCH = 3;
    fireEvent.press(option(/Cơm cá và rau luộc/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText('Bữa trưa đã đổi đủ lượt hôm nay. Ngày mai thực đơn sẽ có gợi ý mới.')).toBeTruthy();
    await landed();
    expect(screen.getByText('Đã dùng 3/3 lượt đổi cho bữa trưa')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(world.plan.planned.LUNCH).toBe(mealByCode('COM_GA').id);
    view.unmount();
  });

  test('a slot that was logged (candidates look the same: none, 0 left) gets its own sentence, not the limit', async () => {
    const view = await openMealDetail('LUNCH');
    world.plan.logged.LUNCH = true;
    // the detail screen has not heard yet: it offers the swap; the server's candidates say 0
    fireEvent.press(screen.getByRole('button', { name: 'Đổi món khác' }));
    expect(await screen.findByText('Bữa trưa đã được ghi nên không đổi món được nữa.')).toBeTruthy();
    expect(screen.queryByText(/đổi đủ lượt/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ghi món ngoài thực đơn' })).toBeNull();
    await landed();
    view.unmount();
  });

  test('MEAL_ALREADY_LOGGED on a choice: said, the plan is read again, and the slot is shown as logged (not as the limit)', async () => {
    const view = await openMealSwap('LUNCH');
    world.plan.logged.LUNCH = true;
    fireEvent.press(option(/Cơm cá và rau luộc/));
    fireEvent.press(chooseButton());
    expect(await screen.findByText('Bữa trưa đã được ghi nên không đổi món được nữa.')).toBeTruthy();
    expect(screen.queryByText(/đổi đủ lượt/)).toBeNull();
    await landed();
    view.unmount();
  });
});

describe('S15: ingredients to avoid', () => {
  test('the sheet lists the eight tags; saving sends the chosen ones, then the suggestions are read again and leave those meals out', async () => {
    const view = await openMealSwap('LUNCH');
    fireEvent.press(field());
    expect(await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' })).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map(box => box.props.accessibilityState.checked)).toEqual(Array(8).fill(false));
    for (const label of ['Thịt đỏ', 'Gia cầm', 'Hải sản', 'Trứng', 'Sữa', 'Đậu phộng', 'Gluten', 'Đậu nành']) expect(screen.getByRole('checkbox', { name: label })).toBeTruthy();
    expect(screen.getByText('Áp dụng cho các gợi ý mới. Món đã có trong thực đơn hôm nay giữ nguyên.')).toBeTruthy();
    // chosen in a different order than the tags are listed: sent in the order of the list
    fireEvent.press(screen.getByRole('checkbox', { name: 'Hải sản' }));
    fireEvent.press(screen.getByRole('checkbox', { name: 'Gia cầm' }));
    expect(screen.getByRole('checkbox', { name: 'Hải sản' }).props.accessibilityState.checked).toBe(true);
    const reads = candidateReads();
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await waitForText('Đang tránh: Gia cầm, Hải sản');
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toEqual({ excludedMealTags: ['co:gia-cam', 'co:hai-san'] });
    expect(screen.queryByRole('header', { name: 'Nguyên liệu cần tránh' })).toBeNull();
    await landed();
    expect(candidateReads()).toBeGreaterThan(reads);
    // fish and chicken leave; tofu and the pork rice remain, the latter with MORE kcal than the planned meal
    expect(screen.queryByRole('radio', { name: /Cơm cá và rau luộc/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Bún gà rau thơm/ })).toBeNull();
    expect(within(option(/Đậu hũ, cơm và nấm/)).getByText('745 kcal · ít hơn 75 kcal · không thịt · có đậu nành')).toBeTruthy();
    expect(within(option(/Cơm tấm sườn/)).getByText('900 kcal · nhiều hơn 80 kcal · dễ mua ngoài · có thịt đỏ')).toBeTruthy();
    // the planned meals stay (the note says so)
    expect(world.plan.planned.LUNCH).toBe(mealByCode('COM_GA').id);
    view.unmount();
  });

  test('the sheet starts from what is saved, and unchecking sends the shorter list', async () => {
    world.settings = { ...world.settings, excludedMealTags: ['co:trung', 'co:sua'] };
    const view = await openMealSwap('LUNCH');
    expect(screen.getByText('Đang tránh: Trứng, Sữa')).toBeTruthy();
    fireEvent.press(field());
    await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' });
    expect(screen.getByRole('checkbox', { name: 'Sữa' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Trứng' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Hải sản' }).props.accessibilityState.checked).toBe(false);
    fireEvent.press(screen.getByRole('checkbox', { name: 'Sữa' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await waitForText('Đang tránh: Trứng');
    expect(patches()[0].body).toEqual({ excludedMealTags: ['co:trung'] });
    await landed();
    view.unmount();
  });

  test('closing the sheet without saving sends nothing; a refused save keeps the sheet open with the reason and its choices', async () => {
    const view = await openMealSwap('LUNCH');
    fireEvent.press(field());
    await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' });
    fireEvent.press(screen.getByRole('checkbox', { name: 'Hải sản' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('header', { name: 'Nguyên liệu cần tránh' })).toBeNull();
    expect(patches()).toEqual([]);
    expect(screen.getByText('Chọn thực phẩm cần tránh')).toBeTruthy();

    world.answer = request => (request === 'PATCH /settings' ? refuse(500, 'INTERNAL') : undefined);
    fireEvent.press(field());
    await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' });
    expect(screen.getByRole('checkbox', { name: 'Hải sản' }).props.accessibilityState.checked).toBe(false);
    fireEvent.press(screen.getByRole('checkbox', { name: 'Hải sản' }));
    const reads = candidateReads();
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Chưa lưu được nguyên liệu cần tránh. Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Hải sản' }).props.accessibilityState.checked).toBe(true);
    expect(candidateReads()).toBe(reads);
    expect(world.settings.excludedMealTags).toEqual([]);
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await waitForText('Đang tránh: Hải sản');
    await landed();
    view.unmount();
  });

  test('a save the server refused (a 500), tried again, is a new request id', async () => {
    const view = await openMealSwap('LUNCH');
    world.answer = request => (request === 'PATCH /settings' ? refuse(500, 'INTERNAL') : undefined);
    fireEvent.press(field());
    await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' });
    fireEvent.press(screen.getByRole('checkbox', { name: 'Hải sản' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByText(/^Chưa lưu được nguyên liệu cần tránh\./);
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await waitForText('Đang tránh: Hải sản');
    await landed();
    expect(patches()).toHaveLength(2);
    expect(patches()[1].key).not.toBe(patches()[0].key);
    expect(patches()[1].body).toEqual(patches()[0].body);
    view.unmount();
  });

  test('a lost connection on the save: "Thử lại" repeats the same request id (the server may have it already)', async () => {
    const view = await openMealSwap('LUNCH');
    world.answer = request => {
      if (request === 'PATCH /settings') throw new TypeError('Network request failed');
      return undefined;
    };
    fireEvent.press(field());
    await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' });
    fireEvent.press(screen.getByRole('checkbox', { name: 'Hải sản' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/^Chưa lưu được nguyên liệu cần tránh\. Không kết nối được mạng\./)).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await waitForText('Đang tránh: Hải sản');
    const sent = patches();
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sent.map(patch => patch.key)).size).toBe(1);
    await landed();
    view.unmount();
  });

  test('the settings are still loading: the field is off until they have answered (saving from an empty list would erase what is saved)', async () => {
    const answer = hold('GET /settings');
    const view = await openMealSwap('LUNCH');
    expect(field().props.accessibilityState.disabled).toBe(true);
    // not an error: no message, no retry
    expect(screen.queryByText('Chưa tải được nguyên liệu đang tránh.')).toBeNull();
    await act(async () => answer.release());
    await landed();
    expect(field().props.accessibilityState.disabled).toBeFalsy();
    view.unmount();
  });

  test('the settings cannot be read: the field is off (saving from an empty list would erase what is saved) and says why', async () => {
    world.answer = request => (request === 'GET /settings' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openMealSwap('LUNCH');
    expect(screen.getByText('Chưa tải được nguyên liệu đang tránh.')).toBeTruthy();
    expect(field().props.accessibilityState.disabled).toBe(true);
    view.unmount();
  });
});

describe('S15: no suggestion although swaps remain', () => {
  test('with ingredients excluded: the empty state and "Bỏ bớt nguyên liệu loại trừ", which opens the sheet', async () => {
    world.settings = { ...world.settings, excludedMealTags: [...INGREDIENT_TAGS] };
    const view = await openMealSwap('LUNCH');
    expect(screen.getByText('Chưa có món phù hợp hơn')).toBeTruthy();
    expect(screen.getByText('Hiện chưa có món nào khác hợp với bữa này. Bạn có thể thử bỏ bớt nguyên liệu loại trừ.')).toBeTruthy();
    expect(screen.getByText('Còn 3 lượt đổi cho bữa trưa hôm nay')).toBeTruthy();
    expect(screen.queryByRole('button', { name: CHOOSE })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Bỏ bớt nguyên liệu loại trừ' }));
    expect(await screen.findByRole('header', { name: 'Nguyên liệu cần tránh' })).toBeTruthy();
    expect(screen.getAllByRole('checkbox').every(box => box.props.accessibilityState.checked)).toBe(true);
    view.unmount();
  });

  test('with nothing excluded there is nothing to loosen: the empty state has no such button', async () => {
    world.plan.shown.LUNCH = ['COM_CA', 'BUN_GA', 'DAU_HU_NAM', 'COM_TAM'].map(code => mealByCode(code).id);
    const view = await openMealSwap('LUNCH');
    expect(screen.getByText('Chưa có món phù hợp hơn')).toBeTruthy();
    expect(screen.getByText('Hiện chưa có món nào khác hợp với bữa này.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bỏ bớt nguyên liệu loại trừ' })).toBeNull();
    view.unmount();
  });
});

describe('S15: when the suggestions cannot be read', () => {
  test('the error state with "Thử lại"', async () => {
    world.answer = request => (request.startsWith('GET /nutrition/swap-candidates') ? refuse(500, 'INTERNAL') : undefined);
    const view = await openMealDetail('LUNCH');
    fireEvent.press(screen.getByRole('button', { name: 'Đổi món khác' }));
    await screen.findByRole('header', { name: 'Đổi món bữa trưa' });
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Còn 3 lượt đổi cho bữa trưa hôm nay')).toBeTruthy();
    await landed();
    view.unmount();
  });

  test('409 DAY_CLOSED is read once more by itself', async () => {
    let asked = 0;
    world.answer = request => {
      if (!request.startsWith('GET /nutrition/swap-candidates')) return undefined;
      asked += 1;
      return asked === 1 ? refuse(409, 'DAY_CLOSED') : undefined;
    };
    const view = await openMealDetail('LUNCH');
    fireEvent.press(screen.getByRole('button', { name: 'Đổi món khác' }));
    expect(await screen.findByText('Còn 3 lượt đổi cho bữa trưa hôm nay')).toBeTruthy();
    expect(asked).toBe(2);
    await landed();
    view.unmount();
  });
});

describe('copy', () => {
  test('the kcal delta: fewer, equal (after rounding) and more', () => {
    expect(vi.deltaText(-30)).toBe('ít hơn 30 kcal');
    expect(vi.deltaText(0)).toBe('bằng món hiện tại');
    expect(vi.deltaText(0.4)).toBe('bằng món hiện tại');
    expect(vi.deltaText(-0.4)).toBe('bằng món hiện tại');
    expect(vi.deltaText(80)).toBe('nhiều hơn 80 kcal');
    expect(vi.deltaText(1250)).toBe('nhiều hơn 1.250 kcal');
    // unrounded from the server, rounded for display
    expect(vi.deltaText(-29.6)).toBe('ít hơn 30 kcal');
    expect(vi.candidateLine(790, 0, '')).toBe('790 kcal · bằng món hiện tại');
  });

  test('the sentences the brief fixes, word for word', () => {
    expect(vi.swapsLeft(2, 'LUNCH')).toBe('Còn 2 lượt đổi cho bữa trưa hôm nay');
    expect(vi.macroWarning).toBe('Món gần nhất hiện có, lệch so với mục tiêu của bữa');
    expect(vi.noCandidateTitle).toBe('Chưa có món phù hợp hơn');
    expect(vi.loosen).toBe('Bỏ bớt nguyên liệu loại trừ');
    expect(vi.logOutside).toBe('Ghi món ngoài thực đơn');
    expect(vi.seePerks).toBe('Xem tiện ích');
    expect(vi.eaten(1650, 2394)).toBe('Đã ăn 1.650 / 2.394 kcal');
    expect(vi.windowLine(2154, 2633)).toBe('Việc chính hoàn thành khi tổng cả ngày trong 2.154–2.633 kcal');
    expect(vi.slotLine('Yến mạch và trái cây', 540, 'logged')).toBe('Yến mạch và trái cây · 540 kcal · đã ghi');
    expect(vi.slotLine('Cá áp chảo, cơm và rau', 720, 'open')).toBe('Cá áp chảo, cơm và rau · gợi ý khoảng 720 kcal');
    expect(Object.keys(vi.tagLabel)).toEqual([...INGREDIENT_TAGS]);
  });
});

async function waitForText(text: string) {
  expect(await screen.findByText(text)).toBeTruthy();
}
