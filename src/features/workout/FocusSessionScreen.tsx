import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Easing, Platform, StyleSheet, View } from 'react-native';
import type { WorkoutDetail } from '../../../domain/contract/content.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import * as common from '../../shared/i18n/vi/common';
import { failureText } from '../../shared/i18n/vi/sync';
import * as vi from '../../shared/i18n/vi/workout';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { sizes, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Dialog } from '../../shared/ui/Dialog';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { ProgressRing } from '../../shared/ui/ProgressRing';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { Switch } from '../../shared/ui/Toggles';
import { Touchable } from '../../shared/ui/Touchable';
import { useStandUpHold } from '../quests/useStandUp';
import { useCompleteWorkout, useWorkout } from './api';
import { activeMs, buildSchedule, elapsedSec, pauseClock, positionAt, resumeClock, startClock, type ClockState } from './sessionClock';
import { MoveGuide } from './WorkoutDetailScreen';

// How often the screen looks at the clock. The time shown is read from `Date.now()` each time: it does not depend
// on this number, nor on whether every tick arrives.
const TICK_MS = 250;

/** What has become of the session: running (or paused), then its record. */
type Phase = { at: 'running' } | { at: 'saving' } | { at: 'queued' } | { at: 'failed'; code: string };

function CloseButton({ onPress }: { onPress: () => void }) {
  const palette = useTheme();
  return (
    <Touchable accessibilityRole="button" accessibilityLabel={vi.closeSession} onPress={onPress} style={styles.close}>
      <Icon name="X" color={palette.ink} />
    </Touchable>
  );
}

