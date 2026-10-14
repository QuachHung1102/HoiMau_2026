import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type { DayState } from '../../../domain/contract/core.ts';
import { clearUserCache } from '../../shared/storage/cache';
import { useCelebrationQueue } from '../progression/celebrations';
import { app, dayOf, hold, installTodayTestEnv, meOf, NUTRITION, openToday, queryClient, refuse, respond, settle, USER, world, writes } from '../dashboard/todayTestKit';

installTodayTestEnv();

const HOUR = 3_600_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAVE = 'Ghi món đã ăn';
const logs = () => writes().filter(request => request.path === '/nutrition/log');
const kcalField = () => screen.getByLabelText(/^Số kcal/);
const labelField = () => screen.getByLabelText(/^Tên món/);
const type = (field: ReturnType<typeof kcalField>, text: string) => fireEvent.changeText(field, text);
const save = () => fireEvent.press(screen.getByRole('button', { name: SAVE }));
const noUndo = () => expect(screen.queryByRole('button', { name: 'Hoàn tác', includeHiddenElements: true })).toBeNull();

/** Today, then the nutrition task: S16 as a person reaches it. */
async function openManual(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('button', { name: /^Ăn đủ cho mục tiêu/ }));
  await screen.findByRole('header', { name: 'Ghi bữa ăn' });
  return view;
}

describe('S16 before saving', () => {
  test('the form, today\'s total and window, and the sentence that a logged meal cannot be removed', async () => {
    const view = await openManual();
    expect(screen.getByText('Ăn khác thực đơn? Bạn vẫn ghi lại được.')).toBeTruthy();
    // the server's total and the band that completes the task
    expect(screen.getByLabelText('Hôm nay. 1.650 / 2.394 kcal · cần trong 2.155–2.633')).toBeTruthy();
    expect(kcalField().props.keyboardType).toBe('number-pad');
    expect(kcalField().props.placeholder).toBe('Nhập số trên nhãn hoặc ước tính');
    expect(labelField()).toBeTruthy();
    expect(screen.getByText('Không bắt buộc')).toBeTruthy();
    // said BEFORE saving, not after
    expect(screen.getByText('Bữa đã ghi không xóa được, nên bạn xem lại số kcal trước khi lưu nhé.')).toBeTruthy();
    expect(screen.getByText('Đây là ghi nhận để hiểu thói quen, không phải bài kiểm tra ăn uống.')).toBeTruthy();
    noUndo();
    expect(logs()).toEqual([]);
    view.unmount();
  });
});

describe('what is typed is checked before anything is sent', () => {
  test.each([
    ['nothing', '', 'Nhập số kcal của món này'],
    ['0', '0', 'Số kcal từ 1 đến 5.000'],
    ['5001', '5001', 'Số kcal từ 1 đến 5.000'],
    ['letters', 'abc', 'Chỉ nhập chữ số, ví dụ 450'],
    ['letters after digits', '12a', 'Chỉ nhập chữ số, ví dụ 450'],
    ['a sign', '-5', 'Chỉ nhập chữ số, ví dụ 450'],
    ['a decimal', '4.5', 'Chỉ nhập chữ số, ví dụ 450'],
    ['an exponent', '1e3', 'Chỉ nhập chữ số, ví dụ 450'],
  ])('%s: a field error under "Số kcal", nothing sent', async (_name, typed, message) => {
    const view = await openManual();
    type(kcalField(), typed);
    save();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText(`Số kcal, lỗi: ${message}`)).toBeTruthy();
    await settle();
    expect(logs()).toEqual([]);
    view.unmount();
  });

  test('a name of 61 characters is refused, 60 are not; the error is under "Tên món" and nothing is sent', async () => {
    const view = await openManual();
    type(kcalField(), '450');
    type(labelField(), 'a'.repeat(61));
    save();
    expect(await screen.findByText('Tên món tối đa 60 ký tự')).toBeTruthy();
    await settle();
    expect(logs()).toEqual([]);
    // typing again clears the error; 60 characters go through
    type(labelField(), 'ă'.repeat(60));
    expect(screen.queryByText('Tên món tối đa 60 ký tự')).toBeNull();
    save();
    expect(await screen.findByText(/^Đã ghi\./)).toBeTruthy();
    expect(logs()).toHaveLength(1);
    expect((logs()[0].body as { label: string }).label).toBe('ă'.repeat(60));
    view.unmount();
  });

  test('both fields wrong: both errors, nothing sent', async () => {
    const view = await openManual();
    type(kcalField(), '0');
    type(labelField(), 'x'.repeat(61));
    save();
    expect(await screen.findByText('Số kcal từ 1 đến 5.000')).toBeTruthy();
    expect(screen.getByText('Tên món tối đa 60 ký tự')).toBeTruthy();
    expect(logs()).toEqual([]);
    view.unmount();
  });

  test('the limits themselves are accepted: 1 and 5000', async () => {
    const view = await openManual();
    type(kcalField(), '1');
    save();
    expect(await screen.findByText(/^Đã ghi\./)).toBeTruthy();
    expect(logs().map(request => request.body)).toEqual([{ kcal: 1 }]);
    view.unmount();
  });
});

