import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { AppText } from '../../shared/ui/AppText';
import { useFocusOnShow } from '../../shared/ui/BottomSheet';
import { Screen } from '../../shared/ui/Screen';

type Props = { title: string; subtitle?: string; onBack?: () => void; hasInputs?: boolean; children?: ReactNode };

/**
 * One step of onboarding. Each time the step comes on screen its title takes screen-reader focus and the content
 * eases in; under reduced motion the content is simply there. The navigator itself does not animate these screens
 * (`stepOptions`), so this is the whole transition and the in-app motion setting governs all of it.
 */
export function StepScreen({ title, subtitle, onBack, hasInputs, children }: Props) {
  const reduced = useReducedMotion();
  const { ref, focus } = useFocusOnShow();
  const [enter] = useState(() => new Animated.Value(1));
  useFocusEffect(
    useCallback(() => {
      focus();
      if (reduced) return undefined;
      enter.setValue(0);
      // motion: onboarding-step
      const run = Animated.timing(enter, {
        toValue: 1,
        duration: motion.durationsMs.transition,
        easing: Easing.bezier(...motion.easing.enter),
        useNativeDriver: true,
      });
      run.start();
      return () => {
        run.stop();
        enter.setValue(1);
      };
    }, [reduced, enter, focus]),
  );
  const slide = enter.interpolate({ inputRange: [0, 1], outputRange: [motion.translationDp.enter, 0] });
  return (
    <Screen onBack={onBack} hasInputs={hasInputs}>
      <Animated.View style={[styles.content, { opacity: enter, transform: [{ translateX: slide }] }]}>
        <View ref={ref} accessible accessibilityRole="header">
          <AppText variant="headline">{title}</AppText>
        </View>
        {subtitle ? <AppText variant="secondary">{subtitle}</AppText> : null}
        {children}
      </Animated.View>
    </Screen>
  );
}

/** Registry options of the four steps: the stack does not animate them, `StepScreen` does. */
export const stepOptions = { animation: 'none' } as const;

// the same rhythm as the children of `Screen`
const styles = StyleSheet.create({ content: { gap: 8 } });
