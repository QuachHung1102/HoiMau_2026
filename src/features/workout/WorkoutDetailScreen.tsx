import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WorkoutDetail } from '../../../domain/contract/content.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { healthVi } from '../../shared/i18n/vi/health';
import { failureText } from '../../shared/i18n/vi/sync';
import * as vi from '../../shared/i18n/vi/workout';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useWorkout } from './api';

type Step = WorkoutDetail['steps'][number];
const PHASES: readonly { phase: Step['phase']; icon: IconName }[] = [
  { phase: 'WARMUP', icon: 'Play' },
  { phase: 'MAIN', icon: 'Dumbbell' },
  { phase: 'COOLDOWN', icon: 'Wind' },
];

/** The move in words: its name, how much of it, and its three instruction lines. (The animated demo is Task 36's.) */
export function MoveGuide({ step, caption }: { step: Step; caption?: string }) {
  return (
    <Card tone="soft">
      {caption ? (
        <AppText variant="caption" weight="semibold">
          {caption}
        </AppText>
      ) : null}
      <AppText weight="semibold">{vi.dotted(step.move.name, step.repsText)}</AppText>
      <View style={styles.lines}>
        {step.move.steps.map((line, index) => (
          <AppText key={index} variant="secondary">{`${index + 1}. ${line}`}</AppText>
        ))}
      </View>
    </Card>
  );
}

/** S18: what the workout is made of, before starting it. */
export function WorkoutDetailScreen({ route, navigation }: ScreenProps<'WorkoutDetail'>) {
  const focused = useIsFocused();
  const { id } = route.params;
  const workout = useWorkout(id);
  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  // Two presses inside one frame open one session; back on this screen the button works again.
  const starting = useRef(false);
  useEffect(() => {
    if (focused) starting.current = false;
  }, [focused]);

  const detail = workout.data;
  if (!detail) {
    const code = workout.error instanceof ApiError ? workout.error.code : '';
    return (
      <Screen onBack={back}>
        {workout.isError && !workout.isFetching ? <ErrorState message={failureText(code)} onRetry={() => workout.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }

  const steps = [...detail.steps].sort((a, b) => a.position - b.position);
  const equipment = detail.equipment.length ? detail.equipment.map(item => vi.equipmentText[item] ?? item).join(', ') : vi.noEquipmentNeeded;
  const begin = () => {
    if (starting.current) return;
    starting.current = true;
    navigation.navigate('FocusSession', { id });
  };

  return (
    <Screen onBack={back}>
      {steps[0] ? <MoveGuide step={steps[0]} caption={vi.firstMove} /> : null}
      <AppText variant="caption">{vi.demoCaption(steps.length)}</AppText>

      <View style={styles.section}>
        <AppText variant="headline" accessibilityRole="header">
          {detail.name}
        </AppText>
        <AppText variant="secondary">{vi.meta(detail.durationSec / 60, vi.spaceText[detail.spaceNeeded], equipment)}</AppText>
        <AppText variant="secondary">{vi.summary(detail.sets, steps.length, detail.kcalEstimate)}</AppText>
      </View>

      <Card tone="soft" style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.phasesTitle}
        </AppText>
        {PHASES.filter(({ phase }) => steps.some(step => step.phase === phase)).map(({ phase, icon }) => (
          <View key={phase} style={styles.phase}>
            <Icon name={icon} />
            <View style={styles.fill}>
              <AppText weight="semibold">{vi.phaseTitle[phase]}</AppText>
              <AppText variant="caption">{vi.phaseHint[phase]}</AppText>
            </View>
          </View>
        ))}
      </Card>

      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.movesTitle}
        </AppText>
        {steps.map(step => (
          <ListRow
            key={step.position}
            title={step.move.name}
            description={vi.moveLine(vi.phaseShort[step.phase], step.repsText)}
            onPress={() => navigation.navigate('MoveDemo', { workoutId: id, code: step.move.code })}
          />
        ))}
      </View>

      <AppText variant="secondary">{healthVi.workoutCaution}</AppText>
      <View style={styles.actions}>
        <Button label={vi.start} onPress={begin} />
        <Button variant="secondary" label={vi.changeWorkout} onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('WorkoutCatalog'))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  lines: { gap: 4 },
  section: { marginTop: spacing.section - 8 },
  phase: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  actions: { gap: 12, marginTop: 8 },
});
