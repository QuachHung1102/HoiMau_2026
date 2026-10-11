import { act, render, screen } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { useLoopGate } from './useLoopGate';
import { MotionPreferenceProvider, type MotionPreference } from './useReducedMotion';

function Probe({ active }: { active?: boolean }) {
  return <Text testID="gate">{String(useLoopGate(active))}</Text>;
}
const shown = () => screen.getByTestId('gate').props.children;

// Jest's AppState mock has no real state (currentState is a jest.fn), so tests set it and put it back.
const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
const setAppState = (state: string) => {
  mockedAppState.currentState = state;
};
afterEach(() => setAppState(appStateAtLoad as string));

let change: (state: AppStateStatus) => void;
let remove: jest.Mock;
function mount(start: AppStateStatus, motion: MotionPreference = 'FULL', active?: boolean) {
  setAppState(start);
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: AppStateStatus) => void) => {
    change = cb;
    return { remove };
  }) as never);
  return render(
    <MotionPreferenceProvider value={motion}>
      <Probe active={active} />
    </MotionPreferenceProvider>,
  );
}
afterEach(() => jest.restoreAllMocks());

test.each([
  ['active', 'true'],
  ['inactive', 'false'],
  ['background', 'false'],
] as const)('at mount, app state "%s" gives %s', (state, expected) => {
  const view = mount(state);
  expect(shown()).toBe(expected);
  view.unmount();
});

test('the change handler agrees with the initial value: only "active" is foreground', () => {
  const view = mount('active');
  act(() => change('inactive'));
  expect(shown()).toBe('false');
  act(() => change('active'));
  expect(shown()).toBe('true');
  act(() => change('background'));
  expect(shown()).toBe('false');
  view.unmount();
});

test('an app that starts in the background opens the gate when it becomes active', () => {
  const view = mount('background');
  act(() => change('active'));
  expect(shown()).toBe('true');
  view.unmount();
});

test('closed while the screen is not focused, and under reduced motion', () => {
  const blurred = mount('active', 'FULL', false);
  expect(shown()).toBe('false');
  blurred.unmount();
  const reduced = mount('active', 'REDUCED');
  expect(shown()).toBe('false');
  reduced.unmount();
});

test('unmount removes the AppState listener', () => {
  const view = mount('active');
  expect(remove).not.toHaveBeenCalled();
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
