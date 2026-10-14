import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { DayState, QuestState } from '../../../domain/contract/core.ts';
import { clearUserCache } from '../../shared/storage/cache';
import { BEDTIME, dayOf, hold, HIDDEN, installTodayTestEnv, meOf, openToday, app, queryClient, refuse, respond, settle, USER, world, writes } from '../dashboard/todayTestKit';
import { useCelebrationQueue } from '../progression/celebrations';

installTodayTestEnv();

const HOUR = 3_600_000;
const MARK = 'Ghi nhận kết thúc ngày';
const quests = (day: DayState, change: Record<string, Partial<QuestState>>): DayState => ({
  ...day,
  quests: day.quests.map(quest => ({ ...quest, ...change[quest.code] })),
});
/** 18:00 has passed: the hidden quest is open. */
const evening = (more: Partial<DayState> = {}) => quests(dayOf(more), { [HIDDEN]: { locked: false } });
const marks = () => writes().filter(request => request.path === '/day/bedtime');
const markButton = () => screen.getByRole('button', { name: MARK });
const rewardText = /\+30 XP/;

/** Today, then "Khép lại hôm nay": S45 as a person reaches it. */
async function openEndOfDay(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('button', { name: /^Khép lại hôm nay/ }));
  await screen.findByRole('header', { name: 'Khép lại hôm nay' });
  return view;
}

describe('S45 before the mark', () => {
  test('what the mark means, the hidden quest, and one button', async () => {
    world.day = evening();
    const view = await openEndOfDay();
    expect(screen.getByText('Bạn đã dành sự chú ý cho bản thân.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Đến lúc nghỉ một chút.' })).toBeTruthy();
    expect(screen.getByText('Ghi lại ý định nghỉ ngơi. Bạn vẫn có thể quay lại ứng dụng sau đó.')).toBeTruthy();
    // an intention to rest, not surveillance; the phone may be used afterwards
    expect(screen.getByText(/không ai theo dõi giờ bạn ngủ\. Dùng điện thoại sau khi ghi cũng không sao\./)).toBeTruthy();
    expect(screen.getByText('Nhiệm vụ ẩn: trước 23:00 · +30 XP')).toBeTruthy();
    expect(markButton().props.accessibilityState.disabled).toBeFalsy();
    expect(marks()).toEqual([]);
    view.unmount();
  });

  test('while the hidden quest is locked the button is off and its label and a line beside it give the reason', async () => {
    const view = await openEndOfDay(); // dayOf(): the hidden quest is locked
    const button = screen.getByRole('button', { name: `${MARK}. Mở từ 18:00` });
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Mở từ 18:00')).toBeTruthy();
    fireEvent.press(button);
    await settle();
    expect(marks()).toEqual([]);
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    view.unmount();
  });
});

