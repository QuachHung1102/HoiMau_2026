import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as lucide from 'lucide-react-native';
import { Animated, StyleSheet } from 'react-native';
import { MotionPreferenceProvider } from '../shared/motion/useReducedMotion';
import { colors, fontFamilies } from '../shared/theme/tokens';
import type { IconName } from '../shared/ui/Icon';
import { TAB_BAR_HEIGHT, TabBar } from './TabBar';

const tabs = [
  ['TodayTab', 'Hôm nay', 'Sun'],
  ['PlanTab', 'Lộ trình', 'Route'],
  ['GuildTab', 'Tổ đội', 'Users'],
  ['ProfileTab', 'Cá nhân', 'User'],
] as const;
const icons: Record<string, IconName> = Object.fromEntries(tabs.map(([name, , icon]) => [name, icon]));
const navigation = { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() };

function bar(index: number, motion: 'REDUCED' | 'FULL' = 'REDUCED', bottom = 0) {
  const routes = tabs.map(([name]) => ({ key: `${name}-key`, name, params: undefined }));
  const props = {
    state: { index, routes },
    descriptors: Object.fromEntries(tabs.map(([name, title]) => [`${name}-key`, { options: { title } }])),
    navigation,
    insets: { top: 0, right: 0, bottom, left: 0 },
  } as unknown as BottomTabBarProps;
  return (
    <MotionPreferenceProvider value={motion}>
      <TabBar {...props} icons={icons} />
    </MotionPreferenceProvider>
  );
}
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;
const row = () => screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' });
/** The row of four items reports its width: 360 dp, so one item is 90 dp wide. */
const measure = (width = 360) => fireEvent(row(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 60 } } });
const pills = () => row().findAll(node => typeof node.type === 'string' && flat(node.props.style)?.backgroundColor === colors.soft);
/** Where the pill is (an Animated.Value serialises to its number) and how wide. */
const pill = () => {
  const style = flat(pills()[0].props.style) as { width: number; transform: { translateX: unknown }[] };
  return { width: style.width, x: Number(JSON.stringify(style.transform[0].translateX)) };
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('four tabs with the labels of the design, in order', () => {
  render(bar(0));
  expect(screen.getAllByRole('tab').map(tab => tab.props.accessibilityLabel)).toEqual(['Hôm nay', 'Lộ trình', 'Tổ đội', 'Cá nhân']);
  for (const [, label] of tabs) expect(screen.getByText(label)).toBeTruthy();
});

test('the selected tab is exposed to assistive technology, not only by colour', () => {
  render(bar(2));
  expect(screen.getByRole('tab', { name: 'Tổ đội', selected: true })).toBeTruthy();
  for (const name of ['Hôm nay', 'Lộ trình', 'Cá nhân']) {
    expect(screen.getByRole('tab', { name }).props.accessibilityState).toMatchObject({ selected: false });
  }
});

test('the selection is readable without the pill: before the bar is measured there is none', () => {
  render(bar(2));
  expect(pills()).toHaveLength(0);
  expect(flat(screen.getByText('Tổ đội').props.style)).toMatchObject({ fontFamily: fontFamilies.bold, color: colors.primary });
  expect(flat(screen.getByText('Hôm nay').props.style)).toMatchObject({ fontFamily: fontFamilies.medium, color: colors.muted });
  expect(screen.getByRole('tab', { name: 'Tổ đội', selected: true })).toBeTruthy();
});

test('icons are 22 dp: primary on the selected item, muted on the others', () => {
  render(bar(0));
  expect(screen.UNSAFE_getByType(lucide.Sun).props).toMatchObject({ size: 22, color: colors.primary });
  expect(screen.UNSAFE_getByType(lucide.Route).props).toMatchObject({ size: 22, color: colors.muted });
  expect(screen.UNSAFE_getByType(lucide.Users).props.size).toBe(22);
  expect(screen.UNSAFE_getByType(lucide.User).props.size).toBe(22);
});

test('one soft pill, one item wide, sits behind the selected item', () => {
  render(bar(2));
  measure();
  expect(pills()).toHaveLength(1);
  expect(pill()).toEqual({ width: 90, x: 180 });
  expect(pills()[0].props.pointerEvents).toBe('none');
});

test('an item is 60 dp high and the bar adds the bottom safe-area inset below it', () => {
  render(bar(0, 'REDUCED', 24));
  for (const tab of screen.getAllByRole('tab')) expect(flat(tab.props.style).minHeight).toBe(60);
  expect(row().props.accessibilityLabel).toBe('Điều hướng chính');
  const style = flat(row().parent!.props.style);
  expect([style.paddingTop, style.paddingBottom]).toEqual([8, 8 + 24]);
  expect(TAB_BAR_HEIGHT).toBe(60 + 8 + 8);
});

test('labels scale with the font setting up to 1.3 and are never switched off', () => {
  render(bar(0));
  for (const [, label] of tabs) {
    const text = screen.getByText(label);
    expect(text.props.maxFontSizeMultiplier).toBe(1.3);
    expect(text.props.allowFontScaling).not.toBe(false);
  }
});

test('pressing another tab emits tabPress and navigates to it', () => {
  render(bar(0));
  fireEvent.press(screen.getByRole('tab', { name: 'Tổ đội' }));
  expect(navigation.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'GuildTab-key', canPreventDefault: true });
  expect(navigation.navigate).toHaveBeenCalledWith('GuildTab', undefined);
});

test('pressing the selected tab only emits tabPress (its stack pops to the root)', () => {
  render(bar(0));
  fireEvent.press(screen.getByRole('tab', { name: 'Hôm nay' }));
  expect(navigation.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'TodayTab-key', canPreventDefault: true });
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('a prevented tabPress does not navigate', () => {
  navigation.emit.mockReturnValueOnce({ defaultPrevented: true });
  render(bar(0));
  fireEvent.press(screen.getByRole('tab', { name: 'Lộ trình' }));
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('tab-pill: a selection change slides the pill to the new item in 320 ms on the enter curve', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const bezier = jest.spyOn(require('react-native').Easing, 'bezier');
  render(bar(0, 'FULL'));
  measure();
  // putting the pill in place after the first measurement is not a motion
  expect(timing).not.toHaveBeenCalled();
  expect(pill()).toEqual({ width: 90, x: 0 });

  screen.rerender(bar(3, 'FULL'));
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 270, duration: 320, useNativeDriver: true });
  expect(bezier).toHaveBeenCalledWith(0.2, 0, 0, 1);
});

test('tab-pill: a new measurement moves the pill without animating', () => {
  const timing = jest.spyOn(Animated, 'timing');
  render(bar(1, 'FULL'));
  measure(360);
  measure(600);
  expect(timing).not.toHaveBeenCalled();
  expect(pill()).toEqual({ width: 150, x: 150 });
});

test('tab-pill under reduced motion: the pill is behind the new item at once, with no slide', () => {
  const timing = jest.spyOn(Animated, 'timing');
  render(bar(0, 'REDUCED'));
  measure();
  screen.rerender(bar(1, 'REDUCED'));
  expect(timing).not.toHaveBeenCalled();
  expect(pill()).toEqual({ width: 90, x: 90 });
});
