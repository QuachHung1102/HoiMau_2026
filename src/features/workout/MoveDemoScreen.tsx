import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { healthVi } from '../../shared/i18n/vi/health';
import { failureText } from '../../shared/i18n/vi/sync';
import * as vi from '../../shared/i18n/vi/workout';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { Switch } from '../../shared/ui/Toggles';
import { useWorkout } from './api';
import { MoveDemoView } from './MoveDemoView';
import { moves } from './rig';

/**
 * S82: one move of a workout, shown and told. The move comes from the workout already in the cache (S18 read it;
 * there is no route for a single move). Opened from S18 and from a running S19, whose clock keeps running.
 */
export function MoveDemoScreen({ route, navigation }: ScreenProps<'MoveDemo'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const workout = useWorkout(route.params.workoutId);
  const [slow, setSlow] = useState(false);
  const [paused, setPaused] = useState(false);
  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Today'));

  const step = workout.data?.steps.find(item => item.move.code === route.params.code);
  if (!step) {
    const code = workout.error instanceof ApiError ? workout.error.code : '';
    return (
      <Screen onBack={back}>
        {workout.data ? (
          <ErrorState message={vi.moveMissing} onRetry={() => workout.refetch()} />
        ) : workout.isError && !workout.isFetching ? (
          <ErrorState message={failureText(code)} onRetry={() => workout.refetch()} />
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }

  const { move } = step;
  // Controls only for a demo that moves: a still pose has nothing to pause or slow down, breathing keeps its pace.
  const moving = move.demoCode !== null && !reduced;
  const slowable = moving && move.demoCode !== null && moves[move.demoCode]?.demo === 'rig';
  return (
    <Screen onBack={back} title={move.name} subtitle={vi.moveLine(vi.phaseShort[step.phase], step.repsText)}>
      {move.demoCode ? (
        <Card tone="soft" style={styles.section}>
          <View style={[styles.stage, { backgroundColor: palette.white }]}>
            <MoveDemoView demoCode={move.demoCode} speed={slow ? 0.5 : 1} active={focused && !paused} />
          </View>
          {moving ? <Button variant="secondary" label={paused ? vi.demoPlay : vi.demoPause} onPress={() => setPaused(value => !value)} /> : null}
          {slowable ? <Switch label={vi.slowMotion} value={slow} onChange={setSlow} /> : null}
          <AppText variant="caption">{vi.noSound}</AppText>
        </Card>
      ) : null}

      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.stepsTitle}
        </AppText>
        {move.steps.map((line, index) => (
          <View key={index} style={styles.step}>
            <View style={[styles.number, { backgroundColor: palette.soft }]}>
              <AppText weight="semibold" color="primary">
                {index + 1}
              </AppText>
            </View>
            <AppText style={styles.fill}>{line}</AppText>
          </View>
        ))}
      </View>

      <Card tone="soft" style={styles.section}>
        <AppText weight="semibold">{vi.cautionTitle}</AppText>
        <AppText variant="secondary">{move.caution}</AppText>
      </Card>
      <AppText variant="secondary" style={styles.section}>
        {healthVi.workoutCaution}
      </AppText>
      <View style={styles.section}>
        <Button label={vi.backToSession} onPress={back} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { marginTop: spacing.section - 8 },
  stage: { borderRadius: 16, overflow: 'hidden' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12 },
  number: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
