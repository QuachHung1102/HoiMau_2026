import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type View,
  type AccessibilityRole,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { sizes } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style' | 'children' | 'accessibilityRole' | 'role'> & {
  accessibilityRole: AccessibilityRole;
  /** For moving screen-reader focus to this control; passed on to the Pressable. */
  ref?: Ref<ComponentRef<typeof View>>;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const slopOf = (hitSlop: PressableProps['hitSlop']) =>
  typeof hitSlop === 'number'
    ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }
    : { top: 0, bottom: 0, left: 0, right: 0, ...hitSlop };

/** The only press primitive: enforced role, 48 dp hit area, press feedback. */
export function Touchable({
  accessibilityRole,
  accessibilityState,
  disabled,
  hitSlop,
  onPress,
  onPressIn,
  onPressOut,
  onLayout,
  style,
  children,
  ...rest
}: Props) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(motion.scale.rest));
  const [box, setBox] = useState<{ width: number; height: number }>({ width: sizes.minTouch, height: sizes.minTouch });

  const animateTo = (toValue: number) => {
    if (reduced) return;
    // motion: press-scale
    Animated.timing(scale, { toValue, duration: motion.durationsMs.press, useNativeDriver: true }).start();
  };
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    onLayout?.(e);
  };
  // Each side is the larger of the caller's slop and what is needed to reach 48 dp.
  const vertical = Math.max(0, (sizes.minTouch - box.height) / 2);
  const horizontal = Math.max(0, (sizes.minTouch - box.width) / 2);
  const callerSlop = slopOf(hitSlop);
  const callerTransform = StyleSheet.flatten(style)?.transform;

  return (
    <AnimatedPressable
      {...rest}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: disabled ?? accessibilityState?.disabled }}
      disabled={disabled}
      hitSlop={{
        top: Math.max(vertical, callerSlop.top ?? 0),
        bottom: Math.max(vertical, callerSlop.bottom ?? 0),
        left: Math.max(horizontal, callerSlop.left ?? 0),
        right: Math.max(horizontal, callerSlop.right ?? 0),
      }}
      onLayout={handleLayout}
      onPress={disabled ? undefined : (onPress as ((e: GestureResponderEvent) => void) | undefined)}
      onPressIn={e => {
        animateTo(motion.scale.pressed);
        onPressIn?.(e);
      }}
      onPressOut={e => {
        animateTo(motion.scale.rest);
        onPressOut?.(e);
      }}
      style={[style, { transform: [...(Array.isArray(callerTransform) ? callerTransform : []), { scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
