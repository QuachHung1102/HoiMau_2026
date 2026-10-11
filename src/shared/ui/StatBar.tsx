import { StyleSheet, View } from 'react-native';
import * as vi from '../i18n/vi/pet';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { BarTrack } from './LevelStrip';

export type StatKind = keyof typeof vi.statLabel;

const icons: Record<StatKind, IconName> = { hp: 'Heart', en: 'Zap', str: 'Dumbbell', spd: 'Footprints' };

/** One of the four stats, 0-100, always with its number as text. */
export function StatBar({ kind, value }: { kind: StatKind; value: number }) {
  const now = value > 0 ? Math.min(100, Math.round(value)) : 0;
  const label = vi.statLabel[kind];
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now }}
      style={styles.stat}
    >
      <View style={styles.head}>
        <Icon name={icons[kind]} size={20} />
        <AppText weight="semibold" style={styles.label}>
          {label}
        </AppText>
        <AppText variant="caption">{vi.statValue(now)}</AppText>
      </View>
      <BarTrack ratio={now / 100} track="line" />
    </View>
  );
}

const styles = StyleSheet.create({
  stat: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { flex: 1 },
});
