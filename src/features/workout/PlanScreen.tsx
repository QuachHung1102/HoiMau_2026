import { useIsFocused } from '@react-navigation/native';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import { tabLabel } from '../../shared/i18n/vi/nav';
import * as questsVi from '../../shared/i18n/vi/quests';
import { failureText } from '../../shared/i18n/vi/sync';
import * as today from '../../shared/i18n/vi/today';
import * as vi from '../../shared/i18n/vi/workout';
import { usePendingActions, useWaitingCount } from '../../shared/storage/pendingActions';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { LoadingState } from '../../shared/ui/States';
import { applyPending } from '../dashboard/applyPending';
import { useDay } from '../quests/api';
import { WORKOUT_COMPLETE_PATH, WORKOUT_QUEST } from './api';

// The tab bar owns the bottom edge.
const EDGES = ['top', 'left', 'right'] as const;

function StatusLine({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.status}>
      <Icon name={icon} size={20} />
      <AppText style={styles.fill}>{text}</AppText>
    </View>
  );
}

/** S12, the root of the "Lộ trình" tab: where today stands, and the ways into food, movement and the targets. */
export function PlanScreen({ navigation }: ScreenProps<'Plan'>) {
  const focused = useIsFocused();
  const { userId } = useSession();
  const dayQuery = useDay();
  const pending = usePendingActions(userId);
  const day = dayQuery.data;
  const view = useMemo(() => (day ? applyPending(day, pending) : undefined), [day, pending]);
  const workout = view?.quests.find(quest => quest.code === WORKOUT_QUEST);
  // A session that waits on this device, by the queue's own rule for what is shown as waiting (the one the app-wide row uses):
  // nothing is waiting while requests are simply on their way, also not a record that stands behind one in flight.
  const sessionWaiting = useWaitingCount(userId) > 0 && pending.some(action => action.path === WORKOUT_COMPLETE_PATH);
  const kcal = view ? today.kcalLine(view.caloriesIn, view.calorieWindow) : undefined;
  const dayCode = dayQuery.error instanceof ApiError ? dayQuery.error.code : '';

  // The entries of the tab, in order: a task that adds a destination adds a line here.
  const entries: { icon: IconName; title: string; description: string; onPress: () => void }[] = [
    { icon: 'Utensils', title: vi.planMeal, description: vi.planMealHint, onPress: () => navigation.navigate('MealPlan') },
    { icon: 'Search', title: vi.planWorkout, description: vi.planWorkoutHint, onPress: () => navigation.navigate('WorkoutCatalog') },
    { icon: 'SlidersHorizontal', title: vi.planTargets, description: vi.planTargetsHint, onPress: () => navigation.navigate('Targets') },
  ];

  return (
    <Screen edges={EDGES} title={tabLabel.Plan} subtitle={vi.planSubtitle}>
      {dayQuery.provisional ? (
        <View accessibilityLiveRegion="polite">
          <DisabledReason reason={today.newDayNotSynced} icon="CloudOff" />
        </View>
      ) : null}
      <View style={styles.section}>
        {view && kcal ? (
          <Card tone="soft">
            <AppText variant="title" accessibilityRole="header">
              {vi.planTodayTitle}
            </AppText>
            {/* The state in words and with its own icon, never by colour; "done" only from the server's day. */}
            {workout ? <StatusLine icon={workout.completed ? 'CircleCheck' : 'Dumbbell'} text={workout.completed ? vi.planWorkoutDone : vi.planWorkoutNotStarted} /> : null}
            {sessionWaiting ? <StatusLine icon="Clock" text={vi.planWorkoutWaiting} /> : null}
            <StatusLine icon="Utensils" text={vi.planKcalStatus(view.pending.kcal ? questsVi.withStatus(kcal, common.queued) : kcal)} />
          </Card>
        ) : dayQuery.isError && !dayQuery.isFetching ? (
          // The entries below do not need the day: say that today's numbers are missing and keep the tab usable.
          <InlineError message={`${common.loadFailedTitle}. ${failureText(dayCode)}`} action={{ label: common.retry, onPress: () => dayQuery.refetch() }} />
        ) : (
          <LoadingState blocks={1} active={focused} />
        )}
      </View>
      <View style={styles.section}>
        {entries.map(entry => (
          <ListRow key={entry.title} {...entry} />
        ))}
      </View>
      <AppText variant="secondary" style={styles.footer}>
        {vi.planFooter}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // `Screen` puts 8 between blocks; a section starts further down.
  section: { marginTop: spacing.section - 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footer: { marginTop: spacing.section - 8 },
});
