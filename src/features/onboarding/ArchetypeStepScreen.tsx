import { StyleSheet, View } from 'react-native';
import type { Archetype } from '../../../domain/types.ts';
import { allowedArchetypes } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import * as vi from '../../shared/i18n/vi/onboarding';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { Touchable } from '../../shared/ui/Touchable';
import { fieldMessage, parseDecimal } from './BiometricsFields';
import { useOnboarding } from './OnboardingProvider';
import { SafetySheet } from './SafetySheet';
import { StepScreen } from './StepScreen';
import { ARCHETYPE_ICON } from './TargetsView';

const ARCHETYPES: readonly Archetype[] = ['TANKER', 'ASSASSIN', 'SUPPORTER'];

function ArchetypeCard({ archetype, selected, onPress }: { archetype: Archetype; selected: boolean; onPress: () => void }) {
  const palette = useTheme();
  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      // motion: archetype-lift (tier 2, static: the border, the tone and the check mark of the choice appear at once)
      style={[styles.card, { backgroundColor: selected ? palette.soft : palette.white, borderColor: selected ? palette.primary : palette.line }]}
    >
      <Icon name={ARCHETYPE_ICON[archetype]} />
      <View style={styles.text}>
        <AppText weight="semibold">{vi.archetypes[archetype].headline}</AppText>
        <AppText variant="caption">{vi.archetypeLine(archetype)}</AppText>
      </View>
      {/* the mark, not the tone, says which one is chosen */}
      <Icon name={selected ? 'CircleCheck' : 'Circle'} color={selected ? palette.primary : palette.muted} />
    </Touchable>
  );
}

/** S07 (with S43 as a sheet): the direction that filters the suggested meals and workouts. One choice. */
export function ArchetypeStepScreen({ navigation }: ScreenProps<'OnbArchetype'>) {
  const { draft, errors, block, edit, fail, setBlock } = useOnboarding();
  const heightCm = parseDecimal(draft.heightCm);
  const weightKg = parseDecimal(draft.weightKg);
  // Without readable measurements nothing is ruled out here; the server checks again in any case.
  const allowed = heightCm !== null && weightKg !== null ? allowedArchetypes(heightCm, weightKg) : ARCHETYPES;

  // The refused direction is never selected, so it can never be confirmed.
  const refuse = () => {
    if (draft.archetype && !allowed.includes(draft.archetype)) edit({ archetype: null });
    setBlock('archetype');
  };
  const next = () => {
    if (!draft.archetype) return fail({ fields: { archetype: fieldMessage('archetype', 'required') } });
    if (!allowed.includes(draft.archetype)) return refuse();
    navigation.navigate('OnbTargets');
  };

  return (
    <StepScreen title={vi.archetypeTitle} subtitle={vi.stepOf(vi.archetypeStep, 3, 3)} onBack={navigation.goBack}>
      <View accessibilityRole="radiogroup" accessibilityLabel={vi.archetypeGroup} style={styles.group}>
        {ARCHETYPES.map(archetype => (
          <ArchetypeCard
            key={archetype}
            archetype={archetype}
            selected={draft.archetype === archetype}
            onPress={() => (allowed.includes(archetype) ? edit({ archetype }) : refuse())}
          />
        ))}
      </View>
      <AppText variant="secondary">{vi.archetypeNote}</AppText>
      {errors.fields.archetype ? <InlineError message={errors.fields.archetype} /> : null}
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Button label={vi.archetypeNext} onPress={next} style={styles.next} />
      {block === 'archetype' ? (
        <SafetySheet
          allowed={allowed}
          onChoose={archetype => {
            edit({ archetype });
            setBlock(null);
            navigation.navigate('OnbTargets');
          }}
          onReviewProfile={() => {
            setBlock(null);
            navigation.navigate('OnbProfile', undefined, { pop: true });
          }}
          onDismiss={() => setBlock(null)}
        />
      ) : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: spacing.section - 8, gap: 16, marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderWidth: 1, borderRadius: radius.surface },
  text: { flex: 1, gap: 2 },
  next: { marginTop: spacing.section - 8 },
});
