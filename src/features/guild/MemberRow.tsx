import { StyleSheet, View } from 'react-native';
import type { GuildMember } from '../../../domain/contract/social.ts';
import * as vi from '../../shared/i18n/vi/guild';
import { ListRow } from '../../shared/ui/Card';
import type { IconName } from '../../shared/ui/Icon';
import { DisabledReason } from '../../shared/ui/Notices';

/**
 * What a row may know about a teammate: completion of the shared habits, the level and whether a nudge is welcome.
 * There is deliberately no prop for a measurement of anyone (weight, height, calories): the guild read model has none.
 */
type Props = {
  member: Pick<GuildMember, 'displayName' | 'level' | 'isMe' | 'daysCompletedThisWeek' | 'daysCountedThisWeek' | 'storyDoneToday' | 'nudge'>;
  /** Opens the nudge for this member; only called when the server says a nudge is allowed. */
  onNudge: () => void;
};

/** One teammate: "An · bạn", "Cấp L · d/c ngày", the state in words. Only a member who can be nudged now is a button. */
export function MemberRow({ member, onNudge }: Props) {
  const { displayName, isMe, nudge, storyDoneToday } = member;
  // The own row has no nudge at all; a member who is done needs none; a refused one says why, in place.
  const canNudge = !isMe && nudge.allowed;
  const reason = !isMe && !nudge.allowed && !storyDoneToday ? vi.notNudgeable[nudge.reason ?? 'NOT_IN_GUILD'] : undefined;
  const state = storyDoneToday ? vi.doneToday : canNudge ? vi.canNudge : undefined;
  const description = [vi.levelLine(member.level, member.daysCompletedThisWeek, member.daysCountedThisWeek), state].filter(Boolean).join(vi.dot);
  const icon: IconName = storyDoneToday ? 'CircleCheck' : canNudge ? 'Bell' : nudge.reason === 'NUDGE_RECEIVER_MUTED' ? 'BellOff' : 'Circle';
  return (
    <View>
      <ListRow icon={icon} title={vi.nameLine(displayName, isMe)} description={description} onPress={canNudge ? onNudge : undefined} />
      {reason ? (
        <View style={styles.reason}>
          <DisabledReason reason={reason} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // under the text of the row: the icon (24) and the gap (16) of ListRow
  reason: { marginLeft: 40, marginTop: -8, marginBottom: 8 },
});
