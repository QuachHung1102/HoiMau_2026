import { fireEvent, render } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { colors } from '../theme/tokens';
import { Icon } from './Icon';
import { Checkbox, FilterChip, RadioRow, SegmentedControl, Switch } from './Toggles';

afterEach(() => jest.restoreAllMocks());
const wrap = (node: React.ReactElement, motion: 'REDUCED' | 'FULL' = 'REDUCED') => (
  <MotionPreferenceProvider value={motion}>{node}</MotionPreferenceProvider>
);

test('Checkbox: role checkbox, checked state, label and description, toggles through onChange', () => {
  const onChange = jest.fn();
  const view = render(wrap(<Checkbox label="Tôi đồng ý điều khoản" description="Đọc điều khoản" checked={false} onChange={onChange} />));
  const box = view.getByRole('checkbox', { name: /Tôi đồng ý điều khoản/ });
  expect(box.props.accessibilityState).toMatchObject({ checked: false });
  expect(view.getByText('Đọc điều khoản')).toBeTruthy();
  fireEvent.press(box);
  expect(onChange).toHaveBeenCalledWith(true);
  view.rerender(wrap(<Checkbox label="Tôi đồng ý điều khoản" checked onChange={onChange} />));
  expect(view.getByRole('checkbox').props.accessibilityState).toMatchObject({ checked: true });
  fireEvent.press(view.getByRole('checkbox'));
  expect(onChange).toHaveBeenLastCalledWith(false);
  view.unmount();
});

test('Checkbox: disabled blocks the press and reports disabled', () => {
  const onChange = jest.fn();
  const view = render(wrap(<Checkbox label="Đồng ý" checked={false} onChange={onChange} disabled />));
  expect(view.getByRole('checkbox').props.accessibilityState).toMatchObject({ disabled: true });
  fireEvent.press(view.getByRole('checkbox'));
  expect(onChange).not.toHaveBeenCalled();
  view.unmount();
});

test('Checkbox: the tick springs in with the pop spring unless motion is reduced', () => {
  const spring = jest.spyOn(Animated, 'spring');
  const reduced = render(wrap(<Checkbox label="Đồng ý" checked onChange={() => undefined} />));
  expect(spring).not.toHaveBeenCalled();
  reduced.unmount();
  const full = render(wrap(<Checkbox label="Đồng ý" checked onChange={() => undefined} />, 'FULL'));
  expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ damping: 12, stiffness: 220, mass: 1 }));
  full.unmount();
});

test('Switch: role switch, writes the state out as text, state reaches accessibilityState', () => {
  const onChange = jest.fn();
  const view = render(wrap(<Switch label="Nhắc thói quen" value={false} onChange={onChange} />));
  expect(view.getByText('Đang tắt')).toBeTruthy();
  expect(view.getByRole('switch', { name: /Nhắc thói quen/ }).props.accessibilityState).toMatchObject({ checked: false });
  fireEvent.press(view.getByRole('switch'));
  expect(onChange).toHaveBeenCalledWith(true);
  view.rerender(wrap(<Switch label="Nhắc thói quen" value onChange={onChange} />));
  expect(view.getByText('Đang bật')).toBeTruthy();
  expect(view.queryByText('Đang tắt')).toBeNull();
  expect(view.getByRole('switch').props.accessibilityState).toMatchObject({ checked: true });
  view.unmount();
});

test('Switch: under full motion a change animates to the end state over the 220 ms feedback duration', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const view = render(wrap(<Switch label="Âm thanh" value={false} onChange={() => undefined} />, 'FULL'));
  view.rerender(wrap(<Switch label="Âm thanh" value onChange={() => undefined} />, 'FULL'));
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 220 }));
  view.unmount();
});

test('Switch: with reduced motion the track is already in its end state', () => {
  const view = render(wrap(<Switch label="Âm thanh" value onChange={() => undefined} />));
  const timing = jest.spyOn(Animated, 'timing');
  view.rerender(wrap(<Switch label="Âm thanh" value={false} onChange={() => undefined} />));
  expect(timing).not.toHaveBeenCalled();
  view.unmount();
});

