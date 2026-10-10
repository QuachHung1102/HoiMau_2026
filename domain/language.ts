// Banned wording (spec 9.4): no negative labels about the user, no body comparison,
// no moralising about food, no blame for a broken streak.
export const BANNED_TERMS: readonly string[] = [
  'đồ ăn bẩn',
  'tội lỗi',
  'lười biếng',
  'kẻ lười',
  'ngủ nướng',
  'thất bại',
  'đáng xấu hổ',
  'trừng phạt',
  'bỏ bê bản thân',
  'béo phì',
  'gầy trơ xương',
  'ăn gian',
];

/** Lower-case, strip diacritics, đ → d, collapse spaces. */
export function normalizeVi(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

// Space-padded words, so a phrase only matches at word boundaries ("chất béo" is not "béo phì").
const padded = (text: string) =>
  ` ${normalizeVi(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

// ponytail: matching ignores diacritics, so a harmless phrase that differs from a banned one
// only by tone marks is also reported. Compare NFC text instead if that ever blocks real copy.
export function findBannedTerms(text: string): string[] {
  const haystack = padded(text);
  return BANNED_TERMS.filter(term => haystack.includes(padded(term)));
}
