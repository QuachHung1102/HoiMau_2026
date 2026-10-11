import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Scrim, useFocusOnShow } from './BottomSheet';
import { Button } from './Button';

type Action = { label: string; onPress: () => void };
type Props = {
  /** Mount it only while open, or drive it with `visible`. */
  visible?: boolean;
  title: string;
  body: string;
  primary: Action;
  secondary?: Action;
  /** Android Back and a tap on the dim backdrop. */
  onDismiss: () => void;
};

export function Dialog({ visible = true, title, body, primary, secondary, onDismiss }: Props) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const { ref, focus } = useFocusOnShow();
  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={onDismiss}
      onShow={focus}
    >
      <Scrim onDismiss={onDismiss} justify="center">
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: palette.white }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <View ref={ref} accessible accessibilityRole="header">
              <AppText variant="title">{title}</AppText>
            </View>
            <AppText>{body}</AppText>
            <View style={styles.actions}>
              <Button label={primary.label} onPress={primary.onPress} />
              {secondary ? <Button variant="secondary" label={secondary.label} onPress={secondary.onPress} /> : null}
            </View>
          </ScrollView>
        </View>
      </Scrim>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // maxHeight + ScrollView: at font scale 2.0 the card scrolls instead of clipping.
  card: { maxHeight: '90%', marginHorizontal: spacing.screen, borderRadius: radius.surface, alignSelf: 'stretch' },
  content: { padding: 20, gap: 12 },
  actions: { gap: 10, marginTop: 4 },
});
