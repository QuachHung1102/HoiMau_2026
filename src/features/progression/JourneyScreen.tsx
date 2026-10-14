import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import type { DaySummary } from '../../../domain/contract/core.ts';
import { addDays, weekStartOf } from '../../../domain/logicalDate.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/progression';
import { failureText } from '../../shared/i18n/vi/sync';
import { newDayNotSynced } from '../../shared/i18n/vi/today';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { FrostDot, StreakChip } from '../../shared/ui/Badges';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { MilestoneBadge } from '../../shared/ui/MilestoneBadge';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useDay } from '../quests/api';
import { useHistory, useProgression } from './api';

const MARK = 24;

/** "2026-10-15" -> "15/10": the label of the server, cut, never turned into a device date. */
const shortDate = (date: DateLabel) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * What a day of this week is, from the server's words only. Today is open (the server closes a day after it ends, so
 * today is never "completed" here, and a provisional day has nothing more to say), a later date is not there yet, an
 * earlier one is what the history says, or unknown while that has not arrived.
 */
export function markState(date: DateLabel, today: DateLabel, days: readonly DaySummary[] | undefined): vi.MarkState {
  if (date > today) return 'FUTURE';
  if (date === today) return 'OPEN';
  return days?.find(summary => summary.logicalDate === date)?.outcome ?? 'UNKNOWN';
}

function Mark({ index, date, state, today }: { index: number; date: DateLabel; state: vi.MarkState; today: boolean }) {
  const palette = useTheme();
  return (
    // One element with the whole sentence: the day and its state, in words; the glyph itself is decoration.
    <View accessible accessibilityRole="text" accessibilityLabel={vi.markLabel(vi.weekdayLong[index], shortDate(date), state)} style={styles.mark}>
      <AppText variant="caption" weight={today ? 'bold' : 'regular'} color={today ? 'ink' : 'muted'}>
        {vi.weekdayShort[index]}
      </AppText>
      {state === 'COMPLETED' ? (
        <Icon name="CircleCheck" size={MARK} />
      ) : state === 'FROZEN' ? (
        // motion: ticket-freeze (tier 1, drawn in its end state: the animation belongs to the moment a ticket is used, S34)
        <View style={styles.frozen}>
          <FrostDot compact />
        </View>
      ) : (
        <View style={[styles.ring, { borderColor: palette.primary }]} />
      )}
    </View>
  );
}

function Legend() {
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <Icon name="CircleCheck" size={16} />
        <AppText variant="caption">{vi.legendDone}</AppText>
      </View>
      <View style={styles.legendItem}>
        <FrostDot compact />
        <AppText variant="caption">{vi.legendFrozen}</AppText>
      </View>
    </View>
  );
}

function Week({ today, summaries }: { today: DateLabel; summaries: readonly DaySummary[] | undefined }) {
  const start = weekStartOf(today);
  return (
    <View style={styles.week}>
      {vi.weekdayShort.map((_, index) => {
        const date = addDays(start, index);
        return <Mark key={date} index={index} date={date} state={markState(date, today, summaries)} today={date === today} />;
      })}
    </View>
  );
}

