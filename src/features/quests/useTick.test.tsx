import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Text } from 'react-native';
import type { ActionResult, GameEvent } from '../../../domain/contract/common.ts';
import { api } from '../../shared/api/client';
import {
  app,
  dayOf,
  fetchMock,
  hold,
  idsOnDisk,
  installTodayTestEnv,
  nearLevelUp,
  openToday,
  refuse,
  requested,
  respond,
  serverAnswer,
  queryClient,
  settle,
  TICK,
  tickIds,
  UNDO,
  undos,
  USER,
  world,
} from '../dashboard/todayTestKit';
import type { DayState } from '../../../domain/contract/core.ts';
import { useCelebrationQueue } from '../progression/celebrations';

// The water tracker of the home tab is the first user of `useTick`: these tests press it inside the whole app.
installTodayTestEnv();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNDO_GONE = 'Không hoàn tác được nữa, ghi nhận vẫn được giữ';
const UNDO_COINS_SPENT = 'Không hoàn tác được vì xu của ghi nhận này đã được dùng. Ghi nhận vẫn được giữ.';
const UNDO_NOT_SENT = 'Chưa hoàn tác được, ghi nhận vẫn được giữ';
const record = () => fireEvent.press(screen.getByRole('button', { name: /^Ghi nhận nước/ }));
const tracker = () => screen.getByRole('button', { name: /^Nước hôm nay/ });
const hp = () => within(screen.getByRole('progressbar', { name: 'Sức sống' }));
const level = (xp: number) => screen.queryByRole('button', { name: new RegExp(`^Cấp 5 · Người kiên trì. ${xp} / `) });
/** Nothing on screen claims a reward or offers to take one back. */
function expectNoReward() {
  expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
  expect(screen.queryByText('+10 XP', { exact: false })).toBeNull();
  expect(level(340)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
  expect(screen.queryByText(/đã lưu$/)).toBeNull();
  expect(screen.queryByText('Mầm vui vì bạn vừa ghi nhận')).toBeNull();
  expect(screen.getByLabelText('250 xu')).toBeTruthy();
}
// Timers only: a microtask queued by an unmount is not something that keeps Jest alive.
const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });

describe('a tick the server confirms (S57)', () => {
  test('the next cell fills at once as "đang lưu"; reward, "đã lưu", Undo and the glad Mầm come only with the answer', async () => {
    const tick = hold(TICK);
    const view = await openToday();
    record();
    // before the record is even on disk
    expect(screen.getByText('4 / 8 phần · đang lưu')).toBeTruthy();
    await settle();
    expect(tracker().props.accessibilityLabel).toBe('Nước hôm nay. 4 / 8 phần · đang lưu. Chạm để ghi thêm một phần.');
    // on this device before any answer, and sent with its id
    expect(await idsOnDisk()).toEqual(tickIds());
    expect(tickIds()).toEqual([expect.stringMatching(UUID_V4)]);
    expect(screen.queryByText('Đang chờ gửi')).toBeNull();
    expectNoReward();

    await act(async () => tick.release());
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeTruthy();
    expect(screen.getByText('4 / 8 phần · đã lưu')).toBeTruthy();
    expect(screen.getByText('Mầm vui vì bạn vừa ghi nhận')).toBeTruthy();
    // XP, coins and the stat are the server's, read again after the record
    expect(await screen.findByLabelText('255 xu')).toBeTruthy();
    expect(level(350)).toBeTruthy();
    expect(hp().getByText('31/100')).toBeTruthy();
    // one request, an empty body: the device adds neither an id nor a time of its own
    expect(tickIds()).toHaveLength(1);
    expect(JSON.parse(fetchBodyOf(TICK))).toEqual({});
    expect(await idsOnDisk()).toEqual([]);
    view.unmount();
  });

  test('the count after the answer is the one in the answer, whatever was tapped here', async () => {
    const view = await openToday();
    // two parts were recorded on another device meanwhile: the server answers 6, not 4
    world.answer = request => {
      if (request === TICK) world.day = dayOf({}, { progress: 5 });
      return undefined;
    };
    record();
    expect(screen.getByText('4 / 8 phần · đang lưu')).toBeTruthy();
    expect(await screen.findByText('6 / 8 phần · đã lưu')).toBeTruthy();
    view.unmount();
  });

  test('the answer itself moves the count: it does not wait for the day to be read again, and the cell does not empty meanwhile', async () => {
    const view = await openToday();
    // the refresh that follows every delivered record stays out
    const reread = hold('GET /day');
    record();
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.getByText('4 / 8 phần · đã lưu')).toBeTruthy();
    expect(tracker().props.accessibilityLabel).toBe('Nước hôm nay. 4 / 8 phần · đã lưu. Chạm để ghi thêm một phần.');
    await act(async () => reread.release());
    await settle();
    expect(screen.getByText('4 / 8 phần · đã lưu')).toBeTruthy();
    view.unmount();
  });

  test('a LEVEL_UP in the answer is handed to the celebration queue once; other events open nothing', async () => {
    function Queue() {
      return <Text testID="celebrations">{JSON.stringify(useCelebrationQueue())}</Text>;
    }
    const queue = () => JSON.parse(screen.getByTestId('celebrations').props.children);
    // the 8th part completes the quest (QUEST_COMPLETED) and takes the profile over the level: the server's own events
    const levelUp: GameEvent = { type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 };
    world.day = dayOf({}, { progress: 7 });
    nearLevelUp();
    const view = await openToday({ extra: <Queue /> });
    record();
    await screen.findByText('Đã ghi nhận · +10 XP');
    expect(queue()).toEqual([levelUp]);
    // the refreshed day and profile do not push it again
    await settle();
    expect(queue()).toEqual([levelUp]);
    view.unmount();
  });
});

