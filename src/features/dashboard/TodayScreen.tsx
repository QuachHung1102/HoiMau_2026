import { useIsFocused } from '@react-navigation/native';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { QuestState } from '../../../domain/contract/core.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import { tabLabel } from '../../shared/i18n/vi/nav';
import * as questsVi from '../../shared/i18n/vi/quests';
import { failureText } from '../../shared/i18n/vi/sync';
import * as vi from '../../shared/i18n/vi/today';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { sizes, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { CoinChip, RewardChip, StreakChip } from '../../shared/ui/Badges';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/Card';
import { DisabledReason } from '../../shared/ui/Notices';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { LevelStrip } from '../../shared/ui/LevelStrip';
import { Screen } from '../../shared/ui/Screen';
import { StatBar } from '../../shared/ui/StatBar';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { useMe } from '../auth/api';
import { useDay, useSettings, WATER } from '../quests/api';
import { useStandUp } from '../quests/useStandUp';
import { useTick } from '../quests/useTick';
import { WaterTracker } from '../quests/WaterTracker';
import { applyPending } from './applyPending';
import { CompanionCard } from './CompanionCard';

// The tab bar owns the bottom edge.
const EDGES = ['top', 'left', 'right'] as const;
const STATS = ['hp', 'en', 'str', 'spd'] as const;

type StoryProps = { icon: IconName; quest: QuestState; description: string; onPress: () => void };

/** One of the two tasks the streak depends on: what it gives, or that it is done (in words, not by colour). */
function StoryRow({ icon, quest, description, onPress }: StoryProps) {
  const palette = useTheme();
  const title = questsVi.questTitle[quest.titleKey] ?? quest.titleKey;
  const outcome = quest.completed ? questsVi.questDone : questsVi.reward(quest.xpReward);
  return (
    <Touchable accessibilityRole="button" accessibilityLabel={`${title}. ${description}. ${outcome}`} onPress={onPress} style={styles.story}>
      <Icon name={icon} />
      <View style={styles.fill}>
        <AppText weight="semibold">{title}</AppText>
        <AppText variant="caption">{description}</AppText>
      </View>
      {quest.completed ? (
        <View style={styles.done}>
          <Icon name="Check" size={16} />
          <AppText variant="caption" weight="semibold" color="primary">
            {questsVi.questDone}
          </AppText>
        </View>
      ) : (
        // the chip aligns itself to the top of a row; the wrapper is what the row centres
        <View>
          <RewardChip text={questsVi.reward(quest.xpReward)} />
        </View>
      )}
      <Icon name="ChevronRight" color={palette.muted} />
    </Touchable>
  );
}

/** S09, the home tab: the day at a glance and water in one tap (S57 just recorded, S58 not saved). */
export function TodayScreen({ navigation }: ScreenProps<'Today'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const { userId } = useSession();
  const me = useMe().data;
  const dayQuery = useDay();
  const hideStreakSetting = useSettings().data?.hideStreak ?? false;
  const pending = usePendingActions(userId);
  // The one recorder of the water quest on this screen: the tracker and the card's button share it.
  const water = useTick(WATER);
  // The stand-up reminder lives as long as this tab root does (the signed-in app); it shows nothing itself.
  useStandUp();
  const day = dayQuery.data;
  // On a provisional day the streak is not known (yesterday's close may have changed it): not shown as known.
  const hideStreak = hideStreakSetting || dayQuery.provisional;
  // What this device still has to send is laid over the server's day, so the screen is true offline as well.
  const view = useMemo(() => (day ? applyPending(day, pending) : undefined), [day, pending]);

  const unread = (view?.unreadCount ?? 0) > 0;
  const header = (
    <>
      <View style={styles.header}>
        <AppText variant="headline" accessibilityRole="header" style={styles.fill}>
          {tabLabel.Today}
        </AppText>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={unread ? vi.inboxUnread : vi.inbox}
          onPress={() => navigation.navigate('Inbox')}
          style={styles.bell}
        >
          <Icon name="Bell" />
          {/* motion: unread-dot (tier 2, static: the dot is simply there, and the label says there is new mail) */}
          {unread ? <View style={[styles.unread, { backgroundColor: palette.primary, borderColor: palette.bg }]} /> : null}
        </Touchable>
      </View>
      {me ? <AppText variant="secondary">{vi.greeting(me.user.displayName)}</AppText> : null}
      {dayQuery.provisional ? (
        <View accessibilityLiveRegion="polite">
          <DisabledReason reason={vi.newDayNotSynced} icon="CloudOff" />
        </View>
      ) : null}
    </>
  );

  if (!view || !me) {
    const code = dayQuery.error instanceof ApiError ? dayQuery.error.code : '';
    return (
      <Screen edges={EDGES}>
        {header}
        <View style={styles.section}>
          {/* First load only: a refresh keeps what is on screen. */}
          {/* The error state only when nothing is on its way: a read that failed earlier says nothing about the one
              that is out now (the re-read at the close of the day, or the retry of this very state). */}
          {dayQuery.isError && !dayQuery.isFetching ? (
            <ErrorState message={failureText(code)} onRetry={() => dayQuery.refetch()} />
          ) : (
            <LoadingState active={focused} />
          )}
        </View>
      </Screen>
    );
  }

  const { progression, stats, pet } = me;
  const quest = (code: string) => view.quests.find(item => item.code === code);
  const workout = quest('WORKOUT_MAIN');
  const nutrition = quest('NUTRITION_TARGET');
  // A day without the water quest has nothing to record here.
  const hasWater = water.state.target > 0;
  const waterFull = water.state.full ? questsVi.waterFull(water.state.target) : undefined;
  const kcal = vi.kcalLine(view.caloriesIn, view.calorieWindow);
  return (
    <Screen edges={EDGES}>
      {header}

      {progression ? (
        <View style={styles.level}>
          <View style={styles.fill}>
            <LevelStrip
              level={progression.level}
              title={vi.levelTitleText[progression.titleKey]}
              xpIntoLevel={progression.xpIntoLevel}
              xpForNextLevel={progression.xpForNextLevel}
              onPress={() => navigation.navigate('Levels')}
            />
          </View>
          {/* motion: coin-fly (tier 2, static: the chip shows the server's new balance at once) */}
          <CoinChip coin={progression.coin} />
        </View>
      ) : null}

      {pet ? (
        <View style={styles.section}>
          <CompanionCard pet={pet} cheer={water.state.reward?.n ?? null} onRecord={hasWater ? water.tick : undefined} disabledReason={waterFull} />
        </View>
      ) : null}

      {hasWater ? (
        <View style={styles.section}>
          <WaterTracker state={water.state} onTick={water.tick} />
        </View>
      ) : null}

      {stats ? (
        <View style={styles.section}>
          <AppText variant="title" accessibilityRole="header">
            {vi.statsTitle}
          </AppText>
          {STATS.map(kind => (
            <StatBar key={kind} kind={kind} value={stats[kind]} />
          ))}
          <Touchable accessibilityRole="link" onPress={() => navigation.navigate('StatsExplainer')} style={styles.link}>
            <Icon name="Info" size={20} />
            <AppText weight="semibold" color="primary">
              {vi.statsLink}
            </AppText>
          </Touchable>
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.storyTitle}
        </AppText>
        {workout ? (
          <StoryRow
            icon="Dumbbell"
            quest={workout}
            description={workout.completed ? vi.workoutDone : vi.workoutNotStarted}
            onPress={() => navigation.navigate('WorkoutCatalog')}
          />
        ) : null}
        {nutrition ? (
          <StoryRow
            icon="Utensils"
            quest={nutrition}
            description={view.pending.kcal ? questsVi.withStatus(kcal, common.queued) : kcal}
            onPress={() => navigation.navigate('ManualKcal')}
          />
        ) : null}
        <View style={styles.streak}>
          {hideStreak ? null : <StreakChip days={view.streak.current} />}
          <Touchable accessibilityRole="link" onPress={() => navigation.navigate('Journey')} style={[styles.link, styles.besideChip]}>
            <AppText weight="semibold" color="primary">
              {vi.seeJourney}
            </AppText>
          </Touchable>
        </View>
        <ListRow
          icon="Moon"
          title={vi.endOfDay}
          description={view.bedtimeMarkedAt ? vi.endOfDayMarked : vi.endOfDayHint}
          status={view.pending.bedtime ? common.queued : undefined}
          onPress={() => navigation.navigate('EndOfDay')}
        />
        <Button variant="secondary" label={vi.allQuests} onPress={() => navigation.navigate('QuestBoard')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bell: { width: sizes.minTouch, height: sizes.minTouch, alignItems: 'center', justifyContent: 'center' },
  unread: { position: 'absolute', top: 8, right: 8, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  level: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  // `Screen` puts 8 between blocks; a section starts further down.
  section: { gap: 12, marginTop: spacing.section - 8 },
  story: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: sizes.minTouch, paddingVertical: 8 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  streak: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginVertical: 8 },
  // The 48 dp row of the link reaches 8 above and below the 32 dp chip, so both sit on one line.
  besideChip: { marginVertical: -8 },
  // A real 48 dp row for a text link.
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: sizes.minTouch },
});
