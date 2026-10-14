import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';
import type { WorkoutResult } from '../../../domain/contract/content.ts';
import { api } from '../../shared/api/client';
import { wipeQueries } from '../../shared/api/session';
import * as pendingActions from '../../shared/storage/pendingActions';
import { ProgressRing } from '../../shared/ui/ProgressRing';
import { app, hold, queryClient, refuse, respond, settle, world } from '../dashboard/todayTestKit';
import { useCelebrationQueue } from '../progression/celebrations';
import { COMPLETE, detail, fakeTimers, foreground, gym, installWorkoutTestEnv, openDetail, pass, sessions, startSession, system } from './workoutTestKit';

installWorkoutTestEnv();

const S = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const END = 'Kết thúc buổi tập';
const SAVE = 'Kết thúc và lưu';
const CONTINUE = 'Tập tiếp';
const EXIT = 'Thoát buổi tập?';
const QUEUED = 'Buổi tập đã lưu trên máy, đang chờ gửi';
const DAY_CLOSED = 'Ngày đó đã khép lại nên ghi nhận này không được tính. Bạn không làm gì sai cả.';

/** The time on the ring, as a screen reader gets it. */
const left = () => screen.getByRole('progressbar', { name: /^Thời gian còn lại/ }).props.accessibilityLabel.slice(-5);
const header = (name: string) => screen.queryByRole('header', { name });
const press = (name: string) => fireEvent.press(screen.getAllByRole('button', { name }).at(-1) as never);
/** The device clock moves on without any timer callback running (the app was not given the time to run them). */
const jump = (ms: number) => jest.setSystemTime(Date.now() + ms);
async function begin(options: Parameters<typeof startSession>[0] = {}) {
  fakeTimers();
  foreground();
  return startSession(options);
}
async function endAndSave() {
  press(END);
  fireEvent.press(await screen.findByRole('button', { name: SAVE }));
}