describe('the mark is confirmed', () => {
  test('with the hidden quest completed: good night, and the reward line from the server\'s answer', async () => {
    world.day = evening();
    const view = await openEndOfDay();
    fireEvent.press(markButton());
    expect(await screen.findByText('Chúc bạn nghỉ ngon')).toBeTruthy();
    // 30 XP: what the server granted (delta.xp), not a figure of this screen
    expect(screen.getByText('+30 XP · Nhiệm vụ ẩn đã xong')).toBeTruthy();
    expect(marks()).toHaveLength(1);
    expect(marks()[0].body).toEqual({});
    // nothing left to press twice; the way out is back
    expect(screen.queryByRole('button', { name: MARK })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quay lại Hôm nay' })).toBeTruthy();
    // the server's day has it, and so does the profile read after it
    expect(world.day.bedtimeMarkedAt).not.toBeNull();
    expect(await screen.findByLabelText('265 xu', { includeHiddenElements: true })).toBeTruthy();
    view.unmount();
  });

  test('the reward line shows what the server granted: another amount is shown as it is', async () => {
    world.day = evening();
    world.answer = (request, init) => {
      if (request !== BEDTIME) return undefined;
      world.day = quests({ ...world.day, bedtimeMarkedAt: new Date().toISOString() }, { [HIDDEN]: { completed: true, progress: 1 } });
      return respond(200, { actionId: init.headers['Idempotency-Key'], day: world.day, delta: { xp: 45, coin: 15, events: [{ type: 'QUEST_COMPLETED', questCode: HIDDEN }] } });
    };
    const view = await openEndOfDay();
    fireEvent.press(markButton());
    expect(await screen.findByText('+45 XP · Nhiệm vụ ẩn đã xong')).toBeTruthy();
    view.unmount();
  });

  test('without the QUEST_COMPLETED event (after 23:00): good night, and the other sentence; no reward is claimed', async () => {
    world.day = evening();
    world.bedtimeReward = false;
    const view = await openEndOfDay();
    fireEvent.press(markButton());
    expect(await screen.findByText('Chúc bạn nghỉ ngon')).toBeTruthy();
    expect(screen.getByText('Đã ghi lại. Nhiệm vụ ẩn dành cho những hôm khép lại trước 23:00.')).toBeTruthy();
    expect(screen.queryByText(rewardText)).toBeNull();
    expect(screen.queryByText(/Nhiệm vụ ẩn đã xong/)).toBeNull();
    view.unmount();
  });

  test('an event of another quest is not the hidden quest\'s reward', async () => {
    world.day = evening();
    world.answer = (request, init) => {
      if (request !== BEDTIME) return undefined;
      world.day = { ...world.day, bedtimeMarkedAt: new Date().toISOString() };
      return respond(200, { actionId: init.headers['Idempotency-Key'], day: world.day, delta: { xp: 50, coin: 0, events: [{ type: 'QUEST_COMPLETED', questCode: 'NUTRITION_TARGET' }] } });
    };
    const view = await openEndOfDay();
    fireEvent.press(markButton());
    expect(await screen.findByText('Đã ghi lại. Nhiệm vụ ẩn dành cho những hôm khép lại trước 23:00.')).toBeTruthy();
    expect(screen.queryByText(/XP/)).toBeNull();
    view.unmount();
  });

  test('the events of the answer go to the celebrations once', async () => {
    world.day = evening();
    world.events = [{ type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 }];
    world.answer = (request, init) => {
      if (request !== BEDTIME) return undefined;
      world.day = quests({ ...world.day, bedtimeMarkedAt: new Date().toISOString() }, { [HIDDEN]: { completed: true, progress: 1 } });
      return respond(200, {
        actionId: init.headers['Idempotency-Key'],
        day: world.day,
        delta: { xp: 30, coin: 15, events: [{ type: 'QUEST_COMPLETED', questCode: HIDDEN }, ...world.events] },
      });
    };
    let queue: ReturnType<typeof useCelebrationQueue> = [];
    const Watch = () => {
      queue = useCelebrationQueue();
      return null;
    };
    const view = await openEndOfDay({ extra: <Watch /> });
    fireEvent.press(markButton());
    expect(await screen.findByText('Chúc bạn nghỉ ngon')).toBeTruthy();
    expect(queue).toEqual([world.events[0]]);
    view.unmount();
  });

  test('two quick presses are one mark: the second is ignored while the first is out', async () => {
    world.day = evening();
    const answer = hold(BEDTIME);
    const view = await openEndOfDay();
    fireEvent.press(markButton());
    fireEvent.press(markButton());
    await settle();
    // in flight: the button keeps its label and says it is busy; nothing is claimed yet
    expect(markButton().props.accessibilityState.busy).toBe(true);
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    expect(marks()).toHaveLength(1);
    await act(async () => answer.release());
    expect(await screen.findByText('Chúc bạn nghỉ ngon')).toBeTruthy();
    expect(marks()).toHaveLength(1);
    view.unmount();
  });
});

describe('the mark waits (no network)', () => {
  test('"Đang chờ gửi", no good night and no reward, nothing to press again; the server\'s answer later is shown by the day', async () => {
    world.day = evening();
    const view = await openEndOfDay();
    world.down = true;
    fireEvent.press(markButton());
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.getByText('Giờ nghỉ đã lưu trên máy và sẽ được gửi khi có mạng.')).toBeTruthy();
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    expect(screen.queryByText(rewardText)).toBeNull();
    expect(screen.queryByRole('button', { name: MARK })).toBeNull();

    // the network returns and the queue delivers: the day now says it is marked, and no reward is invented for it
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Hôm nay bạn đã ghi ý định nghỉ ngơi rồi. Không cần làm gì thêm.')).toBeTruthy();
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    expect(screen.queryByText(rewardText)).toBeNull();
    expect(marks().length).toBeGreaterThanOrEqual(1);
    view.unmount();
  });

  test('a mark made earlier and still waiting is shown as waiting when the screen opens', async () => {
    world.day = evening();
    const view = await openToday();
    // made on this device before, with no network: it waits
    world.down = true;
    await act(async () => {
      await app.send({ path: '/day/bedtime', body: {} });
    });
    fireEvent.press(screen.getByRole('button', { name: /^Khép lại hôm nay/ }));
    await screen.findByRole('header', { name: 'Khép lại hôm nay' });
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: MARK })).toBeNull();
    view.unmount();
  });
});

