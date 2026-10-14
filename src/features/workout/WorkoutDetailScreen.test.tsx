import { act, fireEvent, screen } from '@testing-library/react-native';
import { healthVi } from '../../shared/i18n/vi/health';
import { hold, refuse, respond, world } from '../dashboard/todayTestKit';
import { detail, gym, installWorkoutTestEnv, openCatalog, openDetail, sessions } from './workoutTestKit';

// The real registry; `navigate` of the detail screens is recorded on its way to the navigator, so the link to a route
// that no task has registered yet (MoveDemo: inert, AR-25) can still be asserted by name.
const mockNavigate = jest.fn();
jest.mock('../../app/screens', () => {
  const actual = jest.requireActual('../../app/screens');
  const { createElement } = require('react');
  const spied = (entry: { component: unknown }) => {
    function Spied(props: { navigation: { navigate(...to: unknown[]): void } }) {
      const navigate = (...to: unknown[]) => {
        mockNavigate(...to);
        props.navigation.navigate(...to);
      };
      return createElement(entry.component as never, { ...props, navigation: { ...props.navigation, navigate } } as never);
    }
    return { ...entry, component: Spied };
  };
  return { ...actual, detailScreens: actual.detailScreens.map(spied) };
});

installWorkoutTestEnv();

const START = 'Bắt đầu tập';
const button = (name: string) => screen.getByRole('button', { name });
async function open(options: Parameters<typeof openDetail>[0] = {}) {
  const view = await openDetail(options);
  mockNavigate.mockClear();
  return view;
}

describe('S18: one workout, before it starts', () => {
  test('its name, what it takes, its three phases, every move with its phase and amount, and the caution', async () => {
    const view = await open();
    expect(screen.getByRole('header', { name: 'Toàn thân vừa sức' })).toBeTruthy();
    expect(screen.getByText('15 phút · Trong phòng · Không dụng cụ')).toBeTruthy();
    // the energy is named as an estimate
    expect(screen.getByText('3 hiệp · 6 động tác · khoảng 70 kcal (ước tính)')).toBeTruthy();

    expect(screen.getByRole('header', { name: 'Đi theo nhịp của bạn' })).toBeTruthy();
    for (const phase of ['Chuyển động chậm, có kiểm soát', 'Phần tập chính', 'Theo hướng dẫn từng động tác', 'Kết thúc nhẹ nhàng']) expect(screen.getByText(phase)).toBeTruthy();

    expect(screen.getByRole('header', { name: 'Các động tác' })).toBeTruthy();
    const moves = screen.getAllByRole('button', { name: /^.+\. (Khởi động|Phần chính|Thả lỏng) · / }).map(item => item.props.accessibilityLabel);
    expect(moves).toEqual([
      'Xoay vai. Khởi động · 30 giây',
      'Squat tay trước ngực. Phần chính · 12 lần',
      'Chống đẩy tựa bàn. Phần chính · 10 lần',
      'Chùng chân lùi. Phần chính · 8 lần mỗi bên',
      'Plank tựa gối. Phần chính · giữ 20 giây',
      'Thả lỏng vai. Thả lỏng · 30 giây',
    ]);

    // the demo area, in words: the first move, how much of it, its three instruction lines
    expect(screen.getByText('Động tác đầu tiên')).toBeTruthy();
    expect(screen.getByText('Xoay vai · 30 giây')).toBeTruthy();
    detail.steps[0].move.steps.forEach((line, index) => expect(screen.getByText(`${index + 1}. ${line}`)).toBeTruthy());
    expect(screen.getByText('6 động tác · không có âm thanh')).toBeTruthy();

    // the caution is the reviewed sentence of the health module, word for word
    expect(healthVi.workoutCaution).toBe('Dừng nếu thấy đau hoặc khó chịu. Bạn luôn có thể nghỉ hoặc kết thúc sớm.');
    expect(screen.getByText(healthVi.workoutCaution)).toBeTruthy();
    expect(button(START)).toBeTruthy();
    expect(button('Đổi buổi tập')).toBeTruthy();
    // looking at a workout records nothing
    expect(sessions()).toEqual([]);
    view.unmount();
  });

  test('a workout that needs equipment names it', async () => {
    gym.workout = { ...detail, equipment: ['ta-tay', 'day-khang-luc'], spaceNeeded: 'GYM', durationSec: 1800 };
    const view = await open();
    expect(screen.getByText('30 phút · Phòng gym · Tạ tay, Dây kháng lực')).toBeTruthy();
    view.unmount();
  });

  test('each move opens its demo, by the code of the move and the id of the workout', async () => {
    const view = await open();
    fireEvent.press(button('Chùng chân lùi. Phần chính · 8 lần mỗi bên'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('MoveDemo', { workoutId: detail.id, code: 'CHUNG_CHAN_LUI' });
    fireEvent.press(button('Xoay vai. Khởi động · 30 giây'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoveDemo', { workoutId: detail.id, code: 'XOAY_VAI' });
    await act(async () => undefined);
    view.unmount();
  });

  test('"Đổi buổi tập" goes back to the catalog', async () => {
    const view = await open();
    fireEvent.press(button('Đổi buổi tập'));
    expect(await screen.findByRole('header', { name: 'Chọn buổi tập' })).toBeTruthy();
    view.unmount();
  });
});

describe('S18: starting', () => {
  test('"Bắt đầu tập" pressed twice opens one session; back on this screen the button works again', async () => {
    const view = await open();
    // two presses inside one frame: the same button, before the screen has changed
    const start = button(START);
    fireEvent.press(start);
    fireEvent.press(start);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('FocusSession', { id: detail.id });
    expect(await screen.findByRole('header', { name: 'Đang tập' })).toBeTruthy();

    // end it at once: one session reached the server, and leaving the result lands on this workout, not on a second session
    fireEvent.press(screen.getByRole('button', { name: 'Kết thúc buổi tập' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Kết thúc và lưu' }));
    expect(await screen.findByRole('header', { name: 'Bạn đã bắt đầu, vậy là tốt rồi' })).toBeTruthy();
    expect(sessions()).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: 'Tập tiếp' }));
    expect(await screen.findByRole('button', { name: START })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Đang tập' })).toBeNull();

    mockNavigate.mockClear();
    fireEvent.press(button(START));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('header', { name: 'Đang tập' })).toBeTruthy();
    view.unmount();
  });
});

describe('S18 cannot be loaded', () => {
  test('while it loads: a skeleton and Back; no button to start what is not known', async () => {
    const view = await openCatalog();
    const asked = hold(`GET /workout/items/${detail.id}`);
    fireEvent.press(await screen.findByRole('button', { name: `Xem hướng dẫn: ${detail.name}` }));
    expect(await screen.findByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    await act(async () => asked.release(respond(200, detail)));
    expect(await screen.findByRole('button', { name: START })).toBeTruthy();
    view.unmount();
  });

  test('it cannot be read: the error state with "Thử lại", which loads it', async () => {
    const view = await openCatalog();
    const server = world.answer;
    world.answer = (request, init) => (request.startsWith('GET /workout/items/') ? refuse(500, 'INTERNAL') : server?.(request, init));
    fireEvent.press(await screen.findByRole('button', { name: `Xem hướng dẫn: ${detail.name}` }));
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.getByText(/^Hệ thống đang gặp sự cố/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: START })).toBeNull();
    world.answer = server;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: START })).toBeTruthy();
    view.unmount();
  });
});
