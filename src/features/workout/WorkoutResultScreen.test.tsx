import { act, fireEvent, screen } from '@testing-library/react-native';
import type { WorkoutResult } from '../../../domain/contract/content.ts';
import { wipeQueries } from '../../shared/api/session';
import { Mam } from '../../shared/ui/mam/Mam';
import { dayOf, queryClient, respond, settle, world } from '../dashboard/todayTestKit';
import { COMPLETE, detail, fakeTimers, foreground, gym, installWorkoutTestEnv, pass, sessions, startSession } from './workoutTestKit';

installWorkoutTestEnv();

const S = 1000;
const COMPLETED = 'Bạn đã dành thời gian cho mình';
const PARTIAL = 'Bạn đã bắt đầu, vậy là tốt rồi';
const press = (name: string) => fireEvent.press(screen.getAllByRole('button', { name }).at(-1) as never);
const mam = () => screen.UNSAFE_getAllByType(Mam).at(-1)?.props;

/** A session of `seconds`, ended and recorded: the result screen with the server's answer. */
async function resultAfter(seconds: number, options: Parameters<typeof startSession>[0] = {}) {
  fakeTimers();
  foreground();
  const view = await startSession(options);
  jest.setSystemTime(Date.now() + seconds * S);
  await pass(250);
  press('Kết thúc buổi tập');
  fireEvent.press(await screen.findByRole('button', { name: 'Kết thúc và lưu' }));
  return view;
}
/** The server answers the recorded session with `answer` (its own numbers, whatever the rules of the app would give). */
function serverAnswers(answer: Partial<WorkoutResult>) {
  const server = world.answer;
  world.answer = (request, init) =>
    request === COMPLETE ? respond(200, { completed: true, xpAwarded: 0, coinAwarded: 0, elapsedSec: 600, durationSec: 900, day: world.day, delta: { xp: 0, coin: 0, events: [] }, ...answer }) : server?.(request, init);
}
const questDone = () => dayOf({ quests: dayOf().quests.map(quest => (quest.code === 'WORKOUT_MAIN' ? { ...quest, completed: true, progress: 1 } : quest)), story: { done: 1, total: 2 } });

describe('S20: the server recorded a completed session', () => {
  test('at least half of the duration: the words of a completed session, the XP and coins of the answer, the quest named done, Mầm cheering once', async () => {
    const view = await resultAfter(600);
    expect(await screen.findByRole('header', { name: COMPLETED })).toBeTruthy();
    expect(screen.getByText('Buổi tập đã được ghi nhận.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Một bước nữa trên hành trình' })).toBeTruthy();
    expect(screen.getByText('Đã ghi 10:00 trên 15:00')).toBeTruthy();
    expect(screen.getByLabelText('+50 XP')).toBeTruthy();
    expect(screen.getByLabelText('+20 xu')).toBeTruthy();
    expect(screen.getByText('Việc chính: Buổi tập chính đã hoàn thành')).toBeTruthy();
    // the full ring carries the time trained, as text and for a screen reader
    expect(screen.getByRole('progressbar', { name: 'Đã ghi 10:00 trên 15:00', value: { now: 100 } })).toBeTruthy();
    expect(screen.getByText('đã tập')).toBeTruthy();
    // decorative beside the words; the cheer is its own one-shot (not replayed on refocus)
    expect(mam()).toMatchObject({ animation: 'cheer', mood: 'HAPPY', decorative: true, active: true });
    expect(screen.queryByText(PARTIAL)).toBeNull();
    expect(screen.queryByText(/chưa tính hoàn thành/)).toBeNull();
    expect(sessions()).toHaveLength(1);
    view.unmount();
  });

  test('every number is the one in the answer, not one the app could work out', async () => {
    serverAnswers({ completed: true, xpAwarded: 17, coinAwarded: 3, elapsedSec: 777, durationSec: 900, day: questDone() });
    const view = await resultAfter(600);
    expect(await screen.findByRole('header', { name: COMPLETED })).toBeTruthy();
    expect(screen.getByLabelText('+17 XP')).toBeTruthy();
    expect(screen.getByLabelText('+3 xu')).toBeTruthy();
    expect(screen.getByText('Đã ghi 12:57 trên 15:00')).toBeTruthy();
    expect(screen.queryByText(/\+50 XP|\+20 xu|10:00/)).toBeNull();
    view.unmount();
  });

  test('a second completed session of the day earns nothing more: no reward is shown, and the quest is still named done', async () => {
    world.day = questDone();
    gym.given = 50;
    const view = await resultAfter(600);
    expect(await screen.findByRole('header', { name: COMPLETED })).toBeTruthy();
    expect(screen.queryByText(/XP|xu\b/)).toBeNull();
    expect(screen.getByText('Việc chính: Buổi tập chính đã hoàn thành')).toBeTruthy();
    view.unmount();
  });

  test('the day in the answer does not have the quest done: it is not named done here either', async () => {
    serverAnswers({ completed: true, xpAwarded: 50, coinAwarded: 20, day: dayOf() });
    const view = await resultAfter(600);
    expect(await screen.findByRole('header', { name: COMPLETED })).toBeTruthy();
    expect(screen.queryByText(/Việc chính/)).toBeNull();
    view.unmount();
  });

  test('"Về Hôm nay" closes the flow on the home tab, where the quest is done; "Quay lại bài tập" would return to the workout', async () => {
    const view = await resultAfter(600);
    await screen.findByRole('header', { name: COMPLETED });
    expect(screen.getByRole('button', { name: 'Quay lại bài tập' })).toBeTruthy();
    press('Về Hôm nay');
    expect(await screen.findByRole('header', { name: 'Hôm nay' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Vận động vừa sức\. Đã hoàn thành buổi tập\. Đã xong/ })).toBeTruthy();
    expect(screen.queryByRole('header', { name: COMPLETED })).toBeNull();
    view.unmount();
  });

  test.each(['Quay lại bài tập', 'Quay lại'])('"%s" leaves to the workout the flow was started from', async name => {
    const view = await resultAfter(600);
    await screen.findByRole('header', { name: COMPLETED });
    press(name);
    expect(await screen.findByRole('button', { name: 'Bắt đầu tập' })).toBeTruthy();
    expect(screen.getByRole('header', { name: detail.name })).toBeTruthy();
    view.unmount();
  });
});