describe('already marked', () => {
  test('the screen says so and offers nothing to redo', async () => {
    world.day = quests(evening({ bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString() }), { [HIDDEN]: { completed: true, progress: 1 } });
    const view = await openEndOfDay();
    expect(screen.getByText('Hôm nay bạn đã ghi ý định nghỉ ngơi rồi. Không cần làm gì thêm.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: MARK })).toBeNull();
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    expect(screen.getByRole('button', { name: 'Quay lại Hôm nay' })).toBeTruthy();
    expect(marks()).toEqual([]);
    view.unmount();
  });

  test('"Quay lại Hôm nay" goes to the home tab', async () => {
    world.day = evening({ bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString() });
    const view = await openEndOfDay();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại Hôm nay' }));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    await settle();
    view.unmount();
  });
});

describe('the mark is refused', () => {
  test('BEDTIME_TOO_EARLY: the button is back, the reason is beside it with "Thử lại", and the retry is a new action', async () => {
    world.day = evening();
    world.answer = request => (request === BEDTIME ? refuse(409, 'BEDTIME_TOO_EARLY') : undefined);
    const view = await openEndOfDay();
    fireEvent.press(markButton());
    expect(await screen.findByText('Chưa ghi được giờ nghỉ. Lúc đó còn sớm để ghi giờ đi ngủ.')).toBeTruthy();
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    expect(markButton().props.accessibilityState.disabled).toBeFalsy();
    expect(markButton().props.accessibilityState.busy).toBeFalsy();

    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Chúc bạn nghỉ ngon')).toBeTruthy();
    const ids = marks().map(request => request.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(screen.queryByText(/Chưa ghi được/)).toBeNull();
    view.unmount();
  });
});

describe('loading and a provisional day', () => {
  test('while the day is being read: the title and a skeleton, no button; then the day', async () => {
    world.day = evening();
    const view = await openEndOfDay();
    const day = hold('GET /day');
    await clearUserCache(USER);
    await act(async () => {
      queryClient().resetQueries({ queryKey: ['day'] });
    });
    expect(screen.getByRole('header', { name: 'Khép lại hôm nay' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: MARK })).toBeNull();
    await act(async () => day.release());
    expect(await screen.findByRole('button', { name: MARK })).toBeTruthy();
    view.unmount();
  });

  test('the new day cannot be read yet: the line that says so; a mark made then waits, with no good night and no reward', async () => {
    const kept = quests(dayOf({ closesAt: new Date(Date.now() - 60_000).toISOString(), story: { done: 2, total: 2 }, bedtimeMarkedAt: new Date(Date.now() - 2 * HOUR).toISOString() }), { [HIDDEN]: { locked: false, completed: true } });
    await AsyncStorage.setItem(`cache:v1:${USER}:me`, JSON.stringify(meOf()));
    await AsyncStorage.setItem(`cache:v1:${USER}:day`, JSON.stringify(kept));
    world.down = true;
    const view = await openEndOfDay();
    expect(await screen.findByText('Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại.')).toBeTruthy();
    // the old day's mark is not this day's
    expect(screen.queryByText('Hôm nay bạn đã ghi ý định nghỉ ngơi rồi. Không cần làm gì thêm.')).toBeNull();
    fireEvent.press(markButton());
    expect(await screen.findByRole('header', { name: 'Đang chờ gửi' })).toBeTruthy();
    expect(screen.queryByText('Chúc bạn nghỉ ngon')).toBeNull();
    expect(screen.queryByText(/XP/)).toBeNull();
    view.unmount();
  });
});
