import { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as vi from '../i18n/vi/pet';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { useNumberRoll } from './Badges';
import { Touchable } from './Touchable';

/** The drawn bar only. Callers always put the number next to it as text. `ratio` is 0-1. */
export type Track = 'soft' | 'line' | 'white';
export function BarTrack({ ratio, track = 'soft' }: { ratio: number; track?: Track }) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [stretch] = useState(() => new Animated.Value(1));
  const drawn = useRef(ratio);
  // Layout effect: the fill is already at its new width, so it must be scaled back before the first paint.
  useLayoutEffect(() => {
    const from = drawn.current;
    drawn.current = ratio;
    if (reduced || ratio <= 0 || from === ratio) return;
    stretch.setValue(from / ratio);
    // motion: progress-fill
    const fill = Animated.timing(stretch, {
      toValue: 1,
      duration: motion.durationsMs.celebration,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    });
    fill.start();
    return () => {
      fill.stop();
      stretch.setValue(1);
    };
  }, [ratio, reduced, stretch]);
  return (
    <View style={[styles.track, { backgroundColor: palette[track] }]}>
      <Animated.View
        style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: palette.primary, transform: [{ scaleX: stretch }] }]}
      />
    </View>
  );
}

/** Finite numbers for a bar: `max` must be finite and above 0, else the bar is 0 of 0; `now` is `value` kept in 0..max. */
function barRange(value: number, max: number) {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  return { max: top, now: value > 0 ? Math.min(value, top) : 0 };
}

/** A bar with its value written under it (`label`, e.g. "64% tới Chồi non"). */
export function ProgressBar({ value, max, label, track }: { value: number; max: number; label: string; track?: Track }) {
  const range = barRange(value, max);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: range.max, now: range.now }}
      style={styles.bar}
    >
      <BarTrack ratio={range.max > 0 ? range.now / range.max : 0} track={track} />
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

type LevelStripProps = {
  level: number;
  /** The title that goes with the level, e.g. "Người kiên trì". */
  title: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  onPress?: () => void;
  /** The colour of the empty part of the bar; white on a soft card, where the default would vanish. */
  track?: Track;
};

export function LevelStrip({ level, title, xpIntoLevel, xpForNextLevel, onPress, track }: LevelStripProps) {
  const heading = vi.levelTitle(level, title);
  // The text shows the same clamped numbers the bar reports.
  const { now, max } = barRange(xpIntoLevel, xpForNextLevel);
  const rolling = useNumberRoll(now);
  const content = (
    <View style={styles.strip}>
      <AppText weight="semibold">{heading}</AppText>
      <ProgressBar value={now} max={max} label={vi.xpProgress(rolling, max)} track={track} />
    </View>
  );
  if (!onPress) return content;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${vi.xpProgress(now, max)}`}
      onPress={onPress}
    >
      {content}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, transformOrigin: 'left' },
  bar: { gap: 6 },
  strip: { gap: 6 },
});
