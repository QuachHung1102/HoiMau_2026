import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { DayDetail } from '../../../domain/contract/core.ts';
import { addDays, daysBetween, localParts, weekStartOf } from '../../../domain/logicalDate.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { boardQuestTitle } from '../../shared/i18n/vi/quests';
import * as vi from '../../shared/i18n/vi/progression';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { sizes, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { DisabledReason } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { useMe } from '../auth/api';
import { useDay } from '../quests/api';
import { useDayDetail } from './api';

/** The server refuses a history range of more than 92 dates; the screen goes no further back than that. */
export const MAX_DAYS_BACK = 92;

type Action = DayDetail['actions'][number];

/** "07:45" in the person's own zone; empty when the zone is unknown to this engine. */
function timeOf(at: string, timeZone: string | undefined) {
  if (!timeZone) return '';
  try {
    const { hour, minute } = localParts(Date.parse(at), timeZone);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/** What one recorded action reads as: its title, and its time and value. Amounts are stated, never judged. */
function describe(action: Action, timeZone: string | undefined): { icon: IconName; title: string; description: string; status?: string } {
  const time = timeOf(action.at, timeZone);
  switch (action.kind) {
    case 'TICK':
      return {
        icon: action.label === 'WATER_8' ? 'Droplets' : 'Check',
        title: (action.label && boardQuestTitle[action.label]) || vi.tickFallback,
        description: time,
        status: action.undone ? vi.undone : undefined,
      };
    case 'NUTRITION':
      return {
        icon: 'Utensils',
        title: action.label ?? (action.mealSlot ? vi.slotName[action.mealSlot] : vi.nutritionFallback),
        description: vi.joined(time, action.label && action.mealSlot ? vi.slotName[action.mealSlot] : null, action.value === null ? null : vi.kcal(action.value)),
      };
    case 'WORKOUT':
      // `value` is the seconds spent; a session of a few seconds still reads as a minute
      return {
        icon: 'Dumbbell',
        title: action.label ?? vi.workoutFallback,
        description: vi.joined(time, action.value === null ? null : vi.minutes(Math.max(1, Math.round(action.value / 60)))),
      };
    case 'BEDTIME':
      return { icon: 'Moon', title: vi.bedtimeAction, description: time };
  }
}

/** "2026-10-15" -> "15/10/2026", from the label itself. */
const fullDate = (date: DateLabel) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const weekdayOf = (date: DateLabel) => vi.weekdayLong[daysBetween(weekStartOf(date), date)];

/** S51: one logical day at a time, from the server's today back at most 92 days: what was recorded, and when. */
export function DayHistoryScreen({ navigation, route }: ScreenProps<'DayHistory'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const dayQuery = useDay();
  const timeZone = useMe().data?.user.timezone;
  const today = dayQuery.data?.logicalDate;
  const [chosen, setChosen] = useState<DateLabel | undefined>(route.params?.date);
  const oldest = today && addDays(today, -MAX_DAYS_BACK);
  // Never past the server's today and never further back than the limit, whatever was asked for.
  const date = today && oldest ? (chosen === undefined || chosen > today ? today : chosen < oldest ? oldest : chosen) : undefined;
  const detail = useDayDetail(date);

  const header = { title: vi.historyTitle, subtitle: vi.historySubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!today || !oldest || !date) {
    const code = dayQuery.error instanceof ApiError ? dayQuery.error.code : '';
    return (
      <Screen {...header}>
        <View style={styles.section}>
          {dayQuery.isError && !dayQuery.isFetching ? <ErrorState message={failureText(code)} onRetry={() => dayQuery.refetch()} /> : <LoadingState active={focused} />}
        </View>
      </Screen>
    );
  }

  const atOldest = date <= oldest;
  const atNewest = date >= today;
  const name = date === today ? vi.todayName : vi.dayName(weekdayOf(date), fullDate(date));
  const step = (by: -1 | 1) => setChosen(addDays(date, by));
  const code = detail.error instanceof ApiError ? detail.error.code : '';
  const { summary, actions } = detail.data ?? {};
  return (
    <Screen {...header}>
      <View style={[styles.section, styles.nav]}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={vi.previousDay}
          accessibilityState={{ disabled: atOldest }}
          disabled={atOldest}
          onPress={() => step(-1)}
          style={styles.step}
        >
          <Icon name="ChevronLeft" color={atOldest ? palette.muted : palette.primary} />
        </Touchable>
        <View style={styles.fill} accessibilityLiveRegion="polite">
          <AppText variant="title" accessibilityRole="header" style={styles.centered}>
            {name}
          </AppText>
        </View>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={vi.nextDay}
          accessibilityState={{ disabled: atNewest }}
          disabled={atNewest}
          onPress={() => step(1)}
          style={styles.step}
        >
          <Icon name="ChevronRight" color={atNewest ? palette.muted : palette.primary} />
        </Touchable>
      </View>
      {atOldest ? <DisabledReason reason={vi.oldestDay(MAX_DAYS_BACK)} /> : null}
      {atNewest ? <DisabledReason reason={vi.newestDay} /> : null}

      {detail.isError && !detail.data && !detail.isFetching ? (
        <View style={styles.section}>
          <ErrorState message={failureText(code)} onRetry={() => detail.refetch()} />
        </View>
      ) : !summary || !actions ? (
        <View style={styles.section}>
          <LoadingState active={focused} />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Card tone="soft">
              <AppText variant="title">{vi.outcomeText[summary.outcome]}</AppText>
              <AppText>{vi.storyLine(summary.storyDone, summary.storyTotal)}</AppText>
              <AppText>{vi.waterLine(summary.waterMl)}</AppText>
              <AppText>{vi.kcalLine(summary.caloriesIn)}</AppText>
              <AppText>{vi.workoutLine(Math.round(summary.workoutMinutes))}</AppText>
            </Card>
          </View>
          <View style={styles.section}>
            {actions.length === 0 ? (
              <EmptyState title={vi.emptyTitle} body={vi.emptyBody} />
            ) : (
              <>
                <AppText variant="title" accessibilityRole="header">
                  {vi.actionsTitle}
                </AppText>
                {/* motion: list-stagger (tier 2, static: every row is there at once) */}
                {actions.map(action => (
                  <ListRow key={`${action.kind}:${action.id}:${action.at}`} {...describe(action, timeZone)} />
                ))}
              </>
            )}
          </View>
        </>
      )}
      <AppText variant="secondary" style={styles.section}>
        {vi.historyFooter}
      </AppText>
      <Button variant="secondary" label={vi.backToToday} onPress={() => navigation.navigate('Today')} style={styles.section} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // `Screen` puts 8 between blocks; a section starts further down.
  section: { marginTop: spacing.section - 8 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: sizes.minTouch, height: sizes.minTouch, alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
});
