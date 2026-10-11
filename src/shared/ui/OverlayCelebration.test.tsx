import { act, fireEvent, render, within } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, AppState, Modal, StyleSheet } from 'react-native';
import { motion as tokens } from '../motion/motion';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { colors } from '../theme/tokens';
import { OverlayCelebration } from './OverlayCelebration';

// Jest's AppState mock has no real state (currentState is a jest.fn), so tests set it and put it back.
const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
const setAppState = (state: string) => {
  mockedAppState.currentState = state;
};
afterEach(() => setAppState(appStateAtLoad as string));

beforeEach(() => {
  jest.useFakeTimers(); // nothing advances unless a test says so: assertions are made while the animation is running
  setAppState('active');
  // The preset's AccessibilityInfo is already a jest.fn: clear it, or call counts carry over between tests.
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined).mockClear();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

type Motion = 'REDUCED' | 'FULL';
const handlers = { primary: jest.fn(), secondary: jest.fn(), onClose: jest.fn() };
beforeEach(() => Object.values(handlers).forEach(mock => mock.mockClear()));

const levelUp = (motion: Motion, title = 'Bạn lên cấp 5') => (
  <MotionPreferenceProvider value={motion}>
    <OverlayCelebration
      kind="LEVEL_UP"
      level={5}
      stage="HATCHLING"
      title={title}
      subtitle="Người kiên trì"
      body="Bạn nhận 1 điểm tiện ích."
      primary={{ label: 'Xem tiện ích', onPress: handlers.primary }}
      secondary={{ label: 'Để sau', onPress: handlers.secondary }}
      onClose={handlers.onClose}
    />
  </MotionPreferenceProvider>
);
const milestone = (motion: Motion) => (
  <MotionPreferenceProvider value={motion}>
    <OverlayCelebration
      kind="STREAK_MILESTONE"
      days={7}
      title="7 ngày giữ nhịp"
      body="Huy hiệu Người giữ nhịp đã vào kho đồ."
      primary={{ label: 'Xem huy hiệu', onPress: jest.fn() }}
      secondary={{ label: 'Tiếp tục', onPress: jest.fn() }}
      onClose={jest.fn()}
    />
  </MotionPreferenceProvider>
);
const hidden = { includeHiddenElements: true };
const painted = (view: ReturnType<typeof render>) => JSON.stringify(view.toJSON());
const groupNames = (view: ReturnType<typeof render>) => [...painted(view).matchAll(/"name":"([a-z-]+)"/g)].map(m => m[1]);

type TimingConfig = { duration: number; delay?: number; easing: (t: number) => number; useNativeDriver: boolean };
const timingConfigs = (spy: jest.SpyInstance) => spy.mock.calls.map(call => call[1] as TimingConfig);
/** The highest value a curve reaches on 0..1: above 1 means it overshoots (the "pop" curve). */
const peak = (curve: (t: number) => number) => Math.max(...Array.from({ length: 101 }, (_, i) => curve(i / 100)));

test.each(['REDUCED', 'FULL'] as const)('%s motion: title, subtitle, body and both actions are on screen at once', motion => {
  const view = render(levelUp(motion));
  expect(view.getByRole('header', { name: 'Bạn lên cấp 5' })).toBeTruthy();
  expect(view.getByText('Người kiên trì')).toBeTruthy();
  expect(view.getByText('Bạn nhận 1 điểm tiện ích.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Xem tiện ích' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Để sau' })).toBeTruthy();
  view.unmount();
});

test('primary and secondary fire while the animation is still running', () => {
  const animation = jest.spyOn(Animated, 'parallel');
  const view = render(levelUp('FULL'));
  expect(animation).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Xem tiện ích' }));
  expect(handlers.primary).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: 'Để sau' }));
  expect(handlers.secondary).toHaveBeenCalledTimes(1);
  expect(handlers.onClose).not.toHaveBeenCalled();
  view.unmount();
});

