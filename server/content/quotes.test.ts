import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findBannedTerms, normalizeVi } from '../../domain/language.ts';
import { QUOTES } from './quotes.ts';

const texts = QUOTES.map(q => q.text);

test('at least 40 quotes with ordered codes Q001...', () => {
  assert.ok(QUOTES.length >= 40, `only ${QUOTES.length}`);
  assert.deepEqual(
    QUOTES.map(q => q.code),
    QUOTES.map((_, i) => `Q${String(i + 1).padStart(3, '0')}`),
  );
  assert.equal(new Set(texts).size, texts.length);
});

test('every quote is self-authored, short, plain and ends with a full stop', () => {
  for (const q of QUOTES) {
    assert.equal(q.author, null, q.code);
    assert.ok(q.text.length <= 160, `${q.code} is ${q.text.length} chars`);
    assert.ok(q.text.endsWith('.'), `${q.code} must end with a full stop`);
    assert.ok(!q.text.includes('!'), `${q.code} has an exclamation mark`);
    assert.equal(q.text, q.text.normalize('NFC'), q.code);
    assert.equal(q.text, q.text.trim(), q.code);
  }
});

test('no banned term, digit, URL or weight talk', () => {
  for (const q of QUOTES) {
    assert.deepEqual(findBannedTerms(q.text), [], q.code);
    assert.doesNotMatch(q.text, /\d/, q.code);
    assert.doesNotMatch(q.text, /https?:|www\.|@|\.com|\.vn/i, q.code);
    assert.doesNotMatch(
      normalizeVi(q.text),
      /\b(kg|calo|kcal|can nang|giam can|than hinh)\b/,
      q.code,
    );
  }
});

// A quote is picked at random, so it must not jar after a heavy entry: no cheerful reassurance, no
// commands, no praise for being strong or productive. Compared on normalizeVi forms (no diacritics).
test('no dismissive, commanding or praising wording', () => {
  const phrases = [
    'moi chuyen',
    'se on',
    'se tot hon',
    'ngay mai',
    'mim cuoi',
    'hay co',
    'co len',
    'co gang',
    'manh me',
    'kien cuong',
    'dung cam',
    'nang suat',
    'tuyet voi',
    'khong sao',
    'vui len',
  ];
  for (const q of QUOTES) {
    const n = ` ${normalizeVi(q.text).replace(/[^a-z0-9]+/g, ' ')} `;
    for (const p of phrases)
      assert.ok(!n.includes(` ${p} `), `${q.code}: ${p}`);
    // "hay" also means "or" ("nhanh hay chậm"); only the imperative "hãy" is banned, told apart by its tone mark.
    for (const w of ['phai', 'nen'])
      assert.ok(!n.includes(` ${w} `), `${q.code}: ${w}`);
    assert.ok(!/(^|\s)hãy(\s|$)/i.test(q.text), `${q.code}: hãy`);
  }
});

test('no two quotes open with the same four words', () => {
  const opening = (t: string) =>
    normalizeVi(t).split(' ').slice(0, 4).join(' ');
  const seen = new Map<string, string>();
  for (const q of QUOTES) {
    const key = opening(q.text);
    assert.ok(
      !seen.has(key),
      `${q.code} and ${seen.get(key)} open with "${key}"`,
    );
    seen.set(key, q.code);
  }
});
