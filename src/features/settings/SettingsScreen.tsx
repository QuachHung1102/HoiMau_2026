import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { useSession } from '../../shared/api/session';
import * as authVi from '../../shared/i18n/vi/auth';
import * as vi from '../../shared/i18n/vi/settings';
import { spacing } from '../../shared/theme/tokens';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { Switch } from '../../shared/ui/Toggles';
import { useSettings } from './api';

type Entry = { key: keyof typeof vi.rows; icon: IconName; route: 'EditProfile' | 'NotificationSettings' | 'Display' | 'Privacy' | 'Help' };
// The rows in the order of the frame; the sound switch sits between "Thông báo" and "Hiển thị & chuyển động".
const BEFORE_SOUND: readonly Entry[] = [
  { key: 'profile', icon: 'User', route: 'EditProfile' },
  { key: 'notifications', icon: 'Bell', route: 'NotificationSettings' },
];
const AFTER_SOUND: readonly Entry[] = [
  { key: 'display', icon: 'Accessibility', route: 'Display' },
  { key: 'privacy', icon: 'ShieldCheck', route: 'Privacy' },
  { key: 'help', icon: 'Info', route: 'Help' },
];

/**
 * Leaves through `session.signOut`, which asks first when records are still waiting to be sent (Task 24): the button works
 * again when the person chose to stay.
 */
function SignOut() {
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
    <Button
      variant="secondary"
      label={authVi.signOut}
      loading={leaving}
      onPress={() => {
        setLeaving(true);
        signOut().finally(() => {
          if (mounted.current) setLeaving(false);
        });
      }}
      style={styles.signOut}
    />
  );
}

/** S35: where the person adjusts the app and leaves it. */
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const motion = useSettings().data?.motion;
  const row = ({ key, icon, route }: Entry) => {
    const text = vi.rows[key];
    // The display row says what the motion setting is, once it is known.
    const description = 'description' in text ? text.description : motion && vi.motionWords[motion];
    return <ListRow key={key} icon={icon} title={text.title} description={description} onPress={() => navigation.navigate(route)} />;
  };
  return (
    <Screen title={vi.title} subtitle={vi.subtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <View style={styles.list}>
        {BEFORE_SOUND.map(row)}
        {/* AR-22: this build is silent. The switch is off, cannot be turned on, and its name says why. */}
        <View style={styles.sound}>
          <Icon name="VolumeX" />
          <View style={styles.fill}>
            <Switch label={`${vi.sound}. ${vi.soundUnavailable}`} value={false} onChange={() => undefined} disabled />
          </View>
        </View>
        {AFTER_SOUND.map(row)}
        <SignOut />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: spacing.section - 8, gap: 4 },
  sound: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  fill: { flex: 1 },
  signOut: { marginTop: spacing.section - 8 },
});
