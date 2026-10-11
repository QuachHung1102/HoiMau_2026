import { StyleSheet, View } from 'react-native';
import * as vi from '../i18n/vi/pet';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

type Props = {
  days: number;
  achieved: boolean;
  /** Days still to go; without it an unachieved badge says "Chưa đạt". */
  remaining?: number;
};

/** A streak milestone (7 / 30 / 100). The state is always written under the badge, never colour alone. */
export function MilestoneBadge({ days, achieved, remaining }: Props) {
  const palette = useTheme();
  const count = vi.dayCount(days);
  const status = achieved ? vi.milestoneAchieved : remaining == null ? vi.milestoneNotYet : vi.milestoneRemaining(remaining);
  const tone = achieved ? 'flame' : 'muted';
  return (
    <View accessible accessibilityLabel={`${count}. ${status}`} style={styles.badge}>
      <View
        style={[
          styles.circle,
          achieved
            ? { backgroundColor: palette.flameSoft, borderColor: palette.flame }
            : { backgroundColor: palette.white, borderColor: palette.line },
        ]}
      >
        <AppText variant="headline" color={tone}>
          {days}
        </AppText>
      </View>
      <View style={[styles.pill, { backgroundColor: achieved ? palette.flame : palette.soft }]}>
        <AppText variant="caption" weight="semibold" color={achieved ? 'white' : 'muted'}>
          {count}
        </AppText>
      </View>
      <AppText variant="caption" weight={achieved ? 'semibold' : 'regular'} color={tone}>
        {status}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', gap: 6 },
  // min sizes, not sizes: "100" at a large font scale widens the circle instead of clipping.
  circle: { minWidth: 72, minHeight: 72, paddingHorizontal: 8, borderRadius: 999, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 10 },
});
