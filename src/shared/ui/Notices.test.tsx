import { fireEvent, render } from '@testing-library/react-native';
import { MotionPreferenceProvider } from '../motion/useReducedMotion';
import { colors } from '../theme/tokens';
import { DisabledReason, InlineError } from './Notices';

const wrap = (node: React.ReactElement) => <MotionPreferenceProvider value="REDUCED">{node}</MotionPreferenceProvider>;

type Node = { parent: Node | null; props: Record<string, unknown> };
const liveRegionOf = (start: Node | null) => {
  let node = start;
  while (node && !node.props.accessibilityLiveRegion) node = node.parent;
  return node?.props.accessibilityLiveRegion;
};

test('InlineError shows its text with an icon, as a polite live region, in the error colour', () => {
  const view = render(wrap(<InlineError message="Chưa lưu được phần nước vừa ghi." />));
  const text = view.getByText('Chưa lưu được phần nước vừa ghi.');
  expect(liveRegionOf(text as unknown as Node)).toBe('polite');
  expect(JSON.stringify(view.toJSON())).toContain(colors.error);
  view.unmount();
});

test('InlineError with an action offers a button that fires', () => {
  const onPress = jest.fn();
  const view = render(wrap(<InlineError message="Chưa lưu được." action={{ label: 'Thử lại', onPress }} />));
  fireEvent.press(view.getByRole('button', { name: 'Thử lại' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('DisabledReason states the reason in text and is not an alert', () => {
  const view = render(wrap(<DisabledReason reason="Lời nhắc gửi được từ 12:00 đến 20:00 theo giờ của Minh." icon="Clock" />));
  const text = view.getByText('Lời nhắc gửi được từ 12:00 đến 20:00 theo giờ của Minh.');
  expect(liveRegionOf(text as unknown as Node)).toBeUndefined();
  expect(JSON.stringify(view.toJSON())).not.toContain(colors.error);
  view.unmount();
});
