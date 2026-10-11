import { fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, Modal } from 'react-native';
import { motion as tokens } from '../motion/motion';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { OverlayCelebration } from './OverlayCelebration';

beforeEach(() => {
  jest.useFakeTimers(); // the animation never advances: every assertion is made while it is still running
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Motion = 'REDUCED' | 'FULL';
function levelUp(motion: Motion) {
  const handlers = { primary: jest.fn(), secondary: jest.fn(), onClose: jest.fn() };
  const node = (
    <MotionPreferenceProvider value={motion}>
      <OverlayCelebration
        kind="LEVEL_UP"
        level={5}
        stage="HATCHLING"
        title="Bạn lên cấp 5"
        subtitle="Người kiên trì"
        body="Bạn nhận 1 điểm tiện ích."
        primary={{ label: 'Xem tiện ích', onPress: handlers.primary }}
        secondary={{ label: 'Để sau', onPress: handlers.secondary }}
        onClose={handlers.onClose}
      />
    </MotionPreferenceProvider>
  );
  return { view: render(node), node, ...handlers };
}
const hidden = { includeHiddenElements: true };
const groupNames = (view: ReturnType<typeof render>) =>
  [...JSON.stringify(view.toJSON()).matchAll(/"name":"([a-z-]+)"/g)].map(m => m[1]);

test.each(['REDUCED', 'FULL'] as const)('%s motion: title, subtitle, body, the level and both actions are on screen at once', motion => {
  const { view } = levelUp(motion);
  expect(view.getByRole('header', { name: 'Bạn lên cấp 5' })).toBeTruthy();
  expect(view.getByText('Người kiên trì')).toBeTruthy();
  expect(view.getByText('Bạn nhận 1 điểm tiện ích.')).toBeTruthy();
  expect(view.getByText('5', hidden)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Xem tiện ích' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Để sau' })).toBeTruthy();
  view.unmount();
});

test('primary and secondary fire while the animation is still running', () => {
  const animation = jest.spyOn(Animated, 'parallel');
  const { view, primary, secondary, onClose } = levelUp('FULL');
  expect(animation).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Xem tiện ích' }));
  expect(primary).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Để sau' }));
  expect(secondary).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  view.unmount();
});

test('the close button and Android Back call onClose', () => {
  const { view, onClose } = levelUp('FULL');
  fireEvent.press(view.getByRole('button', { name: 'Đóng' }));
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('reduced motion starts no animation and draws no particles', () => {
  const parallel = jest.spyOn(Animated, 'parallel');
  const sequence = jest.spyOn(Animated, 'sequence');
  const timing = jest.spyOn(Animated, 'timing');
  const { view } = levelUp('REDUCED');
  expect(parallel).not.toHaveBeenCalled();
  expect(sequence).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
  expect(view.queryAllByTestId('celebration-particle', hidden)).toHaveLength(0);
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe('none');
  view.unmount();
});

test('full motion plays once per mount, with at most 24 particles, and stops on unmount', () => {
  const stop = jest.fn();
  const parallel = jest.spyOn(Animated, 'parallel').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
  const timing = jest.spyOn(Animated, 'timing');
  const { view, node } = levelUp('FULL');
  const particles = view.queryAllByTestId('celebration-particle', hidden).length;
  expect(particles).toBeGreaterThan(0);
  expect(particles).toBeLessThanOrEqual(tokens.particles.maxCount);
  expect(timing.mock.calls.map(c => (c[1] as { duration: number }).duration)).toContain(1600);
  for (const call of timing.mock.calls) expect(call[1]).toMatchObject({ useNativeDriver: true });
  view.rerender(node);
  expect(parallel).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('it announces its title, moves screen-reader focus to it when shown, and is modal', () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValue(7); // Jest has no native node handles
  const { view } = levelUp('REDUCED');
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Bạn lên cấp 5');
  fireEvent(view.UNSAFE_getByType(Modal), 'show');
  expect(focus).toHaveBeenCalledWith(7);
  expect(view.UNSAFE_getByProps({ accessibilityViewIsModal: true })).toBeTruthy();
  view.unmount();
});

test('STREAK_MILESTONE shows the day count and the "N ngày giữ nhịp" ribbon', () => {
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <OverlayCelebration
        kind="STREAK_MILESTONE"
        days={7}
        title="7 ngày giữ nhịp"
        body="Huy hiệu Người giữ nhịp đã vào kho đồ."
        primary={{ label: 'Xem huy hiệu', onPress: jest.fn() }}
        secondary={{ label: 'Tiếp tục', onPress: jest.fn() }}
        onClose={jest.fn()}
      />
    </MotionPreferenceProvider>,
  );
  expect(view.getByRole('header', { name: '7 ngày giữ nhịp' })).toBeTruthy();
  expect(view.getByText('7', hidden)).toBeTruthy();
  expect(view.getAllByText('7 ngày giữ nhịp', hidden)).toHaveLength(2); // the title and the ribbon
  expect(groupNames(view)).not.toContain('body'); // no mascot on this one
  view.unmount();
});

test.each(['REDUCED', 'FULL'] as const)('PET_STAGE_UP under %s motion ends on Mầm at the new stage', motion => {
  const view = render(
    <MotionPreferenceProvider value={motion}>
      <OverlayCelebration
        kind="PET_STAGE_UP"
        stage="JUVENILE"
        title="Mầm đã thành Chồi non"
        body="Công sức những ngày qua đã giúp Mầm lớn lên."
        primary={{ label: 'Xem Mầm', onPress: jest.fn() }}
        secondary={{ label: 'Để sau', onPress: jest.fn() }}
        onClose={jest.fn()}
      />
    </MotionPreferenceProvider>,
  );
  expect(view.getByRole('header', { name: 'Mầm đã thành Chồi non' })).toBeTruthy();
  const names = groupNames(view);
  // JUVENILE is the first stage with a top leaf; the outgoing HATCHLING is drawn only while the animation runs.
  expect(names.filter(n => n === 'leaf-top')).toHaveLength(1);
  expect(names.filter(n => n === 'body')).toHaveLength(motion === 'FULL' ? 2 : 1);
  expect(names.filter(n => n.startsWith('face-')).every(n => n === 'face-happy')).toBe(true);
  view.unmount();
});
