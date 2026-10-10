import { fireEvent, render, userEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';
import { Button } from './Button';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never);

test.each([
  ['primary', colors.primary],
  ['secondary', colors.soft],
  ['onPrimary', colors.lime],
] as const)('%s variant uses its background token', (variant, expected) => {
  const view = render(<Button label="Tiếp tục" variant={variant} />);
  expect(flat(view.getByRole('button')).backgroundColor).toBe(expected);
  view.unmount();
});

test('has a minimum height of 52 so it can grow with the font scale', () => {
  const view = render(<Button label="Tiếp tục" />);
  expect(flat(view.getByRole('button')).minHeight).toBe(52);
  view.unmount();
});

test('press calls onPress', () => {
  const onPress = jest.fn();
  const view = render(<Button label="Tiếp tục" onPress={onPress} />);
  fireEvent.press(view.getByRole('button', { name: 'Tiếp tục' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('loading keeps the label, reports busy and swallows presses', async () => {
  const onPress = jest.fn();
  const view = render(<Button label="Đang lưu" loading onPress={onPress} />);
  const el = view.getByRole('button', { name: 'Đang lưu' });
  expect(el.props.accessibilityState).toMatchObject({ busy: true });
  // userEvent goes through the real press responder; fireEvent.press would find Button's own onPress prop up the tree.
  await userEvent.setup().press(el);
  expect(onPress).not.toHaveBeenCalled();
  view.unmount();

  // control: the same gesture does fire when not loading
  const idle = render(<Button label="Lưu" onPress={onPress} />);
  await userEvent.setup().press(idle.getByRole('button'));
  expect(onPress).toHaveBeenCalledTimes(1);
  idle.unmount();
});

test('disabled blocks presses and reports disabled', () => {
  const onPress = jest.fn();
  const view = render(<Button label="Tiếp tục" disabled onPress={onPress} />);
  fireEvent.press(view.getByRole('button'));
  expect(onPress).not.toHaveBeenCalled();
  expect(view.getByRole('button').props.accessibilityState).toMatchObject({ disabled: true });
  view.unmount();
});