describe('an answer that carries an older day', () => {
  test("the answer to a tick comes back with yesterday's day (the day rolled over while it was out): its reward is shown, today's day stays", async () => {
    const view = await openToday();
    const answer = hold(TICK);
    record();
    await settle();
    const yesterday = dayOf({}, { progress: 4 });
    world.day = dayOf({ logicalDate: '2026-10-15' }, { progress: 0, lastTick: null });
    await act(async () => queryClient().invalidateQueries({ queryKey: ['day'] }));
    await settle();
    const result: ActionResult = { actionId: tickIds()[0], day: yesterday, delta: { xp: 10, coin: 5, events: [] } };
    // the read that follows a delivered record stays out, so that only the answer's day could be on screen
    const reread = hold('GET /day');
    await act(async () => answer.release(respond(200, result)));
    // the reward is the answer's own
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeTruthy();
    // the day is today's: yesterday's 4 / 8 is on neither the screen, the cache nor the disk
    expect(queryClient().getQueryData<DayState>(['day'])?.logicalDate).toBe('2026-10-15');
    expect(JSON.parse((await AsyncStorage.getItem(`cache:v1:${USER}:day`)) ?? '{}').logicalDate).toBe('2026-10-15');
    expect(screen.queryByText(/^4 \/ 8 phần/)).toBeNull();
    await act(async () => reread.release());
    view.unmount();
  });
});

