import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { retry } from '../../shared/i18n/vi/common';
import { legalVi } from '../../shared/i18n/vi/legal';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { SHARE_FAILED, SHARE_TOO_LARGE, useExportData, type PrivacyOutcome } from './api';

type Sheet = 'own' | 'policy';

/** Why a copy was not made or not shared, in the words of the person, and whether asking again could change anything. */
const reasonOf = (code: string) =>
  code === SHARE_TOO_LARGE
    ? { text: vi.exportTooLarge, retry: false }
    : code === SHARE_FAILED
      ? { text: vi.exportShareFailed, retry: true }
      : code === 'RATE_LIMITED'
        ? { text: vi.exportRateLimited, retry: true }
        : { text: vi.exportNotDone(failureText(code)), retry: true };

/**
 * S44: what stays private, a copy of the data as a JSON file, and the way to the deletion of the account. The copy is fetched when
 * the row is pressed and handed straight to the share box (`useExportData`): this screen never holds it.
 */
export function PrivacyScreen({ navigation }: ScreenProps<'Privacy'>) {
  const palette = useTheme();
  const [exportData, preparing] = useExportData();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [result, setResult] = useState<PrivacyOutcome | null>(null);
  const share = async () => {
    setResult(null);
    const outcome = await exportData();
    if (outcome) setResult(outcome);
  };
  const failed = result?.state === 'failed' ? reasonOf(result.code) : null;
  return (
    <Screen title={vi.privacyTitle} subtitle={vi.privacySubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <View style={styles.list}>
        <ListRow icon="Lock" {...vi.ownDataRow} onPress={() => setSheet('own')} />
        <ListRow icon="Download" {...vi.exportRow} busy={preparing} onPress={share} />
      </View>
      {preparing ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <ActivityIndicator color={palette.primary} />
          <AppText variant="secondary">{vi.exporting}</AppText>
        </View>
      ) : null}
      {result?.state === 'done' ? (
        <Card tone="soft" accessibilityLiveRegion="polite">
          <Icon name="CircleCheck" />
          <AppText variant="title" accessibilityRole="header">
            {vi.exportedTitle}
          </AppText>
          <AppText variant="secondary">{vi.exportedNote}</AppText>
        </Card>
      ) : null}
      {failed ? <InlineError message={failed.text} action={failed.retry ? { label: retry, onPress: share } : undefined} /> : null}
      <Card style={styles.danger}>
        <AppText variant="title" color="error" accessibilityRole="header">
          {vi.deleteCard.title}
        </AppText>
        <AppText variant="secondary">{vi.deleteCard.body}</AppText>
        <Button variant="secondary" label={vi.deleteCard.action} onPress={() => navigation.navigate('DeleteAccount')} />
      </Card>
      <Button variant="secondary" label={vi.readPolicy} onPress={() => setSheet('policy')} />
      {sheet === 'own' ? (
        <BottomSheet title={vi.ownDataRow.title} onDismiss={() => setSheet(null)}>
          {vi.ownDataLines.map(line => (
            <AppText key={line} variant="secondary">
              {line}
            </AppText>
          ))}
        </BottomSheet>
      ) : null}
      {sheet === 'policy' ? (
        <BottomSheet title={legalVi.title} onDismiss={() => setSheet(null)}>
          <AppText variant="secondary">{legalVi.intro}</AppText>
          {legalVi.sections.map(({ heading, body }) => (
            <View key={heading} style={styles.section}>
              <AppText weight="semibold">{heading}</AppText>
              <AppText variant="secondary">{body}</AppText>
            </View>
          ))}
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.section - 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  danger: { marginTop: 8 },
  section: { marginTop: 12, gap: 4 },
});
