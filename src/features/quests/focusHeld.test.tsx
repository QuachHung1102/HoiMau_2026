import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useFocusHeld, useStandUpHold } from './useStandUp';

// The hold is one counter for the whole focus flow (the session and its result are two screens): `useFocusHeld` is true
// for as long as any screen holds, so an overlay never slips in between the two.
function Holding() {
  useStandUpHold();
  return null;
}
function Probe() {
  return <Text testID="held">{String(useFocusHeld())}</Text>;
}
const held = () => screen.getByTestId('held').props.children;

test('held while any screen of the flow is mounted, free when the last one leaves', () => {
  const tree = (first: boolean, second: boolean) => (
    <>
      <Probe />
      {first ? <Holding key="first" /> : null}
      {second ? <Holding key="second" /> : null}
    </>
  );
  const view = render(tree(false, false));
  expect(held()).toBe('false');
  view.rerender(tree(true, false));
  expect(held()).toBe('true');
  view.rerender(tree(true, true));
  view.rerender(tree(false, true));
  expect(held()).toBe('true');
  view.rerender(tree(false, false));
  expect(held()).toBe('false');
  view.unmount();
});

test('a screen that replaces another in one commit (session -> result) does not let go in between', () => {
  const seen: string[] = [];
  function Spy() {
    seen.push(String(useFocusHeld()));
    return null;
  }
  const view = render(
    <>
      <Spy />
      <Holding key="session" />
    </>,
  );
  seen.length = 0;
  view.rerender(
    <>
      <Spy />
      <Holding key="result" />
    </>,
  );
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(value => value === 'true')).toBe(true);
  view.unmount();
});
