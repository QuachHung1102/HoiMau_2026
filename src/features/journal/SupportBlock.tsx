import type { StyleProp, ViewStyle } from 'react-native';
import { healthVi } from '../../shared/i18n/vi/health';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';

/**
 * The support block that stands beside a response when the device's crisis check matched (S33 after a save, S32 beside the error
 * of a save that failed). Never instead of the response. Whether it shows is decided in memory by the caller; nothing here knows why.
 */
export function SupportBlock({ onSeeSources, style }: { onSeeSources: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Card tone="soft" style={style}>
      <Icon name="HeartHandshake" size={32} />
      <AppText variant="title" accessibilityRole="header">
        {healthVi.support.title}
      </AppText>
      <AppText variant="secondary">{healthVi.support.body}</AppText>
      <Button label={healthVi.support.seeSources} onPress={onSeeSources} />
    </Card>
  );
}
