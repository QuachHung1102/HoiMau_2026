import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import * as questsVi from '../../shared/i18n/vi/quests';
import * as vi from '../../shared/i18n/vi/workout';
import { motion } from '../../shared/motion/motion';
import { useLoopGate } from '../../shared/motion/useLoopGate';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { RewardChip } from '../../shared/ui/Badges';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { Mam } from '../../shared/ui/mam/Mam';
import { ProgressRing } from '../../shared/ui/ProgressRing';
import { Screen } from '../../shared/ui/Screen';
import { useMe } from '../auth/api';
import { useStandUpHold } from '../quests/useStandUp';
import { WORKOUT_QUEST } from './api';

const PARTICLES = 16;
const PARTICLE_REACH = 90;
const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true };

/** The burst of a recorded, completed session. Decorative; flame and lime (gold is for coins and prices only). */
function Burst({ progress }: { progress: Animated.Value }) {
  const palette = useTheme();
  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View {...hidden} testID="workout-burst" pointerEvents="none" style={styles.burst}>
      {Array.from({ length: PARTICLES }, (_, index) => {
        const angle = (2 * Math.PI * index) / PARTICLES;
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * PARTICLE_REACH] });
        const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * PARTICLE_REACH] });
        return <Animated.View key={index} style={[styles.particle, { backgroundColor: index % 2 ? palette.flame : palette.lime, opacity, transform: [{ translateX }, { translateY }] }]} />;
      })}
    </View>
  );
}

/**
 * S20 / S64: what the SERVER recorded for the session. This route is reached only with its answer, so every number
 * here (XP, coins, completed or not) is the server's. A session that waits on the device or was refused never gets
 * here: the focus screen says so itself.
 */
export function WorkoutResultScreen({ route, navigation }: ScreenProps<'WorkoutResult'>) {
  const focused = useIsFocused();
  const pet = useMe().data?.pet;
  // Still part of the focus flow: no stand-up prompt over the result.
  useStandUpHold();
  const { result } = route.params;
  const { completed, xpAwarded, coinAwarded } = result;
  const questDone = result.day.quests.some(quest => quest.code === WORKOUT_QUEST && quest.completed);
  const recorded = vi.recorded(vi.clock(result.elapsedSec), vi.clock(result.durationSec));
  // Back to where the flow was started from (the workout it was started on).
  const leave = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Today'));

  // motion: workout-complete (the ring swells once and the burst flies out; with reduced motion both stand still)
  const celebrate = useLoopGate(focused) && completed;
  const [burst] = useState(() => new Animated.Value(0));
  const [swell] = useState(() => new Animated.Value(0));
  const played = useRef(false);
  useEffect(() => {
    // Once: coming back to this screen, or to the app, does not replay a reward.
    if (!celebrate || played.current) return undefined;
    const { celebration, countUp } = motion.durationsMs;
    const run = Animated.parallel([
      Animated.timing(burst, { toValue: 1, delay: 300, duration: countUp, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(swell, { toValue: 1, delay: 300, duration: celebration / 2, useNativeDriver: true }),
        Animated.timing(swell, { toValue: 0, duration: celebration / 2, useNativeDriver: true }),
      ]),
    ]);
    run.start(({ finished }) => {
      played.current = finished;
    });
    return () => run.stop();
  }, [celebrate, burst, swell]);

  const mam = pet ? (
    // motion: mam-cheer (once, on a completed session only; Mầm's own one-shot is not replayed on refocus)
    <Mam
      stage={pet.stage}
      mood={completed ? 'HAPPY' : pet.mood}
      skin={pet.skinCode === 'SKIN_FOX' ? 'fox' : undefined}
      size={112}
      animation={completed ? 'cheer' : 'idle'}
      active={focused}
      decorative
    />
  ) : null;
  const toToday = <Button label={vi.toToday} onPress={() => navigation.navigate('Today')} />;

  if (!completed) {
    // S64: under half of the duration. What was recorded, its share of the XP, and nothing called complete.
    return (
      <Screen title={vi.partialTitle} subtitle={recorded} onBack={leave}>
        <Card tone="soft" style={[styles.section, styles.hero]}>
          {mam}
        </Card>
        {xpAwarded > 0 ? (
          <View style={styles.chips}>
            <RewardChip text={vi.partialXp(xpAwarded)} />
          </View>
        ) : null}
        <Card tone="soft">
          <AppText>{questDone ? vi.partialQuestDone : vi.partialNote}</AppText>
        </Card>
        <View style={styles.actions}>
          {toToday}
          <Button variant="secondary" label={vi.continueWorkout} onPress={leave} />
        </View>
      </Screen>
    );
  }

  // S20: at least half of the duration.
  return (
    <Screen title={vi.completedTitle} subtitle={vi.completedSubtitle} onBack={leave}>
      <Card tone="soft" style={[styles.section, styles.hero]}>
        {mam}
        <Animated.View style={{ transform: [{ scale: swell.interpolate({ inputRange: [0, 1], outputRange: [motion.scale.rest, motion.scale.celebrationPeak] }) }] }}>
          <ProgressRing progress={1} size={112} accessibilityLabel={recorded}>
            <AppText variant="title">{vi.clock(result.elapsedSec)}</AppText>
            <AppText variant="caption">{vi.timeTrained}</AppText>
          </ProgressRing>
        </Animated.View>
        {celebrate ? <Burst progress={burst} /> : null}
      </Card>
      <AppText variant="title" accessibilityRole="header" style={styles.section}>
        {vi.completedHeadline}
      </AppText>
      <AppText variant="secondary">{recorded}</AppText>
      {xpAwarded > 0 || coinAwarded > 0 ? (
        <View style={styles.chips}>
          {xpAwarded > 0 ? <RewardChip text={questsVi.reward(xpAwarded)} /> : null}
          {coinAwarded > 0 ? <RewardChip text={vi.coinReward(coinAwarded)} /> : null}
        </View>
      ) : null}
      {questDone ? (
        <View style={styles.quest}>
          <Icon name="CircleCheck" size={20} />
          <AppText weight="semibold" style={styles.fill}>
            {vi.questCompleted}
          </AppText>
        </View>
      ) : null}
      <View style={styles.actions}>
        {toToday}
        <Button variant="secondary" label={vi.backToWorkout} onPress={leave} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { marginTop: spacing.section - 8 },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, minHeight: 168 },
  burst: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  particle: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  quest: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { gap: 12, marginTop: spacing.section - 8 },
});
