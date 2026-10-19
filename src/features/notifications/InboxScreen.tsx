import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import type { InboxItem } from '../../../domain/contract/core.ts';
import type { RouteName, ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/inbox';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Mam } from '../../shared/ui/mam/Mam';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { useMe } from '../auth/api';
import { useInbox, useMarkRead } from './api';

type Shown = { icon: IconName; title: string; description?: string; target?: Extract<RouteName, 'Journey' | 'QuestBoard' | 'Leaderboard' | 'Today'> };

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The words and the way on of one notification. The payload is the server's and is read defensively: a field that is not
 * what the contract says is left out, and a kind this app does not know is a generic row with no way on, never a blank or a crash.
 */
function shown(item: InboxItem): Shown {
  const payload: Record<string, unknown> = item.payload !== null && typeof item.payload === 'object' ? item.payload : {};
  switch (item.kind) {
    case 'NUDGE': {
      const name = text(payload.senderName);
      const line = text(payload.text);
      return { icon: 'Users', title: name ? vi.nudgeTitle(name) : vi.nudgeSomeone, description: line ? vi.quoted(line) : undefined };
    }
    case 'STREAK_MILESTONE':
      return { icon: 'Award', title: vi.milestoneTitle, description: vi.milestoneBody, target: 'Journey' };
    case 'PET_TIRED':
      return { icon: 'Sprout', title: vi.petTitle, description: vi.petBody, target: 'QuestBoard' };
    case 'GUILD_WEEKLY_RESULT': {
      const rank = count(payload.rank);
      return { icon: 'Trophy', title: vi.weeklyTitle, description: rank === undefined ? undefined : vi.weeklyBody(rank, count(payload.coins) ?? 0), target: 'Leaderboard' };
    }
    case 'QUEST_REMINDER':
      return { icon: 'Bell', title: vi.reminderTitle, description: vi.reminderBody, target: 'Today' };
    default:
      return { icon: 'Mail', title: vi.unknownTitle, description: vi.unknownBody };
  }
}

/** One notification. Opening an unread one marks it read (this row's own write: its key and its one-at-a-time are its own). */
function Row({ item, navigation }: { item: InboxItem; navigation: ScreenProps<'Inbox'>['navigation'] }) {
  const palette = useTheme();
  const snackbar = useSnackbar();
  const [markRead] = useMarkRead();
  const { icon, title, description, target } = shown(item);
  const unread = item.readAt === null;
  const open = () => {
    if (unread) {
      markRead([item.id]).then(outcome => {
        if (outcome?.state === 'failed') snackbar.show({ message: vi.markFailed });
      });
    }
    if (target) navigation.navigate(target);
  };
  const body = (
    <View style={styles.row}>
      <Icon name={icon} />
      <View style={styles.text}>
        <AppText weight="semibold">{title}</AppText>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
      {/* motion: unread-dot (tier 2, static: the dot is simply there; the row's label says it is unread) */}
      {unread ? <View testID="unread-dot" style={[styles.dot, { backgroundColor: palette.primary }]} /> : null}
      {target ? <Icon name="ChevronRight" color={palette.muted} /> : null}
    </View>
  );
  if (!unread && !target) return <View accessible accessibilityLabel={[title, description].filter(Boolean).join('. ')}>{body}</View>;
  return (
    <Touchable accessibilityRole="button" accessibilityLabel={[title, description, unread ? vi.unread : undefined].filter(Boolean).join('. ')} onPress={open}>
      {body}
    </Touchable>
  );
}

/** S30: the notifications, newest first, a page at a time; S75 when there are none. */
export function InboxScreen({ navigation }: ScreenProps<'Inbox'>) {
  const focused = useIsFocused();
  const query = useInbox();
  const stage = useMe().data?.pet?.stage ?? 'HATCHLING';
  const [markAll, markingAll] = useMarkRead();
  const [allFailed, setAllFailed] = useState<{ text: string; again?: () => void } | null>(null);
  const header = { title: vi.title, subtitle: vi.subtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  const settings = () => navigation.navigate('NotificationSettings');
  const pages = query.data?.pages;
  if (!pages) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? (
          <ErrorState message={query.error instanceof ApiError && query.error.code !== 'INTERNAL' ? failureText(query.error.code) : vi.loadFailed} onRetry={() => query.refetch()} />
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }
  const items = pages.flatMap(page => page.items);
  if (items.length === 0) {
    return (
      <Screen {...header}>
        <EmptyState
          title={vi.emptyTitle}
          body={vi.emptyBody}
          // decorative: the words under it say the same. motion: mam-wave (tier 2, static: drawn already waving)
          illustration={<Mam stage={stage} mood="HAPPY" size={128} animation="idle" decorative active={focused} />}
          primary={{ label: vi.settings, onPress: settings }}
        />
      </Screen>
    );
  }

  const unreadCount = pages[0].unreadCount;
  const doMarkAll = async () => {
    setAllFailed(null);
    const outcome = await markAll(null);
    if (outcome?.state === 'failed') setAllFailed({ text: failureText(outcome.code), again: outcome.code === 'NETWORK' || outcome.code === 'TIMEOUT' ? doMarkAll : undefined });
  };
  return (
    <Screen {...header} scroll={false}>
      {unreadCount > 0 ? (
        <Touchable accessibilityRole="button" accessibilityState={{ busy: markingAll }} onPress={markingAll ? undefined : doMarkAll} style={styles.markAll}>
          <AppText weight="semibold" color="primary">
            {vi.markAllRead}
          </AppText>
        </Touchable>
      ) : null}
      {allFailed ? <InlineError message={allFailed.text} action={allFailed.again ? { label: retry, onPress: allFailed.again } : undefined} /> : null}
      {/* motion: list-stagger (tier 2, static: every row is there at once) */}
      <FlatList
        testID="inbox-list"
        style={styles.list}
        data={items}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <Row item={item} navigation={navigation} />}
        initialNumToRender={20}
        onEndReachedThreshold={0.5}
        // After a page that failed, only "Thử lại" asks again: scrolling must not hammer the server.
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) query.fetchNextPage();
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            {query.isFetchingNextPage ? <LoadingState blocks={1} active={focused} /> : null}
            {query.isFetchNextPageError && !query.isFetchingNextPage ? <InlineError message={vi.moreFailed} action={{ label: retry, onPress: () => query.fetchNextPage() }} /> : null}
            <Button variant="secondary" label={vi.settings} onPress={settings} />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 },
  text: { flex: 1, gap: 2 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  markAll: { alignSelf: 'flex-end' },
  footer: { gap: 12, paddingVertical: 12 },
});