/** S21, and S67 when the streak has just ended: this week, the record, the milestones, and the way into the history. */
export function JourneyScreen({ navigation }: ScreenProps<'Journey'>) {
  const focused = useIsFocused();
  const progressionQuery = useProgression();
  const dayQuery = useDay();
  const day = dayQuery.data;
  const today = day?.logicalDate;
  const history = useHistory(today && weekStartOf(today), today);
  const progression = progressionQuery.data;

  const header = { title: vi.journeyTitle, subtitle: vi.journeySubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!progression) {
    const code = progressionQuery.error instanceof ApiError ? progressionQuery.error.code : '';
    return (
      <Screen {...header}>
        <View style={styles.section}>
          {progressionQuery.isError && !progressionQuery.isFetching ? (
            <ErrorState message={failureText(code)} onRetry={() => progressionQuery.refetch()} />
          ) : (
            <LoadingState active={focused} />
          )}
        </View>
      </Screen>
    );
  }

  const provisional = dayQuery.provisional;
  const restart = progression.breakNotice !== null;
  // The number of days to go comes from the streak, which a provisional day does not know.
  const remaining = (days: number) => (provisional ? undefined : Math.max(days - progression.streakCurrent, 1));
  const next = progression.milestones.find(milestone => !milestone.achieved);
  const historyCode = history.error instanceof ApiError ? history.error.code : '';
  return (
    <Screen {...header}>
      {provisional ? (
        <View accessibilityLiveRegion="polite">
          <DisabledReason reason={newDayNotSynced} icon="CloudOff" />
        </View>
      ) : null}
      <View style={styles.section}>
        <Card tone="soft">
          {restart ? (
            // motion: streak-reset-soft (tier 2, static: the record and the invitation are there at once)
            <>
              <AppText variant="headline" accessibilityRole="header">
                {vi.restartTitle}
              </AppText>
              <AppText variant="secondary">{provisional ? vi.restartBodyRecordOnly(progression.streakBest) : vi.restartBody(progression.streakCurrent, progression.streakBest)}</AppText>
            </>
          ) : (
            <>
              {provisional ? null : <StreakChip days={progression.streakCurrent} />}
              {provisional ? null : (
                <AppText variant="headline" accessibilityRole="header">
                  {progression.streakCurrent > 0 ? vi.streakRunning : vi.streakIdle}
                </AppText>
              )}
              <AppText variant="secondary">{vi.record(progression.streakBest)}</AppText>
              <AppText variant="secondary">{vi.weekHint}</AppText>
            </>
          )}
          {today ? <Week today={today} summaries={history.data?.days} /> : <LoadingState blocks={1} active={focused} />}
          {restart ? null : <Legend />}
        </Card>
        {history.isError && !history.isFetching ? (
          <InlineError message={`${common.loadFailedTitle}. ${failureText(historyCode)}`} action={{ label: common.retry, onPress: () => history.refetch() }} style={styles.error} />
        ) : null}
      </View>

      {restart ? null : (
        <View style={styles.section}>
          <AppText variant="title" accessibilityRole="header">
            {vi.milestonesTitle}
          </AppText>
          <View style={styles.badges}>
            {progression.milestones.map(milestone => (
              <MilestoneBadge key={milestone.days} days={milestone.days} achieved={milestone.achieved} remaining={milestone.achieved ? undefined : remaining(milestone.days)} />
            ))}
          </View>
          {next && !provisional ? <AppText variant="caption">{vi.untilMilestone(remaining(next.days) ?? next.days, next.days)}</AppText> : null}
        </View>
      )}

      {/* motion: list-stagger (tier 2, static: every row is there at once) */}
      <View style={styles.section}>
        <ListRow icon="ChartNoAxesColumn" {...vi.journeyRows.history} onPress={() => navigation.navigate('DayHistory')} />
        <ListRow icon="Award" {...vi.journeyRows.levels} onPress={() => navigation.navigate('Levels')} />
        <ListRow icon="Ticket" {...vi.journeyRows.tickets} title={restart ? vi.seeTickets : vi.journeyRows.tickets.title} onPress={() => navigation.navigate('Tickets')} />
      </View>
      <AppText style={styles.section}>{vi.journeyFooter}</AppText>
      {restart ? <Button label={vi.restartAction} onPress={() => navigation.navigate('QuestBoard')} style={styles.section} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // `Screen` puts 8 between blocks; a section starts further down.
  section: { marginTop: spacing.section - 8 },
  error: { marginTop: 8 },
  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  // 44 and more: a mark is not pressed, but its box stays as wide as a touch target so the seven fit a 360 dp screen
  mark: { alignItems: 'center', gap: 6, minWidth: 40 },
  // FrostDot sits at the start of its own box: this one is as wide as the other marks, so it lines up with them
  frozen: { width: MARK, height: MARK, alignItems: 'center', justifyContent: 'center' },
  ring: { width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badges: { flexDirection: 'row', justifyContent: 'space-around', gap: 8 },
});
