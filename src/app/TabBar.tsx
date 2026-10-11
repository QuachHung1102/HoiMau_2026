import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as vi from '../shared/i18n/vi/nav';
import { motion } from '../shared/motion/motion';
import { useReducedMotion } from '../shared/motion/useReducedMotion';
import { useTheme } from '../shared/theme/ThemeProvider';
import { radius, sizes } from '../shared/theme/tokens';
import { AppText } from '../shared/ui/AppText';
import { Icon, type IconName } from '../shared/ui/Icon';
import { Touchable } from '../shared/ui/Touchable';

const PADDING = 8;
const ICON_SIZE = 22;
const LABEL_MAX_FONT_SCALE = 1.3;

/**
 * Height of the bar without the bottom safe-area inset; whatever floats above the bar (the snackbar) adds it.
 * It is a constant because the label scale is capped: icon 22 + gap 4 + label 14 x 1.3 stays inside the 60 dp item.
 */
export const TAB_BAR_HEIGHT = sizes.navItemHeight + 2 * PADDING;

type ItemProps = { label: string; icon: IconName; selected: boolean; onPress: () => void };

function TabItem({ label, icon, selected, onPress }: ItemProps) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [pill] = useState(() => new Animated.Value(selected ? 1 : 0));
  const shown = useRef(selected);
  useEffect(() => {
    if (shown.current === selected) return;
    shown.current = selected;
    const toValue = selected ? 1 : 0;
    if (reduced) {
      pill.setValue(toValue);
      return;
    }
    // motion: tab-pill
    const fade = Animated.timing(pill, {
      toValue,
      duration: motion.durationsMs.feedback,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [selected, reduced, pill]);
  const tint = selected ? 'primary' : 'muted';
  return (
    <Touchable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.item}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.pill, { backgroundColor: palette.soft, opacity: pill }]} />
      <Icon name={icon} size={ICON_SIZE} color={palette[tint]} />
      {/* The one place where the font scale is capped (never switched off): four labels must share one row. */}
      <AppText variant="navLabel" weight={selected ? 'bold' : 'medium'} color={tint} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE} numberOfLines={1}>
        {label}
      </AppText>
    </Touchable>
  );
}

type Props = Pick<BottomTabBarProps, 'state' | 'descriptors' | 'navigation' | 'insets'> & {
  /** Icon per tab route name. The label is the tab screen's `title` option. */
  icons: Record<string, IconName>;
};

export function TabBar({ state, descriptors, navigation, insets, icons }: Props) {
  const palette = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={vi.tabBar}
      style={[styles.bar, { backgroundColor: palette.white, borderTopColor: palette.line, paddingBottom: PADDING + insets.bottom }]}
    >
      {state.routes.map((route, index) => {
        const selected = state.index === index;
        return (
          <TabItem
            key={route.key}
            label={descriptors[route.key].options.title ?? route.name}
            icon={icons[route.name]}
            selected={selected}
            onPress={() => {
              // `tabPress` on the selected tab is what pops its stack back to the root.
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 4, paddingTop: PADDING, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, minHeight: sizes.navItemHeight, alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: { borderRadius: radius.button },
});
