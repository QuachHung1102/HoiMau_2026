import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, sizes, spacing, type Palette } from '../theme/tokens';
import { AppText } from './AppText';
import { Touchable } from './Touchable';

type Variant = 'primary' | 'secondary' | 'onPrimary';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const scheme: Record<Variant, { background: keyof Palette; text: keyof Palette }> = {
  primary: { background: 'primary', text: 'white' },
  secondary: { background: 'soft', text: 'primary' },
  onPrimary: { background: 'lime', text: 'ink' },
};

export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false, accessibilityLabel, style }: Props) {
  const palette = useTheme();
  const { background, text } = scheme[variant];
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: loading }}
      disabled={disabled}
      // Loading keeps the label and swallows presses, so a slow save cannot be submitted twice.
      onPress={loading ? undefined : onPress}
      style={[styles.base, { backgroundColor: palette[background] }, disabled && styles.disabled, style]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={palette[text]} /> : null}
        <AppText weight="semibold" color={text} style={styles.label}>
          {label}
        </AppText>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  // minHeight, not height: the button grows with the font scale.
  base: { minHeight: sizes.buttonHeight, borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: spacing.screen, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
