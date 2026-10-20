import { useIsFocused } from '@react-navigation/native';
import { useEffect } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/journal';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { useJournalList } from './api';
import { dayWord } from './time';

/**
 * S49: the pages, newest first, a page of the list at a time. More is asked for only while the last page names a next one
 * (`nextBefore`): a page with fewer entries than asked for does not mean the end, because the server leaves out an entry it
 * cannot open. The empty state is for a list with no entry and no next page.
 */
export function JournalListScreen({ navigation }: ScreenProps<'JournalList'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const query = useJournalList();
  const header = { title: vi.listTitle, subtitle: vi.listSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  const pages = query.data?.pages;
  const entries = pages?.flatMap(page => page.entries) ?? [];
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  // A whole page of entries the server could not open is empty while the next one is not: there is nothing to scroll, so ask for it.
  const walking = pages !== undefined && entries.length === 0 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError;
  useEffect(() => {
    if (walking) fetchNextPage();
  }, [walking, fetchNextPage]);

  if (!pages) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? (
          <ErrorState message={query.error instanceof ApiError && query.error.code !== 'INTERNAL' ? failureText(query.error.code) : vi.listFailed} onRetry={() => query.refetch()} />
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }
  const write = <Button label={vi.newPage} onPress={() => navigation.navigate('JournalWrite')} />;
  if (entries.length === 0 && !hasNextPage) {
    return (
      <Screen {...header}>
        <EmptyState title={vi.emptyTitle} body={vi.emptyBody} primary={{ label: vi.newPage, onPress: () => navigation.navigate('JournalWrite') }} />
      </Screen>
    );
  }
  return (
    <Screen {...header} scroll={false}>
      <FlatList
        testID="journal-list"
        style={styles.list}
        data={entries}
        keyExtractor={entry => entry.id}
        renderItem={({ item }) => (
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={`${item.preview.replace(/\s+/g, ' ')}. ${dayWord(item.createdAt)} · ${vi.rowHint}`}
            onPress={() => navigation.navigate('JournalEntry', { id: item.id })}
          >
            <View style={styles.row}>
              <Icon name="NotebookPen" />
              <View style={styles.text}>
                <AppText weight="semibold" numberOfLines={2}>
                  {item.preview.replace(/\s+/g, ' ')}
                </AppText>
                <AppText variant="caption">{`${dayWord(item.createdAt)} · ${vi.rowHint}`}</AppText>
              </View>
              <Icon name="ChevronRight" color={palette.muted} />
            </View>
          </Touchable>
        )}
        onEndReachedThreshold={0.5}
        // After a page that failed, only "Thử lại" asks again: scrolling must not hammer the server.
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) fetchNextPage();
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            {isFetchingNextPage || walking ? <LoadingState blocks={1} active={focused} /> : null}
            {isFetchNextPageError && !isFetchingNextPage ? <InlineError message={vi.moreFailed} action={{ label: retry, onPress: () => fetchNextPage() }} /> : null}
            {write}
            <AppText>{vi.listFooter}</AppText>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12, minHeight: 48 },
  text: { flex: 1, gap: 2 },
  footer: { gap: 12, paddingVertical: 12 },
});
