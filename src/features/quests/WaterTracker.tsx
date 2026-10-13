import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/quests';
import { failureText } from '../../shared/i18n/vi/sync';
import { motion } from '../../shared/motion/motion';
import { useLoopGate } from '../../shared/motion/useLoopGate';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { sizes } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { Touchable } from '../../shared/ui/Touchable';
import type { TickState } from './useTick';

const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const;
const curve = (points: readonly [number, number, number, number]) => Easing.bezier(...points);

/** done: the server has it · saving: sent, no answer yet · queued: kept on this device · empty. Each has its own icon. */
type CellKind = 'done' | 'saving' | 'queued' | 'empty';

function WaterCell({ kind }: { kind: CellKind }) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const solid = kind === 'done' || kind === 'saving';
  const [level] = useState(() => new Animated.Value(solid ? 1 : 0));
  const [drop] = useState(() => new Animated.Value(1));
  const before = useRef(kind);
  useEffect(() => {
    const from = before.current;
    before.current = kind;
    const filling = from === 'empty' && solid;
    const emptying = kind === 'empty' && (from === 'done' || from === 'saving');
    // Only a part that was just recorded, or just taken back, moves; every other change is drawn at once.
    if (reduced || !(filling || emptying)) {
      level.setValue(solid ? 1 : 0);
      return;
    }
    if (filling) drop.setValue(0);
    const run = filling
      ? // motion: water-check-in
        Animated.parallel([
          Animated.timing(drop, { toValue: 1, duration: motion.durationsMs.celebration, easing: curve(motion.easing.enter), useNativeDriver: true }),
          Animated.timing(level, { toValue: 1, duration: motion.durationsMs.celebration, delay: 200, easing: curve(motion.easing.enter), useNativeDriver: true }),
        ])
      : // motion: reject-revert (the reason beside the tracker fades in through InlineError)
        Animated.timing(level, { toValue: 0, duration: motion.durationsMs.feedback, easing: curve(motion.easing.exit), useNativeDriver: true });
    run.start();
    return () => {
      run.stop();
      level.setValue(solid ? 1 : 0);
      drop.setValue(1);
    };
  }, [kind, solid, reduced, level, drop]);

  const falling = [0, 0.6, 1];
  return (
    <View style={styles.cellSlot}>
      <View style={[styles.cell, { backgroundColor: palette.soft }, kind === 'queued' && [styles.outlined, { borderColor: palette.primary }]]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.level, { backgroundColor: palette.primary, transform: [{ scaleY: level }] }]} />
        <Icon
          name={kind === 'done' ? 'Check' : kind === 'queued' ? 'Clock' : 'Droplet'}
          size={18}
          color={solid ? palette.white : palette.primary}
        />
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.drop,
          { opacity: drop.interpolate({ inputRange: falling, outputRange: [0, 1, 0] }), transform: [{ translateY: drop.interpolate({ inputRange: falling, outputRange: [-40, 0, 6] }) }] },
        ]}
      >
        <Icon name="Droplet" size={18} color={palette.primary} />
      </Animated.View>
    </View>
  );
}

/** The mark of "waiting to be sent": it beats twice when parts start to wait, then stays still. */
function PendingDot() {
  const palette = useTheme();
  const running = useLoopGate(); // foreground only, and never under reduced motion
  const [beat] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!running) return;
    // motion: pending-pulse
    const pulse = Animated.loop(
      Animated.timing(beat, { toValue: 1, duration: motion.durationsMs.celebration, easing: curve(motion.easing.idle), useNativeDriver: true }),
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
  return <Animated.View {...hidden} style={[styles.dot, { backgroundColor: palette.primary, opacity, transform: [{ scale }] }]} />;
}

/** "+10 XP" rising from the count once the server has confirmed. Under reduced motion it stands in the snackbar only. */
function XpFloat({ xp }: { xp: number }) {
  const reduced = useReducedMotion();
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    // motion: xp-float
    const run = Animated.timing(rise, { toValue: 1, duration: motion.durationsMs.countUp, easing: curve(motion.easing.enter), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [reduced, rise]);
  if (reduced || xp <= 0) return null;
  const steps = [0, 0.3, 1];
  return (
    <Animated.View
      {...hidden}
      pointerEvents="none"
      style={[
        styles.float,
        { opacity: rise.interpolate({ inputRange: steps, outputRange: [0, 1, 0] }), transform: [{ translateY: rise.interpolate({ inputRange: steps, outputRange: [0, -12, -24] }) }] },
      ]}
    >
      <AppText variant="caption" weight="semibold" color="primary">
        {vi.reward(xp)}
      </AppText>
    </Animated.View>
  );
}

type Props = {
  state: TickState;
  /** One more part. Also the retry after a refusal: the refused record is gone, this is a new one. */
  onTick: () => void;
};

/**
 * "Nước hôm nay": the count, one cell per part and the state of what was just recorded. The whole row of cells is
 * one button (the next empty cell fills); it is off, with the reason, once every part is recorded or on its way.
 */
export function WaterTracker({ state, onTick }: Props) {
  const { target, done, queued, saving, full, reward, failed } = state;
  const count = done + queued + saving;
  // "đã lưu" only while the server's answer is fresh; a waiting part never says it.
  const status = saving ? vi.saving : reward ? vi.saved : undefined;
  const countText = status ? vi.withStatus(vi.waterCount(count, target), status) : vi.waterCount(count, target);
  const hint = full ? vi.waterFull(target) : vi.waterHint;
  const label = [vi.waterTitle, countText, queued ? vi.waterWaiting(queued) : undefined, full ? vi.waterFull(target) : vi.tapToRecord].filter(Boolean).join('. ');
  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <AppText variant="title" accessibilityRole="header" style={styles.title}>
          {vi.waterTitle}
        </AppText>
        <View>
          <AppText variant="caption" accessibilityLiveRegion="polite">
            {countText}
          </AppText>
          {reward ? <XpFloat key={reward.n} xp={reward.xp} /> : null}
        </View>
      </View>
      <Touchable accessibilityRole="button" accessibilityLabel={label} disabled={full} onPress={onTick} style={styles.cells}>
        {Array.from({ length: target }, (_, i) => (
          <WaterCell key={i} kind={i < done ? 'done' : i < done + queued ? 'queued' : i < count ? 'saving' : 'empty'} />
        ))}
      </Touchable>
      {queued ? (
        <View accessibilityLiveRegion="polite" style={styles.waiting}>
          <PendingDot />
          <AppText variant="caption" weight="semibold" color="ink">
            {common.queued}
          </AppText>
        </View>
      ) : null}
      {failed ? (
        <InlineError
          message={vi.waterNotSaved(failureText(failed))}
          action={full ? undefined : { label: common.retry, onPress: onTick }}
          style={styles.failure}
        />
      ) : null}
      <AppText variant="caption">{hint}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 16 },
  title: { flexGrow: 1 },
  // A real 48 dp row: hit slop outside it would be clipped on Android.
  cells: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: sizes.minTouch },
  cellSlot: { flex: 1 },
  cell: { height: 36, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  outlined: { borderWidth: 2 },
  level: { transformOrigin: 'bottom' },
  drop: { position: 'absolute', top: 9, left: 0, right: 0, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, margin: 4 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Tall enough for the 48 dp target of "Thử lại" to stay inside the row.
  failure: { minHeight: sizes.minTouch },
  float: { position: 'absolute', right: 0, top: -4 },
});
