import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { motion } from '../../shared/motion/motion';
import { useForeground, useLoopGate } from '../../shared/motion/useLoopGate';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';

/**
 * Which of `phases` is on now: each lasts its `ms`, in order, looping, from the moment `active` became true. Read
 * from the clock (`Date.now()`), the timer only says when to look again. Not tied to motion: under reduced motion
 * the phases still change. In the background the timer is off, and on return the cycle starts again from its first phase.
 */
export function usePhase(phases: readonly { ms: number }[] | undefined, active: boolean): number {
  const [index, setIndex] = useState(0);
  const foreground = useForeground();
  useEffect(() => {
    if (!phases?.length || !active || !foreground) return undefined;
    const total = phases.reduce((sum, phase) => sum + phase.ms, 0);
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      const at = (Date.now() - start) % total;
      let i = 0;
      let end = phases[0].ms;
      while (at >= end) end += phases[(i += 1)].ms;
      setIndex(i);
      timer = setTimeout(look, end - at);
    };
    look();
    return () => clearTimeout(timer);
  }, [phases, active, foreground]);
  return phases?.length ? Math.min(index, phases.length - 1) : 0;
}

type Props = {
  pattern: readonly { label: string; ms: number }[];
  active: boolean;
  /** The ring that grows on the in-breath and shrinks on the out-breath (`focus-breathe`); without it, the label only. */
  circle?: boolean;
};

/** The breathing phase now ("Hít vào", "Giữ"…), and for `focus-breathe` its circle. */
export function BreathingGuide({ pattern, active, circle }: Props) {
  const palette = useTheme();
  const phase = pattern[usePhase(pattern, active)];
  const moving = useLoopGate(active) && circle;
  const [breath] = useState(() => new Animated.Value(0));
  useEffect(() => {
    breath.setValue(0);
    if (!moving) return undefined;
    // motion: focus-breathe (0.7 -> 1 -> 0.7 over one cycle; a still circle under reduced motion, the text still changes)
    const duration = pattern.reduce((sum, item) => sum + item.ms, 0);
    const loop = Animated.loop(Animated.timing(breath, { toValue: 1, duration, easing: Easing.bezier(...motion.easing.idle), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [moving, pattern, breath]);
  const label = (
    <AppText variant={circle ? 'body' : 'title'} weight="semibold" color="primary" style={[styles.text, circle && styles.inRing]}>
      {phase.label}
    </AppText>
  );
  if (!circle) return <View style={styles.label}>{label}</View>;
  const scale = breath.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1, 0.7] });
  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.circle, { borderColor: palette.primary, backgroundColor: palette.white, transform: [{ scale }] }]} />
      {label}
    </View>
  );
}

const SIZE = 180;
const styles = StyleSheet.create({
  label: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
  text: { textAlign: 'center' },
  // Large text wraps inside the ring at its smallest (0.7 x SIZE, less the border) instead of crossing it.
  inRing: { maxWidth: SIZE * 0.6 },
  stage: { width: SIZE, height: SIZE, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  circle: { ...StyleSheet.absoluteFill, borderRadius: SIZE / 2, borderWidth: 4 },
});
