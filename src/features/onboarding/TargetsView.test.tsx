import { render, screen } from '@testing-library/react-native';
import { calculatePrescription, calorieWindow, macroSplit, type Prescription } from '../../../domain/energy.ts';
import type { Archetype } from '../../../domain/types.ts';
import { healthVi } from '../../shared/i18n/vi/health';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { dotted } from './onboardingTestKit';
import { TargetsView } from './TargetsView';

const view = (prescription: Prescription, archetype: Archetype = 'SUPPORTER') => (
  <ThemeProvider>
    <MotionPreferenceProvider value="REDUCED">
      <TargetsView archetype={archetype} prescription={prescription}>
        <AppText>host actions</AppText>
      </TargetsView>
    </MotionPreferenceProvider>
  </ThemeProvider>
);
const plain = calculatePrescription({ heightCm: 165, weightKg: 58, ageYears: 28, sex: 'FEMALE', activityLevel: 'MODERATE', archetype: 'SUPPORTER' });

test('the numbers are shown as given, with the band of calorieWindow and the estimate wording; the host content comes last', () => {
  render(view(plain));
  const band = calorieWindow(plain.calorieTarget);
  expect(screen.getByText('Hỗ Trợ')).toBeTruthy();
  expect(screen.getByText(`${dotted(plain.calorieTarget)} kcal / ngày`)).toBeTruthy();
  expect(screen.getByText(`Nhiệm vụ dinh dưỡng được tính khi bạn ghi nhận từ ${dotted(band.min)} đến ${dotted(band.max)} kcal.`)).toBeTruthy();
  expect(screen.getByText(`${dotted(plain.waterMl)} ml / ngày`)).toBeTruthy();
  expect(screen.getByText(`Đạm ${plain.proteinG} g · Béo ${plain.fatG} g · Carb ${plain.carbsG} g`)).toBeTruthy();
  expect(screen.getByText(healthVi.estimate.prescription)).toBeTruthy();
  expect(screen.getByText('host actions')).toBeTruthy();
  expect(screen.queryByText(healthVi.safetyClamped.title)).toBeNull();
  expect(screen.queryByText(healthVi.macroAdjusted.title)).toBeNull();
});

test('numbers the view did not compute are not "corrected": odd values are printed as they came', () => {
  // not what the domain would return for anyone; the view must not re-derive or re-round any of it
  render(view({ ...plain, calorieTarget: 1987, proteinG: 91, fatG: 7, carbsG: 3, waterMl: 2125 }));
  expect(screen.getByText('1.987 kcal / ngày')).toBeTruthy();
  expect(screen.getByText('2.125 ml / ngày')).toBeTruthy();
  expect(screen.getByText('Đạm 91 g · Béo 7 g · Carb 3 g')).toBeTruthy();
});

test('safetyClamped: the chip beside the number and the reason with the floor, both from the health copy', () => {
  render(view({ ...plain, calorieTarget: 1200, safetyClamped: true }, 'ASSASSIN'));
  expect(screen.getByText(healthVi.safetyClamped.chip)).toBeTruthy();
  expect(screen.getByRole('header', { name: healthVi.safetyClamped.title })).toBeTruthy();
  expect(screen.getByText('Mục tiêu không xuống dưới mức nền 1.200 kcal mỗi ngày. Đây là ước tính, không phải chỉ định y tế.')).toBeTruthy();
});

test('macroAdjusted: the split is explained with the health copy, and the energy target is left alone', () => {
  // the fallback split cannot be reached with measurements inside the valid ranges, so it is built with macroSplit
  const split = macroSplit(1200, 250, 'TANKER');
  expect(split.macroAdjusted).toBe(true);
  render(view({ ...plain, calorieTarget: 1200, ...split }));
  expect(screen.getByRole('header', { name: healthVi.macroAdjusted.title })).toBeTruthy();
  expect(screen.getByText(healthVi.macroAdjusted.body)).toBeTruthy();
  expect(screen.getByText(`Đạm ${split.proteinG} g · Béo ${split.fatG} g · Carb ${split.carbsG} g`)).toBeTruthy();
  expect(screen.getByText('1.200 kcal / ngày')).toBeTruthy();
});

test('a new prescription replaces the numbers (at once under reduced motion)', () => {
  const first = render(view(plain));
  first.rerender(view({ ...plain, calorieTarget: plain.calorieTarget + 137 }));
  expect(screen.getByText(`${dotted(plain.calorieTarget + 137)} kcal / ngày`)).toBeTruthy();
});
