import { act, render, screen } from '@testing-library/react-native';
import { Animated, AppState } from 'react-native';
import * as vi from '../../shared/i18n/vi/workout';
import { motion } from '../../shared/motion/motion';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { BreathingGuide } from './BreathingGuide';

const IN = 'Hít vào 4 giây';
const OUT = 'Thở ra 4 giây';
const appState = AppState as unknown as { currentState: unknown };
const atLoad = appState.currentState;
beforeEach(() => {
  appState.currentState = 'active';
  jest.useFakeTimers();
});
afterEach(() => {
  appState.currentState = atLoad;
  jest.useRealTimers();
  jest.restoreAllMocks();
});
const pass = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

test('the 4/4 pattern is one breathCycle', () => {
  expect(vi.fourFourBreath.reduce((sum, phase) => sum + phase.ms, 0)).toBe(motion.durationsMs.breathCycle);
});

test.each(['FULL', 'REDUCED'] as const)('motion %s: the text follows the clock, "Hít vào" until 4 s, "Thở ra" until 8 s, then again', async preference => {
  const loop = jest.spyOn(Animated, 'loop');
  const view = render(
    <MotionPreferenceProvider value={preference}>
      <BreathingGuide pattern={vi.fourFourBreath} active circle />
    </MotionPreferenceProvider>,
  );
  expect(screen.getByText(IN)).toBeTruthy();
  await pass(3999);
  expect(screen.getByText(IN)).toBeTruthy();
  await pass(1);
  expect(screen.getByText(OUT)).toBeTruthy();
  expect(screen.queryByText(IN)).toBeNull();
  await pass(3999);
  expect(screen.getByText(OUT)).toBeTruthy();
  await pass(1);
  expect(screen.getByText(IN)).toBeTruthy();
  // the circle grows and shrinks only with motion; reduced, it stands still
  expect(loop).toHaveBeenCalledTimes(preference === 'FULL' ? 1 : 0);
  view.unmount();
});

test('inactive: the text stays on its phase; active again, the cycle starts over', async () => {
  const guide = (active: boolean) => (
    <MotionPreferenceProvider value="REDUCED">
      <BreathingGuide pattern={vi.fourFourBreath} active={active} />
    </MotionPreferenceProvider>
  );
  const view = render(guide(true));
  await pass(4000);
  expect(screen.getByText(OUT)).toBeTruthy();
  view.rerender(guide(false));
  await pass(8000);
  expect(screen.getByText(OUT)).toBeTruthy();
  view.rerender(guide(true));
  expect(screen.getByText(IN)).toBeTruthy();
  view.unmount();
});
