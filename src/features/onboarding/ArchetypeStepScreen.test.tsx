import { screen } from '@testing-library/react-native';
import { allowedArchetypes, bmi } from '../../../domain/validation.ts';
import { healthVi } from '../../shared/i18n/vi/health';
import { choose, draft, installOnboardingTestEnv, mount, onStep, press, sent, TITLES } from './onboardingTestKit';

installOnboardingTestEnv();

const open = { ...draft, archetype: null };
// A height / weight pair for which the domain does not offer the reduce-fat direction (found with the domain, not by hand).
const low = { ...open, heightCm: '175', weightKg: '55' };
const checked = () => screen.getAllByRole('radio').map(card => card.props.accessibilityState.checked);
const TANKER = /^Khỏe hơn mỗi ngày/;
const ASSASSIN = /^Nhẹ nhàng, bền bỉ/;
const SUPPORTER = /^Cân bằng lại nhịp sống/;
const sheet = () => screen.queryByRole('header', { name: healthVi.blockedArchetype.title });

test('the test measurements are what they claim', () => {
  expect(bmi(175, 55)).toBeLessThan(18.5);
  expect(allowedArchetypes(175, 55)).toEqual(['TANKER', 'SUPPORTER']);
  expect(allowedArchetypes(171.5, 63.25)).toContain('ASSASSIN');
});

test('S07 offers the three directions as one single choice, each named with what it filters for', async () => {
  await mount('OnbArchetype', { draft: open });
  expect(await onStep(TITLES.OnbArchetype)).toBeTruthy();
  expect(screen.getByText('Mục tiêu · Bước 3 trong 3')).toBeTruthy();
  expect(screen.getByLabelText('Mục tiêu của bạn').props.accessibilityRole).toBe('radiogroup');
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(screen.getByText('Đỡ Đòn · ưu tiên tăng cơ và kháng lực')).toBeTruthy();
  expect(screen.getByText('Sát Thủ · ưu tiên sức bền và giảm mỡ')).toBeTruthy();
  expect(screen.getByText('Hỗ Trợ · tư thế, giấc ngủ và giảm căng thẳng')).toBeTruthy();
  // a filter for suggestions, and it can be changed later
  expect(screen.getByText(/^Mục tiêu bạn chọn quyết định bữa ăn và bài tập được gợi ý\./)).toBeTruthy();
  expect(checked()).toEqual([false, false, false]);
});

test('choosing a direction checks that card only; the step then goes on to S08', async () => {
  await mount('OnbArchetype', { draft: open });
  await onStep(TITLES.OnbArchetype);
  choose(ASSASSIN);
  expect(checked()).toEqual([false, true, false]);
  expect(sheet()).toBeNull();
  choose(TANKER);
  expect(checked()).toEqual([true, false, false]);
  press('Xem lộ trình của tôi');
  expect(await onStep(TITLES.OnbTargets)).toBeTruthy();
  expect(screen.getByText('Đỡ Đòn')).toBeTruthy();
});

test('nothing chosen: the step says so and does not move', async () => {
  await mount('OnbArchetype', { draft: open });
  await onStep(TITLES.OnbArchetype);
  press('Xem lộ trình của tôi');
  expect(await screen.findByText('Chọn một mục tiêu để tiếp tục.')).toBeTruthy();
  expect(screen.getByRole('header', { name: TITLES.OnbArchetype })).toBeTruthy();
});

describe('S43: the reduce-fat direction is not offered for these measurements', () => {
  test('choosing "Sát Thủ" opens the explanation from the health copy and selects nothing', async () => {
    await mount('OnbArchetype', { draft: low });
    await onStep(TITLES.OnbArchetype);
    choose(ASSASSIN);
    const copy = healthVi.blockedArchetype;
    expect(sheet()).toBeTruthy();
    for (const text of [copy.subtitle, copy.cardTitle, copy.body, copy.footer]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chọn hướng tăng sức mạnh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chọn hướng cân bằng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kiểm tra lại hồ sơ' })).toBeTruthy();
    // the refused direction is offered nowhere in the sheet and is not selected underneath
    expect(screen.queryByRole('button', { name: /giảm mỡ|Sát Thủ/ })).toBeNull();
    press('Đóng');
    expect(sheet()).toBeNull();
    expect(checked()).toEqual([false, false, false]);
    expect(sent().every(r => r.method === 'GET')).toBe(true);
  });

  test('it never shows a number or a word about the body', async () => {
    await mount('OnbArchetype', { draft: low });
    await onStep(TITLES.OnbArchetype);
    choose(ASSASSIN);
    expect(screen.queryByText(/BMI|18[.,]5|thiếu cân|thừa cân|gầy|nhẹ cân/i)).toBeNull();
  });

  test.each([
    ['Chọn hướng cân bằng', 'Hỗ Trợ'],
    ['Chọn hướng tăng sức mạnh', 'Đỡ Đòn'],
  ])('"%s" continues to S08 with that direction', async (button, name) => {
    await mount('OnbArchetype', { draft: low });
    await onStep(TITLES.OnbArchetype);
    choose(ASSASSIN);
    press(button);
    expect(await onStep(TITLES.OnbTargets)).toBeTruthy();
    expect(screen.getByText(name)).toBeTruthy();
  });

  test('an earlier choice that the measurements no longer allow cannot be confirmed: the sheet opens and the choice is dropped', async () => {
    await mount('OnbArchetype', { draft: { ...low, archetype: 'ASSASSIN' } });
    await onStep(TITLES.OnbArchetype);
    expect(checked()).toEqual([false, true, false]);
    press('Xem lộ trình của tôi');
    expect(sheet()).toBeTruthy();
    press('Đóng');
    expect(checked()).toEqual([false, false, false]);
    expect(screen.getByRole('header', { name: TITLES.OnbArchetype })).toBeTruthy();
  });

  test('the other two directions stay selectable, and a choice is kept when the refused one is tapped', async () => {
    await mount('OnbArchetype', { draft: low });
    await onStep(TITLES.OnbArchetype);
    choose(SUPPORTER);
    expect(checked()).toEqual([false, false, true]);
    choose(ASSASSIN);
    press('Đóng');
    expect(checked()).toEqual([false, false, true]);
  });

  test('"Kiểm tra lại hồ sơ" goes back to S05 with the measurements kept', async () => {
    await mount('OnbArchetype', { draft: low });
    await onStep(TITLES.OnbArchetype);
    choose(ASSASSIN);
    press('Kiểm tra lại hồ sơ');
    await onStep(TITLES.OnbProfile);
    expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe('175');
    expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe('55');
    expect(screen.getByLabelText('Năm sinh').props.value).toBe(low.birthYear);
  });
});

test('Back from S07 to S05 keeps every value, and so does coming forward again', async () => {
  await mount('OnbArchetype', { draft: { ...draft, archetype: 'SUPPORTER' } });
  await onStep(TITLES.OnbArchetype);
  press('Quay lại');
  await onStep(TITLES.OnbActivity);
  expect(screen.getByRole('radio', { name: /^Vận động nhẹ/ }).props.accessibilityState.checked).toBe(true);
  press('Quay lại');
  await onStep(TITLES.OnbProfile);
  expect(screen.getByLabelText('Năm sinh').props.value).toBe(draft.birthYear);
  expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe('171,5');
  expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe('63.25');
  expect(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Nam' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Múi giờ, Asia/Ho_Chi_Minh' })).toBeTruthy();
  press('Tiếp tục');
  await onStep(TITLES.OnbActivity);
  press('Chọn mục tiêu');
  await onStep(TITLES.OnbArchetype);
  expect(checked()).toEqual([false, false, true]);
});
