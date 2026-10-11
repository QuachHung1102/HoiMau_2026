import { useEffect, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Animated, Easing, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import * as vi from '../i18n/vi/common';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, sizes, typography } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { InlineError } from './Notices';
import { Touchable } from './Touchable';

type FrameProps = { label: string; error?: string; helper?: string; focused?: boolean; children: ReactNode };

/** Label above, bordered box, then the error (or helper) below. Shared by TextField and SelectField. */
export function FieldFrame({ label, error, helper, focused = false, children }: FrameProps) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const invalid = Boolean(error);
  const [tint] = useState(() => new Animated.Value(invalid ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      tint.setValue(invalid ? 1 : 0);
      return;
    }
    // motion: field-error
    const run = Animated.timing(tint, {
      toValue: invalid ? 1 : 0,
      duration: motion.durationsMs.feedback,
      easing: Easing.bezier(...motion.easing.enter),
      useNativeDriver: false, // border colour cannot run on the native driver
    });
    run.start();
    return () => run.stop();
  }, [invalid, reduced, tint]);

  const errorTint = tint.interpolate({ inputRange: [0, 1], outputRange: [palette.line, palette.error] });
  const emphasised = focused || invalid;
  return (
    <View style={styles.frame}>
      {/* The input carries the label for screen readers; this copy is visual only. */}
      <AppText variant="caption" weight="medium" accessible={false} importantForAccessibility="no">
        {label}
      </AppText>
      <Animated.View
        testID="field-box"
        style={[
          styles.box,
          {
            backgroundColor: palette.white,
            borderColor: focused && !invalid ? palette.primary : errorTint,
          },
          emphasised ? styles.boxThick : styles.boxThin,
        ]}
      >
        {children}
      </Animated.View>
      {error ? (
        <InlineError message={error} />
      ) : helper ? (
        // read as the input's hint, so this copy is visual only
        <AppText variant="caption" accessible={false} importantForAccessibility="no">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

/** What a ref to a TextField holds: the underlying input (focus, blur, clear). */
export type TextFieldInput = ComponentRef<typeof TextInput>;

type Props = Omit<TextInputProps, 'style' | 'accessibilityLabel' | 'secureTextEntry' | 'placeholderTextColor'> & {
  label: string;
  error?: string;
  helper?: string;
  /** Password field with a show / hide toggle. */
  secure?: boolean;
  /** The underlying input, e.g. to move focus to the first invalid field. */
  ref?: Ref<TextFieldInput>;
};

export function TextField({ label, error, helper, secure = false, onFocus, onBlur, ref, ...rest }: Props) {
  const palette = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <FieldFrame label={label} error={error} helper={helper} focused={focused}>
      <View style={styles.row}>
        <TextInput
          // A revealed password must not be capitalised, corrected or learned by the keyboard; callers can override.
          {...(secure ? { autoCapitalize: 'none', autoCorrect: false, spellCheck: false } : null)}
          {...rest}
          ref={ref}
          // React Native has no `invalid` accessibility state on both platforms, so the error is part of the label.
          accessibilityLabel={error ? vi.fieldInvalid(label, error) : label}
          accessibilityHint={error ? undefined : helper}
          secureTextEntry={secure && hidden}
          placeholderTextColor={palette.muted}
          onFocus={e => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: palette.ink }]}
        />
        {secure ? (
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={hidden ? vi.showPassword : vi.hidePassword}
            onPress={() => setHidden(h => !h)}
          >
            <Icon name={hidden ? 'Eye' : 'EyeOff'} color={palette.muted} />
          </Touchable>
        ) : null}
      </View>
    </FieldFrame>
  );
}

const styles = StyleSheet.create({
  // the vertical margin plus the Screen gap give the ~16 dp between fields drawn in the frames
  frame: { gap: 6, marginVertical: 4 },
  box: { minHeight: sizes.buttonHeight, borderRadius: radius.surface, justifyContent: 'center' },
  // the padding shrinks as the border thickens, so the text does not move
  boxThin: { borderWidth: 1, paddingHorizontal: 15 },
  boxThick: { borderWidth: 2, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, paddingVertical: 12, fontFamily: typography.body.fontFamily, fontSize: typography.body.fontSize },
});
