import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as vi from '../../shared/i18n/vi/sync';
import { motion } from '../../shared/motion/motion';
import { useLoopGate } from '../../shared/motion/useLoopGate';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Icon } from '../../shared/ui/Icon';
import { Touchable } from '../../shared/ui/Touchable';
import { useMe } from '../auth/api';
import { usePendingSync } from './usePendingSync';

const DOT = 10;

/** The "waiting" mark: it beats twice when records start to wait, then stays still. Never a spinner. */
function PendingDot({ beating }: { beating: boolean }) {
  const palette = useTheme();
  const running = useLoopGate(beating); // foreground only, and never under reduced motion
  const [beat] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!running) return;
    // motion: pending-pulse
    const pulse = Animated.loop(
      Animated.timing(beat, {
        toValue: 1,
        duration: motion.durationsMs.celebration,
        easing: Easing.bezier(...motion.easing.idle),
        useNativeDriver: true,
      }),
      { iterations: 2 },
    );
    pulse.start();
    return () => {
      pulse.stop();
      beat.setValue(0);
    };
  }, [running, beat]);
  const scale = beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.6, 1] });
  const opacity = beat.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.4, 1] });
  return <Animated.View accessible={false} style={[styles.dot, { backgroundColor: palette.primary, opacity, transform: [{ scale }] }]} />;
}

type Props = { waiting: number; offline: boolean; onRetry: () => Promise<void> };

/** The row itself, without the queue behind it (the preview and the tests of its wording use it directly). */
export function PendingBannerView({ waiting, offline, onRetry }: Props) {
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const [retrying, setRetrying] = useState(false);
  // Neither offline nor waiting: everything that waited has just been confirmed by the server.
  const synced = !offline && waiting === 0;
  const count = waiting > 0 ? vi.waitingOnDevice(waiting) : undefined;
  const title = offline ? vi.offlineTitle : count ?? vi.synced;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8, backgroundColor: palette.soft, borderBottomColor: palette.line }]}>
      {synced ? <Icon name="Check" size={18} color={palette.primary} /> : <PendingDot beating={waiting > 0} />}
      <View accessible accessibilityLiveRegion="polite" style={styles.text}>
        <AppText variant="secondary" weight="semibold" color="ink">
          {title}
        </AppText>
        {offline && count ? <AppText variant="caption">{count}</AppText> : null}
      </View>
      {/* Only with records to send: without any, the screen whose request failed owns the retry (never two retry buttons). */}
      {waiting > 0 ? (
        <Touchable
          accessibilityRole="button"
          accessibilityState={{ busy: retrying }}
          onPress={() => {
            if (retrying) return;
            setRetrying(true);
            onRetry().finally(() => setRetrying(false));
          }}
          style={styles.retry}
        >
          <AppText weight="semibold" color="primary">
            {vi.retry}
          </AppText>
        </Touchable>
      ) : null}
    </View>
  );
}

/**
 * S38 as a row above the app: "Bạn đang ngoại tuyến" while the last request did not reach the server, and how many
 * records are waiting on this device, with "Thử lại" to send them. It takes its own space (it never covers a screen
 * or the snackbar) and runs the queue (`usePendingSync`), so mount it exactly once, above `AppNavigation`.
 */
export function PendingBanner() {
  const { userId, waiting, offline, synced, retry } = usePendingSync();
  const me = useMe();
  // Only over the app itself: the start-up states (S39) already say this, with their own "Thử lại".
  if (!userId || !me.data || !(offline || waiting > 0 || synced)) return null;
  return <PendingBannerView waiting={waiting} offline={offline} onRetry={retry} />;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8, paddingHorizontal: spacing.screen, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, margin: 4 },
  text: { flex: 1, gap: 2 },
  retry: { justifyContent: 'center' },
});
