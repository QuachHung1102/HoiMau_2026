import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Leaderboard } from '../../../domain/contract/social.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/guild';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { SegmentedControl } from '../../shared/ui/Toggles';
import { useGuild, useLeaderboard, type BoardWeek } from './api';
import { clockTime } from './clockTime';

const percent = (ratio: number) => Math.round(ratio * 100);
const WEEKS = [
  { value: 'current', label: vi.weekCurrent },
  { value: 'previous', label: vi.weekPrevious },
] as const;

/**
 * One guild of the board. A plain row: nothing here is pressable, so nothing moves under a finger (motion: rank-roll,
 * tier 2, static: a refreshed board shows its new ratios at once and rows keep their places while they are touched).
 * The caller's own guild says so in words as well as in the lime tile.
 */
function Row({ rank, name, line, mine }: { rank: number | null; name: string; line: string; mine: boolean }) {
  const palette = useTheme();
  return (
    <View accessible accessibilityLabel={vi.boardRowLabel(rank, name, mine ? `${line}${vi.dot}${vi.yourGuild}` : line)} style={styles.row}>
      <View style={[styles.tile, { backgroundColor: mine && rank !== null ? palette.lime : mine ? palette.white : palette.soft }]}>
        {rank === null ? <Icon name="Info" color={palette.muted} /> : <AppText variant="title">{String(rank)}</AppText>}
      </View>
      <View style={styles.text}>
        <AppText weight="semibold" color={rank === null ? 'muted' : 'ink'}>
          {name}
        </AppText>
        <AppText variant="caption">{mine ? `${line}${vi.dot}${vi.yourGuild}` : line}</AppText>
      </View>
    </View>
  );
}

function Board({ board, week, guildName, noGuild, navigation }: { board: Leaderboard; week: BoardWeek; guildName: string | undefined; noGuild: boolean; navigation: ScreenProps<'Leaderboard'>['navigation'] }) {
  const { mine, entries } = board;
  // The caller's guild is on the board unless it is ranked below the 50 the server lists, or not ranked at all.
  const beside = mine !== null && !entries.some(entry => entry.isMine) ? mine : null;
  const own = entries.find(entry => entry.isMine)?.guildName ?? guildName ?? vi.yourGuild;
  const unranked = week === 'current' && mine !== null && !mine.ranked ? mine : null;
  const empty = entries.length === 0 && beside === null;
  return (
    <>
      {noGuild ? (
        <Card tone="soft">
          <AppText variant="headline" accessibilityRole="header">
            {vi.noGuildBoardTitle}
          </AppText>
          <AppText variant="secondary">{vi.noGuildBoardBody}</AppText>
          <Button label={vi.toGuildTab} onPress={() => navigation.navigate('Guild')} />
        </Card>
      ) : unranked ? (
        <Card tone="soft">
          <AppText variant="headline" accessibilityRole="header">
            {vi.unrankedTitle}
          </AppText>
          <AppText variant="secondary">{vi.unrankedBody(unranked.activeMembers)}</AppText>
        </Card>
      ) : (
        <Card tone="soft">
          <AppText variant="headline" accessibilityRole="header">
            {vi.boardExplainTitle}
          </AppText>
          <AppText variant="secondary">{vi.boardExplain}</AppText>
        </Card>
      )}
      {empty && !noGuild ? (
        <Card>
          <AppText variant="title" accessibilityRole="header">
            {vi.emptyBoardTitle[week]}
          </AppText>
          <AppText variant="secondary">{vi.emptyBoardBody[week]}</AppText>
        </Card>
      ) : null}
      {/* motion: list-stagger (tier 2, static: every row is there at once) */}
      <View style={styles.list}>
        {entries.map(entry => (
          <Row key={entry.rank} rank={entry.rank} name={entry.guildName} line={vi.boardLine(percent(entry.avgCompletion), entry.activeMembers)} mine={entry.isMine} />
        ))}
        {beside ? (
          <Row
            rank={beside.ranked ? beside.rank : null}
            name={own}
            line={beside.ranked ? vi.boardLine(percent(beside.avgCompletion), beside.activeMembers) : vi.notRanked[week]}
            mine
          />
        ) : null}
      </View>
      {empty ? null : <AppText variant="secondary">{board.final ? vi.settledFooter : vi.updatedFooter(clockTime(board.updatedAt))}</AppText>}
      {unranked ? <Button label={vi.inviteMore} onPress={() => navigation.navigate('GuildManage')} /> : null}
    </>
  );
}

/** S28: the weekly ranking of guilds, this week or the last closed one; S73 is the same screen for a guild that is not on the board yet. */
export function LeaderboardScreen({ navigation, route }: ScreenProps<'Leaderboard'>) {
  const focused = useIsFocused();
  const [week, setWeek] = useState<BoardWeek>(route.params?.week ?? 'current');
  const query = useLeaderboard(week);
  const guild = useGuild().data;
  const board = query.data;
  return (
    <Screen title={vi.boardTitle} subtitle={vi.boardSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <SegmentedControl accessibilityLabel={vi.weekChoice} options={WEEKS} value={week} onChange={next => setWeek(next as BoardWeek)} />
      {board ? (
        // Before the guild has been read, "no guild" is only certain for the running week (the closed one has no row for anybody before it settles).
        <Board board={board} week={week} guildName={guild?.guild?.name} noGuild={guild ? guild.guild === null : week === 'current' && board.mine === null} navigation={navigation} />
      ) : query.isError && !query.isFetching ? (
        <ErrorState message={query.error instanceof ApiError && query.error.code !== 'INTERNAL' ? failureText(query.error.code) : vi.boardLoadFailed} onRetry={() => query.refetch()} />
      ) : (
        <LoadingState active={focused} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginVertical: 8, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  tile: { width: 48, height: 48, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
