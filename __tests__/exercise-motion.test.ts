/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import data from '../src/assets/motion/exercises.json';

const root = path.join(__dirname, '..');

test('src/assets/motion is what scripts/extract-exercise-motion.mjs makes from design/ now', () => {
  let output: string;
  try {
    output = execFileSync(process.execPath, [path.join(root, 'scripts/extract-exercise-motion.mjs'), '--check'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    throw new Error(String((error as { stderr?: string }).stderr || error));
  }
  expect(output).toMatch(/^OK: /);
});

test('every move of the content has its demo: an extracted exercise entry, or the breathing guide', () => {
  const content = fs.readFileSync(path.join(root, 'server/content/exercises.ts'), 'utf8');
  const codes = [...content.matchAll(/demoCode: '([^']+)'/g)].map(match => match[1]);
  expect(codes.length).toBeGreaterThan(0);
  expect(codes.filter(code => code !== 'focus-breathe' && !(code in data.moves))).toEqual([]);
});
