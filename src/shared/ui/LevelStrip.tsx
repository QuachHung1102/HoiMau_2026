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
export function BarTrack({ ratio, track = 'soft' }: { ratio: number; track?: 'soft' | 'line' }) {
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

const within = (value: number, max: number) => (value > 0 ? Math.min(value, max) : 0);

/** A bar with its value written under it (`label`, e.g. "64% tới Chồi non"). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const now = within(value, max);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now }}
      style={styles.bar}
    >
      <BarTrack ratio={max > 0 ? now / max : 0} />
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
};

export function LevelStrip({ level, title, xpIntoLevel, xpForNextLevel, onPress }: LevelStripProps) {
  const heading = vi.levelTitle(level, title);
  const rolling = useNumberRoll(xpIntoLevel);
  const content = (
    <View style={styles.strip}>
      <AppText weight="semibold">{heading}</AppText>
      <ProgressBar value={xpIntoLevel} max={xpForNextLevel} label={vi.xpProgress(rolling, xpForNextLevel)} />
    </View>
  );
  if (!onPress) return content;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${vi.xpProgress(xpIntoLevel, xpForNextLevel)}`}
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
