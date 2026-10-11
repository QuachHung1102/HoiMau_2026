import { useEffect, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import * as vi from '../i18n/vi/common';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';

const SWEEP = 120;
const SHEEN_ALPHA = ['26', '66', '26'] as const;

/** Skeleton blocks for a first load. Keep stale data instead of showing this on a refresh. */
export function LoadingState({ blocks = 3 }: { blocks?: number }) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [sweep] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  // ponytail: no blur handling here; screens that stay mounted behind another one should unmount this state.
  useEffect(() => {
    if (reduced || !foreground) return;
    sweep.setValue(0);
    // motion: skeleton-shimmer
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: motion.durationsMs.shimmerLoop,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, foreground, sweep]);
  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP, width] });
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={vi.loading}
      accessibilityState={{ busy: true }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={styles.blocks}
    >
      {Array.from({ length: blocks }, (_, i) => (
        <View key={i} style={[styles.block, { backgroundColor: palette.soft }]}>
          <View style={[styles.barTitle, { backgroundColor: palette.line }]} />
          <View style={[styles.barBody, { backgroundColor: palette.line }]} />
          {reduced || !foreground ? null : (
            <Animated.View style={[styles.sheen, { transform: [{ translateX }] }]}>
              {/* three bands of rising opacity stand in for a gradient edge */}
              {SHEEN_ALPHA.map((alpha, band) => (
                <View key={band} style={[styles.band, { backgroundColor: `${palette.white}${alpha}` }]} />
              ))}
            </Animated.View>
          )}
        </View>
      ))}
    </View>
  );
}

/** A calm failure with a way forward. `message` should say what happened and that saved data is safe. */
export function ErrorState({ message, onRetry, icon = 'WifiOff' }: { message: string; onRetry: () => void; icon?: IconName }) {
  return (
    <Card>
      <Icon name={icon} />
      <View accessibilityLiveRegion="polite" style={styles.text}>
        <AppText variant="title">{vi.loadFailedTitle}</AppText>
        <AppText variant="secondary">{message}</AppText>
      </View>
      <Button label={vi.retry} onPress={onRetry} />
    </Card>
  );
}

type Action = { label: string; onPress: () => void };

/** Nothing here yet. Neutral tone: an empty list is not an error. */
export function EmptyState({
  title,
  body,
  primary,
  secondary,
  illustration,
}: {
  title: string;
  body: string;
  primary?: Action;
  secondary?: Action;
  /** Slot for the Mầm picture. */
  illustration?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {illustration}
      <View style={styles.text}>
        <AppText variant="title" style={styles.centered}>
          {title}
        </AppText>
        <AppText variant="secondary" style={styles.centered}>
          {body}
        </AppText>
      </View>
      {primary ? <Button label={primary.label} onPress={primary.onPress} style={styles.action} /> : null}
      {secondary ? <Button variant="secondary" label={secondary.label} onPress={secondary.onPress} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 16 },
  block: { borderRadius: radius.surface, padding: 20, gap: 12, overflow: 'hidden' },
  barTitle: { height: 16, width: '55%', borderRadius: 8 },
  barBody: { height: 12, width: '85%', borderRadius: 6 },
  sheen: { position: 'absolute', top: 0, bottom: 0, left: 0, width: SWEEP, flexDirection: 'row' },
  band: { flex: 1 },
  text: { gap: 6 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 12 },
  centered: { textAlign: 'center' },
  action: { alignSelf: 'stretch' },
});
