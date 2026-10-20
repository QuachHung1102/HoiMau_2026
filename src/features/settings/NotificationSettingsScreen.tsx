import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import type { Settings } from '../../../domain/contract/core.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { failureText } from '../../shared/i18n/vi/sync';
import * as vi from '../../shared/i18n/vi/settings';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { SelectField } from '../../shared/ui/SelectField';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { Switch } from '../../shared/ui/Toggles';
import { usePatchSettings, useSettings } from './api';

type Window = Settings['reminderWindow'];
// The values are the server's own words: they drive the reminder job (a window it does not know is refused).
const WINDOWS = (Object.keys(vi.windows) as Window[]).map(value => ({ value, label: vi.windows[value] }));

/**
 * S36 with the S80 layout (AR-23): this build sends nothing outside the app, so the card at the top says so and opens the inbox,
 * where the reminders are; no permission is asked. Each change is shown at once and goes to the server as one PATCH.
 */
export function NotificationSettingsScreen({ navigation }: ScreenProps<'NotificationSettings'>) {
  const focused = useIsFocused();
  const query = useSettings();
  const patch = usePatchSettings();
  const settings = query.data;
  const header = { title: vi.notificationsTitle, subtitle: vi.notificationsSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!settings) {
    return (
      <Screen {...header}>
        <View style={styles.block}>
          {query.isError && !query.isFetching ? (
            <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} />
          ) : (
            <LoadingState active={focused} />
          )}
        </View>
      </Screen>
    );
  }
  return (
    <Screen {...header}>
      <Card tone="soft" style={styles.notice}>
        <Icon name="BellOff" />
        <AppText>{vi.noticeBody}</AppText>
        <Button label={vi.openInbox} onPress={() => navigation.navigate('Inbox')} />
      </Card>
      <Switch label={vi.nudgesLabel} value={settings.nudgesEnabled} onChange={nudgesEnabled => patch({ nudgesEnabled })} />
      <Switch label={vi.reminderLabel} value={settings.reminderEnabled} onChange={reminderEnabled => patch({ reminderEnabled })} />
      <SelectField
        label={vi.windowLabel}
        value={settings.reminderWindow}
        options={WINDOWS}
        disabled={!settings.reminderEnabled}
        helper={settings.reminderEnabled ? undefined : vi.windowNeedsReminder}
        onChange={window => window !== settings.reminderWindow && patch({ reminderWindow: window as Window })}
      />
      <AppText variant="caption" style={styles.footer}>
        {vi.notificationsFooter}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.section - 8 },
  notice: { marginTop: spacing.section - 8, marginBottom: 8 },
  footer: { marginTop: 8 },
});
