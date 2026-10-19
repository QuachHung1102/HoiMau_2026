import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GuildState } from '../../../domain/contract/social.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/guild';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { BarTrack } from '../../shared/ui/LevelStrip';
import { Mam } from '../../shared/ui/mam/Mam';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useMe } from '../auth/api';
import { shareInvitation, useGuild } from './api';
import { MemberRow } from './MemberRow';

// A tab root: the tab bar owns the bottom edge.
const EDGES = ['top', 'left', 'right'] as const;

type Guild = NonNullable<GuildState['guild']>;

/** S25: alone, what a guild is for and the two ways in. */
function Empty({ navigation }: Pick<ScreenProps<'Guild'>, 'navigation'>) {
  return (
    <Screen edges={EDGES} title={vi.tabTitle} subtitle={vi.emptySubtitle}>
      <Card tone="soft">
        <Icon name="Users" size={40} />
        <AppText variant="headline" accessibilityRole="header">
          {vi.emptyTitle}
        </AppText>
        <AppText variant="secondary">{vi.emptyBody}</AppText>
        <Button label={vi.joinWithCode} onPress={() => navigation.navigate('GuildJoin')} />
      </Card>
      <Button variant="secondary" label={vi.createGuild} onPress={() => navigation.navigate('GuildCreate')} />
      <AppText variant="secondary" style={styles.footer}>
        {vi.emptyFooter}
      </AppText>
    </Screen>
  );
}

/** S76: a calm hint above the list. Nobody is named, nobody is blamed. */
function QuietHint({ guild, navigation, focused }: { guild: Guild; navigation: ScreenProps<'Guild'>['navigation']; focused: boolean }) {
  const stage = useMe().data?.pet?.stage ?? 'EGG';
  const [shareFailed, setShareFailed] = useState(false);
  const share = () => {
    setShareFailed(false);
    shareInvitation(guild.name, guild.inviteCode).catch(() => setShareFailed(true));
  };
  return (
    <>
      <Card tone="soft">
        <View style={styles.hint}>
          {/* decorative: the words say the same. motion: mam-tired (lives in Mam) */}
          <Mam stage={stage} mood="TIRED" size={72} animation="idle" decorative active={focused} />
          <View style={styles.hintText}>
            <AppText variant="title" accessibilityRole="header">
              {vi.quietTitle}
            </AppText>
            <AppText variant="secondary">{vi.quietBody(guild.inactiveDays)}</AppText>
          </View>
        </View>
      </Card>
      {shareFailed ? <InlineError message={vi.shareFailed} /> : null}
      <Button label={vi.shareCode} onPress={share} />
      <Button variant="secondary" label={vi.findOtherGuild} onPress={() => navigation.navigate('GuildManage', { focus: 'leave' })} />
    </>
  );
}

/** S27: the guild, its week and its members. S76 (the same screen) when the guild has been quiet for a fortnight. */
function Members({ guild, navigation }: { guild: Guild; navigation: ScreenProps<'Guild'>['navigation'] }) {
  const palette = useTheme();
  const focused = useIsFocused();
  const percent = Math.round(guild.weekCompletion * 100);
  const line = vi.weekLine(percent);
  return (
    <Screen edges={EDGES} title={guild.name} subtitle={guild.motto || vi.guildSubtitle}>
      {guild.inactive ? (
        <QuietHint guild={guild} navigation={navigation} focused={focused} />
      ) : (
        <Card tone="primary">
          <Icon name="Users" size={32} color={palette.white} />
          <AppText variant="headline" color="white" accessibilityRole="header">
            {vi.headerTitle}
          </AppText>
          <AppText variant="secondary" color="white">
            {vi.headerBody}
          </AppText>
          <View accessible accessibilityRole="progressbar" accessibilityLabel={line} accessibilityValue={{ min: 0, max: 100, now: percent }} style={styles.bar}>
            <AppText weight="semibold" color="white">
              {line}
            </AppText>
            {/* motion: progress-fill */}
            <BarTrack ratio={guild.weekCompletion} onPrimary />
          </View>
        </Card>
      )}
      <View accessibilityLabel={vi.membersLabel} style={styles.list}>
        {guild.members.map(member => (
          <MemberRow key={member.userId} member={member} onNudge={() => navigation.navigate('Nudge', { receiverId: member.userId, receiverName: member.displayName })} />
        ))}
      </View>
      <Button variant="secondary" label={vi.seeLeaderboard} onPress={() => navigation.navigate('Leaderboard')} />
      <Button variant="secondary" label={vi.inviteAndManage} onPress={() => navigation.navigate('GuildManage')} />
    </Screen>
  );
}

/** The root of the "Tổ đội" tab: S25 without a guild, S27 (S76 when it is quiet) with one. */
export function GuildScreen({ navigation }: ScreenProps<'Guild'>) {
  const focused = useIsFocused();
  const query = useGuild();
  const state = query.data;
  if (!state) {
    return (
      <Screen edges={EDGES} title={vi.tabTitle}>
        {query.isError && !query.isFetching ? (
          <ErrorState message={query.error instanceof ApiError && query.error.code !== 'INTERNAL' ? failureText(query.error.code) : vi.loadFailed} onRetry={() => query.refetch()} />
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }
  return state.guild ? <Members guild={state.guild} navigation={navigation} /> : <Empty navigation={navigation} />;
}

const styles = StyleSheet.create({
  footer: { marginTop: 8 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hintText: { flex: 1, gap: 4 },
  bar: { gap: 8, marginTop: 4 },
  list: { marginVertical: 8 },
});