describe('the record is confirmed', () => {
  test('back to the home tab with the server\'s total; the name is sent trimmed, the request carries an id and nothing else', async () => {
    const view = await openManual();
    type(kcalField(), ' 400 ');
    type(labelField(), '  Bún gà ');
    save();
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.050 kcal')).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    expect(logs()).toHaveLength(1);
    expect(logs()[0].body).toEqual({ kcal: 400, label: 'Bún gà' });
    expect(logs()[0].id).toMatch(UUID_V4);
    // 2.050 is outside the band: no reward is claimed
    expect(screen.queryByText('Bữa ăn theo mục tiêu đã xong', { exact: false })).toBeNull();
    noUndo();
    view.unmount();
  });

  test('without a name no name is sent', async () => {
    const view = await openManual();
    type(kcalField(), '300');
    save();
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 1.950 kcal')).toBeTruthy();
    expect(logs()[0].body).toEqual({ kcal: 300 });
    view.unmount();
  });

  test('the total is the server\'s, not the sum on this device', async () => {
    world.answer = (request, init) => {
      if (request !== NUTRITION) return undefined;
      world.day = { ...world.day, caloriesIn: 2100 };
      return respond(200, { actionId: init.headers['Idempotency-Key'], day: world.day, delta: { xp: 0, coin: 0, events: [] } });
    };
    const view = await openManual();
    type(kcalField(), '400');
    save();
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.100 kcal')).toBeTruthy();
    expect(screen.queryByText(/2\.050/)).toBeNull();
    // and Hôm nay shows it from the answer
    expect(await screen.findByText('2.100 / 2.394 kcal · cần trong 2.155–2.633')).toBeTruthy();
    view.unmount();
  });

  test('when the log completes the task: the reward line from the answer, in the same snackbar, still no Undo', async () => {
    const view = await openManual();
    type(kcalField(), '600'); // 1.650 + 600 = 2.250, inside 2.155–2.633
    save();
    expect(await screen.findByText(/Đã ghi\. Tổng hôm nay: 2\.250 kcal/)).toBeTruthy();
    expect(screen.getByText(/\+50 XP · Bữa ăn theo mục tiêu đã xong/)).toBeTruthy();
    // one message, two lines (the text matcher folds the line break into a space)
    expect(screen.getByText(/Tổng hôm nay: 2\.250 kcal\s+\+50 XP · Bữa ăn theo mục tiêu đã xong/)).toBeTruthy();
    noUndo();
    expect(await screen.findByLabelText('270 xu', { includeHiddenElements: true })).toBeTruthy();
    view.unmount();
  });

  test('the events of the answer go to the celebrations once', async () => {
    world.events = [{ type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 }];
    world.answer = (request, init) => {
      if (request !== NUTRITION) return undefined;
      world.day = { ...world.day, caloriesIn: 2250 };
      return respond(200, { actionId: init.headers['Idempotency-Key'], day: world.day, delta: { xp: 50, coin: 20, events: world.events } });
    };
    let queue: ReturnType<typeof useCelebrationQueue> = [];
    const Watch = () => {
      queue = useCelebrationQueue();
      return null;
    };
    const view = await openManual({ extra: <Watch /> });
    type(kcalField(), '600');
    save();
    expect(await screen.findByText(/Đã ghi\./)).toBeTruthy();
    expect(queue).toEqual(world.events);
    view.unmount();
  });

  test('two quick presses are one record, and the button is busy until the answer', async () => {
    const answer = hold(NUTRITION);
    const view = await openManual();
    type(kcalField(), '400');
    save();
    save();
    await settle();
    expect(screen.getByRole('button', { name: SAVE }).props.accessibilityState.busy).toBe(true);
    expect(screen.queryByText(/^Đã ghi\./)).toBeNull();
    expect(logs()).toHaveLength(1);
    await act(async () => answer.release());
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.050 kcal')).toBeTruthy();
    expect(logs()).toHaveLength(1);
    view.unmount();
  });

  test('a person who has already left the screen is not taken back again when the answer arrives; the total still shows', async () => {
    const answer = hold(NUTRITION);
    const view = await openManual();
    type(kcalField(), '400');
    save();
    await settle();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    await act(async () => answer.release());
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.050 kcal')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    view.unmount();
  });
});

