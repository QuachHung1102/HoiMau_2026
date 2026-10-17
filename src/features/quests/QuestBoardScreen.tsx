import { useIsFocused } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { QuestState } from '../../../domain/contract/core.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import { formatNumber } from '../../shared/i18n/vi/pet';
import * as vi from '../../shared/i18n/vi/quests';
import { failureText } from '../../shared/i18n/vi/sync';
import * as today from '../../shared/i18n/vi/today';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { sizes, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { RewardChip } from '../../shared/ui/Badges';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { applyPending } from '../dashboard/applyPending';
import { useDay, WATER } from './api';
import { STAND_UP, useStandUpMinutes } from './useStandUp';
import { useTick, type TickState } from './useTick';

const title = (quest: QuestState) => vi.boardQuestTitle[quest.titleKey] ?? quest.titleKey;

/** "Đã xong" with a check: the quest's state in words and a shape, never colour alone. It pops in when a quest completes while on screen. */
function CompletedBadge({ animate }: { animate: boolean }) {
  const reduced = useReducedMotion();
  const [pop] = useState(() => new Animated.Value(animate && !reduced ? 0 : 1));
  useEffect(() => {
    if (!animate || reduced) return;
    // motion: quest-complete
    const run = Animated.timing(pop, { toValue: 1, duration: motion.durationsMs.celebration, easing: Easing.bezier(...motion.springs.pop.webApprox), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [animate, reduced, pop]);
  return (
    <Animated.View style={[styles.done, { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
      <Icon name="Check" size={16} />
      <AppText variant="caption" weight="semibold" color="primary">
        {vi.questDone}
      </AppText>
    </Animated.View>
  );
}

type RowProps = {
  icon: IconName;
  title: string;
  /** Lines under the title. */
  lines: ReactNode;
  /** Beside the chevron: the reward, or that the quest is done. */
  trailing: ReactNode;
  /** What a screen reader hears instead of the pieces (they include the state). */
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Below the row, outside its button. */
  below?: ReactNode;
  chevron?: boolean;
};

/** One quest. A real 48 dp row; the button is the whole of it. */
function Row({ icon, title: heading, lines, trailing, label, onPress, disabled = false, below, chevron = true }: RowProps) {
  const palette = useTheme();
  const body = (
    <>
      <Icon name={icon} />
      <View style={styles.fill}>
        <AppText weight="semibold">{heading}</AppText>
        {lines}
      </View>
      {trailing}
      {chevron && onPress ? <Icon name="ChevronRight" color={palette.muted} /> : null}
    </>
  );
  return (
    <View>
      {onPress ? (
        <Touchable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.row}>
          {body}
        </Touchable>
      ) : (
        <View accessible accessibilityLabel={label} style={styles.row}>
          {body}
        </View>
      )}
      {below}
    </View>
  );
}

const Line = ({ children }: { children: string }) => <AppText variant="caption">{children}</AppText>;

/** "Đang chờ gửi": a clock and the words (the record is kept on this device, nothing is granted yet). */
function Waiting() {
  const palette = useTheme();
  return (
    <View style={styles.waiting}>
      <Icon name="Clock" size={16} color={palette.muted} />
      <AppText variant="caption" weight="semibold" color="ink">
        {common.queued}
      </AppText>
    </View>
  );
}

type TickRowProps = {
  icon: IconName;
  quest: QuestState;
  tick: { tick(): Promise<void>; state: TickState };
  count: (count: number, target: number) => string;
  xp: string;
  full: string;
  tapToRecord: string;
  notSaved: (reason: string) => string;
  /** The line the quest adds under the count (the stand-up reminder). */
  extra?: string;
};

/** A DAILY quest that is ticked from here. Record states as everywhere: saving, waiting, refused (rolled back, with a new try). */
function TickRow({ icon, quest, tick, count, xp, full, tapToRecord, notSaved, extra }: TickRowProps) {
  const { state } = tick;
  const shown = state.done + state.queued + state.saving;
  const counted = count(shown, state.target);
  const done = quest.completed;
  // A row that is already complete on arrival does not pop.
  const arrivedDone = useRef(done).current;
  const shownCount = state.saving ? vi.withStatus(counted, vi.saving) : counted;
  const label = [title(quest), shownCount, state.queued ? vi.waterWaiting : undefined, done ? vi.questDone : state.full ? full : `${xp}. ${tapToRecord}`].filter(Boolean).join('. ');
  return (
    <Row
      icon={icon}
      title={title(quest)}
      label={label}
      disabled={state.full}
      onPress={tick.tick}
      chevron={false}
      lines={
        <>
          <Line>{shownCount}</Line>
          {state.queued ? <Waiting /> : null}
          {extra && !state.full ? <Line>{extra}</Line> : null}
          {state.full && !done ? <Line>{full}</Line> : null}
        </>
      }
      trailing={
        done ? (
          <CompletedBadge animate={!arrivedDone} />
        ) : (
          // the chip aligns itself to the top of a row; the wrapper is what the row centres
          <View>
            <RewardChip text={xp} />
          </View>
        )
      }
      below={state.failed ? <InlineError message={notSaved(failureText(state.failed))} action={state.full ? undefined : { label: common.retry, onPress: tick.tick }} style={styles.failure} /> : undefined}
    />
  );
}

const STORY: Partial<Record<string, { icon: IconName; to: 'WorkoutCatalog' | 'MealPlan' }>> = {
  WORKOUT_MAIN: { icon: 'Dumbbell', to: 'WorkoutCatalog' },
  NUTRITION_TARGET: { icon: 'Utensils', to: 'MealPlan' },
};

/** S10 (S11 on the way): the quests of the day, the two the streak depends on apart from the small habits. */
export function QuestBoardScreen({ navigation }: ScreenProps<'QuestBoard'>) {
  const focused = useIsFocused();
  const { userId } = useSession();
  const dayQuery = useDay();
  const pending = usePendingActions(userId);
  // One recorder per quest on this screen; each shows its own feedback (the S11 snackbar with "Hoàn tác").
  const water = useTick(WATER);
  const standUp = useTick(STAND_UP);
  const minutes = useStandUpMinutes();
  const day = dayQuery.data;
  const view = useMemo(() => (day ? applyPending(day, pending) : undefined), [day, pending]);
  const back = navigation.canGoBack() ? navigation.goBack : undefined;

  if (!view) {
    const code = dayQuery.error instanceof ApiError ? dayQuery.error.code : '';
    return (
      <Screen title={vi.boardTitle} subtitle={vi.boardSubtitle} onBack={back}>
        {dayQuery.isError && !dayQuery.isFetching ? <ErrorState message={failureText(code)} onRetry={() => dayQuery.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }

  const story = view.quests.filter(quest => quest.category === 'STORY');
  const daily = view.quests.filter(quest => quest.category === 'DAILY');
  const hidden = view.quests.find(quest => quest.category === 'HIDDEN');
  const marked = view.bedtimeMarkedAt !== null;
  const window = view.calorieWindow;
  return (
    <Screen title={vi.boardTitle} subtitle={vi.boardSubtitle} onBack={back}>
      {dayQuery.provisional ? (
        <View accessibilityLiveRegion="polite">
          <DisabledReason reason={today.newDayNotSynced} icon="CloudOff" />
        </View>
      ) : null}

      {/* motion: list-stagger (tier 2, static: every row is there at once) */}
      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.storySection}
        </AppText>
        {story.map(quest => {
          const link = STORY[quest.code];
          const kcal = quest.code === 'NUTRITION_TARGET' ? vi.boardKcal(formatNumber(view.caloriesIn), formatNumber(window.target), formatNumber(window.min), formatNumber(window.max)) : undefined;
          const description = kcal ?? (quest.completed ? today.workoutDone : today.workoutNotStarted);
          const waiting = kcal !== undefined && view.pending.kcal > 0;
          return (
            <Row
              key={quest.code}
              icon={quest.completed ? 'CircleCheck' : 'Circle'}
              title={title(quest)}
              label={[title(quest), description, waiting ? common.queued : undefined, quest.completed ? vi.questDone : vi.reward(quest.xpReward)].filter(Boolean).join('. ')}
              onPress={link ? () => navigation.navigate(link.to) : undefined}
              lines={
                <>
                  <Line>{description}</Line>
                  {waiting ? <Waiting /> : null}
                </>
              }
              trailing={
                quest.completed ? (
                  <CompletedBadge animate={false} />
                ) : (
                  <View>
                    <RewardChip text={vi.reward(quest.xpReward)} />
                  </View>
                )
              }
            />
          );
        })}
      </View>

      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.habitsSection}
        </AppText>
        {daily.map(quest =>
          quest.code === WATER ? (
            <TickRow
              key={quest.code}
              icon="Droplets"
              quest={quest}
              tick={water}
              count={vi.waterCount}
              xp={vi.perPart(quest.xpReward)}
              full={vi.waterFull(water.state.target)}
              tapToRecord={vi.tapToRecord}
              notSaved={vi.waterNotSaved}
            />
          ) : quest.code === STAND_UP ? (
            <TickRow
              key={quest.code}
              icon="PersonStanding"
              quest={quest}
              tick={standUp}
              count={vi.standUpCount}
              xp={vi.perTime(quest.xpReward)}
              full={vi.standUpFull(standUp.state.target)}
              tapToRecord={vi.tapToRecordTime}
              notSaved={vi.standUpNotSaved}
              extra={minutes === null ? undefined : vi.nextReminder(minutes)}
            />
          ) : null,
        )}
        {hidden ? (
          // motion: hidden-quest-reveal (tier 2, static: the row simply shows the quest's name once it is open)
          hidden.locked ? (
            <Row
              icon="Lock"
              title={vi.hiddenLockedTitle}
              label={`${vi.hiddenLockedTitle}. ${vi.hiddenLockedHint}`}
              lines={<Line>{vi.hiddenLockedHint}</Line>}
              trailing={null}
            />
          ) : (
            <Row
              icon="Moon"
              title={title(hidden)}
              label={[title(hidden), hidden.completed ? vi.questDone : marked ? today.endOfDayMarked : vi.reward(hidden.xpReward), view.pending.bedtime ? common.queued : undefined].filter(Boolean).join('. ')}
              onPress={() => navigation.navigate('EndOfDay')}
              lines={
                <>
                  {marked ? <Line>{today.endOfDayMarked}</Line> : null}
                  {view.pending.bedtime ? <Waiting /> : null}
                </>
              }
              trailing={
                hidden.completed ? (
                  <CompletedBadge animate={false} />
                ) : marked ? null : (
                  <View>
                    <RewardChip text={vi.reward(hidden.xpReward)} />
                  </View>
                )
              }
            />
          )
        ) : null}
      </View>

      <AppText variant="secondary" style={styles.footer}>
        {vi.boardFooter}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: 2 },
  section: { gap: 4, marginTop: spacing.section - 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: sizes.minTouch, paddingVertical: 8 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Tall enough for the 48 dp target of "Thử lại" to stay inside the row.
  failure: { minHeight: sizes.minTouch },
  footer: { marginTop: spacing.section - 8 },
});
