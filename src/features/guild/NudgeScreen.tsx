import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/guild';
import { failureText } from '../../shared/i18n/vi/sync';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { DisabledReason, InlineError, useAnnounceOnIos } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { RadioRow } from '../../shared/ui/Toggles';
import { nudgeTemplatesKey, useGuild, useNudgeTemplates, useReadGuildAgain, useSendNudge } from './api';

/** The answers of the server that mean "not now" (S74): said calmly, with one way out. Anything else is a failure to retry. */
const NOT_NOW = ['NUDGE_RECEIVER_MUTED', 'NUDGE_RECEIVER_LIMIT', 'NUDGE_SENDER_LIMIT', 'NUDGE_OUTSIDE_WINDOW', 'NUDGE_NOT_NEEDED', 'NUDGE_NOT_SAME_GUILD', 'NOT_IN_GUILD'];

/**
 * motion: nudge-sent (tier 1). The paper plane leaves up and to the right while it fades; the line under the button
 * fades in 200 ms later. No confetti. Reduced motion: neither moves, the button and the line say it in words.
 */
function Plane() {
  const [flight] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(flight, { toValue: 1, duration: motion.durationsMs.countUp, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [flight]);
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.plane,
        {
          opacity: flight.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateX: flight.interpolate({ inputRange: [0, 1], outputRange: [0, 70] }) },
            { translateY: flight.interpolate({ inputRange: [0, 1], outputRange: [0, -60] }) },
            { rotate: flight.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-12deg'] }) },
          ],
        },
      ]}
    >
      <Icon name="Send" />
    </Animated.View>
  );
}
function SentLine({ text, reduced }: { text: string; reduced: boolean }) {
  const [shown] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) return;
    const run = Animated.timing(shown, { toValue: 1, delay: 200, duration: motion.durationsMs.feedback, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [reduced, shown]);
  // Never fully transparent: a screen reader may skip a view that is.
  return (
    <Animated.View accessibilityLiveRegion="polite" style={{ opacity: shown.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] }) }}>
      <AppText variant="secondary">{text}</AppText>
    </Animated.View>
  );
}

/** What kind of "not now" it is: a clock for what clears with time, a muted bell, a tick for done already; anything else is the plain info mark. */
const REASON_ICON: Record<string, IconName> = {
  NUDGE_OUTSIDE_WINDOW: 'Clock',
  NUDGE_RECEIVER_LIMIT: 'Clock',
  NUDGE_SENDER_LIMIT: 'Clock',
  NUDGE_RECEIVER_MUTED: 'BellOff',
  NUDGE_NOT_NEEDED: 'CircleCheck',
};

/** S74: the calm reason. A live region (and an announcement on iOS, which has none), because the form the person pressed is replaced by it. */
function Blocked({ code, name }: { code: string; name: string }) {
  const reason = vi.nudgeBlocked(code, name);
  useAnnounceOnIos(reason);
  return (
    <Card tone="soft" accessibilityLiveRegion="polite">
      <AppText variant="title" accessibilityRole="header">
        {vi.nudgeBlockedTitle}
      </AppText>
      <DisabledReason reason={reason} icon={REASON_ICON[code]} />
    </Card>
  );
}

type Problem = { text: string; again?: () => void };

/**
 * S29: one of the fixed lines for one teammate. S74 (the same screen): why it cannot be sent now, read from the guild the
 * screen already has (no request at all) or from the server's refusal. The send needs the network and goes out once.
 */
export function NudgeScreen({ route, navigation }: ScreenProps<'Nudge'>) {
  const { receiverId, receiverName: name } = route.params;
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();
  const guild = useGuild().data?.guild;
  const readAgain = useReadGuildAgain();
  // A teammate who cannot be nudged says why in the guild read (`GuildMember.nudge.reason`); then nothing is asked.
  const known = guild?.members.find(member => member.userId === receiverId && !member.isMe)?.nudge.reason ?? null;
  const templates = useNudgeTemplates(known === null);
  const [send, sending] = useSendNudge();
  const [picked, setPicked] = useState<string | null>(null);
  const [sentLeft, setSentLeft] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const header = { title: vi.nudgeTitle, subtitle: vi.nudgeSubtitle(name), onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  const sent = sentLeft !== null;
  const blocked = sent ? null : refusal ?? known;

  if (blocked) {
    return (
      <Screen {...header}>
        <Blocked code={blocked} name={name} />
        <Button variant="secondary" label={vi.nudgeLater} onPress={navigation.goBack} />
      </Screen>
    );
  }

  const submit = async (code: string) => {
    setProblem(null);
    const outcome = await send(receiverId, code);
    if (!outcome) return;
    if (outcome.state === 'done') {
      setSentLeft(outcome.result.senderRemainingToday);
      return;
    }
    if (NOT_NOW.includes(outcome.code)) {
      setRefusal(outcome.code);
      readAgain();
    } else if (outcome.code === 'NUDGE_TEMPLATE_UNKNOWN') {
      // The list on this screen is out of date: read it again and choose anew.
      setPicked(null);
      setProblem({ text: vi.templateGone });
      queryClient.invalidateQueries({ queryKey: nudgeTemplatesKey });
    } else {
      setProblem({ text: failureText(outcome.code), again: outcome.code === 'NETWORK' || outcome.code === 'TIMEOUT' ? () => submit(code) : undefined });
    }
  };

  const list = templates.data?.templates;
  return (
    <Screen {...header}>
      {list ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={vi.templatesLabel}>
          {list.map(template => (
            <RadioRow key={template.code} label={template.text} selected={picked === template.code} disabled={sending || sent} onPress={() => setPicked(template.code)} />
          ))}
        </View>
      ) : templates.isError && !templates.isFetching ? (
        <ErrorState message={templates.error instanceof ApiError && templates.error.code !== 'INTERNAL' ? failureText(templates.error.code) : vi.templatesFailed} onRetry={() => templates.refetch()} />
      ) : (
        <LoadingState active={focused} />
      )}
      <AppText variant="secondary">{vi.nudgeRules(name)}</AppText>
      {list && picked === null && !sent ? <DisabledReason reason={vi.pickTemplate} /> : null}
      {problem ? <InlineError message={problem.text} action={problem.again ? { label: retry, onPress: problem.again } : undefined} /> : null}
      <View>
        <Button
          variant={sent ? 'secondary' : 'primary'}
          label={sent ? vi.nudgeSent : vi.nudgeSend(name)}
          loading={sending}
          disabled={picked === null || sent}
          // Sent is a result, not a refusal: it keeps its full colour while it cannot be pressed again.
          style={sent ? styles.done : undefined}
          onPress={() => picked && submit(picked)}
        />
        {sent && !reduced ? <Plane /> : null}
      </View>
      {sentLeft !== null ? <SentLine text={vi.nudgeLeft(sentLeft)} reduced={reduced} /> : null}
      <Button variant="secondary" label={sent ? vi.nudgeClose : vi.nudgeLater} onPress={navigation.goBack} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  plane: { position: 'absolute', right: 16, top: 12 },
  done: { opacity: 1 },
});
