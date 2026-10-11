import { AppText } from '../../shared/ui/AppText';
import { Touchable } from '../../shared/ui/Touchable';

/** A text-only action drawn like the links of the S02 / S03 frames. */
export function TextLink({ label, onPress, small = false }: { label: string; onPress: () => void; small?: boolean }) {
  return (
    <Touchable accessibilityRole="link" onPress={onPress}>
      <AppText variant={small ? 'caption' : 'body'} weight="semibold" color="primary">
        {label}
      </AppText>
    </Touchable>
  );
}
