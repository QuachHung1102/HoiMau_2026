import { AppText } from '../../shared/ui/AppText';
import { Card } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { useAnnounceOnIos } from '../../shared/ui/Notices';

type Props = { icon: IconName; title?: string; message: string; note?: string };

/**
 * A calm message that is not an error: the session ended (S02), the code was sent (S04).
 * A polite live region on Android, announced explicitly on iOS (the same path as InlineError).
 */
export function Notice({ icon, title, message, note }: Props) {
  useAnnounceOnIos([title, message, note].filter(Boolean).join('. '));
  return (
    <Card tone="soft" accessibilityLiveRegion="polite">
      <Icon name={icon} />
      {title ? (
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      <AppText variant={title ? 'secondary' : 'body'}>{message}</AppText>
      {note ? <AppText variant="secondary">{note}</AppText> : null}
    </Card>
  );
}
