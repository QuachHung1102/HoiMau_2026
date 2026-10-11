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
/** Current opacity (an Animated.Value serialises to its number) of the soft pill behind a tab. */
const pillOpacity = (name: string) => {
  const pill = screen.getByRole('tab', { name }).findAll(node => flat(node.props.style)?.backgroundColor === colors.soft)[0];
  return Number(JSON.stringify(flat(pill.props.style).opacity));
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
  // and to the eye by more than the tint: a soft pill behind it and a heavier label
  expect(flat(screen.getByText('Tổ đội').props.style).fontFamily).toBe(fontFamilies.bold);
  expect(flat(screen.getByText('Hôm nay').props.style).fontFamily).toBe(fontFamilies.medium);
});

test('selected = soft pill, primary icon and text; the others are muted without a pill', () => {
  render(bar(0));
  expect(pillOpacity('Hôm nay')).toBe(1);
  expect(pillOpacity('Lộ trình')).toBe(0);
  expect(flat(screen.getByText('Hôm nay').props.style).color).toBe(colors.primary);
  expect(flat(screen.getByText('Lộ trình').props.style).color).toBe(colors.muted);
  expect(screen.UNSAFE_getByType(lucide.Sun).props).toMatchObject({ size: 22, color: colors.primary });
  expect(screen.UNSAFE_getByType(lucide.Route).props).toMatchObject({ size: 22, color: colors.muted });
  expect(screen.UNSAFE_getByType(lucide.Users).props.size).toBe(22);
  expect(screen.UNSAFE_getByType(lucide.User).props.size).toBe(22);
});

test('an item is 60 dp high and the bar adds the bottom safe-area inset below it', () => {
  render(bar(0, 'REDUCED', 24));
  for (const tab of screen.getAllByRole('tab')) expect(flat(tab.props.style).minHeight).toBe(60);
  const list = screen.UNSAFE_getByProps({ accessibilityRole: 'tablist' });
  expect(list.props.accessibilityLabel).toBe('Điều hướng chính');
  const style = flat(list.props.style);
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

test('tab-pill: a selection change fades the pill over 220 ms; nothing animates on first render', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const fades = () => timing.mock.calls.filter(([, config]) => config.duration === 220);
  render(bar(0, 'FULL'));
  expect(fades()).toHaveLength(0);
  screen.rerender(bar(1, 'FULL'));
  // one fade out (Hôm nay) and one fade in (Lộ trình)
  expect(fades().map(([, config]) => config.toValue).sort()).toEqual([0, 1]);
  for (const [, config] of fades()) expect(config.useNativeDriver).toBe(true);
});

test('tab-pill under reduced motion: the pill changes at once, with no animation', () => {
  const timing = jest.spyOn(Animated, 'timing');
  render(bar(0, 'REDUCED'));
  screen.rerender(bar(1, 'REDUCED'));
  expect(timing.mock.calls.filter(([, config]) => config.duration === 220)).toHaveLength(0);
  expect(pillOpacity('Lộ trình')).toBe(1);
  expect(pillOpacity('Hôm nay')).toBe(0);
});
