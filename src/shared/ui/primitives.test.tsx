import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { colors, fontFamilies } from '../theme/tokens';
import { AppText } from './AppText';
import { Card, ListRow } from './Card';
import { Icon } from './Icon';
import { Screen } from './Screen';

test('AppText: headline is Be Vietnam Pro 28, body is Inter 16, weight picks the per-weight file', () => {
  const view = render(
    <>
      <AppText variant="headline">Hồi Máu</AppText>
      <AppText>Nội dung</AppText>
      <AppText weight="semibold">Đậm vừa</AppText>
    </>,
  );
  const style = (t: string) => StyleSheet.flatten(view.getByText(t).props.style);
  expect(style('Hồi Máu')).toMatchObject({ fontFamily: fontFamilies.headline, fontSize: 28, color: colors.ink });
  expect(style('Nội dung')).toMatchObject({ fontFamily: fontFamilies.regular, fontSize: 16 });
  expect(style('Đậm vừa').fontFamily).toBe(fontFamilies.semibold);
  view.unmount();
});

test('Icon renders a lucide glyph', () => {
  const view = render(<Icon name="Heart" />);
  expect(view.toJSON()).not.toBeNull();
  view.unmount();
});

test('Screen: title is a header, Back is a labelled button, children render', () => {
  const onBack = jest.fn();
  const view = render(
    <Screen title="Cài đặt" subtitle="Phụ đề" onBack={onBack}>
      <Text>Nội dung</Text>
    </Screen>,
  );
  expect(view.getByRole('header', { name: 'Cài đặt' })).toBeTruthy();
  expect(view.getByText('Nội dung')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: 'Quay lại' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('Card tones use surface, soft and primary backgrounds', () => {
  const view = render(
    <>
      <Card tone="surface" testID="a" />
      <Card tone="soft" testID="b" />
      <Card tone="primary" testID="c" />
    </>,
  );
  const bg = (id: string) => StyleSheet.flatten(view.getByTestId(id).props.style).backgroundColor;
  expect([bg('a'), bg('b'), bg('c')]).toEqual([colors.white, colors.soft, colors.primary]);
  view.unmount();
});

test('ListRow is one touchable with one combined label', () => {
  const onPress = jest.fn();
  const view = render(<ListRow icon="Bell" title="Thông báo" description="Chọn điều bạn muốn nhận" onPress={onPress} />);
  const buttons = view.getAllByRole('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].props.accessibilityLabel).toBe('Thông báo. Chọn điều bạn muốn nhận');
  fireEvent.press(buttons[0]);
  expect(onPress).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('ListRow without onPress is plain and shows its trailing node', () => {
  const view = render(<ListRow title="Âm thanh" trailing={<Text>Đang tắt</Text>} />);
  expect(view.queryByRole('button')).toBeNull();
  expect(view.getByText('Đang tắt')).toBeTruthy();
  view.unmount();
});

test('ListRow: a pressable row exposes title, description and status in one label', () => {
  const view = render(<ListRow title="Âm thanh" description="Hiệu ứng trong ứng dụng" status="Đang tắt" onPress={() => undefined} />);
  expect(view.getByRole('button').props.accessibilityLabel).toBe('Âm thanh. Hiệu ứng trong ứng dụng. Đang tắt');
  expect(view.getByText('Đang tắt')).toBeTruthy();
  view.unmount();
});

test('Icon without a label is hidden from the accessibility tree', () => {
  const view = render(<Icon name="Heart" />);
  expect(view.toJSON()).toMatchObject({
    props: { accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true },
  });
  view.unmount();
});

test('Icon with a label is an image the screen reader can find', () => {
  const view = render(<Icon name="Heart" accessibilityLabel="Yêu thích" />);
  expect(view.getByLabelText('Yêu thích').props).toMatchObject({ accessible: true, accessibilityRole: 'image' });
  view.unmount();
});

test('Screen without scroll fills the screen so children can pin to the bottom', () => {
  const view = render(
    <Screen scroll={false}>
      <Text testID="kid">x</Text>
    </Screen>,
  );
  // the nearest ancestor that carries a style is the content view
  let node = view.getByTestId('kid').parent;
  while (node && !node.props.style) node = node.parent;
  expect(StyleSheet.flatten(node?.props.style).flex).toBe(1);
  view.unmount();
});
