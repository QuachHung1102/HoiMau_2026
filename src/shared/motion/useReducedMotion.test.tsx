import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { MotionPreferenceProvider, resetSystemMotionForTests, useReducedMotion, type MotionPreference } from './useReducedMotion';

type Listener = (enabled: boolean) => void;

function Probe() {
  return <Text testID="v">{String(useReducedMotion())}</Text>;
}
const shown = () => screen.getByTestId('v').props.children;

let listener: Listener | undefined;
let resolve: (v: boolean) => void;
let reject: (e: Error) => void;
let addEventListener: jest.SpyInstance;

beforeEach(() => {
  resetSystemMotionForTests();
  listener = undefined;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(
    () =>
      new Promise<boolean>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  addEventListener = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, cb: Listener) => {
    listener = cb;
    return { remove: jest.fn() };
  }) as never);
  addEventListener.mockClear(); // the preset's AccessibilityInfo is already a jest.fn, so counts would carry over
});
afterEach(() => jest.restoreAllMocks());

const mount = (value: MotionPreference, count = 1) =>
  render(
    <MotionPreferenceProvider value={value}>
      {Array.from({ length: count }, (_, i) => (
        <Probe key={i} />
      ))}
    </MotionPreferenceProvider>,
  );

test('REDUCED -> true and FULL -> false, whatever the system says, with no native listener', () => {
  const a = mount('REDUCED');
  expect(shown()).toBe('true');
  a.unmount();
  const b = mount('FULL');
  expect(shown()).toBe('false');
  b.unmount();
  expect(addEventListener).not.toHaveBeenCalled();
});

test('SYSTEM is reduced until the OS value is known', () => {
  const v = mount('SYSTEM');
  expect(shown()).toBe('true');
  v.unmount();
});

test('SYSTEM follows the OS value once known, and later change events', async () => {
  const v = mount('SYSTEM');
  await act(async () => resolve(false));
  expect(shown()).toBe('false');
  act(() => listener?.(true));
  expect(shown()).toBe('true');
  v.unmount();
});

test('a change event that arrives before the initial read is not overwritten by it', async () => {
  const v = mount('SYSTEM');
  act(() => listener?.(false));
  expect(shown()).toBe('false');
  await act(async () => resolve(true));
  expect(shown()).toBe('false');
  v.unmount();
});

test('a failed initial read leaves the value reduced', async () => {
  const v = mount('SYSTEM');
  await act(async () => reject(new Error('boom')));
  expect(shown()).toBe('true');
  v.unmount();
});

test('many hook instances, across mounts, register exactly one native listener', () => {
  const v = mount('SYSTEM', 30);
  expect(screen.getAllByTestId('v')).toHaveLength(30);
  expect(addEventListener).toHaveBeenCalledTimes(1);
  v.unmount();
  const w = mount('SYSTEM', 5);
  expect(addEventListener).toHaveBeenCalledTimes(1);
  w.unmount();
});
