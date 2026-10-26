import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/nutrition';
import { failureText } from '../../shared/i18n/vi/sync';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { loadText, NUTRITION_LOG_PATH, tagWords, useLogMeal, useMealPlan } from './api';
import { mealImage, slotIcon } from './mealImages';

// Two lines (the total, and the reward when there is one) take longer to read than the default 4 s.
const CONFIRMATION_MS = 7000;
const CONFIRMATION_SCREEN_READER_MS = 9000;
const SWAP_SHIFT = 16;
const SWAP_DELAY_MS = 120;

/**
 * motion: meal-swap. The new meal slides in (16 dp from the right, fading in after 120 ms) when this screen shows a
 * different meal than the last time it was in front: the swap happens on the screen above, so the change is seen on
 * the return. Reduced motion: the new meal is simply there. ponytail: the outgoing track (the old meal sliding out) is
 * not drawn, the old meal is already gone when this screen is shown again.
 */
function useSwapIn(mealId: string | undefined, focused: boolean) {
  const reduced = useReducedMotion();
  const seen = useRef<string | undefined>(undefined);
  const [enter] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!focused) return;
    const first = seen.current === undefined;
    const changed = seen.current !== mealId;
    if (mealId !== undefined) seen.current = mealId;
    if (first || !changed || reduced || mealId === undefined) return;
    enter.setValue(0);
    const run = Animated.timing(enter, { toValue: 1, duration: motion.durationsMs.transition, delay: SWAP_DELAY_MS, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true });
    run.start();
    return () => {
      run.stop();
      enter.setValue(1);
    };
  }, [mealId, focused, reduced, enter]);
  return {
    // Never fully transparent: a screen reader may skip a view that is.
    opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] }),
    transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [SWAP_SHIFT, 0] }) }],
  };
}

