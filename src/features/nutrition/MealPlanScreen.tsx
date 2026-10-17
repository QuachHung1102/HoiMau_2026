import { useIsFocused } from '@react-navigation/native';
import { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { MealPlanState } from '../../../domain/contract/content.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/nutrition';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { BarTrack } from '../../shared/ui/LevelStrip';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { loadText, NUTRITION_LOG_PATH, useMealPlan } from './api';
import { mealImage, planHeaderImage, slotIcon } from './mealImages';

type Slot = MealPlanState['slots'][number];

function SlotRow({ slot, waiting, onPress }: { slot: Slot; waiting: boolean; onPress: () => void }) {
  const palette = useTheme();
  const { meal } = slot;
  const status = slot.logged ? 'logged' : waiting ? 'waiting' : 'open';
  const name = vi.slotName[slot.mealSlot];
  const line = meal ? vi.slotLine(meal.name, meal.kcal, status) : vi.slotNoMeal;
  const picture = meal ? mealImage(meal.imageKey) : undefined;
  return (
    <Touchable accessibilityRole="button" accessibilityLabel={[name, line, slot.macroWarning ? vi.macroWarning : undefined].filter(Boolean).join('. ')} onPress={onPress} style={styles.row}>
      {picture ? (
        <Image source={picture} style={styles.thumb} accessible={false} />
      ) : (
        <View style={[styles.thumb, styles.iconBox, { backgroundColor: palette.soft }]}>
          <Icon name={slotIcon[slot.mealSlot]} />
        </View>
      )}
      <View style={styles.text}>
        <AppText weight="semibold">{name}</AppText>
        <AppText variant="caption">{line}</AppText>
        {slot.macroWarning ? (
          <View style={styles.warning}>
            <Icon name="Info" size={14} color={palette.muted} />
            <AppText variant="caption" style={styles.text}>
              {vi.macroWarning}
            </AppText>
          </View>
        ) : null}
      </View>
      {/* The words in the line above say it; the mark is an extra, never the only sign. */}
      {slot.logged ? <Icon name="CircleCheck" /> : waiting ? <Icon name="Clock" color={palette.muted} /> : null}
      <Icon name="ChevronRight" color={palette.muted} />
    </Touchable>
  );
}

/** S13: today's four meals, how much has been eaten against the band that completes the quest, and the way to log something else. */
export function MealPlanScreen({ navigation }: ScreenProps<'MealPlan'>) {
  const focused = useIsFocused();
  const { userId } = useSession();
  const query = useMealPlan();
  const pending = usePendingActions(userId);
  const plan = query.data;
  // A planned meal sent from this device and not yet confirmed by the server: "đang chờ gửi", no total, no reward.
  const waiting = useMemo(() => new Set(pending.filter(action => action.path === NUTRITION_LOG_PATH).map(action => action.body.mealSlot)), [pending]);

  const target = plan?.calorieWindow.target ?? 0;
  const ratio = plan && target > 0 ? Math.min(1, Math.max(0, plan.caloriesIn / target)) : 0;
  return (
    <Screen onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <Image source={planHeaderImage} style={styles.header} accessible={false} resizeMode="cover" />
      <AppText variant="headline" accessibilityRole="header">
        {vi.planTitle}
      </AppText>
      <AppText variant="secondary">{vi.planSubtitle}</AppText>
      {plan ? (
        <>
          <Card tone="soft">
            <AppText variant="title">{vi.planCardTitle}</AppText>
            <AppText variant="secondary">{vi.planCardBody}</AppText>
            {/* motion: progress-fill (BarTrack) */}
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${vi.eaten(plan.caloriesIn, target)}. ${vi.windowLine(plan.calorieWindow.min, plan.calorieWindow.max)}`}
              accessibilityValue={{ min: 0, max: target, now: Math.min(Math.max(plan.caloriesIn, 0), target) }}
              style={styles.progress}
            >
              <AppText weight="bold">{vi.eaten(plan.caloriesIn, target)}</AppText>
              <BarTrack ratio={ratio} track="white" />
              <AppText variant="caption">{vi.windowLine(plan.calorieWindow.min, plan.calorieWindow.max)}</AppText>
            </View>
          </Card>
          <View style={styles.rows}>
            {plan.slots.map(slot => (
              <SlotRow key={slot.mealSlot} slot={slot} waiting={waiting.has(slot.mealSlot)} onPress={() => navigation.navigate('MealDetail', { mealSlot: slot.mealSlot })} />
            ))}
          </View>
        </>
      ) : query.isError && !query.isFetching ? (
        <ErrorState message={loadText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} />
      ) : (
        <LoadingState active={focused} />
      )}
      {/* Always there: a meal outside the menu can be recorded (and queued) whether or not the plan could be read. */}
      <Button label={vi.saveAction} onPress={() => navigation.navigate('ManualKcal')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { width: '100%', aspectRatio: 692 / 320, borderRadius: radius.surface },
  progress: { gap: 6 },
  rows: { gap: 4, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 72, paddingVertical: 8 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  warning: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
