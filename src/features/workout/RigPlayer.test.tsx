import { act, render } from '@testing-library/react-native';
import { Animated, AppState } from 'react-native';
import { G } from 'react-native-svg';
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

test('one loop over the duration token for every track; it stops when active turns false, and again on unmount', () => {
  const { loop, timing, stops } = spyLoops();
  const view = render(player());
  expect(loop).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls.map(([, config]) => config.duration)).toEqual([motion.durationsMs.repCycle]);
  expect(stops.every(stop => stop.mock.calls.length === 0)).toBe(true);

  view.rerender(player({ active: false }));
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  expect(loop).toHaveBeenCalledTimes(1);

  view.rerender(player());
  expect(loop).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(stops).toHaveLength(2);
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
  act(() => listeners.forEach(listener => listener('background')));
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  act(() => listeners.forEach(listener => listener('active')));
  expect(loop).toHaveBeenCalledTimes(2);
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

// The mounted groups of the figure, each with its setNativeProps replaced by a spy (the player calls it per frame).
function spyGroups(view: ReturnType<typeof render>) {
  const sent = new Map<string, number[][]>();
  for (const node of view.UNSAFE_root.findAll(found => found.type === G && found.props.id)) {
    const list: number[][] = [];
    sent.set(node.props.id, list);
    node.instance.setNativeProps = ({ matrix }: { matrix: number[] }) => list.push(matrix);
  }
  return sent;
}
const apart = (a: number[], b: number[]) => Math.max(...a.map((n, i) => Math.abs(n - b[i])));

test('the real loop moves every track frame by frame: each group gets a changing matrix, then nothing after unmount', async () => {
  jest.useFakeTimers();
  const view = render(player());
  const sent = spyGroups(view);
  const tracks = tracksOf(moves[SQUAT]);
  await act(() => jest.advanceTimersByTimeAsync(500));
  for (const track of tracks) {
    const frames = sent.get(track.id) ?? [];
    expect(frames.length).toBeGreaterThan(5);
    frames.forEach(matrix => expect(matrix).toHaveLength(6));
  }
  // the figure moved away from its first pose
  expect(tracks.some(track => apart((sent.get(track.id) ?? []).at(-1) ?? [], matrixAt(track, 0)) > 0.01)).toBe(true);
  view.unmount();
  const counts = [...sent.values()].map(frames => frames.length);
  await act(() => jest.advanceTimersByTimeAsync(500));
  expect([...sent.values()].map(frames => frames.length)).toEqual(counts);
  jest.useRealTimers();
});

test.each([
  ['"Xem chậm" turned on', { speed: 0.5 as const }],
  ['pause then resume', null],
])('%s: the figure goes on from the pose it is at, not from its first pose', async (_name, change) => {
  jest.useFakeTimers();
  const view = render(player());
  const sent = spyGroups(view);
  const thigh = 'thigh-f';
  // half way through the 3.2 s cycle: the deepest point of the squat, far from the first pose
  await act(() => jest.advanceTimersByTimeAsync(motion.durationsMs.repCycle / 2));
  const before = (sent.get(thigh) ?? []).at(-1) ?? [];
  const first = matrixAt(tracksOf(moves[SQUAT]).find(track => track.id === thigh) as never, 0);
  expect(apart(before, first)).toBeGreaterThan(0.3);
  if (change) view.rerender(player(change));
  else {
    view.rerender(player({ active: false }));
    await act(() => jest.advanceTimersByTimeAsync(2000));
    view.rerender(player());
  }
  const seen = (sent.get(thigh) ?? []).length;
  await act(() => jest.advanceTimersByTimeAsync(50));
  const after = (sent.get(thigh) ?? [])[seen];
  expect(after).toBeDefined();
  expect(apart(after, before)).toBeLessThan(0.1);
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
