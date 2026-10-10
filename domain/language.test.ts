import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANNED_TERMS, findBannedTerms, normalizeVi } from './language.ts';

test('normalizeVi lower-cases, strips diacritics, maps đ to d and collapses spaces', () => {
  assert.equal(normalizeVi('  Đồ   ĂN\tbẩn \n'), 'do an ban');
  assert.equal(normalizeVi('Hồi Máu'), 'hoi mau');
  assert.equal(normalizeVi('Chiến binh kỷ luật'), 'chien binh ky luat');
  assert.equal(normalizeVi(''), '');
});

test('BANNED_TERMS contains the required terms', () => {
  for (const term of [
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
  ]) {
    assert.ok(BANNED_TERMS.includes(term), term);
  }
});

test('findBannedTerms finds every banned term inside a sentence', () => {
  for (const term of BANNED_TERMS) {
    assert.deepEqual(
      findBannedTerms(`Hôm nay bạn ${term} rồi đó.`),
      [term],
      term,
    );
    assert.deepEqual(findBannedTerms(`${term.toUpperCase()}!`), [term], term);
  }
});

test('findBannedTerms reports each term once, in list order', () => {
  assert.deepEqual(
    findBannedTerms('Tội lỗi, tội lỗi: lại ăn gian và ngủ nướng.'),
    ['tội lỗi', 'ngủ nướng', 'ăn gian'],
  );
});

test('findBannedTerms matches whole words only', () => {
  assert.deepEqual(findBannedTerms('Chất béo tốt cho bữa ăn hôm nay.'), []);
  assert.deepEqual(findBannedTerms('chất béo'), []);
  assert.deepEqual(findBannedTerms('bữa ăn'), []);
  assert.deepEqual(findBannedTerms('Cách bày bàn giản dị.'), []); // "ban gian" contains "an gian"
  assert.deepEqual(findBannedTerms('Một phần thưởng nhỏ sau bữa tối.'), []);
  assert.deepEqual(findBannedTerms(''), []);
});
