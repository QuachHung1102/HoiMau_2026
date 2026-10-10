/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { findBannedTerms } from '../domain/language.ts';

// Scans the source text of every file in src/shared/i18n/vi/, so files added by later tasks are covered.
const dir = path.join(__dirname, '../src/shared/i18n/vi');
const files = fs.readdirSync(dir).filter(f => /\.tsx?$/.test(f));

test('there are Vietnamese string files to scan', () => {
  expect(files).toContain('common.ts');
});

test.each(files)('%s contains no banned term', file => {
  expect(findBannedTerms(fs.readFileSync(path.join(dir, file), 'utf8'))).toEqual([]);
});
