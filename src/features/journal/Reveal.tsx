import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';

/**
 * A short fade and rise for what the server has just confirmed (`journal-saved`, `ticket-granted`, `ticket-freeze`; the
 * caller says which with its own `// motion:` marker). Reduced motion: it is simply there. Never fully transparent, so a
 * screen reader does not skip it.
 */
export function Reveal({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const reduced = useReducedMotion();
  const [shown] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      shown.setValue(1);
      return;
    }
    const run = Animated.timing(shown, { toValue: 1, delay: delayMs, duration: motion.durationsMs.feedback, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [delayMs, reduced, shown]);
  return (
    <Animated.View style={{ opacity: shown.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] }), transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
