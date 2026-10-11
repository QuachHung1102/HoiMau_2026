import { AppText } from '../../shared/ui/AppText';
import { StyleSheet } from 'react-native';
import { sizes } from '../../shared/theme/tokens';
import { Touchable } from '../../shared/ui/Touchable';

/** A text-only action drawn like the links of the S02 / S03 frames. */
export function TextLink({ label, onPress, small = false }: { label: string; onPress: () => void; small?: boolean }) {
  return (
    // a 48 dp row of its own: the target never reaches into the control above it
    <Touchable accessibilityRole="link" onPress={onPress} style={styles.row}>
      <AppText variant={small ? 'caption' : 'body'} weight="semibold" color="primary">
        {label}
      </AppText>
    </Touchable>
  );
}

const styles = StyleSheet.create({ row: { minHeight: sizes.minTouch, justifyContent: 'center' } });
