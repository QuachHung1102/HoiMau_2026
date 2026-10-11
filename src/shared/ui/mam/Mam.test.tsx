import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, AppState } from 'react-native';
import type { PetMood, PetStage } from '../../../../domain/types.ts';
import { MotionPreferenceProvider, resetSystemMotionForTests } from '../../motion/useReducedMotion';
import { Mam } from './Mam';

afterEach(() => jest.restoreAllMocks());
const wrap = (node: React.ReactElement, motion: 'REDUCED' | 'FULL' = 'REDUCED') => (
  <MotionPreferenceProvider value={motion}>{node}</MotionPreferenceProvider>
);
const painted = (view: ReturnType<typeof render>) => JSON.stringify(view.toJSON());
// react-native-svg renders real host components under Jest; a group's `id` arrives as its `name`.
const namesIn = (json: string) => [...json.matchAll(/"name":"([a-z-]+)"/g)].map(m => m[1]);
const groups = (view: ReturnType<typeof render>) => namesIn(painted(view));

const stageNames: Record<PetStage, string> = {
  EGG: 'Hạt giống',
  HATCHLING: 'Mầm nhú',
  JUVENILE: 'Chồi non',
  ADULT: 'Cây xanh',
  MYTHIC: 'Cây huyền thoại',
};
const moods: Record<PetMood, { text: string; face: string }> = {
  HAPPY: { text: 'Mầm đang vui', face: 'face-happy' },
  NEUTRAL: { text: 'Mầm đang bình thường', face: 'face-neutral' },
  TIRED: { text: 'Mầm hơi buồn ngủ, đang chờ bạn quay lại', face: 'face-tired' },
};
const combos = (Object.keys(stageNames) as PetStage[]).flatMap(stage =>
  (Object.keys(moods) as PetMood[]).map(mood => [stage, mood] as const),
);

/** What the composite animation spies see: the mocked handle and the durations of the timings built for it. */
function spyOnAnimations() {
  const stop = jest.fn();
  const handle = { start: jest.fn(), stop, reset: jest.fn() } as never;
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue(handle);
  const sequence = jest.spyOn(Animated, 'sequence').mockReturnValue(handle);
  const timing = jest.spyOn(Animated, 'timing');
  const total = () => timing.mock.calls.reduce((sum, call) => sum + ((call[1] as { duration?: number }).duration ?? 0), 0);
  return { stop, loop, sequence, timing, total };
}
function captureAppState() {
  const captured = { change: (_: string) => undefined as void };
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    captured.change = cb;
    return { remove: jest.fn() };
  }) as never);
  return captured;
}

test('there are 15 stage x mood combinations', () => {
  expect(combos).toHaveLength(15);
});

test.each(combos)('%s / %s is one image labelled with the stage and the mood, showing only that face', (stage, mood) => {
  const view = render(wrap(<Mam stage={stage} mood={mood} size={128} />));
  expect(view.getByRole('image', { name: `${stageNames[stage]}. ${moods[mood].text}` })).toBeTruthy();
  const names = groups(view);
  expect(names.filter(n => n.startsWith('face-'))).toEqual([moods[mood].face]);
  expect(names).toEqual(expect.arrayContaining(['leaf-left', 'leaf-right', 'body']));
  expect(names).not.toContain('skin');
  view.unmount();
});

test('a tired Mầm keeps every part and every colour of its stage (never a wilted look)', () => {
  const draw = (mood: PetMood) => {
    const view = render(wrap(<Mam stage="ADULT" mood={mood} size={128} />));
    const json = painted(view);
    view.unmount();
    return json;
  };
  const parts = (json: string) => namesIn(json).filter(n => !n.startsWith('face-'));
  const fills = (json: string) => [...new Set([...json.matchAll(/"payload":(\d+)/g)].map(m => m[1]))].sort();
  expect(parts(draw('TIRED'))).toEqual(parts(draw('HAPPY')));
  expect(fills(draw('TIRED'))).toEqual(fills(draw('HAPPY')));
});

test('skin="fox" adds the overlay on top of the stage', () => {
  const view = render(wrap(<Mam stage="HATCHLING" mood="HAPPY" skin="fox" size={128} />));
  const names = groups(view);
  expect(names).toContain('skin');
  expect(names.indexOf('skin')).toBeGreaterThan(names.indexOf('body'));
  view.unmount();
});

test('on the seed the skin moves down with the head (the offset stage-egg.svg gives its face)', () => {
  const headOffsets = (stage: PetStage, skin?: 'fox') => {
    const view = render(wrap(<Mam stage={stage} mood="HAPPY" skin={skin} size={128} />));
    const count = painted(view).split('"matrix":[1,0,0,1,2.2,31]').length - 1;
    view.unmount();
    return count;
  };
  expect(headOffsets('EGG')).toBe(1); // the face
  expect(headOffsets('EGG', 'fox')).toBe(2); // the face and the skin
  expect(headOffsets('HATCHLING', 'fox')).toBe(0);
});

test('the picture is drawn at the requested size in the 128 viewBox', () => {
  const view = render(wrap(<Mam stage="EGG" mood="NEUTRAL" size={40} />));
  expect(painted(view)).toContain('"bbWidth":40,"bbHeight":40,"minX":0,"minY":0,"vbWidth":128,"vbHeight":128');
  view.unmount();
});

