import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { MotionPreferenceProvider, useReducedMotion, type MotionPreference } from './useReducedMotion';

function Probe() {
  return <Text testID="v">{String(useReducedMotion())}</Text>;
}
const flush = () => act(async () => undefined);

let listener: ((enabled: boolean) => void) | undefined;
const remove = jest.fn();
beforeEach(() => {
  listener = undefined;
  remove.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_: string, cb: (enabled: boolean) => void) => {
    listener = cb;
    return { remove };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

async function mount(value: MotionPreference) {
  const view = render(
    <MotionPreferenceProvider value={value}>
      <Probe />
    </MotionPreferenceProvider>,
  );
  await flush();
  return view;
}

test('REDUCED -> true, whatever the system says', async () => {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
  const view = await mount('REDUCED');
  expect(view.getByTestId('v').props.children).toBe('true');
  view.unmount();
});

test('FULL -> false, whatever the system says', async () => {
  const view = await mount('FULL');
  expect(view.getByTestId('v').props.children).toBe('false');
  view.unmount();
});

test('SYSTEM follows the OS value and its change event, and unsubscribes on unmount', async () => {
  const view = await mount('SYSTEM');
  expect(view.getByTestId('v').props.children).toBe('true');
  act(() => listener?.(false));
  expect(view.getByTestId('v').props.children).toBe('false');
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