const options = [
  { value: 'SYSTEM', label: 'Theo hệ thống' },
  { value: 'REDUCED', label: 'Giảm' },
  { value: 'FULL', label: 'Đầy đủ' },
];

test('SegmentedControl: radiogroup of radios, the selected one is checked and shows a check mark', () => {
  const onChange = jest.fn();
  const view = render(wrap(<SegmentedControl accessibilityLabel="Chuyển động" options={options} value="SYSTEM" onChange={onChange} />));
  expect(view.getByLabelText('Chuyển động').props.accessibilityRole).toBe('radiogroup');
  expect(view.getAllByRole('radio')).toHaveLength(3);
  expect(view.getByRole('radio', { name: 'Theo hệ thống' }).props.accessibilityState).toMatchObject({ checked: true });
  expect(view.getByRole('radio', { name: 'Giảm' }).props.accessibilityState).toMatchObject({ checked: false });
  // the check mark (an icon) appears only on the selected option
  expect(view.UNSAFE_getAllByType(Icon)).toHaveLength(1);
  expect(view.getByRole('radio', { name: 'Theo hệ thống' }).findAllByType(Icon)).toHaveLength(1);
  fireEvent.press(view.getByRole('radio', { name: 'Đầy đủ' }));
  expect(onChange).toHaveBeenCalledWith('FULL');
  view.unmount();
});

test('FilterChip: button with selected state, check mark only when selected, selected colours', () => {
  const onPress = jest.fn();
  const view = render(wrap(<FilterChip label="Trong phòng" selected={false} onPress={onPress} />));
  const chip = view.getByRole('button', { name: 'Trong phòng' });
  expect(chip.props.accessibilityState).toMatchObject({ selected: false });
  expect(view.UNSAFE_queryAllByType(Icon)).toHaveLength(0);
  expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe(colors.soft);
  fireEvent.press(chip);
  expect(onPress).toHaveBeenCalledTimes(1);
  view.rerender(wrap(<FilterChip label="Trong phòng" selected onPress={onPress} />));
  const picked = view.getByRole('button', { name: 'Trong phòng' });
  expect(picked.props.accessibilityState).toMatchObject({ selected: true });
  expect(view.UNSAFE_getAllByType(Icon)).toHaveLength(1);
  expect(StyleSheet.flatten(picked.props.style).backgroundColor).toBe(colors.primary);
  view.unmount();
});

test('RadioRow: role radio with checked state, a filled dot only when selected, label and description', () => {
  const onPress = jest.fn();
  const view = render(wrap(<RadioRow label="Mình cùng vận động nhé?" description="Mẫu lời nhắc" selected={false} onPress={onPress} />));
  const row = view.getByRole('radio', { name: /Mình cùng vận động nhé/ });
  expect(row.props.accessibilityState).toMatchObject({ checked: false });
  expect(view.queryByTestId('radio-dot')).toBeNull();
  expect(view.getByText('Mẫu lời nhắc')).toBeTruthy();
  fireEvent.press(row);
  expect(onPress).toHaveBeenCalledTimes(1);
  view.rerender(wrap(<RadioRow label="Mình cùng vận động nhé?" selected onPress={onPress} />));
  expect(view.getByRole('radio').props.accessibilityState).toMatchObject({ checked: true });
  expect(view.getByTestId('radio-dot')).toBeTruthy();
  view.unmount();
});

test('RadioRow: disabled blocks the press and reports disabled', () => {
  const onPress = jest.fn();
  const view = render(wrap(<RadioRow label="Chưa gửi được" selected={false} onPress={onPress} disabled />));
  expect(view.getByRole('radio').props.accessibilityState).toMatchObject({ disabled: true });
  fireEvent.press(view.getByRole('radio'));
  expect(onPress).not.toHaveBeenCalled();
  view.unmount();
});

test('SegmentedControl: segments can shrink and wrap so three fit at a large font scale', () => {
  const view = render(wrap(<SegmentedControl accessibilityLabel="Chuyển động" options={options} value="SYSTEM" onChange={() => undefined} />));
  const segment = StyleSheet.flatten(view.getByRole('radio', { name: 'Giảm' }).props.style);
  expect(segment).toMatchObject({ flexShrink: 1, minHeight: 48 });
  expect(segment.height).toBeUndefined();
  view.unmount();
});
