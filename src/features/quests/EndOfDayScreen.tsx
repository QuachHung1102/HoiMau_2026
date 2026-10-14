import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/quests';
import { failureText } from '../../shared/i18n/vi/sync';
import * as today from '../../shared/i18n/vi/today';
import { usePendingActions } from '../../shared/storage/pendingActions';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Mam } from '../../shared/ui/mam/Mam';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useMe } from '../auth/api';
import { applyPending } from '../dashboard/applyPending';
import { pushCelebrations } from '../progression/celebrations';
import { useQueuedWrite } from '../sync/useQueuedWrite';
import { acceptDay, useDay } from './api';

/** The hidden quest of the day. */
const BEDTIME = 'BEDTIME_BEFORE_23';
const BEDTIME_PATH = '/day/bedtime';

/** What the server said to the mark made on this screen: the reward only when it names the hidden quest completed. */
type Result = { xp: number; rewarded: boolean };

/** The night card: dark ground and a still moon (`end-of-day-sky`), Mầm asleep beside the text (`mam-sleep`). */
function NightCard({ icon, children, sleeping }: { icon: IconName; children: ReactNode; sleeping: boolean }) {
  const palette = useTheme();
  const pet = useMe().data?.pet;
  return (
    // motion: end-of-day-sky (tier 2, static: the night ground and the moon are simply there)
    <View style={[styles.night, { backgroundColor: palette.ink }]}>
      <View style={styles.top}>
        <Icon name={icon} size={40} color={palette.lime} />
        {/* motion: mam-sleep (tier 2, static: eyes closed; the words beside it say what happened) */}
        {pet && sleeping ? <Mam stage={pet.stage} mood="TIRED" skin={pet.skinCode === 'SKIN_FOX' ? 'fox' : undefined} size={88} decorative /> : null}
      </View>
      {children}
    </View>
  );
}

/** S45: marks the intention to rest (`POST /day/bedtime`, queueable). Not a surveillance feature, and not a test. */
export function EndOfDayScreen({ navigation }: ScreenProps<'EndOfDay'>) {
  const focused = useIsFocused();
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const dayQuery = useDay();
  const pending = usePendingActions(userId);
  const { send } = useQueuedWrite<ActionResult>();
  const day = dayQuery.data;
  const view = useMemo(() => (day ? applyPending(day, pending) : undefined), [day, pending]);

  // One mark at a time. The ref is what two presses inside one frame read; the state is what is drawn.
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const back = navigation.canGoBack() ? navigation.goBack : undefined;

  const mark = async () => {
    if (sending.current || !userId) return;
    sending.current = true;
    setSaving(true);
    setFailed(null);
    try {
      const outcome = await send({ path: BEDTIME_PATH, body: {} });
      if (outcome.state === 'confirmed' && boundUserId() === userId) {
        const { day: next, delta } = outcome.result;
        // The server's day first, then this screen's own state, in the same block: no render in between.
        acceptDay(queryClient, userId, next);
        pushCelebrations(delta.events);
        setResult({ xp: delta.xp, rewarded: delta.events.some(event => event.type === 'QUEST_COMPLETED' && event.questCode === BEDTIME) });
      }
      // Queued: nothing to do, the waiting state comes from the queue. Refused: it is not kept anywhere.
      if (outcome.state === 'failed') setFailed(outcome.code);
    } finally {
      // Whatever happened, the button works again.
      sending.current = false;
      setSaving(false);
    }
  };

  if (!view) {
    const code = dayQuery.error instanceof ApiError ? dayQuery.error.code : '';
    return (
      <Screen title={vi.eodTitle} subtitle={vi.eodSubtitle} onBack={back}>
        {dayQuery.isError && !dayQuery.isFetching ? <ErrorState message={failureText(code)} onRetry={() => dayQuery.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }

  const hidden = view.quests.find(quest => quest.code === BEDTIME);
  const locked = hidden?.locked === true;
  // The queue also lists the record this screen has just sent: while it is out that is "saving" (the busy button), not
  // a mark that was already there.
  const marked = view.bedtimeMarkedAt !== null && !(saving && view.pending.bedtime);
  const notice = dayQuery.provisional ? (
    <View accessibilityLiveRegion="polite">
      <DisabledReason reason={today.newDayNotSynced} icon="CloudOff" />
    </View>
  ) : null;
  const toToday = <Button variant="secondary" label={vi.backToToday} onPress={() => navigation.navigate('Today')} />;

  let body: ReactNode;
  if (result) {
    // Confirmed by the server on this screen.
    body = (
      <>
        <NightCard icon="Moon" sleeping>
          <View accessibilityLiveRegion="polite" style={styles.text}>
            <AppText variant="title" color="white" accessibilityRole="header">
              {vi.eodGoodNight}
            </AppText>
            <AppText variant="secondary" color="white">
              {result.rewarded ? vi.eodReward(result.xp) : vi.eodNoReward}
            </AppText>
          </View>
        </NightCard>
        {toToday}
      </>
    );
  } else if (marked && view.pending.bedtime) {
    // On this device, not on the server yet: no reward and no good night until it is.
    body = (
      <>
        <NightCard icon="Clock" sleeping={false}>
          <View accessibilityLiveRegion="polite" style={styles.text}>
            <AppText variant="title" color="white" accessibilityRole="header">
              {common.queued}
            </AppText>
            <AppText variant="secondary" color="white">
              {vi.eodWaiting}
            </AppText>
          </View>
        </NightCard>
        {toToday}
      </>
    );
  } else if (marked) {
    body = (
      <>
        <NightCard icon="Moon" sleeping>
          <AppText variant="secondary" color="white">
            {vi.eodAlready}
          </AppText>
        </NightCard>
        {toToday}
      </>
    );
  } else {
    const label = locked ? `${vi.eodAction}. ${vi.eodLocked}` : undefined;
    body = (
      <>
        <NightCard icon="Moon" sleeping>
          <View style={styles.text}>
            <AppText variant="title" color="white" accessibilityRole="header">
              {vi.eodHeadline}
            </AppText>
            <AppText variant="secondary" color="white">
              {vi.eodBody}
            </AppText>
          </View>
        </NightCard>
        <AppText variant="secondary">{vi.eodMeaning}</AppText>
        {hidden && !hidden.completed ? <AppText variant="caption">{vi.eodHidden(hidden.xpReward)}</AppText> : null}
        <Button label={vi.eodAction} accessibilityLabel={label} disabled={locked} loading={saving} onPress={mark} />
        {locked ? <DisabledReason reason={vi.eodLocked} /> : null}
        {failed ? <InlineError message={vi.eodNotSaved(failureText(failed))} action={{ label: common.retry, onPress: mark }} /> : null}
      </>
    );
  }
  return (
    <Screen title={vi.eodTitle} subtitle={vi.eodSubtitle} onBack={back}>
      {notice}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  night: { borderRadius: radius.surface, padding: 20, gap: 12, marginTop: spacing.section - 8 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  text: { gap: 8 },
});