describe('S19: the session follows the clock', () => {
  test('starts on the first move with the whole duration left; counts down by the second; follows wall time when callbacks are skipped', async () => {
    const view = await begin();
    expect(screen.getByText('Toàn thân vừa sức · đang diễn ra')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Xoay vai' })).toBeTruthy();
    expect(screen.getByText('Hiệp 1 / 3 · Động tác 1 / 6')).toBeTruthy();
    expect(left()).toBe('15:00');
    expect(screen.getByText('còn lại')).toBeTruthy();
    expect(screen.getByText('Động tác này còn 00:30')).toBeTruthy();

    await pass(1 * S);
    expect(left()).toBe('14:59');

    // 30 s go by on the device clock and exactly one tick arrives: the countdown has moved by the 30 s, not by one tick
    jump(30 * S);
    await pass(250);
    expect(left()).toBe('14:29');
    // and the session is where 31 s lead: the second move, in the first set
    expect(screen.getByRole('header', { name: 'Squat tay trước ngực' })).toBeTruthy();
    expect(screen.getByText('Hiệp 1 / 3 · Động tác 2 / 6')).toBeTruthy();
    expect(screen.getByText('Động tác này còn 01:29')).toBeTruthy();
    // nothing is recorded by time passing
    expect(sessions()).toEqual([]);
    view.unmount();
  });

  test('the demo area is the move in words: its amount and its three instruction lines, with its own caution', async () => {
    const view = await begin();
    const { move, repsText } = detail.steps[0];
    expect(screen.getByText('Cách thực hiện')).toBeTruthy();
    expect(screen.getByText(`${move.name} · ${repsText}`)).toBeTruthy();
    move.steps.forEach((line, index) => expect(screen.getByText(`${index + 1}. ${line}`)).toBeTruthy());
    expect(screen.getByText(move.caution)).toBeTruthy();
    expect(screen.getByText('Hít thở đều. Bạn không cần cố theo nhịp của ai khác.')).toBeTruthy();
    view.unmount();
  });

  test('the sound switch is off, cannot be turned on, and its name says why', async () => {
    const view = await begin();
    const sound = screen.getByRole('switch', { name: /Bản này chưa có âm thanh/, disabled: true, checked: false });
    expect(sound).toBeTruthy();
    expect(screen.getByText('Đang tắt')).toBeTruthy();
    fireEvent.press(sound);
    expect(screen.getByRole('switch', { checked: false })).toBeTruthy();
    view.unmount();
  });

  test('the second set, and the cool-down as the last move of the last set', async () => {
    const view = await begin();
    // 30 + 280: the second set begins
    jump(310 * S);
    await pass(250);
    expect(screen.getByText('Hiệp 2 / 3 · Động tác 2 / 6')).toBeTruthy();
    jump(570 * S);
    await pass(250);
    expect(screen.getByRole('header', { name: 'Thả lỏng vai' })).toBeTruthy();
    expect(screen.getByText('Hiệp 3 / 3 · Động tác 6 / 6')).toBeTruthy();
    expect(left()).toBe('00:20');
    view.unmount();
  });
});

describe('the ring', () => {
  const ring = () => screen.UNSAFE_getByType(ProgressRing).props;

  test('with reduced motion it moves once per second; the time and the content are the same', async () => {
    const view = await begin();
    await pass(1750);
    expect(ring()).toMatchObject({ tone: 'primary', progress: 1 / 900 });
    expect(left()).toBe('14:59');
    view.unmount();
  });

  test('with motion on it follows the clock inside the second as well; the countdown still shows whole seconds', async () => {
    const view = await begin({ motion: 'FULL' });
    await pass(1750);
    expect(ring().progress).toBeCloseTo(1.75 / 900, 6);
    expect(left()).toBe('14:59');
    view.unmount();
  });
});

describe('S41: paused', () => {
  test('"Tạm dừng" stops the clock and says so; the paused time is not counted; "Tập tiếp" goes on from the same second', async () => {
    const view = await begin();
    await pass(60 * S);
    expect(left()).toBe('14:00');
    press('Tạm dừng');
    expect(header('Đang tạm dừng')).toBeTruthy();
    expect(header('Đang tập')).toBeNull();
    expect(screen.getByText('Toàn thân vừa sức · nghỉ một chút cũng được')).toBeTruthy();
    expect(screen.getByText('Thời gian tạm dừng không tính vào buổi tập.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tạm dừng' })).toBeNull();
    expect(screen.getByRole('button', { name: END })).toBeTruthy();

    await pass(300 * S);
    expect(left()).toBe('14:00');

    press(CONTINUE);
    expect(header('Đang tập')).toBeTruthy();
    expect(left()).toBe('14:00');
    await pass(30 * S);
    expect(left()).toBe('13:30');
    view.unmount();
  });

  test.each(['background', 'inactive'] as const)('the app going to "%s" pauses the session; coming back shows it paused and never resumes it', async state => {
    const view = await begin();
    await pass(45 * S);
    expect(left()).toBe('14:15');
    await system(state);
    await pass(120 * S);
    await system('active');
    expect(header('Đang tạm dừng')).toBeTruthy();
    // neither the time away nor the time since the return is trained time
    await pass(10 * S);
    expect(left()).toBe('14:15');
    expect(header('Đang tạm dừng')).toBeTruthy();
    // the person resumes, nobody else
    press(CONTINUE);
    await pass(5 * S);
    expect(left()).toBe('14:10');
    view.unmount();
  });
});

