import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import * as vi from '../i18n/vi/common';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

type Props = {
  title?: string;
  subtitle?: string;
  /** Shows the native-style Back arrow above the title. */
  onBack?: () => void;
  scroll?: boolean;
  /** Set when the screen contains text inputs, so the keyboard does not cover them. */
  hasInputs?: boolean;
  /** Safe-area edges to pad; a tab root lets the tab bar own the bottom edge. */
  edges?: readonly Edge[];
  children?: ReactNode;
};

export function Screen({ title, subtitle, onBack, scroll = true, hasInputs = false, edges, children }: Props) {
  const palette = useTheme();
  const body = (
    <>
      {onBack ? (
        <Touchable accessibilityRole="button" accessibilityLabel={vi.back} onPress={onBack} style={styles.back}>
          <Icon name="ArrowLeft" color={palette.ink} />
        </Touchable>
      ) : null}
      {title ? (
        <AppText variant="headline" accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      {subtitle ? <AppText variant="secondary">{subtitle}</AppText> : null}
      {children}
    </>
  );
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: palette.bg }]}>
      <KeyboardAvoidingView
        enabled={hasInputs}
        // ponytail: Android resizes the window itself (adjustResize); confirm on a device.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        {scroll ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          <View style={[styles.fill, styles.content]}>{body}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.screen, gap: 8 },
  back: { width: 48, height: 48, justifyContent: 'center', marginLeft: -12 },
});