test('decorative hides it from screen readers', () => {
  const view = render(wrap(<Mam stage="EGG" mood="NEUTRAL" size={40} decorative />));
  expect(view.queryByRole('image')).toBeNull();
  expect(view.UNSAFE_getByProps({ importantForAccessibility: 'no-hide-descendants' }).props.accessible).toBe(false);
  view.unmount();
});

test('reduced motion (OS setting still unknown) starts no animation', () => {
  resetSystemMotionForTests();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never);
  const spies = spyOnAnimations();
  const view = render(<Mam stage="HATCHLING" mood="NEUTRAL" size={128} animation="idle" />);
  expect(spies.loop).not.toHaveBeenCalled();
  expect(spies.sequence).not.toHaveBeenCalled();
  expect(spies.timing).not.toHaveBeenCalled();
  view.unmount();
  resetSystemMotionForTests();
});

test.each(['idle', 'happy', 'cheer'] as const)('the REDUCED setting keeps "%s" static', animation => {
  const spies = spyOnAnimations();
  const view = render(wrap(<Mam stage="HATCHLING" mood="HAPPY" size={128} animation={animation} />));
  expect(spies.timing).not.toHaveBeenCalled();
  view.unmount();
});

test('without an animation prop nothing moves, even under full motion', () => {
  const spies = spyOnAnimations();
  const view = render(wrap(<Mam stage="HATCHLING" mood="TIRED" size={128} />, 'FULL'));
  expect(spies.timing).not.toHaveBeenCalled();
  view.unmount();
});

test('idle is one 3000 ms loop on the native driver that moves at most 4 dp, and unmount stops it', () => {
  const spies = spyOnAnimations();
  const interpolate = jest.spyOn(Animated.Value.prototype, 'interpolate');
  const view = render(wrap(<Mam stage="HATCHLING" mood="NEUTRAL" size={128} animation="idle" />, 'FULL'));
  expect(spies.loop).toHaveBeenCalledTimes(1);
  expect(spies.total()).toBe(3000);
  for (const call of spies.timing.mock.calls) expect(call[1]).toMatchObject({ useNativeDriver: true });
  expect(interpolate).toHaveBeenCalledWith({ inputRange: [0, 1], outputRange: [0, -4] });
  expect(spies.stop).not.toHaveBeenCalled();
  view.unmount();
  expect(spies.stop).toHaveBeenCalledTimes(1);
});

test('a tired Mầm idles on the slow 5000 ms loop', () => {
  const spies = spyOnAnimations();
  const view = render(wrap(<Mam stage="HATCHLING" mood="TIRED" size={128} animation="idle" />, 'FULL'));
  expect(spies.loop).toHaveBeenCalledTimes(1);
  expect(spies.total()).toBe(5000);
  view.unmount();
});

test.each([
  ['happy', 450],
  ['cheer', 1600],
] as const)('%s plays once for %d ms and does not loop', (animation, duration) => {
  const spies = spyOnAnimations();
  const view = render(wrap(<Mam stage="HATCHLING" mood="HAPPY" size={128} animation={animation} />, 'FULL'));
  expect(spies.sequence).toHaveBeenCalledTimes(1);
  expect(spies.loop).not.toHaveBeenCalled();
  expect(spies.total()).toBe(duration);
  view.unmount();
  expect(spies.stop).toHaveBeenCalledTimes(1);
});

test('active={false} (screen not focused) stops the loop, and it resumes when focus returns', () => {
  const spies = spyOnAnimations();
  const mam = (active: boolean) => wrap(<Mam stage="ADULT" mood="NEUTRAL" size={128} animation="idle" active={active} />, 'FULL');
  const view = render(mam(false));
  expect(spies.loop).not.toHaveBeenCalled();
  view.rerender(mam(true));
  expect(spies.loop).toHaveBeenCalledTimes(1);
  view.rerender(mam(false));
  expect(spies.stop).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('the loop stops when the app goes to the background and restarts when it returns', () => {
  const appState = captureAppState();
  const spies = spyOnAnimations();
  const view = render(wrap(<Mam stage="ADULT" mood="NEUTRAL" size={128} animation="idle" />, 'FULL'));
  act(() => appState.change('background'));
  expect(spies.stop).toHaveBeenCalledTimes(1);
  act(() => appState.change('active'));
  expect(spies.loop).toHaveBeenCalledTimes(2);
  view.unmount();
});

test('a one-shot animation that has finished is not replayed when the app returns to the foreground', () => {
  const appState = captureAppState();
  const spies = spyOnAnimations();
  const finishAtOnce = { start: (done: (result: { finished: boolean }) => void) => done({ finished: true }), stop: jest.fn() };
  spies.sequence.mockReturnValue(finishAtOnce as never);
  const view = render(wrap(<Mam stage="ADULT" mood="HAPPY" size={128} animation="cheer" />, 'FULL'));
  act(() => appState.change('background'));
  act(() => appState.change('active'));
  expect(spies.sequence).toHaveBeenCalledTimes(1);
  view.unmount();
});
