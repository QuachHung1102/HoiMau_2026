import { fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Modal, Text } from 'react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { BottomSheet } from './BottomSheet';
import { Dialog } from './Dialog';

afterEach(() => jest.restoreAllMocks());
const wrap = (node: React.ReactElement) => <MotionPreferenceProvider value="REDUCED">{node}</MotionPreferenceProvider>;

function setup() {
  const onDismiss = jest.fn();
  const primary = jest.fn();
  const secondary = jest.fn();
  const view = render(
    wrap(
      <Dialog
        title="Kết thúc buổi tập bây giờ?"
        body="Phần đã tập vẫn được lưu."
        primary={{ label: 'Tập tiếp', onPress: primary }}
        secondary={{ label: 'Kết thúc và lưu', onPress: secondary }}
        onDismiss={onDismiss}
      />,
    ),
  );
  return { view, onDismiss, primary, secondary };
}

test('Dialog shows a header title, the body and both actions', () => {
  const { view } = setup();
  expect(view.getByRole('header', { name: 'Kết thúc buổi tập bây giờ?' })).toBeTruthy();
  expect(view.getByText('Phần đã tập vẫn được lưu.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Tập tiếp' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Kết thúc và lưu' })).toBeTruthy();
  view.unmount();
});

test('Dialog is modal to the screen reader', () => {
  const { view } = setup();
  expect(view.UNSAFE_getByProps({ accessibilityViewIsModal: true })).toBeTruthy();
  view.unmount();
});

test('the Back request calls onDismiss', () => {
  const { view, onDismiss } = setup();
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  expect(onDismiss).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('a tap on the backdrop calls onDismiss', () => {
  const { view, onDismiss } = setup();
  // the backdrop sits outside the modal card, so a screen reader on iOS does not reach it: query it hidden
  fireEvent.press(view.getByLabelText('Đóng', { includeHiddenElements: true }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('primary and secondary fire their own handlers', () => {
  const { view, primary, secondary, onDismiss } = setup();
  fireEvent.press(view.getByRole('button', { name: 'Tập tiếp' }));
  expect(primary).toHaveBeenCalledTimes(1);
  expect(secondary).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Kết thúc và lưu' }));
  expect(secondary).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  view.unmount();
});

test('when the dialog is shown, screen-reader focus is sent to the title', () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValue(7); // Jest has no native node handles
  const { view } = setup();
  fireEvent(view.UNSAFE_getByType(Modal), 'show');
  expect(focus).toHaveBeenCalledWith(7);
  view.unmount();
});

test('a dialog that is not visible renders nothing', () => {
  const view = render(wrap(<Dialog visible={false} title="Ẩn" body="Ẩn" primary={{ label: 'OK', onPress: jest.fn() }} onDismiss={jest.fn()} />));
  expect(view.queryByText('Ẩn')).toBeNull();
  view.unmount();
});

test('BottomSheet shows title and children; Back, the close button and the backdrop dismiss', () => {
  const onDismiss = jest.fn();
  const view = render(
    wrap(
      <BottomSheet title="Múi giờ" onDismiss={onDismiss}>
        <Text>Nội dung</Text>
      </BottomSheet>,
    ),
  );
  expect(view.getByRole('header', { name: 'Múi giờ' })).toBeTruthy();
  expect(view.getByText('Nội dung')).toBeTruthy();
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  const closers = view.getAllByLabelText('Đóng', { includeHiddenElements: true }); // backdrop and the close button
  expect(closers).toHaveLength(2);
  closers.forEach(c => fireEvent.press(c));
  expect(onDismiss).toHaveBeenCalledTimes(3);
  view.unmount();
});

test('BottomSheet sends screen-reader focus to its title when shown', () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  jest.spyOn(jest.requireActual('react-native'), 'findNodeHandle').mockReturnValue(7); // Jest has no native node handles
  const view = render(
    wrap(
      <BottomSheet title="Múi giờ" onDismiss={jest.fn()}>
        <Text>x</Text>
      </BottomSheet>,
    ),
  );
  fireEvent(view.UNSAFE_getByType(Modal), 'show');
  expect(focus).toHaveBeenCalledWith(7);
  view.unmount();
});
