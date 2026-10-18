import { act, render } from '@testing-library/react-native';
import { Animated, AppState } from 'react-native';
import { motion } from '../../shared/motion/motion';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { matrixAt, moves, parseTransform, Rig, tracksOf } from './rig';
import { RigPlayer } from './RigPlayer';

const SQUAT = 'exercise-squat';

function spyLoops() {
  const timing = jest.spyOn(Animated, 'timing');
  const stops: jest.Mock[] = [];
  const loop = jest.spyOn(Animated, 'loop').mockImplementation(() => {
    const stop = jest.fn();
    stops.push(stop);
    return { start: jest.fn(), stop, reset: jest.fn() };
  });
  return { timing, loop, stops };
}
const player = (props: Partial<Parameters<typeof RigPlayer>[0]> = {}) => (
  <MotionPreferenceProvider value="FULL">
    <RigPlayer demoCode={SQUAT} speed={1} active {...props} />
  </MotionPreferenceProvider>
);

// The loops run only in the foreground (useLoopGate).
const appState = AppState as unknown as { currentState: unknown };
const atLoad = appState.currentState;
beforeEach(() => {
  appState.currentState = 'active';
});
afterEach(() => {
  appState.currentState = atLoad;
  jest.restoreAllMocks();
});

test('one loop per track over the duration token; all stop when active turns false, and again on unmount', () => {
  const { loop, timing, stops } = spyLoops();
  const view = render(player());
  const tracks = moves[SQUAT].tracks.length;
  expect(loop).toHaveBeenCalledTimes(tracks);
  expect(timing.mock.calls.map(([, config]) => config.duration)).toEqual(Array(tracks).fill(motion.durationsMs.repCycle));
  expect(stops.every(stop => stop.mock.calls.length === 0)).toBe(true);

  view.rerender(player({ active: false }));
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  expect(loop).toHaveBeenCalledTimes(tracks);

  view.rerender(player());
  expect(loop).toHaveBeenCalledTimes(2 * tracks);
  view.unmount();
  expect(stops).toHaveLength(2 * tracks);
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
});

test('the app going to the background stops the loops; back in the foreground they start again', () => {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  const { loop, stops } = spyLoops();
  const view = render(player());
  const tracks = moves[SQUAT].tracks.length;
  act(() => listeners.forEach(listener => listener('background')));
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  act(() => listeners.forEach(listener => listener('active')));
  expect(loop).toHaveBeenCalledTimes(2 * tracks);
  view.unmount();
});

test('"Xem chậm" (speed 0.5) runs each loop over twice the duration', () => {
  const { timing } = spyLoops();
  const view = render(player({ speed: 0.5 }));
  expect(new Set(timing.mock.calls.map(([, config]) => config.duration))).toEqual(new Set([2 * motion.durationsMs.repCycle]));
  view.unmount();
});

test('reduced motion: no loop starts', () => {
  const { loop } = spyLoops();
  const view = render(
    <MotionPreferenceProvider value="REDUCED">
      <RigPlayer demoCode={SQUAT} speed={1} active />
    </MotionPreferenceProvider>,
  );
  expect(loop).not.toHaveBeenCalled();
  view.unmount();
});

test('the real loops run frame by frame without errors and stop on unmount', async () => {
  jest.useFakeTimers();
  const view = render(player());
  await act(() => jest.advanceTimersByTimeAsync(500));
  view.unmount();
  jest.useRealTimers();
});

test('keyframe offsets as Web Animations reads them: given ones kept, missing ones spread evenly, first 0 and last 1', () => {
  const key = (offset?: number) => ({ transform: 'rotate(0deg)', ...(offset === undefined ? null : { offset }) });
  const move = { ...moves[SQUAT], tracks: [{ target: '#head', keyframes: [key(), key(), key(0.6), key(), key(), key()] }] };
  expect(tracksOf(move)[0].offsets).toEqual([0, 0.3, 0.6, expect.closeTo(0.7333, 4), expect.closeTo(0.8667, 4), 1]);
  // a value between two keys is linear between them: at 0.25, half way from scale 1 (offset 0) to 1.12 (offset 0.5)
  const scaled = { ...move, tracks: [{ target: '#belly', keyframes: [key(), { transform: 'scale(1, 1.12)', offset: 0.5 }, key()] }] };
  const [, , , d] = matrixAt(tracksOf(scaled)[0], 0.25);
  expect(d).toBeCloseTo(1.06, 6);
});

test('every track of the 40 moves moves a drawn group of its rig (side or front)', () => {
  const missing: string[] = [];
  for (const [code, move] of Object.entries(moves)) {
    const view = render(<Rig move={move} tracks={tracksOf(move)} at={move.poster} />);
    const ids = new Set(view.UNSAFE_root.findAll(node => typeof node.type !== 'string' && node.props.id).map(node => node.props.id));
    for (const track of tracksOf(move)) if (!ids.has(track.id)) missing.push(`${code} ${move.rig} #${track.id}`);
    view.unmount();
  }
  expect(Object.keys(moves)).toHaveLength(40);
  expect(new Set(Object.values(moves).map(move => move.rig))).toEqual(new Set(['side', 'front']));
  expect(missing).toEqual([]);
});

test('a track value is translate, rotate, scale in that order, about the group pivot', () => {
  expect(parseTransform('translate(-1.8px, 3.4px) rotate(12deg) scale(1, 0.91)')).toEqual([-1.8, 3.4, 12, 1, 0.91]);
  expect(parseTransform('rotate(-40deg)')).toEqual([0, 0, -40, 1, 1]);
  // the order: (0, 1) scaled to (0, 2), turned 90° to (-2, 0), moved by (2, 3) to (0, 3)
  const ordered = { id: 'x', origin: [0, 0], offsets: [0, 1], values: [parseTransform('translate(2px, 3px) rotate(90deg) scale(1, 2)')], easing: 'linear' as const };
  const [, , c0, d0, e0, f0] = matrixAt(ordered, 0);
  expect([c0 + e0, d0 + f0].map(n => Number(n.toFixed(9)))).toEqual([0, 3]);
  // the squat's front thigh (pivot 100, 92) at its deepest key: the pivot stays where it is
  const thigh = tracksOf(moves[SQUAT]).find(track => track.id === 'thigh-f');
  const [a, b, c, d, e, f] = matrixAt(thigh as never, 0.5);
  expect(a * 100 + c * 92 + e).toBeCloseTo(100, 6);
  expect(b * 100 + d * 92 + f).toBeCloseTo(92, 6);
  expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(-67.9, 6);
});