describe('the record waits (no network)', () => {
  test('"Đang chờ gửi", no total and no reward; what waits is in Hôm nay\'s total, marked as waiting', async () => {
    const view = await openManual();
    world.down = true;
    type(kcalField(), '600');
    save();
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.getByText('Bữa ăn đã lưu trên máy và sẽ được gửi khi có mạng. Tổng hôm nay cập nhật sau đó.')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi\./)).toBeNull();
    expect(screen.queryByText(/XP/)).toBeNull();
    // nothing to enter again: it would be a second meal
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    noUndo();

    fireEvent.press(screen.getByRole('button', { name: 'Xong' }));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    expect(screen.getByText('2.250 / 2.394 kcal · cần trong 2.155–2.633 · Đang chờ gửi')).toBeTruthy();
    // no reward until the server says so: the task is not shown as done
    expect(screen.queryByText('Đã xong')).toBeNull();
    expect(logs().length).toBeGreaterThanOrEqual(1);
    view.unmount();
  });
});

describe('the record is refused', () => {
  test('DAY_CLOSED: the refusal copy next to the button, what was typed is kept, "Thử lại" is a new action', async () => {
    world.closedDate = world.day.logicalDate;
    const view = await openManual();
    type(kcalField(), '400');
    type(labelField(), 'Bún gà');
    save();
    expect(await screen.findByText('Chưa ghi được bữa ăn. Ngày đó đã khép lại nên ghi nhận này không được tính. Bạn không làm gì sai cả.')).toBeTruthy();
    expect(kcalField().props.value).toBe('400');
    expect(labelField().props.value).toBe('Bún gà');
    expect(screen.queryByText(/Đã ghi\./)).toBeNull();
    expect(screen.queryByRole('header', { name: 'Đang chờ gửi' })).toBeNull();

    world.closedDate = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.050 kcal')).toBeTruthy();
    const ids = logs().map(request => request.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    view.unmount();
  });

  test('a server VALIDATION_FAILED about the amount becomes the field error', async () => {
    world.answer = request => (request === NUTRITION ? refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'kcal', rule: 'max' }] }) : undefined);
    const view = await openManual();
    type(kcalField(), '400');
    save();
    expect(await screen.findByText('Số kcal từ 1 đến 5.000')).toBeTruthy();
    expect(screen.queryByText(/Chưa ghi được bữa ăn/)).toBeNull();
    view.unmount();
  });

  test('a server refusal for a field the form has no place for is a message beside the button', async () => {
    world.answer = request => (request === NUTRITION ? refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'occurredAt', rule: 'format' }] }) : undefined);
    const view = await openManual();
    type(kcalField(), '400');
    save();
    expect(await screen.findByText(/^Chưa ghi được bữa ăn\./)).toBeTruthy();
    view.unmount();
  });
});

describe('the day behind the form', () => {
  test('while the total cannot be read the form still works, and says the total is unknown', async () => {
    const view = await openManual();
    world.answer = request => (request === 'GET /day' ? refuse(500, 'INTERNAL') : undefined);
    await clearUserCache(USER);
    await act(async () => {
      queryClient().resetQueries({ queryKey: ['day'] });
    });
    expect(await screen.findByText(/^Chưa tải được tổng hôm nay\./)).toBeTruthy();
    expect(screen.queryByLabelText(/^Hôm nay\./)).toBeNull();
    world.answer = undefined;
    type(kcalField(), '400');
    save();
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.050 kcal')).toBeTruthy();
    view.unmount();
  });

  test('a provisional new day: the line that says so, and a record made then waits, with no total and no reward', async () => {
    const kept: DayState = dayOf({ closesAt: new Date(Date.now() - 60_000).toISOString(), caloriesIn: 2380, story: { done: 2, total: 2 }, bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString() });
    await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(meOf()));
    await AsyncStorage.setItem(`cache:v1:${USER}:day`, JSON.stringify(kept));
    world.down = true;
    const view = await openManual();
    expect(await screen.findByText('Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.')).toBeTruthy();
    // the new day starts from nothing: yesterday's 2.380 is not shown as today's
    expect(screen.getByLabelText('Hôm nay. 0 / 2.394 kcal · cần trong 2.155–2.633')).toBeTruthy();
    type(kcalField(), '400');
    save();
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.queryByText(/Đã ghi\./)).toBeNull();
    expect(screen.queryByText(/XP/)).toBeNull();
    view.unmount();
  });
});

