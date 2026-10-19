import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GuildMember } from '../../../domain/contract/social.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/guild';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Dialog } from '../../shared/ui/Dialog';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { TextField } from '../../shared/ui/TextField';
import { shareInvitation, useGuild, useLeaveGuild, useReadGuildAgain, useTransferGuild } from './api';

type Asked = { kind: 'transfer'; member: Pick<GuildMember, 'userId' | 'displayName'> } | { kind: 'leave' };
type Refused = { text: string; again?: () => void };

/** The refusals of the two writes, in words; a connection that was lost can be tried again with the same request. */
function refusalText(code: string) {
  switch (code) {
    case 'NOT_LEADER':
      return vi.notLeaderAny;
    case 'TRANSFER_TARGET_INVALID':
      return vi.transferTargetGone;
    case 'LEADER_MUST_TRANSFER':
      return vi.leaderMustTransfer;
    case 'NOT_IN_GUILD':
      return vi.notInGuild;
    default:
      return failureText(code);
  }
}
/** What the server said was news to this screen (a role or a membership that changed): read the guild again. */
const stale = (code: string) => ['NOT_LEADER', 'TRANSFER_TARGET_INVALID', 'LEADER_MUST_TRANSFER', 'NOT_IN_GUILD'].includes(code);

/** S54: the invite code and sharing it, the members and their roles, the nudge settings and leaving. */
export function GuildManageScreen({ navigation }: ScreenProps<'GuildManage'>) {
  const focused = useIsFocused();
  const query = useGuild();
  const [transfer] = useTransferGuild();
  const [leave] = useLeaveGuild();
  const readAgain = useReadGuildAgain();
  const [asked, setAsked] = useState<Asked | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  const [transferredTo, setTransferredTo] = useState<string | null>(null);
  const guild = query.data?.guild;
  const header = { title: vi.manageTitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!query.data) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? (
          <ErrorState message={query.error instanceof ApiError && query.error.code !== 'INTERNAL' ? failureText(query.error.code) : vi.loadFailed} onRetry={() => query.refetch()} />
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }
  if (!guild) {
    return (
      <Screen {...header}>
        <EmptyState title={vi.noGuildTitle} body={vi.noGuildBody} primary={{ label: vi.backToGuild, onPress: () => navigation.navigate('Guild') }} />
      </Screen>
    );
  }

  const isLeader = guild.myRole === 'LEADER';
  const others = guild.members.length > 1;
  const leaderBlocked = isLeader && others;

  const failed = (code: string, again: () => void) => {
    setRefused({ text: refusalText(code), again: code === 'NETWORK' || code === 'TIMEOUT' ? again : undefined });
    if (stale(code)) readAgain();
  };
  const doTransfer = async (member: Pick<GuildMember, 'userId' | 'displayName'>) => {
    setRefused(null);
    setTransferredTo(null);
    const outcome = await transfer(member.userId);
    if (!outcome) return;
    setAsked(null);
    if (outcome.state === 'done') setTransferredTo(member.displayName);
    else failed(outcome.code, () => doTransfer(member));
  };
  const doLeave = async () => {
    setRefused(null);
    setTransferredTo(null);
    const outcome = await leave();
    if (!outcome) return;
    setAsked(null);
    if (outcome.state === 'done') navigation.navigate('Guild');
    else failed(outcome.code, doLeave);
  };
  const share = () => {
    setShareFailed(false);
    shareInvitation(guild.name, guild.inviteCode).catch(() => setShareFailed(true));
  };

  return (
    <Screen {...header} subtitle={guild.name} hasInputs>
      <TextField label={vi.inviteCodeLabel} value={guild.inviteCode} editable={false} selectTextOnFocus />
      {shareFailed ? <InlineError message={vi.shareFailed} /> : null}
      <Button label={vi.shareCode} onPress={share} />

      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.membersTitle}
        </AppText>
        <AppText variant="caption">{vi.membersHint}</AppText>
        {guild.members.map(member => (
          <View key={member.userId}>
            <ListRow icon="User" title={vi.nameLine(member.displayName, member.isMe)} description={vi.roleLabel[member.role]} />
            {isLeader && !member.isMe ? (
              <Button variant="secondary" label={vi.transferAction} accessibilityLabel={vi.transferTo(member.displayName)} onPress={() => setAsked({ kind: 'transfer', member })} />
            ) : null}
          </View>
        ))}
        {transferredTo ? (
          <View accessibilityLiveRegion="polite">
            <AppText variant="secondary">{vi.transferred(transferredTo)}</AppText>
          </View>
        ) : null}
      </View>

      <ListRow icon="Bell" title={vi.nudgeSettingsTitle} description={vi.nudgeSettingsHint} onPress={() => navigation.navigate('NotificationSettings')} />

      <Card>
        <AppText variant="title" accessibilityRole="header">
          {vi.leaveTitle}
        </AppText>
        <AppText variant="secondary">{vi.leaveBody}</AppText>
        {leaderBlocked ? <DisabledReason reason={vi.leaderMustTransfer} /> : null}
        {refused ? <InlineError message={refused.text} action={refused.again ? { label: retry, onPress: refused.again } : undefined} /> : null}
        <Button variant="secondary" label={vi.leaveAction} disabled={leaderBlocked} onPress={() => setAsked({ kind: 'leave' })} />
      </Card>

      {asked?.kind === 'transfer' ? (
        <Dialog
          title={vi.transferTitle}
          body={vi.transferBody(asked.member.displayName)}
          primary={{ label: vi.transferConfirm, onPress: () => doTransfer(asked.member) }}
          secondary={{ label: vi.transferCancel, onPress: () => setAsked(null) }}
          onDismiss={() => setAsked(null)}
        />
      ) : null}
      {asked?.kind === 'leave' ? (
        <Dialog
          title={vi.leaveDialogTitle}
          body={vi.leaveDialogBody(guild.name)}
          note={others ? undefined : vi.leaveAloneNote}
          primary={{ label: vi.leaveConfirm, onPress: doLeave }}
          secondary={{ label: vi.leaveCancel, onPress: () => setAsked(null) }}
          onDismiss={() => setAsked(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, gap: 4 },
});
