import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

type Action = { label: string; onPress: () => void };

/** Error text with an icon (never colour alone), announced politely when it appears. */
export function InlineError({ message, action, style }: { message: string; action?: Action; style?: StyleProp<ViewStyle> }) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) return;
    // motion: field-error
    const run = Animated.timing(enter, {
      toValue: 1,
      duration: motion.durationsMs.feedback,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [reduced, enter]);
  const shift = enter.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] });
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.row, { opacity: enter, transform: [{ translateY: shift }] }, style]}
    >
      <Icon name="CircleAlert" size={16} color={palette.error} />
      <AppText variant="caption" color="error" style={styles.text}>
        {message}
      </AppText>
      {action ? (
        <Touchable accessibilityRole="button" onPress={action.onPress}>
          <AppText variant="caption" weight="semibold" color="primary">
            {action.label}
          </AppText>
        </Touchable>
      ) : null}
    </Animated.View>
  );
}

/** Says why an action is unavailable; sits beside the disabled control, in the muted tone. */
export function DisabledReason({ reason, icon = 'Info' }: { reason: string; icon?: IconName }) {
  const palette = useTheme();
  return (
    <View style={styles.row}>
      <Icon name={icon} size={16} color={palette.muted} />
      <AppText variant="caption" style={styles.text}>
        {reason}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1 },
});
