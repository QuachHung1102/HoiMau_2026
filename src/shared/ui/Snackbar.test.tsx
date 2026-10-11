import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { SnackbarProvider, useSnackbar, type SnackbarOptions } from './Snackbar';

let api: ReturnType<typeof useSnackbar>;
function Grab() {
  api = useSnackbar();
  return <Text>nội dung</Text>;
}
const mount = (motion: 'REDUCED' | 'FULL' = 'REDUCED') =>
  render(
    <MotionPreferenceProvider value={motion}>
      <SnackbarProvider>
        <Grab />
      </SnackbarProvider>
    </MotionPreferenceProvider>,
  );
const show = (options: SnackbarOptions) => act(() => api.show(options));

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('show displays the message and announces it', () => {
  const view = mount();
  show({ message: 'Đã lưu thêm một phần nước' });
  expect(view.getByText('Đã lưu thêm một phần nước')).toBeTruthy();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Đã lưu thêm một phần nước');
  view.unmount();
});

test('the action is a button that fires once and dismisses', () => {
  const onPress = jest.fn();
  const view = mount();
  show({ message: 'Đã lưu', action: { label: 'Hoàn tác', onPress } });
  const button = view.getByRole('button', { name: 'Hoàn tác' });
  fireEvent.press(button);
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

test('auto-dismisses after durationMs and not before', () => {
  const view = mount();
  show({ message: 'Đã lưu', durationMs: 3000 });
  act(() => jest.advanceTimersByTime(2999));
  expect(view.getByText('Đã lưu')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1));
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

test('the default duration is 4000 ms', () => {
  const view = mount();
  show({ message: 'Đã lưu' });
  act(() => jest.advanceTimersByTime(3999));
  expect(view.getByText('Đã lưu')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1));
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

test('under reduced motion a countdown is written as seconds, and counts down', () => {
  const view = mount('REDUCED');
  show({ message: 'Đã lưu', countdown: true, durationMs: 5000, action: { label: 'Hoàn tác', onPress: jest.fn() } });
  expect(view.getByText('Còn 5 giây')).toBeTruthy();
  act(() => jest.advanceTimersByTime(2000));
  expect(view.getByText('Còn 3 giây')).toBeTruthy();
  view.unmount();
});

test('under full motion a countdown draws a bar and writes no seconds', () => {
  const view = mount('FULL');
  show({ message: 'Đã lưu', countdown: true, durationMs: 5000 });
  expect(view.queryByText(/Còn \d+ giây/)).toBeNull();
  view.unmount();
});

test('a second show replaces the first, and the first timer does not close the second', () => {
  const view = mount();
  show({ message: 'Một', durationMs: 2000 });
  act(() => jest.advanceTimersByTime(1000));
  show({ message: 'Hai', durationMs: 3000 });
  expect(view.queryByText('Một')).toBeNull();
  expect(view.getByText('Hai')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1500)); // past the first timer's 2000 ms
  expect(view.getByText('Hai')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1500));
  expect(view.queryByText('Hai')).toBeNull();
  view.unmount();
});

test('dismiss() removes the current snackbar', () => {
  const view = mount();
  show({ message: 'Đã lưu' });
  act(() => api.dismiss());
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

// Records every timer the code under test starts and has not cleared yet. (jest.getTimerCount() also counts
// React's own scheduler tasks, which are not ours to clear.)
const watchTimers = () => {
  const live = new Set<unknown>();
  const real = { setTimeout, setInterval, clearTimeout, clearInterval };
  const start = (starter: typeof setTimeout | typeof setInterval) =>
    ((fn: never, ms?: number) => {
      const id = (starter as (f: never, m?: number) => unknown)(fn, ms);
      // the RN Jest preset fakes native animation completion with its own 16 ms timer: not ours
      if (!new Error().stack?.includes('jest-preset')) live.add(id);
      return id;
    }) as never;
  const stop = (stopper: (id: never) => void) =>
    ((id: never) => {
      live.delete(id);
      stopper(id);
    }) as never;
  globalThis.setTimeout = start(real.setTimeout);
  globalThis.setInterval = start(real.setInterval);
  globalThis.clearTimeout = stop(real.clearTimeout as never);
  globalThis.clearInterval = stop(real.clearInterval as never);
  return { live, restore: () => Object.assign(globalThis, real) };
};

test.each([['REDUCED'], ['FULL']] as const)('unmounting leaves no timer behind (%s motion, with countdown)', motion => {
  const timers = watchTimers();
  const view = mount(motion);
  show({ message: 'Đã lưu', countdown: true, durationMs: 5000, action: { label: 'Hoàn tác', onPress: jest.fn() } });
  expect(timers.live.size).toBeGreaterThan(0);
  view.unmount();
  expect(timers.live.size).toBe(0);
  timers.restore();
});

test('useSnackbar outside a provider fails loudly', () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Grab />)).toThrow('SnackbarProvider');
});
