import { StyleSheet, View } from 'react-native';
import * as vi from '../i18n/vi/pet';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { AppText } from './AppText';

type Props = {
  days: number;
  achieved: boolean;
  /** Days still to go; without it an unachieved badge says "Chưa đạt". */
  remaining?: number;
};

/** The round medal with the number of days. Achieved is the only place the medal takes the flame colours. */
export function MilestoneMedal({ days, achieved }: { days: number; achieved: boolean }) {
  const palette = useTheme();
  return (
    <View
      style={[
        styles.circle,
        achieved
          ? { backgroundColor: palette.flameSoft, borderColor: palette.flame }
          : { backgroundColor: palette.white, borderColor: palette.line },
      ]}
    >
      <AppText weight="bold" color={achieved ? 'flame' : 'muted'} style={styles.numeral}>
        {days}
      </AppText>
    </View>
  );
}

/** The pill under the medal. */
export function MilestoneRibbon({ text, achieved }: { text: string; achieved: boolean }) {
  const palette = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: achieved ? palette.flame : palette.soft }]}>
      <AppText variant="caption" weight="semibold" color={achieved ? 'white' : 'muted'}>
        {text}
      </AppText>
    </View>
  );
}

/** A streak milestone (7 / 30 / 100). The state is always written under the badge, never colour alone. */
export function MilestoneBadge({ days, achieved, remaining }: Props) {
  const count = vi.dayCount(days);
  const status = achieved ? vi.milestoneAchieved : remaining == null ? vi.milestoneNotYet : vi.milestoneRemaining(remaining);
  return (
    <View accessible accessibilityLabel={`${count}. ${status}`} style={styles.badge}>
      <MilestoneMedal days={days} achieved={achieved} />
      <MilestoneRibbon text={count} achieved={achieved} />
      <AppText variant="caption" weight={achieved ? 'semibold' : 'regular'} color={achieved ? 'flame' : 'muted'}>
        {status}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', gap: 6 },
  // min sizes, not sizes: "100" at a large font scale widens the circle instead of clipping.
  circle: { minWidth: 72, minHeight: 72, paddingHorizontal: 8, borderRadius: 999, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  // S21: the numeral is Inter bold, a little under the headline size.
  numeral: { fontSize: 26, lineHeight: 32 },
  pill: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: radius.button },
});
