/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { motion } from '../src/shared/motion/motion';
import { colors, themes } from '../src/shared/theme/tokens';

const root = path.join(__dirname, '..');
const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

describe('DESIGN.md drift', () => {
  const design = fs.readFileSync(path.join(root, 'DESIGN.md'), 'utf8');
  const block = /^colors:\n((?: {2}.+\n)+)/m.exec(design)?.[1] ?? '';
  const declared = [...block.matchAll(/^ {2}([a-z-]+): "(#[0-9A-Fa-f]{6})"$/gm)];

  test('every colour of the frontmatter equals colors[name]', () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const [, name, hex] of declared) {
      expect({ name, hex: (colors as Record<string, string>)[camel(name)] }).toEqual({ name, hex });
    }
  });

  test('colors has no token that DESIGN.md does not declare', () => {
    expect(Object.keys(colors).sort()).toEqual(declared.map(d => camel(d[1])).sort());
  });

  test('themes override only primary, soft and bg', () => {
    for (const theme of Object.values(themes)) expect(Object.keys(theme).sort()).toEqual(['bg', 'primary', 'soft']);
  });
});

test('motion.ts equals design/motion/tokens.json', () => {
  const json = JSON.parse(fs.readFileSync(path.join(root, 'design/motion/tokens.json'), 'utf8'));
  expect(motion).toEqual(json);
});
