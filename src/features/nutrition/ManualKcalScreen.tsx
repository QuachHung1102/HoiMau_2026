import { useIsFocused } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LIMITS } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/nutrition';
import * as questsVi from '../../shared/i18n/vi/quests';
import { failureText } from '../../shared/i18n/vi/sync';
import * as today from '../../shared/i18n/vi/today';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { LoadingState } from '../../shared/ui/States';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { focusFirstInvalid } from '../auth/form';
import { applyPending } from '../dashboard/applyPending';
import { useDay } from '../quests/api';
import { checkKcalForm, serverKcalErrors, useLogKcal, type KcalField } from './api';

const FIELDS = ['kcal', 'label'] as const;
// A guard against a pasted wall of text, not a rule: the rule (60) is checked and explained under the field.
const LABEL_TYPED_MAX = 200;
// Two lines (the total, and the reward when there is one) take longer to read than the default 4 s.
const CONFIRMATION_MS = 7000;
const CONFIRMATION_SCREEN_READER_MS = 9000;

/** S16: a meal that is not on the menu. Today's total is the server's (plus what waits on this device, marked). */
export function ManualKcalScreen({ navigation }: ScreenProps<'ManualKcal'>) {
  const focused = useIsFocused();
  const palette = useTheme();
  const { userId } = useSession();
  const snackbar = useSnackbar();
  const dayQuery = useDay();
  const pending = usePendingActions(userId);
  const { log, saving } = useLogKcal();
  const day = dayQuery.data;
  const view = useMemo(() => (day ? applyPending(day, pending) : undefined), [day, pending]);

  const [kcal, setKcal] = useState('');
  const [label, setLabel] = useState('');
  const [errors, setErrors] = useState<Partial<Record<KcalField, string>>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const inputs = { kcal: useRef<TextFieldInput>(null), label: useRef<TextFieldInput>(null) };
  // The answer can arrive after the person has left: then there is nothing to go back from.
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Today'));

  const show = (next: Partial<Record<KcalField, string>>) => {
    setErrors(next);
    focusFirstInvalid(FIELDS, next, inputs);
  };

  const submit = async () => {
    const checked = checkKcalForm(kcal, label);
    if (!checked.ok) return show(checked.errors);
    setErrors({});
    setFailed(null);
    const outcome = await log(checked.kcal, checked.label);
    if (!outcome) return;
    if (outcome.state === 'confirmed') {
      // The total and the reward are the server's. No Undo: a logged meal cannot be removed (AR-12).
      snackbar.show({
        message: [vi.logged(outcome.total), outcome.questDone ? vi.questReward(outcome.xp) : undefined].filter(Boolean).join('\n'),
        durationMs: CONFIRMATION_MS,
        screenReaderDurationMs: CONFIRMATION_SCREEN_READER_MS,
      });
      if (here.current) back();
    } else if (outcome.state === 'queued') {
      setWaiting(true);
    } else {
      const fields = outcome.code === 'VALIDATION_FAILED' ? serverKcalErrors(outcome.details) : undefined;
      if (fields) show(fields);
      else setFailed(outcome.code);
    }
  };

  const dayCode = dayQuery.error instanceof ApiError ? dayQuery.error.code : '';
  // While this screen's own request is out the queue lists it too (as unsent): that is "saving", not waiting, and its
  // amount is not added here: the total is what the server last gave. Only records that really settled as queued
  // (earlier ones) are in the total, marked as waiting (nothing is granted for them yet).
  const shown = day && saving ? { caloriesIn: day.caloriesIn, waiting: false } : view ? { caloriesIn: view.caloriesIn, waiting: view.pending.kcal > 0 } : undefined;
  const line = view && shown ? today.kcalLine(shown.caloriesIn, view.calorieWindow) : undefined;
  const totalLine = line && (saving ? questsVi.withStatus(line, questsVi.saving) : shown?.waiting ? questsVi.withStatus(line, common.queued) : line);

  if (waiting) {
    // Kept on this device and not on the server yet: the waiting mark and its words, no total, no reward.
    return (
      <Screen title={vi.manualTitle} subtitle={vi.manualSubtitle}>
        <Card tone="soft">
          <Icon name="Clock" />
          <View accessibilityLiveRegion="polite" style={styles.text}>
            <AppText variant="title" accessibilityRole="header">
              {vi.waitingTitle}
            </AppText>
            <AppText variant="secondary">{vi.waitingBody}</AppText>
          </View>
        </Card>
        <Button label={vi.done} onPress={back} />
      </Screen>
    );
  }

  return (
    <Screen title={vi.manualTitle} subtitle={vi.manualSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      {dayQuery.provisional ? (
        <View accessibilityLiveRegion="polite">
          <DisabledReason reason={today.newDayNotSynced} icon="CloudOff" />
        </View>
      ) : null}
      {view ? (
        <Card tone="soft" accessible accessibilityLabel={`${vi.todayTotal}. ${totalLine}`}>
          <AppText variant="caption" weight="semibold">
            {vi.todayTotal}
          </AppText>
          <AppText>{totalLine}</AppText>
        </Card>
      ) : dayQuery.isError && !dayQuery.isFetching ? (
        // The form does not need the day: say the total is unknown and keep it usable.
        <InlineError message={`${vi.totalUnknown} ${failureText(dayCode)}`} action={{ label: common.retry, onPress: () => dayQuery.refetch() }} />
      ) : (
        <LoadingState blocks={1} active={focused} />
      )}
      <TextField
        ref={inputs.kcal}
        label={vi.kcalLabel}
        placeholder={vi.kcalPlaceholder}
        value={kcal}
        onChangeText={text => {
          setKcal(text);
          setFailed(null);
          setErrors(now => ({ ...now, kcal: undefined }));
        }}
        error={errors.kcal}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={String(LIMITS.manualKcal.max).length + 1}
        returnKeyType="next"
        onSubmitEditing={() => inputs.label.current?.focus()}
      />
      <TextField
        ref={inputs.label}
        label={vi.labelLabel}
        helper={vi.labelHelper}
        placeholder={vi.labelPlaceholder}
        value={label}
        onChangeText={text => {
          setLabel(text);
          setFailed(null);
          setErrors(now => ({ ...now, label: undefined }));
        }}
        error={errors.label}
        maxLength={LABEL_TYPED_MAX}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <AppText variant="secondary">{vi.reassurance}</AppText>
      <View style={styles.cannotRemove}>
        <Icon name="Info" size={16} color={palette.muted} />
        <AppText variant="caption" style={styles.note}>
          {vi.cannotRemove}
        </AppText>
      </View>
      <Button label={vi.saveAction} loading={saving} onPress={submit} />
      {failed ? <InlineError message={vi.notSaved(failureText(failed))} action={{ label: common.retry, onPress: submit }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { gap: 4 },
  note: { flex: 1 },
  cannotRemove: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
