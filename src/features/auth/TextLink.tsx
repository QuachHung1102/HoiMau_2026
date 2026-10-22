import { AppText } from '../../shared/ui/AppText';
import { StyleSheet } from 'react-native';
import { sizes } from '../../shared/theme/tokens';
import { Touchable } from '../../shared/ui/Touchable';

/** A text-only control drawn like the links of the S02 / S03 frames. `role="button"` when it acts (signs out) instead of going somewhere. */
export function TextLink({ label, onPress, small = false, role = 'link' }: { label: string; onPress: () => void; small?: boolean; role?: 'link' | 'button' }) {
  return (
    // a 48 dp row of its own: the target never reaches into the control above it
    <Touchable accessibilityRole={role} onPress={onPress} style={styles.row}>
      <AppText variant={small ? 'caption' : 'body'} weight="semibold" color="primary">
        {label}
      </AppText>
    </Touchable>
  );
}

const styles = StyleSheet.create({ row: { minHeight: sizes.minTouch, justifyContent: 'center' } });