describe('S64: the server recorded a session under half of the duration', () => {
  test('what was recorded and its share of the XP; nothing is called complete, and no coins are named', async () => {
    const view = await resultAfter(378);
    expect(await screen.findByRole('header', { name: PARTIAL })).toBeTruthy();
    expect(screen.getByText('Đã ghi 06:18 trên 15:00')).toBeTruthy();
    // floor(50 x 378 / 900), worked out by the stand-in server
    expect(screen.getByLabelText(`+${Math.floor((50 * 378) / 900)} XP theo phần đã tập`)).toBeTruthy();
    expect(screen.getByText('Buổi này chưa tính hoàn thành việc chính hôm nay. Bạn có thể tập tiếp khi sẵn sàng.')).toBeTruthy();
    expect(screen.queryByText(COMPLETED)).toBeNull();
    expect(screen.queryByText(/đã hoàn thành|Một bước nữa|xu\b/)).toBeNull();
    // Mầm is there, not cheering
    expect(mam()).toMatchObject({ animation: 'idle', decorative: true });
    expect(screen.queryByTestId('workout-burst', { includeHiddenElements: true })).toBeNull();
    view.unmount();
  });

  test('a short session after the quest was done earlier in the day: no XP is named, and the quest is not called undone', async () => {
    world.day = questDone();
    gym.given = 50;
    const view = await resultAfter(120);
    expect(await screen.findByRole('header', { name: PARTIAL })).toBeTruthy();
    expect(screen.getByText('Việc chính hôm nay đã xong từ buổi tập trước.')).toBeTruthy();
    expect(screen.queryByText(/XP/)).toBeNull();
    expect(screen.queryByText(/chưa tính hoàn thành/)).toBeNull();
    view.unmount();
  });

  test('"Tập tiếp" returns to the workout; "Về Hôm nay" to the home tab, where the quest is still open', async () => {
    const view = await resultAfter(378);
    await screen.findByRole('header', { name: PARTIAL });
    press('Tập tiếp');
    expect(await screen.findByRole('button', { name: 'Bắt đầu tập' })).toBeTruthy();
    expect(screen.getByRole('header', { name: detail.name })).toBeTruthy();
    view.unmount();
  });

  test('"Về Hôm nay" shows the home tab with the quest still open', async () => {
    const view = await resultAfter(378);
    await screen.findByRole('header', { name: PARTIAL });
    press('Về Hôm nay');
    expect(await screen.findByRole('header', { name: 'Hôm nay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Vận động vừa sức\. Chưa bắt đầu\. \+50 XP/ })).toBeTruthy();
    view.unmount();
  });
});

describe('the celebration', () => {
  test('with reduced motion nothing flies or swells: the words, the ring and Mầm are simply there', async () => {
    const view = await resultAfter(600);
    await screen.findByRole('header', { name: COMPLETED });
    expect(screen.queryByTestId('workout-burst', { includeHiddenElements: true })).toBeNull();
    view.unmount();
  });

  test('with motion on: one burst, hidden from screen readers, that ends by itself and leaves nothing running', async () => {
    const view = await resultAfter(600, { motion: 'FULL' });
    await screen.findByRole('header', { name: COMPLETED });
    const burst = screen.getByTestId('workout-burst', { includeHiddenElements: true });
    expect(burst.props.accessibilityElementsHidden).toBe(true);
    expect(burst.props.importantForAccessibility).toBe('no-hide-descendants');
    // 16 pieces, in the flame and lime tokens only (gold is for coins and prices)
    const colours = burst.children.map(piece => (typeof piece === 'string' ? '' : [piece.props.style].flat(Infinity).find((style: { backgroundColor?: string }) => style?.backgroundColor)?.backgroundColor));
    expect(colours).toHaveLength(16);
    expect(new Set(colours)).toEqual(new Set(['#C2410C', '#D8F58A']));
    await pass(3 * S);
    // everything on screen is still the server's result
    expect(screen.getByLabelText('+50 XP')).toBeTruthy();
    await act(async () => undefined);
    await settle();
    view.unmount();
    wipeQueries(queryClient());
    expect(jest.getTimerCount()).toBe(0);
  });
});
