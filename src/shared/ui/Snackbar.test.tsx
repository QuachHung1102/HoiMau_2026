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
// async: the screen-reader check resolves in a microtask after the snackbar mounts
const show = (options: SnackbarOptions) => act(async () => api.show(options));
const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

let screenReader: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks(); // the preset's AccessibilityInfo methods are shared jest.fn()s: counts would carry over
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  screenReader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('show displays the message and announces it', async () => {
  const view = mount();
  await show({ message: 'Đã lưu thêm một phần nước' });
  expect(view.getByText('Đã lưu thêm một phần nước')).toBeTruthy();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Đã lưu thêm một phần nước');
  view.unmount();
});

test('the action is a button that fires once and dismisses', async () => {
  const onPress = jest.fn();
  const view = mount();
  await show({ message: 'Đã lưu', action: { label: 'Hoàn tác', onPress }, durationMs: 5000 });
  const button = view.getByRole('button', { name: 'Hoàn tác' });
  // both presses land before React re-renders, so only the component's own guard can stop the second
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

test('auto-dismisses after durationMs and not before', async () => {
  const view = mount();
  await show({ message: 'Đã lưu', durationMs: 3000 });
  await advance(2999);
  expect(view.getByText('Đã lưu')).toBeTruthy();
  await advance(1);
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

test('the default duration is 4000 ms', async () => {
  const view = mount();
  await show({ message: 'Đã lưu' });
  await advance(3999);
  expect(view.getByText('Đã lưu')).toBeTruthy();
  await advance(1);
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

test('under reduced motion a countdown is written as seconds, and counts down', async () => {
  const view = mount('REDUCED');
  await show({ message: 'Đã lưu', countdown: true, durationMs: 5000, action: { label: 'Hoàn tác', onPress: jest.fn() } });
  expect(view.getByText('Còn 5 giây')).toBeTruthy();
  await advance(2000);
  expect(view.getByText('Còn 3 giây')).toBeTruthy();
  view.unmount();
});

test('under full motion a countdown draws a bar and writes no seconds', async () => {
  const view = mount('FULL');
  await show({ message: 'Đã lưu', countdown: true, durationMs: 5000 });
  expect(view.queryByText(/Còn \d+ giây/)).toBeNull();
  view.unmount();
});

test('a second show replaces the first, and the first timer does not close the second', async () => {
  const view = mount();
  // the same duration for both: a snackbar that was reused instead of replaced would keep the first timer
  await show({ message: 'Một', durationMs: 3000 });
  await advance(1000);
  await show({ message: 'Hai', durationMs: 3000 });
  expect(view.queryByText('Một')).toBeNull();
  expect(view.getByText('Hai')).toBeTruthy();
  await advance(2500); // t = 3500: past the first timer's 3000 ms
  expect(view.getByText('Hai')).toBeTruthy();
  await advance(500); // t = 4000: the second timer's 3000 ms
  expect(view.queryByText('Hai')).toBeNull();
  view.unmount();
});

test('dismiss() removes the current snackbar', async () => {
  const view = mount();
  await show({ message: 'Đã lưu' });
  await act(async () => api.dismiss());
  expect(view.queryByText('Đã lưu')).toBeNull();
  view.unmount();
});

describe('with a screen reader on', () => {
  beforeEach(() => {
    screenReader.mockResolvedValue(true);
    jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValue(7); // Jest has no native handles
  });

  test('announces the message and the action together and moves focus to the action', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    const view = mount();
    await show({ message: 'Đã lưu thêm một phần nước', action: { label: 'Hoàn tác', onPress: jest.fn() } });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Đã lưu thêm một phần nước. Nút Hoàn tác.');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(7);
    view.unmount();
  });

  test('uses screenReaderDurationMs instead of durationMs', async () => {
    jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    const view = mount();
    await show({ message: 'Đã lưu', durationMs: 5000, screenReaderDurationMs: 9000, action: { label: 'Hoàn tác', onPress: jest.fn() } });
    await advance(5001);
    expect(view.getByText('Đã lưu')).toBeTruthy();
    await advance(3998);
    expect(view.getByText('Đã lưu')).toBeTruthy();
    await advance(2);
    expect(view.queryByText('Đã lưu')).toBeNull();
    view.unmount();
  });

  test('without screenReaderDurationMs the normal duration applies, and a snackbar without an action takes no focus', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    const view = mount();
    await show({ message: 'Đã lưu', durationMs: 3000 });
    expect(focus).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Đã lưu');
    await advance(3000);
    expect(view.queryByText('Đã lưu')).toBeNull();
    view.unmount();
  });
});

test('with the screen reader off the longer duration is ignored and focus stays put', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  const view = mount();
  await show({ message: 'Đã lưu', durationMs: 5000, screenReaderDurationMs: 9000, action: { label: 'Hoàn tác', onPress: jest.fn() } });
  expect(focus).not.toHaveBeenCalled();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Đã lưu');
  await advance(5000);
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

test.each([['REDUCED'], ['FULL']] as const)('unmounting leaves no timer behind (%s motion, with countdown)', async motion => {
  const timers = watchTimers();
  const view = mount(motion);
  await show({ message: 'Đã lưu', countdown: true, durationMs: 5000, action: { label: 'Hoàn tác', onPress: jest.fn() } });
  expect(timers.live.size).toBeGreaterThan(0);
  view.unmount();
  expect(timers.live.size).toBe(0);
  timers.restore();
});

test('useSnackbar outside a provider fails loudly', () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Grab />)).toThrow('SnackbarProvider');
});
