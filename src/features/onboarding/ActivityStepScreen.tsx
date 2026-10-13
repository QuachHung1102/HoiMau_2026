import { StyleSheet, View } from 'react-native';
import { ACTIVITY_FACTOR } from '../../../domain/energy.ts';
import type { ActivityLevel } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import * as vi from '../../shared/i18n/vi/onboarding';
import { spacing } from '../../shared/theme/tokens';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { RadioRow } from '../../shared/ui/Toggles';
import { fieldMessage } from './BiometricsFields';
import { useOnboarding } from './OnboardingProvider';
import { StepScreen } from './StepScreen';

// The domain's own list, in its order (least to most active).
const LEVELS = Object.keys(ACTIVITY_FACTOR) as ActivityLevel[];

/** S06: how active an ordinary day is. One choice. */
export function ActivityStepScreen({ navigation }: ScreenProps<'OnbActivity'>) {
  const { draft, errors, edit, fail } = useOnboarding();
  const next = () => {
    if (!draft.activityLevel) return fail({ fields: { activityLevel: fieldMessage('activityLevel', 'required') } });
    navigation.navigate('OnbArchetype');
  };
  return (
    <StepScreen title={vi.activityTitle} subtitle={vi.stepOf(vi.activityStep, 2, 3)} onBack={navigation.goBack}>
      <View accessibilityRole="radiogroup" accessibilityLabel={vi.activityGroup} style={styles.group}>
        {LEVELS.map(level => (
          <RadioRow
            key={level}
            label={vi.activityLevels[level].label}
            description={vi.activityLevels[level].description}
            selected={draft.activityLevel === level}
            onPress={() => edit({ activityLevel: level })}
          />
        ))}
      </View>
      {errors.fields.activityLevel ? <InlineError message={errors.fields.activityLevel} /> : null}
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Button label={vi.activityNext} onPress={next} style={styles.next} />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: spacing.section - 8, gap: 8 },
  next: { marginTop: spacing.section - 8 },
});
