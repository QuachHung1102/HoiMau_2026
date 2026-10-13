import type { ComponentProps } from 'react';
import { calculatePrescription, macroSplit } from '../../../domain/energy.ts';
import { AppNavigation } from '../../../src/app/navigation';
import { meKey } from '../../../src/features/auth/api';
import { timezonesKey } from '../../../src/features/onboarding/api';
import { fieldMessage } from '../../../src/features/onboarding/BiometricsFields';
import { OnboardingProvider } from '../../../src/features/onboarding/OnboardingProvider';
import { TargetsView } from '../../../src/features/onboarding/TargetsView';
import * as vi from '../../../src/shared/i18n/vi/onboarding';
import { Screen } from '../../../src/shared/ui/Screen';
import { withApp, type Entries } from '../harness';

const userId = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';
const me = {
  user: { id: userId, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: null, archetypeChangeAvailableAt: null, onboarded: false },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
};
const zones = { zones: ['Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Tokyo', 'Europe/Paris', 'UTC'] };

type Initial = NonNullable<ComponentProps<typeof OnboardingProvider>['initial']>;
type Step = 'OnbProfile' | 'OnbActivity' | 'OnbArchetype' | 'OnbTargets';

// Illustrative values, as in the frames (1999, 170 cm, 65 kg).
const profile = { birthYear: '1999', heightCm: '170', weightKg: '65', sex: 'MALE', timezone: 'Asia/Ho_Chi_Minh' } as const;

/**
 * One onboarding step inside the real navigators, for a signed-in user who has not finished onboarding. The harness
 * mounts `AppNavigation` itself only for `route` entries, without this feature's provider, so it is mounted here the
 * way App.tsx does. Reduced motion: the screenshot is taken at once, not in the middle of the step's fade.
 */
const step = (name: Step, initial: Initial = {}) =>
  withApp(
    <OnboardingProvider initial={initial}>
      <AppNavigation initialState={{ routes: [{ name }] }} />
    </OnboardingProvider>,
    {
      session: { userId },
      motion: 'REDUCED',
      queries: [
        [meKey, me],
        [timezonesKey, zones],
      ],
    },
  );

export const entries: Entries = {
  's05-profile': () => step('OnbProfile', { draft: profile }),
  's60-profile-errors': () =>
    step('OnbProfile', { draft: { ...profile, heightCm: '250' }, errors: { fields: { heightCm: fieldMessage('heightCm', 'max') } } }),
  's61-under-16': () => step('OnbProfile', { draft: profile, block: 'age' }),
  's06-activity': () => step('OnbActivity', { draft: { ...profile, activityLevel: 'LIGHT' } }),
  's07-archetype': () => step('OnbArchetype', { draft: { ...profile, activityLevel: 'LIGHT', archetype: 'TANKER' } }),
  // measurements for which the reduce-fat direction is not offered
  's43-safety-sheet': () => step('OnbArchetype', { draft: { ...profile, heightCm: '175', weightKg: '55', activityLevel: 'LIGHT' }, block: 'archetype' }),
  's08-targets': () => step('OnbTargets', { draft: { ...profile, activityLevel: 'MODERATE', archetype: 'TANKER' } }),
  // a target the domain raises to the floor
  's62-targets-clamped': () =>
    step('OnbTargets', { draft: { birthYear: '1986', heightCm: '160', weightKg: '50', sex: 'FEMALE', timezone: 'Asia/Ho_Chi_Minh', activityLevel: 'SEDENTARY', archetype: 'ASSASSIN' } }),
  // The fallback split cannot be reached with measurements inside the valid ranges, so the view is shown on a
  // prescription built with the domain's own macroSplit for a made-up case.
  's08-targets-macro-adjusted': () => {
    const base = calculatePrescription({ heightCm: 170, weightKg: 65, ageYears: 27, sex: 'MALE', activityLevel: 'MODERATE', archetype: 'TANKER' });
    return withApp(
      <Screen title={vi.targetsTitle} subtitle={vi.targetsSubtitle}>
        <TargetsView archetype="TANKER" prescription={{ ...base, calorieTarget: 1500, ...macroSplit(1500, 150, 'TANKER') }} />
      </Screen>,
      { motion: 'REDUCED' },
    );
  },
};