describe('S63: leaving asks first', () => {
  test.each(['Thoát buổi tập', END])('"%s" opens the dialog with what was trained; nothing is recorded yet', async name => {
    const view = await begin();
    await pass(60 * S);
    press(name);
    expect(await screen.findByText(EXIT)).toBeTruthy();
    expect(screen.getByText('Bạn đã tập 01:00 trên 15:00. Phần đã tập vẫn được lưu.')).toBeTruthy();
    expect(screen.getByText('Dưới một nửa thời lượng sẽ được ghi là buổi tập dở, vẫn nhận XP theo phần đã tập.')).toBeTruthy();
    expect(screen.getByRole('button', { name: CONTINUE })).toBeTruthy();
    expect(screen.getByRole('button', { name: SAVE })).toBeTruthy();
    expect(sessions()).toEqual([]);
    view.unmount();
  });

  test('past the half of the duration the note about a short session is not shown', async () => {
    const view = await begin();
    jump(450 * S);
    await pass(250);
    press(END);
    expect(await screen.findByText('Bạn đã tập 07:30 trên 15:00. Phần đã tập vẫn được lưu.')).toBeTruthy();
    expect(screen.queryByText(/buổi tập dở/)).toBeNull();
    view.unmount();
  });

  test('hardware Back (Android) opens the dialog instead of closing the session', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const handlers: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_event: string, handler: () => boolean) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    }) as never);
    const view = await begin();
    await pass(20 * S);
    // as the system does it: the handler registered last is asked first, and the first one to say "handled" ends it
    let handled = false;
    act(() => {
      handled = [...handlers].reverse().some(handler => handler() === true);
    });
    expect(handled).toBe(true);
    expect(await screen.findByText(EXIT)).toBeTruthy();
    // the session is still there, under the dialog, and nothing was recorded
    expect(left()).toBe('14:40');
    expect(sessions()).toEqual([]);
    view.unmount();
  });

  test('"Tập tiếp" is back at the same remaining time: nothing is lost and nothing is gained while the dialog is open', async () => {
    const view = await begin();
    await pass(60 * S);
    press(END);
    await screen.findByText(EXIT);
    // the question may take a while to answer
    await pass(45 * S);
    expect(screen.getByText('Bạn đã tập 01:00 trên 15:00. Phần đã tập vẫn được lưu.')).toBeTruthy();
    press(CONTINUE);
    expect(screen.queryByText(EXIT)).toBeNull();
    expect(left()).toBe('14:00');
    // it was running before, so it is running again
    expect(header('Đang tập')).toBeTruthy();
    await pass(10 * S);
    expect(left()).toBe('13:50');
    view.unmount();
  });

  test('a session the person had paused is still paused after "Tập tiếp" in the dialog', async () => {
    const view = await begin();
    await pass(60 * S);
    press('Tạm dừng');
    await pass(30 * S);
    press(END);
    await screen.findByText(EXIT);
    await pass(30 * S);
    // the dialog's own button (the paused screen under it has one of the same name)
    press(CONTINUE);
    expect(screen.queryByText(EXIT)).toBeNull();
    expect(header('Đang tạm dừng')).toBeTruthy();
    await pass(10 * S);
    expect(left()).toBe('14:00');
    view.unmount();
  });

  test('the app left while the dialog is open: back in it, "Tập tiếp" closes the dialog on a paused session', async () => {
    const view = await begin();
    await pass(60 * S);
    press(END);
    await screen.findByText(EXIT);
    await pass(5 * S);
    await system('background');
    await pass(600 * S);
    await system('active');
    press(CONTINUE);
    expect(header('Đang tạm dừng')).toBeTruthy();
    await pass(10 * S);
    expect(left()).toBe('14:00');
    view.unmount();
  });
});

