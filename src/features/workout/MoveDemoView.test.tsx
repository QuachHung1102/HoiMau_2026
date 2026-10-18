import { act, render, screen } from '@testing-library/react-native';
import { Animated, AppState, Image } from 'react-native';
import { poses } from '../../assets/motion/poses';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { MoveDemoView } from './MoveDemoView';
import { moves, Rig, tracksOf } from './rig';
import { RigPlayer } from './RigPlayer';

// The figure itself is RigPlayer's (RigPlayer.test.tsx); here only what it is given.
jest.mock('./RigPlayer', () => ({ RigPlayer: jest.fn(() => null) }));
const player = RigPlayer as unknown as jest.Mock;
const lastPlayer = () => player.mock.calls.at(-1)?.[0];

const appState = AppState as unknown as { currentState: unknown };
const atLoad = appState.currentState;
beforeEach(() => {
  appState.currentState = 'active';
  player.mockClear();
  jest.useFakeTimers();
});
afterEach(() => {
  appState.currentState = atLoad;
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const pass = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const demo = (props: Parameters<typeof MoveDemoView>[0], motion: 'FULL' | 'REDUCED' = 'FULL') => (
  <MotionPreferenceProvider value={motion}>
    <MoveDemoView {...props} />
  </MotionPreferenceProvider>
);

test('a move with a rig: the looping figure at the asked speed, hidden from screen readers', () => {
  const view = render(demo({ demoCode: 'exercise-squat', speed: 0.5, active: true }));
  expect(lastPlayer()).toEqual(expect.objectContaining({ demoCode: 'exercise-squat', speed: 0.5, active: true }));
  expect(view.UNSAFE_getByProps({ importantForAccessibility: 'no-hide-descendants' })).toBeTruthy();
  expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  view.unmount();
});

test.each(['exercise-squat', 'exercise-nghieng-co-nhe', 'exercise-tho-vuong'])('reduced motion, %s: its key-pose picture (the pose at `poster`) and no animation', code => {
  const loop = jest.spyOn(Animated, 'loop');
  const view = render(demo({ demoCode: code, active: true }, 'REDUCED'));
  const images = screen.UNSAFE_getAllByType(Image);
  expect(images.map(image => image.props.source)).toEqual([poses[code]]);
  expect(player).not.toHaveBeenCalled();
  expect(loop).not.toHaveBeenCalled();
  view.unmount();
});

test('every extracted move has its pose picture', () => {
  expect(Object.keys(poses).sort()).toEqual(Object.keys(moves).sort());
  expect(Object.keys(moves)).toHaveLength(40);
});

test('no demo code (or one the app does not know): no figure at all', () => {
  const none = render(demo({ demoCode: null, active: true }));
  expect(none.toJSON()).toBeNull();
  none.unmount();
  const unknown = render(demo({ demoCode: 'exercise-not-there', active: true }));
  expect(unknown.toJSON()).toBeNull();
  unknown.unmount();
});

test.each(['FULL', 'REDUCED'] as const)('Thở vuông, motion %s: the phase label follows the clock, 4 s each, looping', async motion => {
  const view = render(demo({ demoCode: 'exercise-tho-vuong', speed: 0.5, active: true }, motion));
  for (const label of ['Hít vào', 'Giữ', 'Thở ra', 'Nghỉ', 'Hít vào']) {
    expect(screen.getByText(label)).toBeTruthy();
    await pass(4000);
  }
  // breathing keeps its real pace: "Xem chậm" does not slow it
  if (motion === 'FULL') expect(lastPlayer().speed).toBe(1);
  view.unmount();
});

test('Thả lỏng từng vùng: the label and the highlighted region move on together', async () => {
  const view = render(demo({ demoCode: 'exercise-tha-long-tung-vung', active: true }));
  const seen: [string, string][] = [];
  for (let i = 0; i < 6; i += 1) {
    seen.push([screen.getByText(/^Thả lỏng /).props.children, lastPlayer().highlight]);
    await pass(4000);
  }
  expect(seen).toEqual([
    ['Thả lỏng trán', 'head'],
    ['Thả lỏng vai', 'shoulder-f'],
    ['Thả lỏng tay', 'forearm-f'],
    ['Thả lỏng bụng', 'belly'],
    ['Thả lỏng chân', 'thigh-f'],
    ['Thả lỏng trán', 'head'],
  ]);
  view.unmount();
});

test.each([
  ['exercise-keo-day-khang-luc', ['prop-chair', 'prop-wall', 'prop-anchor', 'prop-band']],
  ['exercise-cheo-ta-tay', ['prop-sofa', 'prop-dumbbell-f']],
  ['exercise-gap-hong-voi-ta-tay', ['prop-mat', 'prop-dumbbell-b', 'prop-dumbbell-f']],
  ['exercise-day-vai-voi-ta-tay', ['prop-mat', 'prop-dumbbell-r', 'prop-dumbbell-l']],
  ['exercise-buoc-ngang-voi-day-khang-luc', ['prop-mat', 'prop-miniband']],
  ['exercise-xoay-than-khi-ngoi', ['prop-chair']],
])('%s draws its props (`prop-<name>` and `prop-<name>-*`) and no other', (code, props) => {
  const move = moves[code];
  const view = render(<Rig move={move} tracks={tracksOf(move)} at={0} />);
  const drawn = view.UNSAFE_root.findAll(node => typeof node.type !== 'string' && /^prop-/.test(node.props.id ?? '')).map(node => node.props.id);
  expect(drawn.sort()).toEqual([...props].sort());
  view.unmount();
});

test('the highlighted region is drawn tinted over its part; no other part is', () => {
  const move = moves['exercise-tha-long-tung-vung'];
  const tinted = (highlight?: string) => {
    const view = render(<Rig move={move} tracks={tracksOf(move)} at={0} highlight={highlight} />);
    const count = view.UNSAFE_root.findAll(node => typeof node.type !== 'string' && node.props.opacity === 0.75 && node.props.fill === '#88D64B').length;
    view.unmount();
    return count;
  };
  expect(tinted()).toBe(0);
  expect(tinted('head')).toBe(1);
  expect(tinted('belly')).toBe(1);
});

test('the head tinted: the tint lies on the face circle, under the hair and the eye, so the face stays visible', () => {
  const move = moves['exercise-tha-long-tung-vung'];
  const view = render(<Rig move={move} tracks={tracksOf(move)} at={0} highlight="head" />);
  const head = view.UNSAFE_root.find(node => typeof node.type !== 'string' && node.props.id === 'head');
  const fills = head.props.children.map((child: { props: { fill?: string } }) => child.props.fill);
  expect(fills).toEqual(['#E8B08A', '#88D64B', '#182743', '#182743']);
  view.unmount();
});

test('a scanned region changes with its breath label: every move with both has the same phase lengths', () => {
  const both = Object.entries(moves).filter(([, move]) => move.highlight && move.pattern);
  expect(both.map(([code]) => code)).toEqual(['exercise-tha-long-tung-vung']);
  for (const [, move] of both) expect(move.highlight?.map(phase => phase.ms)).toEqual(move.pattern?.map(phase => phase.ms));
});
