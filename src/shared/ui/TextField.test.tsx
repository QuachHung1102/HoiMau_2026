import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { colors } from '../theme/tokens';
import { TextField } from './TextField';

const wrap = (node: React.ReactElement) => <MotionPreferenceProvider value="REDUCED">{node}</MotionPreferenceProvider>;
// the animated border colour is read back as rgba()
const rgba = (hex: string) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, 1)`;
const boxStyle = (view: ReturnType<typeof render>) => StyleSheet.flatten(view.getByTestId('field-box').props.style);

test('shows the visible label and a labelled input; a placeholder does not replace the label', () => {
  const view = render(wrap(<TextField label="Email" placeholder="ban@example.com" value="" onChangeText={() => undefined} />));
  expect(view.getByText('Email')).toBeTruthy();
  expect(view.getByLabelText('Email').props.placeholder).toBe('ban@example.com');
  expect(boxStyle(view).borderColor).toBe(rgba(colors.line));
  view.unmount();
});

test('typing reaches onChangeText', () => {
  const onChangeText = jest.fn();
  const view = render(wrap(<TextField label="Email" value="" onChangeText={onChangeText} />));
  fireEvent.changeText(view.getByLabelText('Email'), 'a@b.vn');
  expect(onChangeText).toHaveBeenCalledWith('a@b.vn');
  view.unmount();
});

test('an error shows its text, keeps the label, extends the accessibility label and uses the error border', () => {
  const view = render(wrap(<TextField label="Chiều cao" error="Chiều cao cần trong khoảng 120–230 cm." value="250" onChangeText={() => undefined} />));
  expect(view.getByText('Chiều cao cần trong khoảng 120–230 cm.')).toBeTruthy();
  expect(view.getByText('Chiều cao')).toBeTruthy();
  expect(view.getByLabelText('Chiều cao, lỗi: Chiều cao cần trong khoảng 120–230 cm.')).toBeTruthy();
  expect(boxStyle(view).borderColor).toBe(rgba(colors.error));
  view.unmount();
});

test('the error text is a polite live region', () => {
  const view = render(wrap(<TextField label="Email" error="Email chưa đúng." value="" onChangeText={() => undefined} />));
  let node = view.getByText('Email chưa đúng.').parent;
  while (node && !node.props.accessibilityLiveRegion) node = node.parent;
  expect(node?.props.accessibilityLiveRegion).toBe('polite');
  view.unmount();
});

test('helper text shows when there is no error and gives way to the error', () => {
  const view = render(wrap(<TextField label="Mật khẩu" helper="Ít nhất 8 ký tự" value="" onChangeText={() => undefined} />));
  expect(view.getByText('Ít nhất 8 ký tự')).toBeTruthy();
  view.rerender(wrap(<TextField label="Mật khẩu" helper="Ít nhất 8 ký tự" error="Mật khẩu quá ngắn." value="" onChangeText={() => undefined} />));
  expect(view.queryByText('Ít nhất 8 ký tự')).toBeNull();
  expect(view.getByText('Mật khẩu quá ngắn.')).toBeTruthy();
  view.unmount();
});

test('focus thickens the border in the primary colour and blur restores it', () => {
  const view = render(wrap(<TextField label="Email" value="" onChangeText={() => undefined} />));
  fireEvent(view.getByLabelText('Email'), 'focus');
  expect(boxStyle(view)).toMatchObject({ borderColor: colors.primary, borderWidth: 2 });
  fireEvent(view.getByLabelText('Email'), 'blur');
  expect(boxStyle(view)).toMatchObject({ borderColor: rgba(colors.line), borderWidth: 1 });
  view.unmount();
});

test('a secure field hides the text and a labelled button toggles it', () => {
  const view = render(wrap(<TextField label="Mật khẩu" secure value="abc" onChangeText={() => undefined} />));
  expect(view.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(true);
  fireEvent.press(view.getByRole('button', { name: 'Hiện mật khẩu' }));
  expect(view.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(false);
  expect(view.getByRole('button', { name: 'Ẩn mật khẩu' })).toBeTruthy();
  view.unmount();
});

test('a secure field turns off capitalisation, correction and spell check; a caller can override', () => {
  const view = render(wrap(<TextField label="Mật khẩu" secure value="" onChangeText={() => undefined} />));
  expect(view.getByLabelText('Mật khẩu').props).toMatchObject({ autoCapitalize: 'none', autoCorrect: false, spellCheck: false });
  view.rerender(wrap(<TextField label="Mật khẩu" secure autoCorrect value="" onChangeText={() => undefined} />));
  expect(view.getByLabelText('Mật khẩu').props.autoCorrect).toBe(true);
  view.unmount();
});

test('a plain field leaves those keyboard settings alone', () => {
  const view = render(wrap(<TextField label="Tên" value="" onChangeText={() => undefined} />));
  expect(view.getByLabelText('Tên').props.autoCapitalize).toBeUndefined();
  view.unmount();
});

test('helper text is also the input hint, until an error replaces it', () => {
  const view = render(wrap(<TextField label="Mật khẩu" helper="Ít nhất 8 ký tự" value="" onChangeText={() => undefined} />));
  expect(view.getByLabelText('Mật khẩu').props.accessibilityHint).toBe('Ít nhất 8 ký tự');
  view.rerender(wrap(<TextField label="Mật khẩu" helper="Ít nhất 8 ký tự" error="Quá ngắn." value="" onChangeText={() => undefined} />));
  expect(view.getByLabelText('Mật khẩu, lỗi: Quá ngắn.').props.accessibilityHint).toBeUndefined();
  view.unmount();
});