describe('a tick the server refuses (S58)', () => {
  test('409 QUEST_ALREADY_COMPLETE: the cell empties, the reason and "Thử lại" stand beside the tracker, no reward', async () => {
    const view = await openToday();
    world.answer = request => (request === TICK ? refuse(409, 'QUEST_ALREADY_COMPLETE') : undefined);
    record();
    expect(screen.getByText('4 / 8 phần · đang lưu')).toBeTruthy();
    expect(await screen.findByText('Chưa lưu được phần nước vừa ghi. Nhiệm vụ này đã hoàn thành từ trước.')).toBeTruthy();
    expect(screen.getByText('3 / 8 phần')).toBeTruthy();
    // the one retry on screen is this record's; the app-wide notice does not repeat the refusal
    expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
    expect(screen.queryByText('Ghi nhận không được tính')).toBeNull();
    expect(await idsOnDisk()).toEqual([]);
    await settle();
    expectNoReward();

    // "Thử lại" records again: a new action with its own id
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.queryByText(/Chưa lưu được/)).toBeNull();
    expect(new Set(tickIds()).size).toBe(2);
    view.unmount();
  });

  test('409 QUEST_NOT_TICKABLE (the stand-in server answers it): the cell empties, the generic reason stands beside the tracker, no reward, nothing is kept', async () => {
    const view = await openToday();
    // the server's picture of the day changed after the app read it: the water quest is not a daily one
    world.day = { ...world.day, quests: world.day.quests.map(item => (item.code === 'WATER_8' ? { ...item, category: 'STORY' } : item)) };
    record();
    expect(screen.getByText('4 / 8 phần · đang lưu')).toBeTruthy();
    expect(await screen.findByText('Chưa lưu được phần nước vừa ghi. Có lỗi xảy ra. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.getByText('3 / 8 phần')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
    expect(screen.queryByText('Ghi nhận không được tính')).toBeNull();
    expect(await idsOnDisk()).toEqual([]);
    await settle();
    expectNoReward();
    view.unmount();
  });

  test('404 QUEST_NOT_FOUND (the stand-in server answers it): the quest has left the day, so the tracker goes with it; no reward, nothing is kept, no spinner', async () => {
    const view = await openToday();
    world.day = { ...world.day, quests: world.day.quests.filter(item => item.code !== 'WATER_8') };
    const reads = requested('/day');
    record();
    await waitFor(() => expect(requested('/day')).toBe(reads + 1));
    await settle();
    expect(screen.queryByLabelText(/^Nước hôm nay/)).toBeNull();
    expect(screen.queryByLabelText('Đang tải')).toBeNull();
    expect(screen.queryByText('Ghi nhận không được tính')).toBeNull();
    expect(await idsOnDisk()).toEqual([]);
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByText('Hoàn tác')).toBeNull();
    expect(screen.getByLabelText('250 xu')).toBeTruthy();
    view.unmount();
  });

  test('this device cannot keep the record: nothing is sent, and the reason says so', async () => {
    const view = await openToday();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    record();
    expect(await screen.findByText('Chưa lưu được phần nước vừa ghi. Máy chưa giữ được ghi nhận này. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.getByText('3 / 8 phần')).toBeTruthy();
    expect(tickIds()).toEqual([]);
    expectNoReward();
    view.unmount();
  });
});

describe('a tick made without a network', () => {
  test('the cell stays, marked "Đang chờ gửi", with no reward; when the queue delivers it the count is the server\'s', async () => {
    const view = await openToday();
    world.down = true;
    record();
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(tracker().props.accessibilityLabel).toBe('Nước hôm nay. 4 / 8 phần. Có phần đang chờ gửi. Chạm để ghi thêm một phần.');
    expect(screen.getByText('Mầm đang vui')).toBeTruthy();
    expectNoReward();
    const waiting = await idsOnDisk();
    expect(waiting).toEqual(tickIds());

    // the network is back; the row above the app owns the retry of the queue
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByText('Đang chờ gửi')).toBeNull());
    expect(await screen.findByLabelText('255 xu')).toBeTruthy();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(tickIds()).toEqual([...waiting, ...waiting]);
    // delivered by the queue, not by this tap: the numbers are refreshed, nothing is celebrated
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    expect(screen.queryByText('Mầm vui vì bạn vừa ghi nhận')).toBeNull();
    view.unmount();
  });

  test('a part recorded without a network right after a confirmed one: the count no longer says "đã lưu", and no number of waiting parts is given', async () => {
    const view = await openToday();
    record();
    expect(await screen.findByText('4 / 8 phần · đã lưu')).toBeTruthy();
    await settle();
    world.down = true;
    record();
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    await settle();
    // 4 are the server's, 1 is only on this device: the five as a whole are not saved
    expect(screen.getByText('5 / 8 phần')).toBeTruthy();
    expect(screen.queryByText(/đã lưu$/)).toBeNull();
    expect(tracker().props.accessibilityLabel).toBe('Nước hôm nay. 5 / 8 phần. Có phần đang chờ gửi. Chạm để ghi thêm một phần.');
    view.unmount();
  });

  test('the server had it, only its answer was lost: delivered later without a reward shown for it here', async () => {
    const view = await openToday();
    let lost = false;
    world.answer = (request, init) => {
      if (request !== TICK || lost) return undefined;
      lost = true;
      serverAnswer(request, init); // committed on the server
      throw new TypeError('Network request failed');
    };
    record();
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expectNoReward();

    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByText('Đang chờ gửi')).toBeNull());
    // one part, not two; its XP and coins arrive through the refreshed profile only
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(await screen.findByLabelText('255 xu')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    view.unmount();
  });

  test('waiting parts count toward the 8: with 6 confirmed and 2 waiting both controls are off, with the reason', async () => {
    world.day = dayOf({}, { progress: 6 });
    const view = await openToday();
    world.down = true;
    record();
    await screen.findByText('Đang chờ gửi');
    record();
    await waitFor(() => expect(screen.getByText('8 / 8 phần')).toBeTruthy());
    await settle();
    expect(await idsOnDisk()).toHaveLength(2);

    expect(screen.getByRole('button', { name: 'Ghi nhận nước. Đã ghi đủ 8 phần hôm nay.' }).props.accessibilityState.disabled).toBe(true);
    expect(tracker().props.accessibilityLabel).toBe('Nước hôm nay. 8 / 8 phần. Có phần đang chờ gửi. Đã ghi đủ 8 phần hôm nay.');
    expect(tracker().props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Đã ghi đủ 8 phần hôm nay.')).toBeTruthy();
    record();
    fireEvent.press(tracker());
    await settle();
    expect(await idsOnDisk()).toHaveLength(2);
    view.unmount();
  });
});