/** The session of one workout, from the first second to the moment the server has its record. */
function Session({ detail, navigation }: { detail: WorkoutDetail; navigation: ScreenProps<'FocusSession'>['navigation'] }) {
  const palette = useTheme();
  const reduced = useReducedMotion();
  const { userId } = useSession();
  const pending = usePendingActions(userId);
  const { complete } = useCompleteWorkout();
  // No stand-up prompt on top of a session.
  useStandUpHold();

  // One session is one action: its id is made here, once, and every try to record it carries it.
  const [sessionId] = useState(newActionId);
  const schedule = useMemo(() => buildSchedule(detail), [detail]);
  const steps = useMemo(() => [...detail.steps].sort((a, b) => a.position - b.position), [detail]);
  const total = useMemo(() => schedule.reduce((sum, segment) => sum + segment.seconds, 0), [schedule]);

  const [clock, setClock] = useState<ClockState>(() => startClock(Date.now()));
  // The moment the screen last looked at the clock.
  const [now, setNow] = useState(() => clock.startedAtMs);
  const [phase, setPhase] = useState<Phase>({ at: 'running' });
  // S63 is open; `wasRunning`: the clock was running when it opened, so "Tập tiếp" lets it run again.
  const [asking, setAsking] = useState<{ wasRunning: boolean } | null>(null);
  // The seconds that were recorded, fixed when the session ended.
  const ended = useRef<number | null>(null);

  const running = phase.at === 'running';
  const paused = clock.pausedAtMs !== null;
  // Paused by the person (or by leaving the app), not merely held while S63 is open.
  const showPaused = paused && !asking?.wasRunning;

  // motion: focus-ring (the ring and the countdown follow the session clock; the interval only says when to look)
  useEffect(() => {
    if (!running || paused) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running, paused]);

  const pause = useCallback(() => {
    const at = Date.now();
    setClock(current => pauseClock(current, at));
    setNow(at);
  }, []);
  const resume = () => {
    const at = Date.now();
    setClock(current => resumeClock(current, at));
    setNow(at);
  };

  // Leaving the app pauses the session, and coming back never resumes it: the person does.
  useEffect(() => {
    if (!running) return;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') return;
      pause();
      // Left while S63 was open: "Tập tiếp" there must not start the clock behind the person's back either.
      setAsking(open => (open ? { wasRunning: false } : open));
    });
    return () => subscription.remove();
  }, [running, pause]);

  // S63. Opening it holds the clock, so the time it shows stays true and nothing is gained or lost while it is open.
  const askToLeave = useCallback(() => {
    const at = Date.now();
    setAsking(open => open ?? { wasRunning: !paused });
    setClock(current => pauseClock(current, at));
    setNow(at);
  }, [paused]);
  const keepGoing = () => {
    // Back to exactly where it was: running if it was running, paused if the person had paused it.
    if (asking?.wasRunning) resume();
    setAsking(null);
  };

  const leave = useCallback(() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Today')), [navigation]);
  // Hardware Back (Android) asks first while the session runs; once it is over there is nothing left to lose.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase.at === 'running') askToLeave();
      else if (phase.at !== 'saving') leave();
      return true;
    });
    return () => subscription.remove();
  }, [phase.at, askToLeave, leave]);

  const elapsed = Math.min(total, ended.current ?? elapsedSec(clock, now));
  const position = positionAt(schedule, elapsed);

  const record = async (seconds: number) => {
    setPhase({ at: 'saving' });
    // Only the sending can throw, and by then the record is on this device: that is the waiting state, not a stuck one.
    const outcome = await complete({ id: sessionId, exerciseItemId: detail.id, elapsedSec: seconds }).catch(() => ({ state: 'queued' }) as const);
    // Nothing comes back for a second press, or for a person who has signed out meanwhile.
    if (!outcome) return;
    if (outcome.state === 'confirmed') navigation.replace('WorkoutResult', { result: outcome.result });
    else setPhase(outcome.state === 'queued' ? { at: 'queued' } : { at: 'failed', code: outcome.code });
  };
  const finish = () => {
    if (ended.current !== null) return;
    // At least one second: a session that was opened is a session.
    ended.current = Math.max(1, Math.min(total, elapsedSec(clock, Date.now())));
    setAsking(null);
    record(ended.current);
  };
  // Reaching the end finishes the session by itself.
  const reachedEnd = running && position.finished;
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useEffect(() => {
    if (reachedEnd) finishRef.current();
  }, [reachedEnd]);

  // motion: focus-pause (the paused label fades in; with reduced motion it is simply there)
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      fade.setValue(1);
      return undefined;
    }
    fade.setValue(0.5);
    const run = Animated.timing(fade, { toValue: 1, duration: motion.durationsMs.transition, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [showPaused, reduced, fade]);

  const time = vi.clock;
  const trained = vi.trained(time(elapsed), time(total));

  if (phase.at !== 'running') {
    // Is the record still on this device? (While it is being sent for the first time it is "saving", not waiting.)
    const waiting = pending.some(action => action.id === sessionId);
    return (
      <Screen>
        {phase.at === 'saving' ? null : <CloseButton onPress={leave} />}
        {phase.at === 'saving' ? (
          <>
            <AppText variant="headline" accessibilityRole="header">
              {vi.savingTitle}
            </AppText>
            <AppText variant="secondary">{trained}</AppText>
            <View style={styles.section}>
              <LoadingState blocks={1} />
            </View>
          </>
        ) : phase.at === 'queued' ? (
          <>
            <View accessibilityLiveRegion="polite" style={styles.text}>
              <AppText variant="headline" accessibilityRole="header">
                {waiting ? vi.queuedTitle : vi.sentTitle}
              </AppText>
              <AppText variant="secondary">{trained}</AppText>
            </View>
            {/* On this device only: no XP, no coins, no "completed" until the server has answered. */}
            <Card tone="soft" style={styles.section}>
              <Icon name={waiting ? 'Clock' : 'CloudUpload'} />
              <AppText>{waiting ? vi.queuedBody : vi.sentBody}</AppText>
            </Card>
            <View style={styles.actions}>
              <Button label={vi.toToday} onPress={() => navigation.navigate('Today')} />
              <Button variant="secondary" label={vi.backToWorkout} onPress={leave} />
            </View>
          </>
        ) : (
          <>
            <AppText variant="headline" accessibilityRole="header">
              {vi.notSavedTitle}
            </AppText>
            <AppText variant="secondary">{trained}</AppText>
            <View style={styles.section}>
              <InlineError message={failureText(phase.code)} />
            </View>
            <View style={styles.actions}>
              {/* The same session again: the same id, the same seconds. */}
              <Button label={common.retry} onPress={() => record(ended.current ?? 1)} />
              <Button variant="secondary" label={vi.leaveUnsaved} onPress={leave} />
            </View>
          </>
        )}
      </Screen>
    );
  }

  const segment = schedule[position.segmentIndex];
  const stepIndex = Math.max(
    0,
    steps.findIndex(step => step.position === segment?.stepPosition),
  );
  const step = steps[stepIndex];
  // With reduced motion the ring moves once per second; otherwise it follows the clock inside the second too.
  const done = reduced ? elapsed : Math.min(total, activeMs(clock, now) / 1000);
  const left = time(position.remainingTotal);
  return (
    <Screen>
      <CloseButton onPress={askToLeave} />
      <Animated.View accessibilityLiveRegion="polite" style={{ opacity: fade }}>
        <AppText variant="headline" accessibilityRole="header">
          {showPaused ? vi.pausedTitle : vi.focusTitle}
        </AppText>
        <AppText variant="secondary">{showPaused ? vi.pausedSubtitle(detail.name) : vi.focusSubtitle(detail.name)}</AppText>
      </Animated.View>

      <Card tone="primary" style={styles.section}>
        <Icon name={showPaused ? 'Pause' : 'Activity'} size={32} color={palette.white} />
        <AppText variant="title" color="white" accessibilityRole="header">
          {step?.move.name}
        </AppText>
        {segment ? (
          <AppText variant="secondary" color="white">
            {vi.setAndMove(segment.setIndex, segment.setCount, stepIndex + 1, steps.length)}
          </AppText>
        ) : null}
        <View style={styles.ring}>
          <ProgressRing tone="primary" size={160} progress={total ? done / total : 1} accessibilityLabel={vi.ringLabel(left)}>
            <AppText variant="headline" color="white">
              {left}
            </AppText>
            <AppText variant="caption" color="white">
              {vi.remaining}
            </AppText>
          </ProgressRing>
        </View>
        <AppText variant="secondary" color="white">
          {showPaused ? vi.pausedNote : vi.moveRemaining(time(position.remainingInSegment))}
        </AppText>
        {showPaused ? <Button variant="onPrimary" label={vi.resume} onPress={resume} /> : <Button variant="secondary" label={vi.pause} onPress={pause} />}
      </Card>

      {step ? (
        <View style={styles.section}>
          <MoveGuide step={step} caption={vi.howTo} />
          <AppText variant="caption">{step.move.caution}</AppText>
        </View>
      ) : null}

      {/* AR-22: this build is silent. The switch is off, cannot be turned on, and its name says why. */}
      <Switch label={`${vi.sound}. ${vi.soundUnavailable}`} value={false} onChange={() => undefined} disabled />

      <AppText variant="secondary">{vi.breathe}</AppText>
      <Button variant="secondary" label={vi.endSession} onPress={askToLeave} />

      {asking ? (
        <Dialog
          title={vi.exitTitle}
          body={vi.exitBody(time(elapsed), time(total))}
          note={elapsed * 2 < total ? vi.exitNote : undefined}
          primary={{ label: vi.resume, onPress: keepGoing }}
          secondary={{ label: vi.endAndSave, onPress: finish }}
          onDismiss={keepGoing}
        />
      ) : null}
    </Screen>
  );
}

/** S19 with its states S41 (paused) and S63 (leave?): a full-screen flow above the tabs. */
export function FocusSessionScreen({ route, navigation }: ScreenProps<'FocusSession'>) {
  const focused = useIsFocused();
  const workout = useWorkout(route.params.id);
  if (workout.data) return <Session detail={workout.data} navigation={navigation} />;
  // No session has begun: there is nothing to confirm, the close button simply leaves.
  const code = workout.error instanceof ApiError ? workout.error.code : '';
  return (
    <Screen>
      <CloseButton onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Today'))} />
      {workout.isError && !workout.isFetching ? <ErrorState message={failureText(code)} onRetry={() => workout.refetch()} /> : <LoadingState active={focused} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  close: { width: sizes.minTouch, height: sizes.minTouch, justifyContent: 'center', marginLeft: -12 },
  text: { gap: 8 },
  section: { gap: 8, marginTop: spacing.section - 8 },
  ring: { alignItems: 'center', marginVertical: 8 },
  actions: { gap: 12, marginTop: spacing.section - 8 },
});
