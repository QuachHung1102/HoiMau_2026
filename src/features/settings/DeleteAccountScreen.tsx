import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LIMITS } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField } from '../../shared/ui/TextField';
import { useDeleteAccount } from './api';
import { ACCOUNT_PURGE_DAYS } from './rules';

/** The refusal of the password is said at the field; anything else, beside the buttons. */
type Problem = { field: boolean; text: string };
const problemOf = (code: string): Problem =>
  code === 'INVALID_CREDENTIALS'
    ? { field: true, text: vi.deleteRefused }
    : { field: false, text: code === 'NETWORK' || code === 'TIMEOUT' ? vi.deleteUnknown : vi.deleteNotDone(failureText(code)) };

/**
 * S52: what deleting the account means, and the password that confirms it. The safe button comes first and is the same size as the
 * other. A success ends the session (`closeAccount`): this screen is replaced by Welcome, which says the account was closed.
 */
export function DeleteAccountScreen({ navigation }: ScreenProps<'DeleteAccount'>) {
  const palette = useTheme();
  const [remove, busy] = useDeleteAccount();
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const ready = password !== '';
  const submit = async () => {
    if (!ready || busy) return;
    setProblem(null);
    const outcome = await remove(password);
    if (outcome?.state === 'failed') setProblem(problemOf(outcome.code));
  };
  return (
    <Screen title={vi.deleteTitle} subtitle={vi.deleteSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <Card style={styles.card}>
        <Icon name="TriangleAlert" size={32} color={palette.error} />
        <AppText variant="title" accessibilityRole="header">
          {vi.deleteHeadline}
        </AppText>
        <View accessibilityRole="list" style={styles.list}>
          {vi.deleteConsequences(ACCOUNT_PURGE_DAYS).map(line => (
            <View key={line} style={styles.item}>
              <AppText accessible={false} importantForAccessibility="no" variant="secondary">
                •
              </AppText>
              <AppText variant="secondary" style={styles.line}>
                {line}
              </AppText>
            </View>
          ))}
        </View>
      </Card>
      <TextField
        label={vi.passwordLabel}
        secure
        value={password}
        onChangeText={text => {
          setPassword(text);
          setProblem(current => (current?.field ? null : current));
        }}
        error={problem?.field ? problem.text : undefined}
        helper={ready ? undefined : vi.passwordHelper}
        maxLength={LIMITS.password.max}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      {problem && !problem.field ? <InlineError message={problem.text} /> : null}
      <View style={styles.actions}>
        <Button label={vi.keepAccount} disabled={busy} onPress={() => navigation.goBack()} />
        <Button variant="danger" label={vi.deleteAction} disabled={!ready} loading={busy} onPress={submit} />
      </View>
      <AppText variant="secondary">{vi.deleteExportHint}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.section - 8 },
  list: { gap: 8 },
  item: { flexDirection: 'row', gap: 8 },
  line: { flex: 1 },
  actions: { gap: 16 },
});