describe('taps', () => {
  test('two quick taps are two records with two ids', async () => {
    const view = await openToday();
    record();
    fireEvent.press(tracker());
    expect(screen.getByText('5 / 8 phần · đang lưu')).toBeTruthy();
    expect(await screen.findByText('5 / 8 phần · đã lưu')).toBeTruthy();
    await settle();
    const ids = tickIds();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(UUID_V4);
    expect(ids[1]).toMatch(UUID_V4);
    expect(ids[0]).not.toBe(ids[1]);
    expect(await screen.findByLabelText('260 xu')).toBeTruthy();
    view.unmount();
  });

  test('at 7 of 8, two taps inside one frame record one part: the second finds the tracker full', async () => {
    world.day = dayOf({}, { progress: 7 });
    const view = await openToday();
    const cta = screen.getByRole('button', { name: 'Ghi nhận nước' });
    const row = tracker();
    act(() => {
      fireEvent.press(cta);
      fireEvent.press(row);
    });
    expect(await screen.findByText('8 / 8 phần · đã lưu')).toBeTruthy();
    await settle();
    expect(tickIds()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ghi nhận nước. Đã ghi đủ 8 phần hôm nay.' }).props.accessibilityState.disabled).toBe(true);
    view.unmount();
  });

  test('a quest the server has completed takes no further tick', async () => {
    world.day = dayOf({}, { progress: 8, completed: true });
    const view = await openToday();
    expect(screen.getByText('8 / 8 phần')).toBeTruthy();
    record();
    fireEvent.press(tracker());
    await settle();
    expect(tickIds()).toEqual([]);
    expect(await idsOnDisk()).toEqual([]);
    view.unmount();
  });
});

describe('undo', () => {
  /** A confirmed tick with its snackbar on screen, under fake timers; returns the tick id. */
  async function recorded() {
    fakeTimers();
    const view = await openToday();
    record();
    await screen.findByText('Đã ghi nhận · +10 XP');
    await settle();
    return { view, tickId: tickIds()[0] };
  }

  test('inside 5 s "Hoàn tác" sends the tick id; the count and the coins shown are the ones the server returns', async () => {
    const { view, tickId } = await recorded();
    // an answer no subtraction on this device would produce: 2 parts, 251 coins
    world.answer = (request, init) => {
      if (request !== UNDO) return undefined;
      const answer = serverAnswer(request, init);
      const key = init.headers['Idempotency-Key'];
      world.day = dayOf({}, { progress: 2, lastTick: null });
      world.me = { ...world.me, progression: world.me.progression && { ...world.me.progression, coin: 251 } };
      const result: ActionResult = { actionId: key, day: world.day, delta: { xp: -10, coin: -5, events: [] } };
      return answer && respond(200, result);
    };
    await act(() => jest.advanceTimersByTimeAsync(4_000));
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText('Đã hoàn tác')).toBeTruthy();
    expect(undos()).toEqual([{ path: '/day/quests/WATER_8/undo', id: expect.stringMatching(UUID_V4), body: { tickId } }]);
    expect(undos()[0].id).not.toBe(tickId);
    expect(await screen.findByText('2 / 8 phần')).toBeTruthy();
    expect(await screen.findByLabelText('251 xu')).toBeTruthy();
    // the reward of the tick is no longer claimed
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    expect(screen.queryByText(/đã lưu$/)).toBeNull();
    expect(screen.queryByText('Mầm vui vì bạn vừa ghi nhận')).toBeNull();
    view.unmount();
  });

  test('the window is 5 s: at 4.9 s the action is there, at 5 s it is gone with "đã lưu", and nothing was undone', async () => {
    const { view } = await recorded();
    await act(() => jest.advanceTimersByTimeAsync(4_880));
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeTruthy();
    expect(screen.getByText('4 / 8 phần · đã lưu')).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(120));
    expect(screen.queryByRole('button', { name: 'Hoàn tác' })).toBeNull();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(screen.getByText('Mầm đang vui')).toBeTruthy();
    expect(undos()).toEqual([]);
    view.unmount();
  });

  test.each(['UNDO_WINDOW_EXPIRED', 'UNDO_NOT_LATEST'])('409 %s: the record is kept and the message says so, with nothing to retry', async code => {
    const { view } = await recorded();
    world.answer = request => (request === UNDO ? refuse(409, code) : undefined);
    const dayRequests = requested('/day');
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_GONE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(screen.getByLabelText('255 xu')).toBeTruthy();
    // the picture of the day was old: it is read again
    await settle();
    expect(requested('/day')).toBe(dayRequests + 1);
    view.unmount();
  });

  test('409 UNDO_COINS_SPENT (a purchase inside the window): its own message, the record is kept, nothing to retry, one undo request', async () => {
    // 78 coins: the tick makes 83, the purchase of a theme (80) leaves 3, and the 5 of the tick cannot be taken back
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), coin: 78 } };
    const { view } = await recorded();
    await act(() => api.write('POST', '/shop/THEME_FOREST/purchase'));
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_COINS_SPENT)).toBeTruthy();
    expect(screen.queryByText(UNDO_GONE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(screen.queryByText('Đã hoàn tác')).toBeNull();
    await settle();
    expect(undos()).toHaveLength(1);
    view.unmount();
  });

  test.each([
    [404, 'TICK_NOT_FOUND', undefined],
    [422, 'VALIDATION_FAILED', { fields: [{ field: 'tickId', rule: 'format' }] }],
  ])('%i %s (the real answers of the route): the record is kept and the message says so, with nothing to retry', async (status, code, details) => {
    const { view } = await recorded();
    world.answer = request => (request === UNDO ? refuse(status, code, details) : undefined);
    const dayRequests = requested('/day');
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_GONE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();
    expect(screen.getByLabelText('255 xu')).toBeTruthy();
    expect(screen.queryByText('Đã hoàn tác')).toBeNull();
    await settle();
    expect(requested('/day')).toBe(dayRequests + 1);
    view.unmount();
  });

  test("the server undid it and only its answer was lost; the retry gets the stored answer, which is yesterday's day: today stays on screen and on disk", async () => {
    const { view } = await recorded();
    let lost = true;
    world.answer = (request, init) => {
      if (request !== UNDO || !lost) return undefined;
      lost = false;
      serverAnswer(request, init); // the undo is done, and its answer (the day as it was then) is stored under the key
      throw new TypeError('Network request failed');
    };
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_NOT_SENT)).toBeTruthy();
    // the day rolls over meanwhile, and today's day is read
    world.day = dayOf({ logicalDate: '2026-10-15' }, { progress: 0, lastTick: null });
    await act(async () => queryClient().invalidateQueries({ queryKey: ['day'] }));
    expect(await screen.findByText('0 / 8 phần')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã hoàn tác')).toBeTruthy();
    await settle();
    expect(undos()).toHaveLength(2);
    expect(undos()[0].id).toBe(undos()[1].id);
    expect(screen.getByText('0 / 8 phần')).toBeTruthy();
    expect(queryClient().getQueryData<DayState>(['day'])?.logicalDate).toBe('2026-10-15');
    expect(JSON.parse((await AsyncStorage.getItem(`cache:v1:${USER}:day`)) ?? '{}').logicalDate).toBe('2026-10-15');
    view.unmount();
  });

  test('no network: "not undone yet" with "Thử lại" while the 5 s last; the retry repeats the same undo with its key', async () => {
    const { view, tickId } = await recorded();
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    world.down = true;
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_NOT_SENT)).toBeTruthy();
    // "cannot be undone any more" would contradict the retry beside it
    expect(screen.queryByText(UNDO_GONE)).toBeNull();
    expect(screen.getByText('4 / 8 phần')).toBeTruthy();

    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã hoàn tác')).toBeTruthy();
    expect(undos().map(request => request.body)).toEqual([{ tickId }, { tickId }]);
    expect(undos()[0].id).toBe(undos()[1].id);
    expect(await screen.findByText('3 / 8 phần')).toBeTruthy();
    expect(await screen.findByLabelText('250 xu')).toBeTruthy();
    expect(level(340)).toBeTruthy();
    view.unmount();
  });

  test('no network, and the 5 s pass: the retry goes away with the window', async () => {
    const { view } = await recorded();
    await act(() => jest.advanceTimersByTimeAsync(3_000));
    world.down = true;
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_NOT_SENT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(2_000));
    expect(screen.queryByText(UNDO_NOT_SENT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    view.unmount();
  });

  test('no network after the 5 s (a screen reader keeps the action for 9 s): the time is over, so no retry, and the sentence that says so', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const { view } = await recorded();
    await act(() => jest.advanceTimersByTimeAsync(6_000));
    world.down = true;
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText(UNDO_GONE)).toBeTruthy();
    expect(screen.queryByText(UNDO_NOT_SENT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    view.unmount();
  });
});

