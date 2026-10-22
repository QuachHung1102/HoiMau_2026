import { act, fireEvent, screen } from '@testing-library/react-native';
import { Image } from 'react-native';
import { poses } from '../../assets/motion/poses';
import { healthVi } from '../../shared/i18n/vi/health';
import { hold, queryClient, respond } from '../dashboard/todayTestKit';
import { RigPlayer } from './RigPlayer';
import { detail, fakeTimers, foreground, gym, pass, installWorkoutTestEnv, openCatalog, openDetail } from './workoutTestKit';

// What the figure is given (the figure itself: RigPlayer.test.tsx).
jest.mock('./RigPlayer', () => ({ RigPlayer: jest.fn(() => null) }));
const player = RigPlayer as unknown as jest.Mock;
// S18 beneath shows the first move's demo too: only the calls for other moves are S82's.
const ofS82 = () => player.mock.calls.map(([props]) => props).filter(props => props.demoCode !== detail.steps[0].move.demoCode);
const last = () => ofS82().at(-1);

installWorkoutTestEnv();

const SQUAT = detail.steps[1];
const row = (step: (typeof detail.steps)[number]) => `${step.move.name}. Phần chính · ${step.repsText}`;
async function openMove(step = SQUAT, options: Parameters<typeof openDetail>[0] = { motion: 'FULL' }) {
  const view = await openDetail(options);
  fireEvent.press(screen.getByRole('button', { name: row(step) }));
  await screen.findByRole('header', { name: step.move.name });
  return view;
}

beforeEach(() => player.mockClear());

describe('S82: one move, shown and told', () => {
  test('its name and amount, the looping demo, its three numbered steps, its caution and the health caution', async () => {
    const view = await openMove();
    expect(screen.getByText('Phần chính · 12 lần')).toBeTruthy();
    expect(last()).toEqual(expect.objectContaining({ demoCode: SQUAT.move.demoCode, speed: 1, active: true }));
    expect(screen.getByText('Không có âm thanh')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Cách làm' })).toBeTruthy();
    SQUAT.move.steps.forEach((line, index) => {
      expect(screen.getByText(String(index + 1))).toBeTruthy();
      expect(screen.getByText(line)).toBeTruthy();
    });
    expect(screen.getByText('Lưu ý')).toBeTruthy();
    expect(screen.getByText(SQUAT.move.caution)).toBeTruthy();
    expect(screen.getByText(healthVi.workoutCaution)).toBeTruthy();
    view.unmount();
  });

  test('"Xem chậm 0,5×" is a switch that says its state, and halves the speed of the demo', async () => {
    const view = await openMove();
    const slow = () => screen.getByRole('switch', { name: /Xem chậm 0,5×/ });
    expect(slow().props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText('Đang tắt')).toBeTruthy();
    fireEvent.press(slow());
    expect(slow().props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText('Đang bật')).toBeTruthy();
    expect(last()).toEqual(expect.objectContaining({ speed: 0.5 }));
    view.unmount();
  });

  test('"Tạm dừng" stops the demo and "Phát tiếp" plays it again', async () => {
    const view = await openMove();
    fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(last()).toEqual(expect.objectContaining({ active: false }));
    fireEvent.press(screen.getByRole('button', { name: 'Phát tiếp' }));
    expect(last()).toEqual(expect.objectContaining({ active: true }));
    view.unmount();
  });

  test('reduced motion: the key pose, still; nothing to pause or slow down; the steps are the same', async () => {
    const view = await openMove(SQUAT, {});
    expect(player).not.toHaveBeenCalled();
    expect(screen.UNSAFE_getAllByType(Image).map(image => image.props.source)).toContain(poses[SQUAT.move.demoCode as string]);
    expect(screen.queryByRole('switch', { name: /Xem chậm/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tạm dừng' })).toBeNull();
    SQUAT.move.steps.forEach(line => expect(screen.getByText(line)).toBeTruthy());
    view.unmount();
  });

  // The phase text of a timed demo keeps cycling under reduced motion (WCAG 2.2.2: auto-updating content can be paused).
  test.each([
    ['exercise-tho-bung', ['Hít vào', 'Thở ra']],
    ['exercise-tha-long-tung-vung', ['Thả lỏng trán', 'Thả lỏng vai']],
  ])('reduced motion: the timed demo %s keeps "Tạm dừng", and pressing it stops the phase text', async (demoCode, [first, second]) => {
    fakeTimers();
    foreground();
    gym.workout = { ...detail, steps: detail.steps.map((step, i) => (i === 1 ? { ...step, move: { ...step.move, demoCode } } : step)) };
    const view = await openMove(SQUAT, {});
    expect(screen.queryByRole('switch', { name: /Xem chậm/ })).toBeNull();
    expect(screen.getByText(first)).toBeTruthy();
    await pass(5000);
    expect(screen.getByText(second)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
    await pass(30000);
    expect(screen.getByText(second)).toBeTruthy(); // stopped on the phase it was on
    fireEvent.press(screen.getByRole('button', { name: 'Phát tiếp' }));
    expect(screen.getByText(first)).toBeTruthy(); // running again, from its first phase
    view.unmount();
  });

  test('a move without a demo: no figure and no demo controls; the steps and the caution carry it', async () => {
    gym.workout = { ...detail, steps: detail.steps.map((step, i) => (i === 1 ? { ...step, move: { ...step.move, demoCode: null } } : step)) };
    const view = await openMove();
    expect(ofS82()).toEqual([]);
    expect(screen.queryByText('Không có âm thanh')).toBeNull();
    expect(screen.queryByRole('switch', { name: /Xem chậm/ })).toBeNull();
    SQUAT.move.steps.forEach(line => expect(screen.getByText(line)).toBeTruthy());
    expect(screen.getByText(SQUAT.move.caution)).toBeTruthy();
    view.unmount();
  });

  test('"Quay lại buổi tập" and Back return to the workout', async () => {
    const view = await openMove();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại buổi tập' }));
    expect(await screen.findByRole('header', { name: detail.name })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: row(SQUAT) }));
    await screen.findByRole('header', { name: SQUAT.move.name });
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: detail.name })).toBeTruthy();
    view.unmount();
  });
});

describe('S82 cannot show the move', () => {
  test('the workout is no longer in the cache: loading, then the move once it is read', async () => {
    // fake timers: a query read again after removeQueries leaves no real gc timer to keep Jest alive
    fakeTimers();
    foreground();
    const view = await openCatalog();
    fireEvent.press(await screen.findByRole('button', { name: `Xem hướng dẫn: ${detail.name}` }));
    await screen.findByRole('header', { name: detail.name });
    const asked = hold(`GET /workout/items/${detail.id}`);
    queryClient().removeQueries({ queryKey: ['workout', 'item', detail.id] });
    fireEvent.press(screen.getByRole('button', { name: row(SQUAT) }));
    expect(await screen.findByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    await act(async () => asked.release(respond(200, detail)));
    expect(await screen.findByRole('header', { name: SQUAT.move.name })).toBeTruthy();
    view.unmount();
  });

  test('the move is not in the workout any more (its content changed meanwhile): said so, with "Thử lại"', async () => {
    const view = await openMove();
    gym.workout = { ...detail, steps: detail.steps.filter(step => step !== SQUAT) };
    await act(async () => queryClient().setQueryData(['workout', 'item', detail.id], gym.workout));
    expect(await screen.findByText('Không tìm thấy động tác này trong buổi tập.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: SQUAT.move.name })).toBeNull();
    view.unmount();
  });
});
