import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as vi from '../i18n/vi/common';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { useFocusOnShow } from './BottomSheet';
import { Touchable } from './Touchable';

export type SnackbarOptions = {
  /** Never put the remaining seconds in the message: `countdown` adds them itself (as text under reduced motion). */
  message: string;
  action?: { label: string; onPress: () => void };
  /** How long it stays. Default 4000. For an undo this is the visible undo window, a business rule. */
  durationMs?: number;
  /**
   * Replaces `durationMs` while a screen reader is on, so TalkBack / VoiceOver users have time to reach the action.
   * There is deliberately no default multiplier: the server accepts an undo for 10 s while the UI shows 5 s, and
   * the Today screens pass 9000 here. Without it a screen-reader user gets `durationMs`.
   */
  screenReaderDurationMs?: number;
  /** Shows how long the action stays available: a shrinking bar, or the seconds as text under reduced motion. */
  countdown?: boolean;
};

type SnackbarProps = Omit<SnackbarOptions, 'durationMs'> & { durationMs: number; onDismiss: () => void };

/** One snackbar. Normally shown through `useSnackbar()`; it owns its auto-dismiss timer. */
export function Snackbar({ message, action, durationMs, screenReaderDurationMs, countdown = false, onDismiss }: SnackbarProps) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(reduced ? 1 : 0));
  const [bar] = useState(() => new Animated.Value(1));
  const [screenReader, setScreenReader] = useState(false);
  const windowMs = screenReader && screenReaderDurationMs ? screenReaderDurationMs : durationMs;
  const [seconds, setSeconds] = useState(Math.ceil(windowMs / 1000));
  const acted = useRef(false);
  const latestDismiss = useRef(onDismiss);
  useEffect(() => {
    latestDismiss.current = onDismiss;
  });
  const { ref: actionRef, focus: focusAction } = useFocusOnShow();

  // With a screen reader on, say the message and the action together and put focus on the action: the
  // snackbar sits last in the tree, so otherwise the Undo button would not be found in time.
  const actionLabel = action?.label;
  useEffect(() => {
    let current = true;
    AccessibilityInfo.isScreenReaderEnabled().then(
      on => on,
      () => false,
    ).then(on => {
      if (!current) return;
      setScreenReader(on);
      if (on && actionLabel) {
        AccessibilityInfo.announceForAccessibility(vi.snackbarAnnouncement(message, actionLabel));
        focusAction();
      } else {
        AccessibilityInfo.announceForAccessibility(message);
      }
    });
    return () => {
      current = false;
    };
  }, [message, actionLabel, focusAction]);

  useEffect(() => {
    const timer = setTimeout(() => latestDismiss.current(), windowMs);
    return () => clearTimeout(timer);
  }, [windowMs]);

  useEffect(() => {
    if (reduced) return;
    // motion: snackbar-undo
    const slide = Animated.timing(enter, {
      toValue: 1,
      duration: motion.durationsMs.transition,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    });
    slide.start();
    return () => slide.stop();
  }, [reduced, enter]);

  useEffect(() => {
    if (!countdown) return;
    if (reduced) {
      const end = Date.now() + windowMs;
      const tick = () => setSeconds(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }
    // motion: snackbar-undo (the bar starts after the slide-in and ends with the window)
    bar.setValue(1);
    const shrink = Animated.timing(bar, {
      toValue: 0,
      duration: Math.max(0, windowMs - motion.durationsMs.transition),
      delay: motion.durationsMs.transition,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    shrink.start();
    return () => shrink.stop();
  }, [countdown, reduced, windowMs, bar]);

  const slideIn = enter.interpolate({ inputRange: [0, 1], outputRange: [motion.translationDp.float, 0] });
  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: palette.ink, opacity: enter, transform: [{ translateY: slideIn }] }]}
    >
      <View style={styles.row}>
        <View style={styles.text}>
          <AppText variant="secondary" color="white">{message}</AppText>
          {countdown && reduced ? (
            <AppText variant="caption" weight="semibold" color="lime">
              {vi.secondsLeft(seconds)}
            </AppText>
          ) : null}
        </View>
        {action ? (
          <Touchable
            ref={actionRef}
            accessibilityRole="button"
            onPress={() => {
              if (acted.current) return;
              acted.current = true;
              action.onPress();
              onDismiss();
            }}
          >
            <AppText weight="semibold" color="lime">
              {action.label}
            </AppText>
          </Touchable>
        ) : null}
      </View>
      {countdown && !reduced ? (
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.countdown, { backgroundColor: palette.lime, transform: [{ scaleX: bar }] }]}
        />
      ) : null}
    </Animated.View>
  );
}

type SnackbarApi = { show: (options: SnackbarOptions) => void; dismiss: () => void };
const SnackbarContext = createContext<SnackbarApi | null>(null);

export function useSnackbar(): SnackbarApi {
  const api = useContext(SnackbarContext);
  if (!api) throw new Error('useSnackbar needs a SnackbarProvider above it');
  return api;
}

const DEFAULT_DURATION_MS = 4000;

/** Holds the single app-wide snackbar: `show` replaces whatever is on screen. */
export function SnackbarProvider({
  children,
  bottomOffset = 0,
}: {
  children: ReactNode;
  /** Extra dp to float above something that sits on the bottom edge, e.g. the tab bar while a tab root shows. */
  bottomOffset?: number;
}) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<(SnackbarOptions & { id: number }) | null>(null);
  const nextId = useRef(0);
  const show = useCallback((options: SnackbarOptions) => setCurrent({ ...options, id: (nextId.current += 1) }), []);
  const dismiss = useCallback(() => setCurrent(null), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const id = current?.id;
  // A dismissal from a snackbar that has already been replaced must not close its replacement.
  const dismissThis = useCallback(() => setCurrent(c => (c?.id === id ? null : c)), [id]);
  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {current ? (
        <View pointerEvents="box-none" style={[styles.host, { paddingBottom: insets.bottom + 16 + bottomOffset }]}>
          <Snackbar key={current.id} {...current} durationMs={current.durationMs ?? DEFAULT_DURATION_MS} onDismiss={dismissThis} />
        </View>
      ) : null}
    </SnackbarContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.screen },
  bar: { borderRadius: radius.button, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 56 },
  text: { flex: 1, gap: 2 },
  countdown: { height: 4, transformOrigin: 'left' },
});
