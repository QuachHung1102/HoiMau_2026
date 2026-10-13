import { screen } from '@testing-library/react-native';
import { choose, draft, installOnboardingTestEnv, mount, onStep, press, sent, TITLES } from './onboardingTestKit';

installOnboardingTestEnv();

const profile = { ...draft, activityLevel: null, archetype: null };
const LEVELS = [
  ['Phần lớn ngồi làm việc', 'Ít vận động ngoài sinh hoạt'],
  ['Vận động nhẹ', 'Đi bộ, tập nhẹ trong tuần'],
  ['Vận động vừa', 'Tập đều và đi lại thường xuyên'],
  ['Vận động nhiều', 'Tập nặng hoặc làm việc thể lực'],
  ['Vận động rất nhiều', 'Cường độ cao hằng ngày'],
];
const checked = () => screen.getAllByRole('radio').map(row => row.props.accessibilityState.checked);

test('S06 lists the five levels, least to most active, as one single choice with nothing chosen', async () => {
  await mount('OnbActivity', { draft: profile });
  expect(await onStep(TITLES.OnbActivity)).toBeTruthy();
  expect(screen.getByText('Vận động · Bước 2 trong 3')).toBeTruthy();
  expect(screen.getByLabelText('Mức vận động thường ngày').props.accessibilityRole).toBe('radiogroup');
  const rows = screen.getAllByRole('radio');
  expect(rows).toHaveLength(5);
  LEVELS.forEach(([label, description], i) => {
    expect(rows[i]).toHaveTextContent(new RegExp(`^${label}`));
    expect(screen.getByText(description)).toBeTruthy();
  });
  expect(checked()).toEqual([false, false, false, false, false]);
  expect(screen.getByRole('button', { name: 'Chọn mục tiêu' })).toBeTruthy();
});

test('choosing a level checks that one only, and choosing another moves the mark', async () => {
  await mount('OnbActivity', { draft: profile });
  await onStep(TITLES.OnbActivity);
  choose(/^Vận động nhẹ/);
  expect(checked()).toEqual([false, true, false, false, false]);
  // the mark is drawn, not only coloured
  expect(screen.getAllByTestId('radio-dot')).toHaveLength(1);
  choose(/^Vận động rất nhiều/);
  expect(checked()).toEqual([false, false, false, false, true]);
});

test('nothing chosen: the step says so and does not move; a choice clears the message and goes on to S07', async () => {
  await mount('OnbActivity', { draft: profile });
  await onStep(TITLES.OnbActivity);
  press('Chọn mục tiêu');
  expect(await screen.findByText('Chọn mức vận động gần với bạn nhất.')).toBeTruthy();
  expect(screen.getByRole('header', { name: TITLES.OnbActivity })).toBeTruthy();
  choose(/^Vận động vừa/);
  expect(screen.queryByText('Chọn mức vận động gần với bạn nhất.')).toBeNull();
  press('Chọn mục tiêu');
  expect(await onStep(TITLES.OnbArchetype)).toBeTruthy();
  expect(sent().every(r => r.method === 'GET')).toBe(true);
});

test('Back returns to S05 with its values, and coming forward again keeps the level', async () => {
  await mount('OnbActivity', { draft: { ...profile, activityLevel: 'ACTIVE' } });
  await onStep(TITLES.OnbActivity);
  press('Quay lại');
  await onStep(TITLES.OnbProfile);
  expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe(draft.heightCm);
  press('Tiếp tục');
  await onStep(TITLES.OnbActivity);
  expect(checked()).toEqual([false, false, false, true, false]);
});