test('the close button and Android Back call onClose', () => {
  const view = render(levelUp('FULL'));
  fireEvent.press(view.getByRole('button', { name: 'Đóng' }));
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  expect(handlers.onClose).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('reduced motion starts no animation, draws no halo or particles, and shows the final level directly', () => {
  const parallel = jest.spyOn(Animated, 'parallel');
  const sequence = jest.spyOn(Animated, 'sequence');
  const timing = jest.spyOn(Animated, 'timing');
  const view = render(levelUp('REDUCED'));
  expect(view.getByText('5', hidden)).toBeTruthy();
  act(() => jest.advanceTimersByTime(2000));
  expect(view.getByText('5', hidden)).toBeTruthy();
  expect(parallel).not.toHaveBeenCalled();
  expect(sequence).not.toHaveBeenCalled();
  expect(timing).not.toHaveBeenCalled();
  expect(view.queryAllByTestId('celebration-particle', hidden)).toHaveLength(0);
  expect(view.queryByTestId('celebration-halo', hidden)).toBeNull();
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe('none');
  view.unmount();
});

test('level-up: the number counts from the previous level 200 ms in (catalog "count" track)', () => {
  const view = render(levelUp('FULL'));
  expect(view.getByText('4', hidden)).toBeTruthy();
  expect(view.queryByText('5', hidden)).toBeNull();
  act(() => jest.advanceTimersByTime(199));
  expect(view.getByText('4', hidden)).toBeTruthy();
  act(() => jest.advanceTimersByTime(1)); // the count step: React starts the roll when this act ends
  act(() => jest.advanceTimersByTime(tokens.durationsMs.celebration + 50));
  expect(view.getByText('5', hidden)).toBeTruthy();
  expect(view.queryByText('4', hidden)).toBeNull();
  view.unmount();
});

test('level-up: the badge pops (overshooting curve, 450 ms), the label rises 450 ms in, at most 24 particles; all on the native driver', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const view = render(levelUp('FULL'));
  const configs = timingConfigs(timing);
  for (const config of configs) expect(config.useNativeDriver).toBe(true);
  const { celebration, celebrationLong, transition } = tokens.durationsMs;
  const pops = configs.filter(c => c.duration === celebration && peak(c.easing) > 1);
  expect(pops.map(c => c.delay)).toEqual([0, 0]); // `.from` (unused here) and `.badge`
  const label = configs.find(c => c.duration === transition && c.delay === celebration);
  expect(label && peak(label.easing)).toBeLessThanOrEqual(1);
  expect(configs.some(c => c.duration === celebrationLong && c.delay === 150)).toBe(true); // particles
  const particles = view.queryAllByTestId('celebration-particle', hidden).length;
  expect(particles).toBeGreaterThan(0);
  expect(particles).toBeLessThanOrEqual(tokens.particles.maxCount);
  view.unmount();
});

test('the halo is clipped to the picture block, which is at least as tall as the halo: it cannot reach the title', () => {
  const view = render(levelUp('FULL'));
  const clip = view.getByTestId('celebration-halo-clip', hidden);
  expect(StyleSheet.flatten(clip.props.style)).toMatchObject({ position: 'absolute', overflow: 'hidden', top: 0, bottom: 0 });
  const halo = StyleSheet.flatten(within(clip).getByTestId('celebration-halo', hidden).props.style);
  const block = StyleSheet.flatten(view.getByTestId('celebration-art', hidden).props.style);
  expect(halo.height).toBeGreaterThan(0);
  expect(block.minHeight).toBeGreaterThanOrEqual(halo.height as number);
  view.unmount();
});

test('the animation plays once per mount: new props, or motion switched off and on again, do not replay it', () => {
  const stop = jest.fn();
  const finishAtOnce = { start: (done: (result: { finished: boolean }) => void) => done({ finished: true }), stop, reset: jest.fn() };
  const parallel = jest.spyOn(Animated, 'parallel').mockReturnValue(finishAtOnce as never);
  const view = render(levelUp('FULL'));
  expect(parallel).toHaveBeenCalledTimes(1);
  view.rerender(levelUp('FULL', 'Bạn lên cấp 5 rồi'));
  expect(view.getByRole('header', { name: 'Bạn lên cấp 5 rồi' })).toBeTruthy(); // the new element did render
  view.rerender(levelUp('REDUCED', 'Bạn lên cấp 5 rồi'));
  view.rerender(levelUp('FULL', 'Bạn lên cấp 5 rồi'));
  expect(parallel).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('unmounting while the animation runs stops it', () => {
  const stop = jest.fn();
  jest.spyOn(Animated, 'parallel').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
  const view = render(levelUp('FULL'));
  expect(stop).not.toHaveBeenCalled();
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('it announces its title once, moves screen-reader focus to it when shown, and is modal', () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValue(7); // Jest has no native node handles
  const view = render(levelUp('REDUCED'));
  view.rerender(levelUp('REDUCED'));
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Bạn lên cấp 5');
  fireEvent(view.UNSAFE_getByType(Modal), 'show');
  expect(focus).toHaveBeenCalledWith(7);
  expect(view.UNSAFE_getByProps({ accessibilityViewIsModal: true })).toBeTruthy();
  view.unmount();
});

test('STREAK_MILESTONE shows the achieved medal and the "N ngày giữ nhịp" ribbon, and no mascot', () => {
  const view = render(milestone('REDUCED'));
  expect(view.getByRole('header', { name: '7 ngày giữ nhịp' })).toBeTruthy();
  expect(view.getByText('7', hidden)).toBeTruthy();
  expect(view.getAllByText('7 ngày giữ nhịp', hidden)).toHaveLength(2); // the title and the ribbon
  expect(painted(view)).toContain(`"backgroundColor":"${colors.flameSoft}","borderColor":"${colors.flame}"`);
  expect(groupNames(view)).not.toContain('body');
  view.unmount();
});

test('streak-milestone: the medal pops 250 ms in, the ribbon unrolls 600 ms in, the burst is flame and lime (never gold)', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const view = render(milestone('FULL'));
  const configs = timingConfigs(timing);
  const { celebration, transition } = tokens.durationsMs;
  const medal = configs.find(c => c.duration === celebration && c.delay === 250);
  expect(medal && peak(medal.easing)).toBeGreaterThan(1);
  const ribbon = configs.find(c => c.duration === transition && c.delay === 600);
  expect(ribbon && peak(ribbon.easing)).toBeLessThanOrEqual(1);
  expect(StyleSheet.flatten(view.getByTestId('celebration-ribbon', hidden).props.style).transform).toEqual([{ scaleX: 0 }]);
  const particles = view.getAllByTestId('celebration-particle', hidden);
  expect(particles).toHaveLength(20);
  const used = new Set(particles.map(p => StyleSheet.flatten(p.props.style).backgroundColor));
  expect([...used].sort()).toEqual([colors.flame, colors.lime].sort());
  expect(painted(view)).not.toContain(colors.gold);
  expect(painted(view).toUpperCase()).not.toContain('#B45309');
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
