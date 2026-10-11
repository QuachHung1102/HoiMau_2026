import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
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

/** The soft background behind the selected item: one pill that slides to it. */
function Pill({ index, itemWidth }: { index: number; itemWidth: number }) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(index * itemWidth));
  const placed = useRef({ index, itemWidth });
  useEffect(() => {
    const toValue = index * itemWidth;
    // Only a change of selection travels; a new measurement (first layout, rotation) just puts the pill in place.
    const selectionChanged = placed.current.index !== index && placed.current.itemWidth === itemWidth;
    placed.current = { index, itemWidth };
    if (reduced || !selectionChanged) {
      x.setValue(toValue);
      return;
    }
    // motion: tab-pill
    const slide = Animated.timing(x, {
      toValue,
      duration: motion.durationsMs.transition,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    });
    slide.start();
    return () => slide.stop();
  }, [index, itemWidth, reduced, x]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pill, { width: itemWidth, backgroundColor: palette.soft, transform: [{ translateX: x }] }]}
    />
  );
}

type ItemProps = { label: string; icon: IconName; selected: boolean; onPress: () => void };

function TabItem({ label, icon, selected, onPress }: ItemProps) {
  const palette = useTheme();
  // Readable without the pill: the selected item is also heavier, tinted and announced as selected.
  const tint = selected ? 'primary' : 'muted';
  return (
    <Touchable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.item}>
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
  const [rowWidth, setRowWidth] = useState(0);
  const itemWidth = rowWidth / state.routes.length;
  return (
    <View style={[styles.bar, { backgroundColor: palette.white, borderTopColor: palette.line, paddingBottom: PADDING + insets.bottom }]}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel={vi.tabBar}
        onLayout={(event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width)}
        style={styles.row}
      >
        {itemWidth > 0 ? <Pill index={state.index} itemWidth={itemWidth} /> : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingTop: PADDING, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth },
  // Equal items without gaps, so item i starts at i x (row width / item count): the pill's travel.
  row: { flexDirection: 'row' },
  item: { flex: 1, minHeight: sizes.navItemHeight, alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.button },
});