describe('recording the session', () => {
  test('"Kết thúc và lưu" sends the active seconds once, under the id of the session; the result is the server\'s', async () => {
    const view = await begin();
    await pass(60 * S);
    press('Tạm dừng');
    await pass(300 * S);
    press(CONTINUE);
    await pass(30 * S);
    press(END);
    const save = await screen.findByRole('button', { name: SAVE });
    const kept = jest.spyOn(pendingActions, 'enqueueAction');
    // two presses inside one frame: both reach the handler before anything is drawn again
    act(() => {
      fireEvent.press(save);
      fireEvent.press(save);
    });
    expect(await screen.findByRole('header', { name: 'Bạn đã bắt đầu, vậy là tốt rồi' })).toBeTruthy();
    // one record was written to this device, and one request left it
    expect(kept).toHaveBeenCalledTimes(1);
    expect(sessions()).toHaveLength(1);
    const [sent] = sessions();
    expect(sent.id).toMatch(UUID);
    // 60 + 30 trained; the 300 paused seconds are not in it; no `occurredAt` from the screen
    expect(sent.body).toEqual({ exerciseItemId: detail.id, elapsedSec: 90 });
    expect(screen.getByText('Đã ghi 01:30 trên 15:00')).toBeTruthy();
    view.unmount();
  });

  test('a session ended at once is one second long: the minimum that can be recorded', async () => {
    const view = await begin();
    await endAndSave();
    await screen.findByRole('header', { name: 'Bạn đã bắt đầu, vậy là tốt rồi' });
    expect(sessions()[0].body).toEqual({ exerciseItemId: detail.id, elapsedSec: 1 });
    view.unmount();
  });

  test('reaching the end finishes the session by itself, with the whole duration and not a second more', async () => {
    const view = await begin();
    await pass(10 * S);
    // two hours later by the device clock, and one tick
    jump(7200 * S);
    await pass(250);
    expect(await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' })).toBeTruthy();
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].body).toEqual({ exerciseItemId: detail.id, elapsedSec: 900 });
    view.unmount();
  });

  test('while its own request is out the session is "being saved": no result, no reward, and not shown as waiting', async () => {
    const view = await begin();
    await pass(600 * S);
    const request = hold(COMPLETE);
    await endAndSave();
    expect(await screen.findByRole('header', { name: 'Đang lưu buổi tập' })).toBeTruthy();
    expect(screen.getByText('Bạn đã tập 10:00 trên 15:00.')).toBeTruthy();
    expect(screen.queryByText(QUEUED)).toBeNull();
    expect(screen.queryByText(/XP|xu|hoàn thành/)).toBeNull();
    // there is no way out of the flow in this moment that would drop the record
    expect(screen.queryByRole('button', { name: 'Thoát buổi tập' })).toBeNull();

    const answer: WorkoutResult = { completed: true, xpAwarded: 44, coinAwarded: 20, elapsedSec: 600, durationSec: 900, day: world.day, delta: { xp: 44, coin: 20, events: [] } };
    await act(async () => request.release(respond(200, answer)));
    expect(await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' })).toBeTruthy();
    // the number is the one in the answer (no rule of the app gives 44)
    expect(screen.getByLabelText('+44 XP')).toBeTruthy();
    view.unmount();
  });

  test('the events of the answer go to the celebrations once, and its day becomes the day', async () => {
    gym.events = [{ type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 }];
    let queue: ReturnType<typeof useCelebrationQueue> = [];
    const Watch = () => {
      queue = useCelebrationQueue();
      return null;
    };
    const view = await begin({ extra: <Watch /> });
    await pass(600 * S);
    await endAndSave();
    await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' });
    expect(queue).toEqual([gym.events[0]]);
    const day = queryClient().getQueryData<typeof world.day>(['day']);
    expect(day?.quests.find(quest => quest.code === 'WORKOUT_MAIN')?.completed).toBe(true);
    view.unmount();
  });
});

