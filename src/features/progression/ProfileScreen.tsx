import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { useSession } from '../../shared/api/session';
import * as authVi from '../../shared/i18n/vi/auth';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { archetypes } from '../../shared/i18n/vi/onboarding';
import * as vi from '../../shared/i18n/vi/progression';
import * as today from '../../shared/i18n/vi/today';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { sizes, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { CoinChip } from '../../shared/ui/Badges';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { LevelStrip } from '../../shared/ui/LevelStrip';
import { Mam } from '../../shared/ui/mam/Mam';
import { Screen } from '../../shared/ui/Screen';
import { LoadingState } from '../../shared/ui/States';
import { Touchable } from '../../shared/ui/Touchable';
import { useMe } from '../auth/api';

// The tab bar owns the bottom edge.
const EDGES = ['top', 'left', 'right'] as const;
const AVATAR = 72;

type Entry = { key: keyof typeof vi.profileRows; icon: IconName; route: 'Journey' | 'Pet' | 'Levels' | 'JournalWrite' | 'Settings' };
// The rows of the tab, in order: a task that adds a destination adds a line here.
const ENTRIES: readonly Entry[] = [
  { key: 'journey', icon: 'ChartNoAxesColumn', route: 'Journey' },
  { key: 'pet', icon: 'Sprout', route: 'Pet' },
  { key: 'levels', icon: 'Award', route: 'Levels' },
  { key: 'journal', icon: 'NotebookPen', route: 'JournalWrite' },
  { key: 'settings', icon: 'Settings', route: 'Settings' },
];

/**
 * The way out, kept quiet at the end of the list. It is here because this tab replaced the placeholder that was the only
 * place besides "Tổ đội" where an onboarded user could sign out; the Settings screen (Task 47) takes it over.
 * `signOut` itself asks first when records are still waiting to be sent.
 */
function SignOutRow() {
  const palette = useTheme();
  const { signOut } = useSession();
  const [leaving, setLeaving] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ busy: leaving }}
      onPress={
        leaving
          ? undefined
          : () => {
              setLeaving(true);
              // It also settles when the person chose to stay: the row must work again then.
              signOut().finally(() => {
                if (mounted.current) setLeaving(false);
              });
            }
      }
      style={styles.signOut}
    >
      <Icon name="LogOut" size={20} color={palette.muted} />
      <AppText color="muted" weight="semibold">
        {authVi.signOut}
      </AppText>
    </Touchable>
  );
}

/** S31, the root of the "Cá nhân" tab: who the person is, their level, and the ways into the progress screens. */
export function ProfileScreen({ navigation }: ScreenProps<'Profile'>) {
  const palette = useTheme();
  const me = useMe().data;
  const progression = me?.progression;
  return (
    <Screen edges={EDGES} title={tabLabel.Profile} subtitle={vi.profileSubtitle}>
      {me ? (
        <>
          <View style={styles.section}>
            <Card tone="soft">
              <View style={[styles.avatar, { backgroundColor: palette.white }]}>
                {me.pet ? <Mam stage={me.pet.stage} mood={me.pet.mood} skin={me.pet.skinCode === 'SKIN_FOX' ? 'fox' : undefined} size={56} /> : null}
              </View>
              <AppText variant="headline">{me.user.displayName}</AppText>
              {me.user.archetype ? <AppText variant="secondary">{archetypes[me.user.archetype].name}</AppText> : null}
              {progression ? (
                <View style={styles.level}>
                  <View style={styles.fill}>
                    <LevelStrip
                      level={progression.level}
                      title={today.levelTitleText[progression.titleKey]}
                      xpIntoLevel={progression.xpIntoLevel}
                      xpForNextLevel={progression.xpForNextLevel}
                      track="white"
                    />
                  </View>
                  <CoinChip coin={progression.coin} />
                </View>
              ) : null}
            </Card>
          </View>
          <View style={styles.section}>
            {ENTRIES.map(({ key, icon, route }) => (
              <ListRow key={key} icon={icon} {...vi.profileRows[key]} onPress={() => navigation.navigate(route)} />
            ))}
            <SignOutRow />
          </View>
        </>
      ) : (
        <View style={styles.section}>
          <LoadingState />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // `Screen` puts 8 between blocks; a section starts further down.
  section: { marginTop: spacing.section - 8 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center' },
  level: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.minTouch, paddingVertical: 12 },
});
