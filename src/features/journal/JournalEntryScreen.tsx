import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/journal';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { useJournalEntry } from './api';
import { dayWord } from './time';

/**
 * S50: one page, whole, with its date and the quote it was answered with. Read only: no edit, no delete, and no share button
 * anywhere in this feature. The text is held by the query cache in memory and is never stored or logged.
 */
export function JournalEntryScreen({ route, navigation }: ScreenProps<'JournalEntry'>) {
  const focused = useIsFocused();
  const query = useJournalEntry(route.params.id);
  const entry = query.data;
  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('JournalList'));
  const header = { title: vi.entryTitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!entry) {
    const code = query.error instanceof ApiError ? query.error.code : undefined;
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? (
          code === 'NOT_FOUND' ? (
            <EmptyState title={vi.entryGone} body={vi.entryGoneBody} primary={{ label: vi.backToList, onPress: back }} />
          ) : (
            <ErrorState message={code && code !== 'INTERNAL' ? failureText(code) : vi.entryFailed} onRetry={() => query.refetch()} />
          )
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }
  return (
    <Screen {...header} subtitle={dayWord(entry.createdAt)}>
      <Card>
        <AppText selectable>{entry.body}</AppText>
      </Card>
      <Card tone="soft">
        <AppText variant="title">{`“${entry.quote.text}”`}</AppText>
        {entry.quote.author ? <AppText variant="caption">{entry.quote.author}</AppText> : null}
      </Card>
      <View style={styles.lock}>
        <Icon name="Lock" />
        <View style={styles.lockText}>
          <AppText weight="semibold">{vi.lockTitle}</AppText>
          <AppText variant="caption">{vi.lockBody}</AppText>
        </View>
      </View>
      <Button variant="secondary" label={vi.backToList} onPress={back} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lock: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  lockText: { flex: 1, gap: 2 },
});