describe('the session waits on this device', () => {
  test('no network: "đã lưu trên máy, đang chờ gửi", with no reward and nothing called done; the queue sends it later under the same id', async () => {
    const view = await begin();
    await pass(600 * S);
    world.down = true;
    await endAndSave();
    expect(await screen.findByRole('header', { name: QUEUED })).toBeTruthy();
    expect(screen.getByText('Bạn đã tập 10:00 trên 15:00.')).toBeTruthy();
    expect(screen.getByText('Phần thưởng được tính khi hệ thống nhận được buổi tập này. Bạn không cần làm gì thêm.')).toBeTruthy();
    // ten minutes of fifteen would complete the quest: nothing of that is claimed before the server says so
    expect(screen.queryByText(/XP|xu\b|hoàn thành/)).toBeNull();
    expect(screen.queryByText('Bạn đã dành thời gian cho mình')).toBeNull();
    // one retry on screen, the app-wide one; this screen adds neither a second one nor a count of its own
    expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(1);
    expect(sessions()).toHaveLength(1);

    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Buổi tập không còn chờ trên máy' })).toBeTruthy();
    expect(screen.getByText('Mở Hôm nay để xem kết quả.')).toBeTruthy();
    // the same action, sent again: one id, one body
    expect(sessions()).toHaveLength(2);
    expect(sessions()[1]).toEqual(sessions()[0]);
    // still no reward on this screen: the answer went to the queue, the day shows what became of it
    expect(screen.queryByText(/XP|xu\b/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Về Hôm nay' }));
    expect(await screen.findByRole('button', { name: /^Vận động vừa sức\. Đã hoàn thành buổi tập\. Đã xong/ })).toBeTruthy();
    view.unmount();
  });

  test('the server had it and only its answer was lost: it comes back as waiting, never as a result made up here', async () => {
    const view = await begin();
    await pass(600 * S);
    const server = world.answer;
    let lost = false;
    world.answer = async (request, init) => {
      if (request !== COMPLETE || lost) return server?.(request, init);
      lost = true;
      await server?.(request, init); // recorded by the server
      throw new TypeError('Network request failed'); // and the answer never arrives
    };
    await endAndSave();
    expect(await screen.findByRole('header', { name: QUEUED })).toBeTruthy();
    expect(gym.given).toBe(50);
    expect(screen.queryByText(/XP|xu\b|hoàn thành/)).toBeNull();

    // the network stays away for more than a minute; then the queue sends it again, now with `occurredAt`, and the
    // server answers that it already has this key
    world.down = true;
    await pass(61 * S);
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Buổi tập không còn chờ trên máy' })).toBeTruthy();
    // every try was the same action
    expect(new Set(sessions().map(sent => sent.id)).size).toBe(1);
    expect(sessions().at(-1)?.body).toEqual({ ...sessions()[0].body, occurredAt: expect.any(String) });
    expect(gym.given).toBe(50);
    expect(screen.queryByText(/XP|xu\b/)).toBeNull();
    // no refusal is shown for it either
    expect(screen.queryByText('Ghi nhận không được tính')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại bài tập' }));
    expect(await screen.findByRole('button', { name: 'Bắt đầu tập' })).toBeTruthy();
    view.unmount();
  });

  test('sent later by the queue and refused (the day had closed): the screen shows the refusal and its reason, with no retry and no reward', async () => {
    const view = await begin();
    await pass(600 * S);
    world.down = true;
    await endAndSave();
    await screen.findByRole('header', { name: QUEUED });
    world.down = false;
    const server = world.answer;
    world.answer = (request, init) => (request === COMPLETE ? refuse(409, 'DAY_CLOSED') : server?.(request, init));
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Buổi tập không được tính' })).toBeTruthy();
    // it does not read as if all were well
    expect(header('Buổi tập không còn chờ trên máy')).toBeNull();
    expect(header(QUEUED)).toBeNull();
    // the app-wide notice and this screen say the same thing
    expect(screen.getByRole('header', { name: 'Ghi nhận không được tính' })).toBeTruthy();
    expect(screen.getAllByText(DAY_CLOSED)).toHaveLength(2);

    // reading the notice makes the queue forget the refusal; the screen keeps what it saw
    press('Đã hiểu');
    await settle();
    expect(header('Ghi nhận không được tính')).toBeNull();
    expect(header('Buổi tập không được tính')).toBeTruthy();
    expect(screen.getAllByText(DAY_CLOSED)).toHaveLength(1);
    expect(screen.getByText('Bạn đã tập 10:00 trên 15:00.')).toBeTruthy();
    // nothing is left to try again (the queue has removed the record), and nothing was earned
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đã hiểu' })).toBeNull();
    expect(screen.queryByText(/XP|xu\b|hoàn thành/)).toBeNull();
    expect(new Set(sessions().map(sent => sent.id)).size).toBe(1);
    // hardware Back and the close button simply leave: there is nothing to lose
    press('Quay lại bài tập');
    expect(await screen.findByRole('button', { name: 'Bắt đầu tập' })).toBeTruthy();
    view.unmount();
  });

  test('the session ends while the request is out (the session expired): nothing of the answer reaches this device', async () => {
    let queue: ReturnType<typeof useCelebrationQueue> = [];
    const Watch = () => {
      queue = useCelebrationQueue();
      return null;
    };
    gym.events = [{ type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 }];
    const view = await begin({ extra: <Watch /> });
    await pass(600 * S);
    const request = hold(COMPLETE);
    await endAndSave();
    await screen.findByRole('header', { name: 'Đang lưu buổi tập' });
    const held = world.answer;
    world.answer = (asked, init) => (asked === 'GET /me' ? refuse(401, 'SESSION_INVALID') : held?.(asked, init));
    await act(() => api.get('/me').catch(() => undefined));
    await screen.findByRole('header', { name: 'Chào bạn trở lại' });
    expect(app.session.status).toBe('signedOut');

    const answer: WorkoutResult = { completed: true, xpAwarded: 50, coinAwarded: 20, elapsedSec: 600, durationSec: 900, day: world.day, delta: { xp: 50, coin: 20, events: gym.events } };
    await act(async () => request.release(respond(200, answer)));
    await settle();
    expect((await AsyncStorage.getAllKeys()).filter(key => key.startsWith('cache:'))).toEqual([]);
    expect(queue).toEqual([]);
    expect(screen.queryByText('Bạn đã dành thời gian cho mình')).toBeNull();
    view.unmount();
  });
});

describe('the session is refused', () => {
  test('the reason and "Thử lại", which sends the SAME session again: the same id, the same seconds', async () => {
    const view = await begin();
    await pass(600 * S);
    const server = world.answer;
    world.answer = (request, init) => (request === COMPLETE ? refuse(409, 'DAY_CLOSED') : server?.(request, init));
    await endAndSave();
    expect(await screen.findByRole('header', { name: 'Chưa lưu được buổi tập' })).toBeTruthy();
    expect(screen.getByText(DAY_CLOSED)).toBeTruthy();
    expect(screen.getByText('Bạn đã tập 10:00 trên 15:00.')).toBeTruthy();
    expect(screen.queryByText(/XP|xu\b|hoàn thành/)).toBeNull();
    // said here, next to the retry: the app-wide notice does not repeat it
    expect(screen.queryByText('Ghi nhận không được tính')).toBeNull();
    expect(sessions()).toHaveLength(1);

    // time passes before the retry: it is still the same session
    await pass(20 * S);
    world.answer = server;
    press('Thử lại');
    expect(await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' })).toBeTruthy();
    expect(sessions()).toHaveLength(2);
    expect(sessions()[1].id).toBe(sessions()[0].id);
    expect(sessions()[1].body).toEqual({ exerciseItemId: detail.id, elapsedSec: 600 });
    view.unmount();
  });

  test('this device cannot keep the record: said as such, and the retry is again the same session', async () => {
    const view = await begin();
    await pass(600 * S);
    const disk = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await endAndSave();
    expect(await screen.findByRole('header', { name: 'Chưa lưu được buổi tập' })).toBeTruthy();
    expect(screen.getByText('Máy chưa giữ được ghi nhận này. Bạn thử lại nhé.')).toBeTruthy();
    expect(sessions()).toEqual([]);
    disk.mockRestore();
    press('Thử lại');
    expect(await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' })).toBeTruthy();
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].id).toMatch(UUID);
    view.unmount();
  });

  test('the close button asks first: a session that is saved nowhere is not dropped with one tap', async () => {
    const view = await begin();
    await pass(600 * S);
    const server = world.answer;
    world.answer = (request, init) => (request === COMPLETE ? refuse(409, 'DAY_CLOSED') : server?.(request, init));
    await endAndSave();
    await screen.findByRole('header', { name: 'Chưa lưu được buổi tập' });
    press('Thoát buổi tập');
    expect(await screen.findByText('Buổi tập chưa được lưu')).toBeTruthy();
    expect(screen.getByText('Nếu thoát bây giờ, 10:00 bạn vừa tập sẽ không được ghi lại.')).toBeTruthy();
    // still on the session: nothing was left
    expect(header('Chưa lưu được buổi tập')).toBeTruthy();
    // the dialog offers the retry and the explicit way out, beside the two of the screen under it
    expect(screen.getAllByRole('button', { name: 'Thử lại' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Thoát, không lưu' })).toHaveLength(2);
    // the dialog's own "leave, unsaved": only now does the session go
    press('Thoát, không lưu');
    expect(await screen.findByRole('button', { name: 'Bắt đầu tập' })).toBeTruthy();
    expect(sessions()).toHaveLength(1);
    view.unmount();
  });

  test('hardware Back (Android) asks first as well; "Thử lại" in the dialog sends the same session again', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const handlers: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_event: string, handler: () => boolean) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    }) as never);
    const view = await begin();
    await pass(600 * S);
    const server = world.answer;
    world.answer = (request, init) => (request === COMPLETE ? refuse(409, 'DAY_CLOSED') : server?.(request, init));
    await endAndSave();
    await screen.findByRole('header', { name: 'Chưa lưu được buổi tập' });
    let handled = false;
    act(() => {
      handled = [...handlers].reverse().some(handler => handler() === true);
    });
    expect(handled).toBe(true);
    expect(await screen.findByText('Buổi tập chưa được lưu')).toBeTruthy();
    expect(header('Chưa lưu được buổi tập')).toBeTruthy();

    world.answer = server;
    press('Thử lại');
    expect(await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' })).toBeTruthy();
    expect(sessions()).toHaveLength(2);
    expect(sessions()[1]).toEqual(sessions()[0]);
    view.unmount();
  });

  test('"Thoát, không lưu" leaves to the workout the flow was started from', async () => {
    const view = await begin();
    await pass(30 * S);
    const server = world.answer;
    world.answer = (request, init) => (request === COMPLETE ? refuse(404, 'NOT_FOUND') : server?.(request, init));
    await endAndSave();
    await screen.findByRole('header', { name: 'Chưa lưu được buổi tập' });
    press('Thoát, không lưu');
    expect(await screen.findByRole('button', { name: 'Bắt đầu tập' })).toBeTruthy();
    expect(sessions()).toHaveLength(1);
    view.unmount();
  });
});

describe('nothing interrupts the session', () => {
  test('the stand-up reminder does not come over a running session, nor over its result', async () => {
    fakeTimers();
    foreground();
    const view = await openDetail();
    await pass(55 * 60 * S);
    fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu tập' }));
    await screen.findByRole('header', { name: 'Đang tập' });
    // the reminder's hour ran out five minutes ago
    await pass(10 * 60 * S);
    expect(left()).toBe('05:00');
    expect(screen.queryByText('Đến lúc đứng dậy vươn vai một chút')).toBeNull();
    await pass(5 * 60 * S);
    await screen.findByRole('header', { name: 'Bạn đã dành thời gian cho mình' });
    await pass(60 * S);
    expect(screen.queryByText('Đến lúc đứng dậy vươn vai một chút')).toBeNull();
    // back in the app proper a new hour has begun: nothing for 59 minutes, then the prompt
    press('Quay lại bài tập');
    await screen.findByRole('button', { name: 'Bắt đầu tập' });
    await pass(59 * 60 * S);
    expect(screen.queryByText('Đến lúc đứng dậy vươn vai một chút')).toBeNull();
    await pass(60 * S);
    expect(screen.getByText('Đến lúc đứng dậy vươn vai một chút')).toBeTruthy();
    view.unmount();
  });
});

describe('nothing is left running', () => {
  test('every 250 ms look at the clock is stopped by pausing, by ending and by leaving; unmounting leaves no timer at all', async () => {
    fakeTimers();
    const started = jest.spyOn(globalThis, 'setInterval');
    const stopped = jest.spyOn(globalThis, 'clearInterval');
    foreground();
    const view = await startSession();
    const looks = () => started.mock.results.filter((_, call) => started.mock.calls[call][1] === 250).map(result => result.value);
    const running = () => looks().filter(timer => !stopped.mock.calls.some(([cleared]) => cleared === timer));
    expect(running()).toHaveLength(1);
    press('Tạm dừng');
    expect(running()).toHaveLength(0);
    press(CONTINUE);
    expect(running()).toHaveLength(1);
    // the dialog holds the clock, so nobody needs to look at it
    press(END);
    await screen.findByText(EXIT);
    expect(running()).toHaveLength(0);
    press(CONTINUE);
    expect(running()).toHaveLength(1);
    await endAndSave();
    await screen.findByRole('header', { name: 'Bạn đã bắt đầu, vậy là tốt rồi' });
    expect(running()).toHaveLength(0);
    press(CONTINUE);
    await screen.findByRole('button', { name: 'Bắt đầu tập' });
    expect(running()).toHaveLength(0);

    // the query cache hands out its notifications on a 0 ms timer: let the last ones go
    await settle();
    view.unmount();
    wipeQueries(queryClient());
    expect(jest.getTimerCount()).toBe(0);
  });

  test('the workout is not in the cache any more: the session begins only once it has been read, with the whole duration left', async () => {
    fakeTimers();
    foreground();
    const view = await openDetail();
    const start = screen.getByRole('button', { name: 'Bắt đầu tập' });
    const asked = hold(`GET /workout/items/${detail.id}`);
    queryClient().removeQueries({ queryKey: ['workout', 'item', detail.id] });
    fireEvent.press(start);
    // a plain close button: there is no session yet to ask about
    expect(await screen.findByRole('button', { name: 'Thoát buổi tập' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(header('Đang tập')).toBeNull();
    // the time spent waiting for it is not trained time
    await pass(30 * S);
    await act(async () => asked.release(respond(200, detail)));
    expect(await screen.findByRole('header', { name: 'Đang tập' })).toBeTruthy();
    expect(left()).toBe('15:00');
    view.unmount();
  });
});
