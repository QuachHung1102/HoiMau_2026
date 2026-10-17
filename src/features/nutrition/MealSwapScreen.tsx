import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { INGREDIENT_TAGS, type IngredientTag } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/nutrition';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { Checkbox, RadioRow } from '../../shared/ui/Toggles';
import { Touchable } from '../../shared/ui/Touchable';
import { useSettings } from '../quests/api';
import { loadText, mealPlanKey, swapCandidatesKey, tagWords, useMealPlan, useSaveExcludedTags, useSwapCandidates, useSwapMeal } from './api';

/** The multi-select of the eight ingredient tags. Mounted only while open, so it always starts from what is saved. */
function ExcludeSheet({ saved, onClose }: { saved: readonly IngredientTag[]; onClose: () => void }) {
  const [picked, setPicked] = useState<readonly IngredientTag[]>(saved);
  const [failed, setFailed] = useState<string | null>(null);
  const { save, saving } = useSaveExcludedTags();
  const submit = async () => {
    setFailed(null);
    const outcome = await save(picked);
    if (outcome?.state === 'done') onClose();
    else if (outcome?.state === 'failed') setFailed(outcome.code);
  };
  return (
    <BottomSheet title={vi.excludeSheetTitle} onDismiss={onClose}>
      {INGREDIENT_TAGS.map(tag => (
        <Checkbox
          key={tag}
          label={vi.tagLabel[tag]}
          checked={picked.includes(tag)}
          onChange={checked => {
            setFailed(null);
            setPicked(now => (checked ? INGREDIENT_TAGS.filter(item => item === tag || now.includes(item)) : now.filter(item => item !== tag)));
          }}
        />
      ))}
      <AppText variant="caption">{vi.excludeNote}</AppText>
      {failed ? <InlineError message={vi.excludeNotSaved(failureText(failed))} action={{ label: common.retry, onPress: submit }} /> : null}
      <Button label={vi.excludeSave} loading={saving} onPress={submit} />
    </BottomSheet>
  );
}

