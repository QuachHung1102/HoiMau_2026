import { normalizeVi } from '../../../../domain/language.ts';
import {
  CRISIS_KEYWORDS,
  CRISIS_LINES,
  CRISIS_PHRASES_EXACT,
  healthVi,
} from './health';

/** Entries may start with ^ and end with $ (see crisisMatch.ts); nothing else is syntax. */
const withoutAnchors = (entry: string): string =>
  entry.slice(
    entry.startsWith('^') ? 1 : 0,
    entry.endsWith('$') ? -1 : undefined,
  );

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
    const core = withoutAnchors(keyword);
    expect(core).toBe(normalizeVi(core));
    expect(core.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(core).not.toMatch(/[\^$]/);
  }
});

test('CRISIS_PHRASES_EXACT entries are distinct and equal their own NFC lower-case form', () => {
  expect(CRISIS_PHRASES_EXACT.length).toBeGreaterThan(0);
  expect(new Set(CRISIS_PHRASES_EXACT).size).toBe(CRISIS_PHRASES_EXACT.length);
  for (const phrase of CRISIS_PHRASES_EXACT) {
    const core = withoutAnchors(phrase);
    expect(core).toBe(core.normalize('NFC').toLowerCase());
    expect(core).toBe(core.trim());
    expect(core).not.toMatch(/[\^$]/);
  }
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

test('the estimate notes use the "ước tính, không phải chẩn đoán" wording', () => {
  expect(healthVi.estimate.prescription).toContain(
    'ước tính, không phải chẩn đoán',
  );
  expect(healthVi.estimate.stats).toContain('ước tính, không phải chẩn đoán');
});

test('the macro explanation says the energy target is unchanged and only the split moved', () => {
  expect(healthVi.macroAdjusted.body).toContain(
    'Mục tiêu năng lượng của bạn vẫn giữ nguyên; mình chỉ chia lại đạm, béo và carb để chất béo chiếm ít nhất 20% năng lượng và carb được giữ ở mức cao nhất có thể.',
  );
  expect(healthVi.macroAdjusted.body).not.toContain('50 g');
});

test('the info paragraph about the floor states the 20 % rule as a maximum', () => {
  const floor = healthVi.info.paragraphs.find(
    p => p.title === 'Mức nền an toàn',
  );
  expect(floor?.body).toContain(
    'thấp hơn mức năng lượng bạn dùng mỗi ngày không quá 20%',
  );
});
