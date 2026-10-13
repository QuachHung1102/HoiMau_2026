import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { calorieWindow, type Prescription } from '../../../domain/energy.ts';
import type { Archetype } from '../../../domain/types.ts';
import { healthVi } from '../../shared/i18n/vi/health';
import * as vi from '../../shared/i18n/vi/onboarding';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { useNumberRoll } from '../../shared/ui/Badges';
import { Card } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';

export const ARCHETYPE_ICON: Record<Archetype, IconName> = { TANKER: 'Shield', ASSASSIN: 'Footprints', SUPPORTER: 'Sprout' };

type Props = {
  archetype: Archetype;
  /** Shown as given: the numbers are the domain's (or the server's), never rounded or derived again here. */
  prescription: Prescription;
  /** The actions of the screen that hosts the view (and, at the end of onboarding, the disclaimer). */
  children?: ReactNode;
};

function Explanation({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <AppText weight="semibold" accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant="secondary">{body}</AppText>
    </Card>
  );
}

/**
 * S08 / S62: the daily energy, water and macro estimates of one prescription, with every safety adjustment said
 * out loud (the reviewed copy of health.ts). No screen chrome: the host supplies the title and the actions.
 */
export function TargetsView({ archetype, prescription, children }: Props) {
  const palette = useTheme();
  const { calorieTarget, waterMl, proteinG, fatG, carbsG, safetyClamped, macroAdjusted } = prescription;
  // motion: number-roll (the first value shows at once; a later value counts to its target)
  const kcal = useNumberRoll(calorieTarget);
  // One source for the band: the same function decides the nutrition quest on the server.
  const band = calorieWindow(calorieTarget);
  return (
    <View style={styles.view}>
      <Card tone="soft" style={styles.hero}>
        <Icon name={ARCHETYPE_ICON[archetype]} size={28} />
        <AppText variant="headline">{vi.archetypes[archetype].name}</AppText>
        <AppText>{vi.archetypeIntro[archetype]}</AppText>
        <View style={styles.row}>
          <Icon name="Utensils" />
          <View style={styles.text}>
            <AppText weight="semibold">{vi.energyLabel}</AppText>
            <AppText variant="caption">{vi.kcalPerDay(kcal)}</AppText>
            {safetyClamped ? (
              <View style={[styles.chip, { backgroundColor: palette.white }]}>
                <Icon name="ShieldCheck" size={16} />
                <AppText variant="caption" weight="semibold" color="primary">
                  {healthVi.safetyClamped.chip}
                </AppText>
              </View>
            ) : null}
            <AppText variant="caption">{vi.calorieBand(band.min, band.max)}</AppText>
          </View>
        </View>
        <View style={styles.row}>
          <Icon name="Droplets" />
          <View style={styles.text}>
            <AppText weight="semibold">{vi.waterLabel}</AppText>
            <AppText variant="caption">{vi.mlPerDay(waterMl)}</AppText>
          </View>
        </View>
      </Card>
      {safetyClamped ? <Explanation title={healthVi.safetyClamped.title} body={healthVi.safetyClamped.body(calorieTarget)} /> : null}
      <View style={styles.macros}>
        <AppText variant="title" accessibilityRole="header">
          {vi.macrosTitle}
        </AppText>
        <AppText variant="secondary">{vi.macros(proteinG, fatG, carbsG)}</AppText>
      </View>
      {macroAdjusted ? <Explanation title={healthVi.macroAdjusted.title} body={healthVi.macroAdjusted.body} /> : null}
      <AppText variant="caption">{healthVi.estimate.prescription}</AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  view: { gap: 16, marginTop: spacing.section - 8 },
  hero: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 20, paddingVertical: 4 },
  text: { flex: 1, gap: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.button },
  macros: { gap: 4 },
});