/** S15 and S59: choose one of up to three suggestions for a slot; with no swap left, say so without blame. */
export function MealSwapScreen({ route, navigation }: ScreenProps<'MealSwap'>) {
  const { mealSlot } = route.params;
  const focused = useIsFocused();
  const palette = useTheme();
  const queryClient = useQueryClient();
  const candidates = useSwapCandidates(mealSlot);
  const planQuery = useMealPlan();
  const settings = useSettings();
  const { swap, swapping } = useSwapMeal();
  const [selected, setSelected] = useState<string | null>(null);
  // `info`: something changed under the person's hands, nobody's error; `error`: the swap did not happen.
  const [notice, setNotice] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [sheet, setSheet] = useState(false);

  const slot = planQuery.data?.slots.find(item => item.mealSlot === mealSlot);
  const data = candidates.data;
  const excluded = settings.data?.excludedMealTags ?? [];
  // A choice that is no longer on the list (the list was read again) is no choice.
  const chosen = data?.candidates.find(item => item.id === selected);
  const header = { title: vi.swapTitle(mealSlot), subtitle: vi.swapSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: mealPlanKey });
    queryClient.invalidateQueries({ queryKey: swapCandidatesKey(mealSlot) });
  };
  const choose = async () => {
    if (!chosen) return;
    setNotice(null);
    const outcome = await swap(mealSlot, chosen.id);
    if (!outcome) return;
    if (outcome.state === 'done') {
      // The plan now holds the new meal: the screen below shows it.
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('MealDetail', { mealSlot });
      return;
    }
    // The old meal stays in every case below.
    if (outcome.code === 'SWAP_CANDIDATE_INVALID') {
      setSelected(null);
      setNotice({ text: vi.candidatesChanged, kind: 'info' });
      refresh();
    } else if (outcome.code === 'SWAP_LIMIT_REACHED') {
      setLimitHit(true);
      refresh();
    } else if (outcome.code === 'MEAL_ALREADY_LOGGED') {
      setSelected(null);
      setNotice({ text: failureText(outcome.code), kind: 'info' });
      refresh();
    } else {
      setNotice({ text: vi.swapNotDone(failureText(outcome.code)), kind: 'error' });
    }
  };

  const exclusion = (
    <View style={styles.exclusion}>
      <AppText variant="caption" weight="semibold">
        {vi.excludeLabel}
      </AppText>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${vi.excludeLabel}. ${excluded.length > 0 ? vi.excludeFieldWith(excluded.map(tag => vi.tagLabel[tag]).join(', ')) : vi.excludeField}`}
        disabled={!settings.data}
        onPress={() => setSheet(true)}
        style={[styles.field, { backgroundColor: palette.white, borderColor: palette.line }, !settings.data && styles.unavailable]}
      >
        <AppText style={styles.fieldText}>{excluded.length > 0 ? vi.excludeFieldWith(excluded.map(tag => vi.tagLabel[tag]).join(', ')) : vi.excludeField}</AppText>
        <Icon name="ChevronDown" color={palette.muted} />
      </Touchable>
      {settings.isError && !settings.data ? <InlineError message={vi.excludeUnknown} action={{ label: common.retry, onPress: () => settings.refetch() }} /> : null}
    </View>
  );
  const sheetView = sheet ? <ExcludeSheet saved={excluded} onClose={() => setSheet(false)} /> : null;

  if (!data) {
    return (
      <Screen {...header}>
        {candidates.isError && !candidates.isFetching ? <ErrorState message={loadText(candidates.error instanceof ApiError ? candidates.error.code : '')} onRetry={() => candidates.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }

  const noSwapLeft = limitHit || data.swapsRemaining === 0;
  if (noSwapLeft) {
    // Which of the two it is, only the plan knows: the candidates look the same for both.
    if (!slot && !planQuery.isError) {
      return (
        <Screen {...header}>
          <LoadingState active={focused} />
        </Screen>
      );
    }
    if (slot?.logged) {
      return (
        <Screen {...header}>
          <Card tone="soft">
            <Icon name="CircleCheck" />
            <View accessibilityLiveRegion="polite" style={styles.text}>
              <AppText>{vi.slotLoggedNote(mealSlot)}</AppText>
            </View>
          </Card>
          <Button label={common.back} variant="secondary" onPress={navigation.goBack} />
        </Screen>
      );
    }
    return (
      <Screen {...header}>
        <AppText weight="semibold">{slot ? vi.usedLine(slot.swapsUsed, slot.swapsAllowed, mealSlot) : vi.usedAll(mealSlot)}</AppText>
        {exclusion}
        <Card tone="soft">
          <View accessibilityLiveRegion="polite">
            <AppText>{vi.limitNote(mealSlot)}</AppText>
          </View>
        </Card>
        <Button label={vi.logOutside} onPress={() => navigation.navigate('ManualKcal')} />
        <ListRow icon="Sparkles" title={vi.seePerks} description={vi.perksHint} onPress={() => navigation.navigate('Levels')} />
        {sheetView}
      </Screen>
    );
  }

  return (
    <Screen {...header}>
      <AppText weight="semibold" color="primary">
        {vi.swapsLeft(data.swapsRemaining, mealSlot)}
      </AppText>
      {exclusion}
      {data.candidates.length === 0 ? (
        <EmptyState
          title={vi.noCandidateTitle}
          body={excluded.length > 0 ? vi.noCandidateExcluded : vi.noCandidateBody}
          primary={excluded.length > 0 ? { label: vi.loosen, onPress: () => setSheet(true) } : undefined}
        />
      ) : (
        <>
          {/* motion: meal-swap lives on the meal screen this one returns to */}
          <View accessibilityRole="radiogroup" accessibilityLabel={vi.candidatesGroup} style={styles.list}>
            {data.candidates.map(item => (
              <RadioRow
                key={item.id}
                label={item.name}
                description={vi.candidateLine(item.kcal, item.kcalDelta, tagWords(item.tags).join(' · '))}
                selected={item.id === selected}
                disabled={swapping}
                onPress={() => {
                  setNotice(null);
                  setSelected(item.id);
                }}
              />
            ))}
          </View>
          <AppText variant="secondary">{vi.pickHint}</AppText>
          {notice?.kind === 'info' ? <DisabledReason reason={notice.text} /> : null}
          {notice?.kind === 'error' ? <InlineError message={notice.text} action={chosen ? { label: common.retry, onPress: choose } : undefined} /> : null}
          <Button label={vi.chooseMeal} disabled={!chosen} loading={swapping} onPress={choose} />
        </>
      )}
      {sheetView}
    </Screen>
  );
}

const styles = StyleSheet.create({
  exclusion: { gap: 6, marginTop: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, borderWidth: 1, borderRadius: radius.button },
  fieldText: { flex: 1 },
  unavailable: { opacity: 0.5 },
  list: { gap: 4, marginTop: 8 },
  text: { flex: 1, gap: 2 },
});
