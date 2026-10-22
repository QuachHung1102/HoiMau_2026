import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as vi from '../i18n/vi/pet';
import { motion } from '../motion/motion';
import { useLoopGate } from '../motion/useLoopGate';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, type Palette } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/** Counts from the previous value to the new one. The first value, and every value under reduced motion, shows at once. */
export function useNumberRoll(value: number, durationMs: number = motion.durationsMs.countUp): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) return;
    const driver = new Animated.Value(from);
    const listener = driver.addListener(step => setShown(Math.round(step.value)));
    // motion: number-roll (text cannot run on the native driver)
    const roll = Animated.timing(driver, {
      toValue: value,
      duration: durationMs,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: false,
    });
    roll.start();
    return () => {
      roll.stop();
      driver.removeListener(listener);
      setShown(value); // an interrupted roll ends on its target
    };
  }, [value, reduced, durationMs]);
  return reduced ? value : shown;
}

type ChipProps = {
  text: string;
  icon?: IconName;
  background: keyof Palette;
  color: keyof Palette;
  /** Defaults to `text`. */
  accessibilityLabel?: string;
};

function Chip({ text, icon, background, color, accessibilityLabel = text }: ChipProps) {
  const palette = useTheme();
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={[styles.chip, { backgroundColor: palette[background] }]}>
      {icon ? <Icon name={icon} size={16} color={palette[color]} /> : null}
      <AppText variant="caption" weight="semibold" color={color}>
        {text}
      </AppText>
    </View>
  );
}

/** Coin balance. Gold is for coins and prices only. */
export function CoinChip({ coin }: { coin: number }) {
  const rolling = useNumberRoll(coin);
  return <Chip icon="Coins" text={vi.coinAmount(rolling)} accessibilityLabel={vi.coinAmount(coin)} background="goldSoft" color="gold" />;
}

/** The streak, shown only from 3 days on and always with the number of days. `active`: the screen's focus; the flame stands still while false. */
export function StreakChip({ days, active = true }: { days: number; active?: boolean }) {
  return days >= 3 ? <Flame days={days} active={active} /> : null;
}

function Flame({ days, active }: { days: number; active: boolean }) {
  const palette = useTheme();
  const running = useLoopGate(active);
  const [flicker] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!running) return;
    // motion: streak-flame
    const loop = Animated.loop(
      Animated.timing(flicker, {
        toValue: 1,
        duration: motion.durationsMs.flameLoop,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      flicker.setValue(0);
    };
  }, [running, flicker]);
  const keyframes = [0, 0.33, 0.66, 1];
  const scaleY = flicker.interpolate({ inputRange: keyframes, outputRange: [1, 1.06, 0.97, 1] });
  // The catalog leans the flame with skewX(-2deg / 2deg); a rotation of the same angle reads the same at 16 dp.
  const rotate = flicker.interpolate({ inputRange: keyframes, outputRange: ['0deg', '-2deg', '2deg', '0deg'] });
  const text = vi.dayCount(days);
  return (
    <View accessible accessibilityLabel={text} style={[styles.chip, { backgroundColor: palette.flameSoft }]}>
      <Animated.View style={[styles.flame, { transform: [{ scaleY }, { rotate }] }]}>
        <Icon name="Flame" size={16} color={palette.flame} />
      </Animated.View>
      <AppText variant="caption" weight="semibold" color="flame">
        {text}
      </AppText>
    </View>
  );
}

/** What a task gives, e.g. "+50 XP". XP is never gold. */
export function RewardChip({ text }: { text: string }) {
  return <Chip text={text} background="soft" color="primary" />;
}

export function LockChip({ minLevel }: { minLevel: number }) {
  return <Chip icon="Lock" text={vi.lockLevel(minLevel)} background="soft" color="muted" />;
}

export function OwnedChip({ equipped }: { equipped: boolean }) {
  return equipped ? (
    <Chip icon="Check" text={vi.equipped} background="lime" color="ink" />
  ) : (
    <Chip icon="Check" text={vi.owned} background="soft" color="ink" />
  );
}

/** A day kept with a ticket: snowflake plus the words. `compact` keeps the words for screen readers only (a week row with a legend). */
export function FrostDot({ compact = false }: { compact?: boolean }) {
  const palette = useTheme();
  return (
    <View accessible accessibilityLabel={vi.ticketUsed} style={styles.frost}>
      <View style={[styles.dot, { backgroundColor: palette.frostSoft, borderColor: palette.frost }]}>
        <Icon name="Snowflake" size={14} color={palette.frost} />
      </View>
      {compact ? null : (
        <AppText variant="caption" weight="semibold" color="frost">
          {vi.ticketUsed}
        </AppText>
      )}
    </View>
  );
}

/** How many recorded actions are still waiting for the network. Nothing when the queue is empty. */
export function OfflineBadge({ count }: { count: number }) {
  return count > 0 ? <Chip icon="CloudOff" text={vi.pendingCount(count)} background="soft" color="ink" /> : null;
}

const styles = StyleSheet.create({
  // No fixed height: the chip grows with the font scale. At its 32 dp height the button radius (14) makes it a pill, as in S09.
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.button },
  flame: { transformOrigin: 'bottom' },
  frost: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
