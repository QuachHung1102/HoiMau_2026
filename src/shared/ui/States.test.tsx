import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, AppState, Platform } from 'react-native';
import { MotionPreferenceProvider, resetSystemMotionForTests } from '../motion/useReducedMotion';
import { colors } from '../theme/tokens';
import { EmptyState, ErrorState, LoadingState } from './States';

afterEach(() => jest.restoreAllMocks());
const wrap = (node: React.ReactElement, motion: 'REDUCED' | 'FULL' = 'REDUCED') => (
  <MotionPreferenceProvider value={motion}>{node}</MotionPreferenceProvider>
);

test('LoadingState is one busy progress element labelled "Đang tải"', () => {
  const view = render(wrap(<LoadingState />));
  const el = view.getByRole('progressbar', { name: 'Đang tải' });
  expect(el.props.accessibilityState).toMatchObject({ busy: true });
  view.unmount();
});

test('LoadingState starts no animation loop under reduced motion (OS setting, as the hook test reads it)', () => {
  resetSystemMotionForTests();
  // the OS value stays unknown, so the hook reports reduced
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never);
  const loop = jest.spyOn(Animated, 'loop');
  const view = render(<LoadingState />);
  expect(loop).not.toHaveBeenCalled();
  view.unmount();
  resetSystemMotionForTests();
});

test('LoadingState loops the 1200 ms shimmer under full motion and stops it on unmount', () => {
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
  const timing = jest.spyOn(Animated, 'timing');
  const view = render(wrap(<LoadingState />, 'FULL'));
  expect(loop).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 1200 }));
  view.unmount();
  expect(stop).toHaveBeenCalled();
});

test('LoadingState stops its loop when the app goes to the background', () => {
  let onChange: (state: string) => void = () => undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    onChange = cb;
    return { remove: jest.fn() };
  }) as never);
  const stop = jest.fn();
  jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
  const view = render(wrap(<LoadingState />, 'FULL'));
  act(() => onChange('background'));
  expect(stop).toHaveBeenCalled();
  view.unmount();
});

test('ErrorState shows the message and "Thử lại", and the retry fires', () => {
  const onRetry = jest.fn();
  const view = render(wrap(<ErrorState message="Kiểm tra kết nối rồi thử lại." onRetry={onRetry} />));
  expect(view.getByText('Kiểm tra kết nối rồi thử lại.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Thử lại' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('EmptyState shows title and body, fires both actions, and never uses the error colour', () => {
  const primary = jest.fn();
  const secondary = jest.fn();
  const view = render(
    wrap(
      <EmptyState
        title="Chưa có thư mới"
        body="Lời nhắc từ tổ đội sẽ xuất hiện ở đây."
        primary={{ label: 'Cài đặt thông báo', onPress: primary }}
        secondary={{ label: 'Để lúc khác', onPress: secondary }}
      />,
    ),
  );
  expect(view.getByText('Chưa có thư mới')).toBeTruthy();
  expect(view.getByText('Lời nhắc từ tổ đội sẽ xuất hiện ở đây.')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Cài đặt thông báo' }));
  fireEvent.press(view.getByRole('button', { name: 'Để lúc khác' }));
  expect(primary).toHaveBeenCalledTimes(1);
  expect(secondary).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(view.toJSON())).not.toContain(colors.error);
  view.unmount();
});

test('EmptyState without actions renders no buttons', () => {
  const view = render(wrap(<EmptyState title="Chưa có gì" body="Quay lại sau nhé." />));
  expect(view.queryByRole('button')).toBeNull();
  view.unmount();
});

test('LoadingState runs the shimmer only while active, in the foreground and with motion allowed', () => {
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
  const view = render(wrap(<LoadingState active={false} />, 'FULL'));
  expect(loop).not.toHaveBeenCalled();
  view.rerender(wrap(<LoadingState active />, 'FULL'));
  expect(loop).toHaveBeenCalledTimes(1);
  view.rerender(wrap(<LoadingState active={false} />, 'FULL')); // the screen lost focus
  expect(stop).toHaveBeenCalled();
  view.unmount();
});

test('ErrorState shows the load-failure title by default and a custom title when given', () => {
  const view = render(wrap(<ErrorState message="Thử lại nhé." onRetry={jest.fn()} />));
  expect(view.getByText('Chưa tải được dữ liệu')).toBeTruthy();
  view.rerender(wrap(<ErrorState title="Chưa gửi được lời nhắc" message="Thử lại nhé." onRetry={jest.fn()} />));
  expect(view.getByText('Chưa gửi được lời nhắc')).toBeTruthy();
  expect(view.queryByText('Chưa tải được dữ liệu')).toBeNull();
  view.unmount();
});

describe('where a live region is the only announcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  });

  test('ErrorState announces its text on iOS, which ignores live regions', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const view = render(wrap(<ErrorState message="Thử lại nhé." onRetry={jest.fn()} />));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Chưa tải được dữ liệu. Thử lại nhé.');
    view.unmount();
  });

  test('ErrorState does not announce on Android, where the live region already does', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = render(wrap(<ErrorState message="Thử lại nhé." onRetry={jest.fn()} />));
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    view.unmount();
  });
});
