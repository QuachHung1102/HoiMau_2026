import { normalizeVi } from '../../../../domain/language.ts';
import { CRISIS_KEYWORDS, CRISIS_LINES, healthVi } from './health';

test('CRISIS_LINES are exactly 115 and 111', () => {
  expect(CRISIS_LINES).toEqual([
    { number: '115', label: 'Cấp cứu' },
    { number: '111', label: 'Tổng đài quốc gia bảo vệ trẻ em' },
  ]);
});

test('CRISIS_KEYWORDS has at least 15 distinct phrases, each already normalised', () => {
  expect(CRISIS_KEYWORDS.length).toBeGreaterThanOrEqual(15);
  expect(new Set(CRISIS_KEYWORDS).size).toBe(CRISIS_KEYWORDS.length);
  for (const keyword of CRISIS_KEYWORDS) {
    expect(keyword).toBe(normalizeVi(keyword));
    expect(keyword.split(' ').length).toBeGreaterThanOrEqual(2);
  }
});

test('everyday sentences do not match a crisis keyword', () => {
  const everyday = [
    'Hôm nay mệt quá, chết đói mất',
    'Tôi đi từ từ cho khỏe',
    'Mệt muốn chết, đói quá',
  ];
  for (const text of everyday) {
    expect(CRISIS_KEYWORDS.filter(k => normalizeVi(text).includes(k))).toEqual(
      [],
    );
  }
  expect(
    CRISIS_KEYWORDS.some(k =>
      normalizeVi('Tôi không muốn sống nữa').includes(k),
    ),
  ).toBe(true);
});

test('the safety-clamp explanation groups thousands the Vietnamese way', () => {
  expect(healthVi.safetyClamped.body(1500)).toContain('1.500 kcal');
  expect(healthVi.safetyClamped.body(1200)).toContain('1.200 kcal');
});

test('the workout caution is the designed sentence', () => {
  expect(healthVi.workoutCaution).toBe(
    'Dừng nếu thấy đau hoặc khó chịu. Bạn luôn có thể nghỉ hoặc kết thúc sớm.',
  );
});