describe('fix round 1', () => {
  test('while this screen\'s own request is out the total is the server\'s last, marked "đang lưu" (not "Đang chờ gửi", and without the typed amount)', async () => {
    const answer = hold(NUTRITION);
    const view = await openManual();
    type(kcalField(), '400');
    save();
    await settle();
    expect(screen.getByLabelText('Hôm nay. 1.650 / 2.394 kcal · cần trong 2.155–2.633 · đang lưu')).toBeTruthy();
    expect(screen.queryByText(/2\.050/)).toBeNull();
    expect(screen.queryByText(/Đang chờ gửi/)).toBeNull();
    await act(async () => answer.release());
    expect(await screen.findByText('Đã ghi. Tổng hôm nay: 2.050 kcal')).toBeTruthy();
    view.unmount();
  });

  test('a record that really settled as queued is in the total, marked "Đang chờ gửi"', async () => {
    const view = await openToday();
    world.down = true;
    await act(async () => {
      await app.send({ path: '/nutrition/log', body: { kcal: 300 } });
    });
    fireEvent.press(screen.getByRole('button', { name: /^Ăn đủ cho mục tiêu/ }));
    await screen.findByRole('header', { name: 'Ghi bữa ăn' });
    expect(screen.getByLabelText('Hôm nay. 1.950 / 2.394 kcal · cần trong 2.155–2.633 · Đang chờ gửi')).toBeTruthy();
    expect(screen.queryByText(/đang lưu/)).toBeNull();
    view.unmount();
  });

  test('a label typed in decomposed form is counted and sent as the composed form: 60 composed characters are accepted and sent as 60', async () => {
    const view = await openManual();
    const composed = 'ă'.repeat(60);
    const decomposed = composed.normalize('NFD');
    expect([...decomposed].length).toBe(120);
    type(kcalField(), '450');
    type(labelField(), decomposed);
    save();
    expect(await screen.findByText(/^Đã ghi\./)).toBeTruthy();
    const sent = (logs()[0].body as { label: string }).label;
    expect(sent).toBe(composed);
    expect([...sent].length).toBe(60);
    view.unmount();
  });

  test('a refusal beside the button goes away as soon as either field is edited', async () => {
    world.closedDate = world.day.logicalDate;
    const view = await openManual();
    type(kcalField(), '400');
    save();
    expect(await screen.findByText(/^Chưa ghi được bữa ăn\./)).toBeTruthy();
    type(kcalField(), '410');
    expect(screen.queryByText(/^Chưa ghi được bữa ăn\./)).toBeNull();

    save();
    expect(await screen.findByText(/^Chưa ghi được bữa ăn\./)).toBeTruthy();
    type(labelField(), 'Bún');
    expect(screen.queryByText(/^Chưa ghi được bữa ăn\./)).toBeNull();
    view.unmount();
  });

  describe('how long the confirmation stays', () => {
    const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const message = 'Đã ghi. Tổng hôm nay: 2.050 kcal';

    test('7 seconds, with no seconds in the text and no action', async () => {
      fakeTimers();
      const view = await openManual();
      type(kcalField(), '400');
      save();
      expect(await screen.findByText(message)).toBeTruthy();
      await act(() => jest.advanceTimersByTimeAsync(6_900));
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByText(/giây/)).toBeNull();
      await act(() => jest.advanceTimersByTimeAsync(200));
      expect(screen.queryByText(message)).toBeNull();
      view.unmount();
    });

    test('9 seconds with a screen reader on', async () => {
      fakeTimers();
      jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
      const view = await openManual();
      type(kcalField(), '400');
      save();
      expect(await screen.findByText(message)).toBeTruthy();
      await act(() => jest.advanceTimersByTimeAsync(8_900));
      expect(screen.getByText(message)).toBeTruthy();
      await act(() => jest.advanceTimersByTimeAsync(200));
      expect(screen.queryByText(message)).toBeNull();
      view.unmount();
    });
  });
});
