import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as vi from '../i18n/vi/common';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, sizes } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

const feedbackEase = Easing.bezier(...motion.easing.enter);

type CheckboxProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function Checkbox({ label, description, checked, onChange, disabled }: CheckboxProps) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [mark] = useState(() => new Animated.Value(checked ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      mark.setValue(checked ? 1 : 0);
      return;
    }
    // motion: check-draw
    const run = Animated.spring(mark, {
      toValue: checked ? 1 : 0,
      damping: motion.springs.pop.damping,
      stiffness: motion.springs.pop.stiffness,
      mass: motion.springs.pop.mass,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [checked, reduced, mark]);
  const scale = mark.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const opacity = mark.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <Touchable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={[styles.box, { borderColor: palette.primary, backgroundColor: checked ? palette.primary : palette.white }]}>
        <Animated.View style={{ opacity, transform: [{ scale }] }}>
          <Icon name="Check" size={18} color={palette.white} />
        </Animated.View>
      </View>
      <View style={styles.text}>
        <AppText weight="semibold">{label}</AppText>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
    </Touchable>
  );
}

type SwitchProps = { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean };

const TRACK = { width: 52, height: 32, pad: 4, thumb: 24 } as const;
const TRAVEL = TRACK.width - TRACK.thumb - 2 * TRACK.pad;

/** The state is always written out (on / off text); the thumb position and colour are extra. */
export function Switch({ label, value, onChange, disabled }: SwitchProps) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [pos] = useState(() => new Animated.Value(value ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      pos.setValue(value ? 1 : 0);
      return;
    }
    // motion: switch-slide
    const run = Animated.timing(pos, {
      toValue: value ? 1 : 0,
      duration: motion.durationsMs.feedback,
      easing: feedbackEase,
      useNativeDriver: false, // the track colour is interpolated, so the thumb shares the JS driver
    });
    run.start();
    return () => run.stop();
  }, [value, reduced, pos]);
  return (
    <Touchable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.row, styles.spread, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <AppText weight="semibold">{label}</AppText>
        <AppText variant="caption">{value ? vi.on : vi.off}</AppText>
      </View>
      <Animated.View
        style={[
          styles.track,
          { backgroundColor: pos.interpolate({ inputRange: [0, 1], outputRange: [palette.muted, palette.primary] }) },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            { backgroundColor: palette.white, transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }] },
          ]}
        />
      </Animated.View>
    </Touchable>
  );
}

type Option = { value: string; label: string };
type SegmentedProps = {
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  /** Names the group for screen readers (the visible heading usually sits outside the control). */
  accessibilityLabel: string;
};

export function SegmentedControl({ options, value, onChange, accessibilityLabel }: SegmentedProps) {
  const palette = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segments, { backgroundColor: palette.white, borderColor: palette.line }]}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Touchable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: palette.primary }]}
          >
            {selected ? <Icon name="Check" size={16} color={palette.white} /> : null}
            <AppText weight="semibold" color={selected ? 'white' : 'primary'} style={styles.segmentLabel}>
              {option.label}
            </AppText>
          </Touchable>
        );
      })}
    </View>
  );
}

type RadioRowProps = { label: string; description?: string; selected: boolean; onPress: () => void; disabled?: boolean };

/** One option of a single-choice list. The filled dot shows the choice, so colour is never the only cue. */
export function RadioRow({ label, description, selected, onPress, disabled }: RadioRowProps) {
  const palette = useTheme();
  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={[styles.radio, { borderColor: palette.primary }]}>
        {selected ? <View testID="radio-dot" style={[styles.dot, { backgroundColor: palette.primary }]} /> : null}
      </View>
      <View style={styles.text}>
        <AppText weight="semibold">{label}</AppText>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
    </Touchable>
  );
}

type ChipProps = { label: string; selected: boolean; onPress: () => void; disabled?: boolean };

export function FilterChip({ label, selected, onPress, disabled }: ChipProps) {
  const palette = useTheme();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      // motion: chip-select (tier 2: the selected colours and check mark appear at once)
      style={[
        styles.chip,
        { borderColor: palette.primary, backgroundColor: selected ? palette.primary : palette.soft },
        disabled && styles.disabled,
      ]}
    >
      {selected ? <Icon name="Check" size={16} color={palette.white} /> : null}
      <AppText variant="caption" weight="semibold" color={selected ? 'white' : 'primary'}>
        {label}
      </AppText>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: sizes.minTouch, paddingVertical: 8 },
  spread: { justifyContent: 'space-between' },
  text: { flex: 1, gap: 2 },
  disabled: { opacity: 0.5 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  track: { width: TRACK.width, height: TRACK.height, borderRadius: TRACK.height / 2, padding: TRACK.pad, justifyContent: 'center' },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  thumb: { width: TRACK.thumb, height: TRACK.thumb, borderRadius: TRACK.thumb / 2 },
  segments: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.surface, padding: 4 },
  // flexGrow without a fixed basis: a wide label gets a wide segment, as in the frame; flexShrink and a wrapping
  // label keep three segments inside 360 dp at font scale 1.3 (minHeight, not height, lets them grow).
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: sizes.minTouch,
    paddingHorizontal: 8,
    borderRadius: radius.button,
  },
  segmentLabel: { flexShrink: 1, textAlign: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    borderWidth: 1,
  },
});
