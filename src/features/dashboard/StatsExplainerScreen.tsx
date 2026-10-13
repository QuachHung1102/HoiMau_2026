import { StyleSheet, View } from 'react-native';
import type { RouteName, ScreenProps } from '../../app/routes';
import { healthVi } from '../../shared/i18n/vi/health';
import { statLabel } from '../../shared/i18n/vi/pet';
import * as vi from '../../shared/i18n/vi/today';
import { sizes, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Screen } from '../../shared/ui/Screen';
import { StatBar, type StatKind } from '../../shared/ui/StatBar';
import { Touchable } from '../../shared/ui/Touchable';
import { useMe } from '../auth/api';
import { useDay } from '../quests/api';

const STATS = ['hp', 'en', 'str', 'spd'] as const;
// Where the behaviour behind each stat is recorded.
const ACTION = { hp: 'Today', en: 'ManualKcal', str: 'WorkoutCatalog', spd: 'WorkoutCatalog' } as const satisfies Record<StatKind, RouteName>;

/**
 * S47: what each of the four stats is made of, what goes into it right now, and where to act on it. The numbers are
 * the server's (spec F-03: derived, read-only); the inputs are those of the day as the server has it.
 */
export function StatsExplainerScreen({ navigation }: ScreenProps<'StatsExplainer'>) {
  const stats = useMe().data?.stats;
  // A provisional day has no inputs worth stating: they are not the server's.
  const { data, provisional } = useDay();
  const day = provisional ? undefined : data;
  const inputs = (kind: StatKind) => {
    if (kind === 'str' || kind === 'spd') return stats ? vi.minutesInputs(stats[kind]) : undefined;
    if (!day) return undefined;
    return kind === 'hp'
      ? vi.hpInputs(day.waterMl, day.waterTargetMl, day.bedtimeMarkedAt !== null, day.streak.current)
      : vi.enInputs(day.caloriesIn, day.calorieWindow.target);
  };
  return (
    <Screen title={vi.explainerTitle} subtitle={vi.explainerSubtitle} onBack={() => navigation.goBack()}>
      {STATS.map(kind => {
        const now = inputs(kind);
        return (
          <View key={kind} style={styles.stat}>
            {stats ? <StatBar kind={kind} value={stats[kind]} /> : <AppText weight="semibold">{statLabel[kind]}</AppText>}
            <AppText variant="secondary">{vi.statSource[kind]}</AppText>
            {now ? <AppText variant="secondary">{now}</AppText> : null}
            <Touchable accessibilityRole="link" onPress={() => navigation.navigate(ACTION[kind])} style={styles.link}>
              <AppText weight="semibold" color="primary">
                {vi.statAction[kind]}
              </AppText>
            </Touchable>
          </View>
        );
      })}
      <View style={styles.closing}>
        <AppText variant="secondary">{healthVi.estimate.stats}</AppText>
        <AppText variant="secondary">{vi.statsReadOnly}</AppText>
        <Button variant="secondary" label={vi.seeHistory} onPress={() => navigation.navigate('DayHistory')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stat: { gap: 6, marginTop: spacing.section - 8 },
  // A real 48 dp row for a text link.
  link: { minHeight: sizes.minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  closing: { gap: 12, marginTop: spacing.section - 8 },
});
