import { useCallback, useRef, type ComponentRef, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as vi from '../i18n/vi/common';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

/**
 * Moves screen-reader focus to the node behind `ref` (the modal title) once the modal is on screen.
 * A no-op wherever the platform cannot do it; whether it lands is a device check.
 */
export function useFocusOnShow() {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const focus = useCallback(() => {
    try {
      const node = ref.current ? findNodeHandle(ref.current) : null;
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
    } catch {
      // unsupported here: leave focus where the platform puts it
    }
  }, []);
  return { ref, focus };
}

/** Translucent layer under a modal card; pressing it dismisses. */
export function Scrim({ onDismiss, children, justify }: { onDismiss: () => void; children: ReactNode; justify: 'center' | 'flex-end' }) {
  const palette = useTheme();
  return (
    // The tint sits on the parent so the transparent Touchable's press scale shows nothing.
    <View style={[styles.scrim, { backgroundColor: `${palette.ink}8C`, justifyContent: justify }]}>
      <Touchable accessibilityRole="button" accessibilityLabel={vi.close} onPress={onDismiss} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}

type Props = { visible?: boolean; title: string; children: ReactNode; onDismiss: () => void };

export function BottomSheet({ visible = true, title, children, onDismiss }: Props) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { ref, focus } = useFocusOnShow();
  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={onDismiss}
      onShow={focus}
    >
      <Scrim onDismiss={onDismiss} justify="flex-end">
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: palette.white, paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.header}>
            <View ref={ref} accessible accessibilityRole="header" style={styles.title}>
              <AppText variant="title">{title}</AppText>
            </View>
            <Touchable accessibilityRole="button" accessibilityLabel={vi.close} onPress={onDismiss}>
              <Icon name="X" color={palette.ink} />
            </Touchable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        </View>
      </Scrim>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.surface,
    borderTopRightRadius: radius.surface,
    paddingTop: 20,
    paddingHorizontal: spacing.screen,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1 },
  content: { gap: 4 },
});