describe('a record and a session that ends', () => {
  test('the answer of a tick arrives after the session has ended: the day in it reaches neither the cache nor the disk', async () => {
    const view = await openToday();
    const tick = hold(TICK);
    record();
    await settle();
    const held = world.answer;
    world.answer = (request, init) => (request === 'GET /me' ? refuse(401, 'SESSION_INVALID') : held?.(request, init));
    await act(() => api.get('/me').catch(() => undefined));
    await screen.findByRole('header', { name: 'Chào bạn trở lại' });
    expect(app.session.status).toBe('signedOut');

    await act(async () => tick.release());
    await settle();
    expect((await AsyncStorage.getAllKeys()).filter(key => key.startsWith('cache:'))).toEqual([]);
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();
    view.unmount();
  });
});

describe('with motion on', () => {
  const mockedAppState = AppState as unknown as { currentState: unknown };
  const appStateAtLoad = mockedAppState.currentState;
  afterEach(() => {
    mockedAppState.currentState = appStateAtLoad;
  });

  test('the same flow runs its animations to the end: the float shows the server\'s XP, and nothing is left running', async () => {
    mockedAppState.currentState = 'active';
    fakeTimers();
    const view = await openToday({ motion: 'FULL' });
    record();
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    // drawn for the eye only: the snackbar is what a screen reader hears
    expect(screen.getByText('+10 XP', { includeHiddenElements: true })).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    world.down = true;
    record();
    expect(await screen.findByText('Đang chờ gửi')).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(6_000));
    expect(screen.queryByText('+10 XP', { includeHiddenElements: true })).toBeNull();
    view.unmount();
  });
});

/** The body of the first request to "METHOD /path". */
function fetchBodyOf(request: string) {
  const [method, path] = request.split(' ');
  return fetchMock.mock.calls.find(([url, init]) => url.endsWith(path) && init.method === method)?.[1].body ?? 'null';
}
