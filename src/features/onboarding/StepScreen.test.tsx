import { screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { motion } from '../../shared/motion/motion';
import { draft, installOnboardingTestEnv, mount, onStep, press, TITLES } from './onboardingTestKit';

installOnboardingTestEnv();

/** The enter animations of onboarding-step that were started: the transition token on the native driver. */
const stepAnimations = (timing: jest.SpyInstance) =>
  timing.mock.calls.filter(([, config]) => config.duration === motion.durationsMs.transition && config.toValue === 1 && config.useNativeDriver === true);

test('each step gives screen-reader focus to its title when it comes on screen, forwards and back', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValue(7); // Jest has no native node handles
  await mount('OnbProfile', { draft });
  expect((await onStep(TITLES.OnbProfile)).props.accessibilityRole).toBe('header');
  expect(focus).toHaveBeenCalledTimes(1);
  press('Tiếp tục');
  await onStep(TITLES.OnbActivity);
  expect(focus).toHaveBeenCalledTimes(2);
  press('Chọn mục tiêu');
  await onStep(TITLES.OnbArchetype);
  expect(focus).toHaveBeenCalledTimes(3);
  press('Xem lộ trình của tôi');
  await onStep(TITLES.OnbTargets);
  expect(focus).toHaveBeenCalledTimes(4);
  press('Quay lại');
  await onStep(TITLES.OnbArchetype);
  expect(focus).toHaveBeenCalledTimes(5);
});

test('reduced motion: a step is simply there, nothing eases in', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  await mount('OnbProfile', { draft });
  await onStep(TITLES.OnbProfile);
  press('Tiếp tục');
  await onStep(TITLES.OnbActivity);
  expect(stepAnimations(timing)).toHaveLength(0);
});

test('full motion: the content of each step eases in once, for the transition duration, on the native driver', async () => {
  // captured, not run: frames arriving between awaits would update the tree outside act()
  const stub = { start: jest.fn(), stop: jest.fn(), reset: jest.fn(), _isUsingNativeDriver: () => false } as unknown as Animated.CompositeAnimation;
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue(stub);
  await mount('OnbProfile', { draft }, { motion: 'FULL' });
  await onStep(TITLES.OnbProfile);
  expect(stepAnimations(timing)).toHaveLength(1);
  press('Tiếp tục');
  await onStep(TITLES.OnbActivity);
  expect(stepAnimations(timing)).toHaveLength(2);
  expect(screen.getByText('Vận động · Bước 2 trong 3')).toBeTruthy();
  // started, and stopped again when the step was left
  expect(stub.start).toHaveBeenCalled();
  expect(stub.stop).toHaveBeenCalled();
});

test('the navigator does not animate the steps itself: the in-app motion setting governs the whole transition', () => {
  const { onboardingScreens } = require('../../app/screens');
  expect(onboardingScreens.map((entry: { name: string }) => entry.name)).toEqual(['OnbProfile', 'OnbActivity', 'OnbArchetype', 'OnbTargets']);
  for (const entry of onboardingScreens) expect(entry.options).toEqual({ animation: 'none' });
});
