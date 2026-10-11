/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const src = path.join(__dirname, '../src');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const files = walk(src).filter(f => /\.tsx?$/.test(f));
const rel = (f: string) => path.relative(src, f).split(path.sep).join('/');

// Any Vietnamese-only letter (the diacritic vowels and đ), upper or lower case.
const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

// User-visible Vietnamese belongs in src/shared/i18n/.
const exempt = (f: string) => rel(f).startsWith('shared/i18n/') || /\.test\.tsx?$/.test(f);

test('the Vietnamese letter pattern matches Vietnamese and ignores plain ASCII', () => {
  expect(VIETNAMESE.test('Hồi Máu')).toBe(true);
  expect(VIETNAMESE.test('Đ')).toBe(true);
  expect(VIETNAMESE.test('Hoi Mau, plain ascii')).toBe(false);
});

test('no Vietnamese text is written inline in components (strings live in src/shared/i18n)', () => {
  const hits: string[] = [];
  for (const file of files.filter(f => !exempt(f))) {
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        const code = line.trim();
        if (/^(\/\/|\/\*|\*)/.test(code)) return; // comment-only lines
        if (VIETNAMESE.test(line)) hits.push(`${rel(file)}:${i + 1}: ${code}`);
      });
  }
  expect(hits).toEqual([]);
});

test('font scaling is never switched off', () => {
  const hits = files.filter(f => /allowFontScaling=\{\s*false\s*\}/.test(fs.readFileSync(f, 'utf8'))).map(rel);
  expect(hits).toEqual([]);
});
