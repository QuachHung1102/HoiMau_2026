import { fireEvent, render } from '@testing-library/react-native';
import { Animated, StyleSheet, Text } from 'react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { Touchable } from './Touchable';

afterEach(() => jest.restoreAllMocks());

const setup = (props: { disabled?: boolean; motion?: 'REDUCED' | 'FULL' } = {}) => {
  const onPress = jest.fn();
  const view = render(
    <MotionPreferenceProvider value={props.motion ?? 'FULL'}>
      <Touchable accessibilityRole="button" accessibilityLabel="Lưu" disabled={props.disabled} onPress={onPress}>
        <Text>Lưu</Text>
      </Touchable>
    </MotionPreferenceProvider>,
  );
  return { ...view, onPress };
};

test('role and label reach the tree and a press fires', () => {
  const { getByRole, onPress, unmount } = setup();
  fireEvent.press(getByRole('button', { name: 'Lưu' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  unmount();
});

test('disabled blocks onPress and reports disabled', () => {
  const { getByRole, onPress, unmount } = setup({ disabled: true });
  const el = getByRole('button', { name: 'Lưu' });
  expect(el.props.accessibilityState).toMatchObject({ disabled: true });
  fireEvent.press(el);
  expect(onPress).not.toHaveBeenCalled();
  unmount();
});

test('press feedback: scale 0.98 over 120 ms', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const { getByRole, unmount } = setup();
  fireEvent(getByRole('button'), 'pressIn');
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.98, duration: 120 }));
  unmount();
});

test('reduced motion starts no Animated.timing', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const { getByRole, unmount } = setup({ motion: 'REDUCED' });
  fireEvent(getByRole('button'), 'pressIn');
  fireEvent(getByRole('button'), 'pressOut');
  expect(timing).not.toHaveBeenCalled();
  unmount();
});

test('a small control expands its hit area to 48 x 48', () => {
  const { getByRole, unmount } = setup();
  fireEvent(getByRole('button'), 'layout', { nativeEvent: { layout: { width: 20, height: 30, x: 0, y: 0 } } });
  expect(getByRole('button').props.hitSlop).toEqual({ top: 9, bottom: 9, left: 14, right: 14 });
  unmount();
});

test('a caller hitSlop is kept where it is larger than the computed one', () => {
  const view = render(
    <Touchable accessibilityRole="button" hitSlop={{ top: 30, left: 2 }}>
      <Text>x</Text>
    </Touchable>,
  );
  fireEvent(view.getByRole('button'), 'layout', { nativeEvent: { layout: { width: 20, height: 30, x: 0, y: 0 } } });
  expect(view.getByRole('button').props.hitSlop).toEqual({ top: 30, bottom: 9, left: 14, right: 14 });
  view.unmount();
});

test('a caller transform is kept next to the press scale', () => {
  const view = render(
    <Touchable accessibilityRole="button" style={{ transform: [{ rotate: '5deg' }] }}>
      <Text>x</Text>
    </Touchable>,
  );
  const transform = StyleSheet.flatten(view.getByRole('button').props.style).transform as unknown[];
  expect(transform).toHaveLength(2);
  expect(transform[0]).toEqual({ rotate: '5deg' });
  view.unmount();
});