/** S14: one planned meal with its numbers, "Ghi nhận món này" (no undo, said before saving) and the way to a swap. */
export function MealDetailScreen({ route, navigation }: ScreenProps<'MealDetail'>) {
  const { mealSlot } = route.params;
  const focused = useIsFocused();
  const palette = useTheme();
  const snackbar = useSnackbar();
  const { userId } = useSession();
  const query = useMealPlan();
  const pending = usePendingActions(userId);
  const { log, saving } = useLogMeal();
  const [failed, setFailed] = useState<string | null>(null);
  const slot = query.data?.slots.find(item => item.mealSlot === mealSlot);
  const meal = slot?.meal ?? undefined;
  const swapIn = useSwapIn(meal?.id, focused);
  // While this screen's own request is out the queue lists it too (as unsent): that is "saving", not waiting.
  const waiting = !saving && pending.some(action => action.path === NUTRITION_LOG_PATH && action.body.mealSlot === mealSlot);
  const header = { onBack: navigation.canGoBack() ? navigation.goBack : undefined };

  const submit = async () => {
    setFailed(null);
    const outcome = await log(mealSlot);
    if (!outcome) return;
    if (outcome.state === 'confirmed') {
      // The total and the reward are the server's. No Undo: a logged meal cannot be removed.
      snackbar.show({
        message: [vi.logged(outcome.total), outcome.questDone ? vi.questReward(outcome.xp) : undefined].filter(Boolean).join('\n'),
        durationMs: CONFIRMATION_MS,
        screenReaderDurationMs: CONFIRMATION_SCREEN_READER_MS,
      });
    } else if (outcome.state === 'failed') {
      setFailed(outcome.code);
      // Logged from another place meanwhile: the plan says so on the next read.
      if (outcome.code === 'MEAL_ALREADY_LOGGED') query.refetch();
    }
  };

  if (!slot) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? <ErrorState message={loadText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }
  if (!meal) {
    // Every meal of the slot is excluded: nothing to show, but a way on.
    return (
      <Screen {...header} title={vi.slotName[mealSlot]}>
        <EmptyState
          title={vi.noMealTitle}
          body={vi.noMealBody}
          primary={{ label: vi.logOutside, onPress: () => navigation.navigate('ManualKcal') }}
          secondary={{ label: vi.seeSuggestions, onPress: () => navigation.navigate('MealSwap', { mealSlot }) }}
        />
      </Screen>
    );
  }

  const picture = mealImage(meal.imageKey);
  const words = tagWords(meal.tags);
  const alreadyLogged = failed === 'MEAL_ALREADY_LOGGED';
  return (
    <Screen {...header}>
      <Animated.View style={[styles.body, swapIn]}>
        <AppText variant="headline" accessibilityRole="header">
          {meal.name}
        </AppText>
        <AppText variant="secondary">{vi.detailKicker(mealSlot, slot.logged)}</AppText>
        {picture ? (
          <Image testID="meal-picture" source={picture} style={styles.picture} accessible={false} resizeMode="cover" />
        ) : (
          <View testID="meal-icon" style={[styles.picture, styles.iconBox, { backgroundColor: palette.soft }]}>
            <Icon name={slotIcon[mealSlot]} size={48} />
          </View>
        )}
        <AppText variant="secondary">{meal.description}</AppText>
        <Card>
          <AppText variant="caption" weight="semibold">
            {vi.nutritionHeading}
          </AppText>
          <AppText variant="headline">{vi.kcalValue(meal.kcal)}</AppText>
          <View style={styles.chips}>
            {[vi.protein(meal.proteinG), vi.carbs(meal.carbsG), vi.fat(meal.fatG)].map(text => (
              <View key={text} style={[styles.chip, { backgroundColor: palette.soft }]}>
                <AppText variant="caption" weight="semibold" color="primary">
                  {text}
                </AppText>
              </View>
            ))}
          </View>
          <AppText variant="caption">{`${meal.portionText} ${vi.estimateNote}`}</AppText>
        </Card>
        <Card accessible accessibilityLabel={[vi.ingredientsTitle, vi.ingredientsHint, words.join(', '), vi.ingredientsCaveat].filter(Boolean).join('. ')}>
          <View style={styles.rowTop}>
            <Icon name="Leaf" />
            <View style={styles.text}>
              <AppText weight="semibold">{vi.ingredientsTitle}</AppText>
              <AppText variant="caption">{vi.ingredientsHint}</AppText>
            </View>
          </View>
          {words.length > 0 ? <AppText>{words.join(' · ')}</AppText> : null}
          <AppText variant="caption">{vi.ingredientsCaveat}</AppText>
        </Card>
      </Animated.View>

      {slot.logged ? (
        <Card tone="soft">
          <Icon name="CircleCheck" />
          <View accessibilityLiveRegion="polite" style={styles.text}>
            <AppText variant="title" accessibilityRole="header">
              {vi.loggedTitle}
            </AppText>
            <AppText variant="secondary">{vi.loggedBody}</AppText>
          </View>
        </Card>
      ) : waiting ? (
        // Kept on this device and not on the server yet: the waiting mark and its words, no total, no reward.
        <Card tone="soft">
          <Icon name="Clock" />
          <View accessibilityLiveRegion="polite" style={styles.text}>
            <AppText variant="title" accessibilityRole="header">
              {vi.waitingTitle}
            </AppText>
            <AppText variant="secondary">{vi.waitingBody}</AppText>
          </View>
        </Card>
      ) : (
        <>
          <View style={styles.cannotRemove}>
            <Icon name="Info" size={16} color={palette.muted} />
            <AppText variant="caption" style={styles.text}>
              {vi.mealCannotRemove}
            </AppText>
          </View>
          <Button label={vi.logMeal} loading={saving} onPress={submit} />
          <Button label={vi.swapOther} variant="secondary" onPress={() => navigation.navigate('MealSwap', { mealSlot })} />
        </>
      )}
      {failed ? (
        alreadyLogged ? (
          <DisabledReason reason={failureText(failed)} />
        ) : (
          <InlineError message={vi.notSaved(failureText(failed))} action={{ label: common.retry, onPress: submit }} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  picture: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.surface },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  text: { flex: 1, gap: 2 },
  cannotRemove: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
