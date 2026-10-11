/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { motion } from '../src/shared/motion/motion';
import { colors, fontFileNames, fontPostScriptNames, themes } from '../src/shared/theme/tokens';

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

describe('fonts', () => {
  // PostScript name (name ID 6) read from the font's own name table.
  const postScriptName = (file: string) => {
    const b = fs.readFileSync(file);
    let table = 0;
    for (let i = 0; i < b.readUInt16BE(4); i++) {
      if (b.toString('latin1', 12 + i * 16, 16 + i * 16) === 'name') table = b.readUInt32BE(20 + i * 16);
    }
    const storage = table + b.readUInt16BE(table + 4);
    for (let i = 0; i < b.readUInt16BE(table + 2); i++) {
      const r = table + 6 + i * 12;
      if (b.readUInt16BE(r + 6) !== 6) continue;
      const raw = b.subarray(storage + b.readUInt16BE(r + 10), storage + b.readUInt16BE(r + 10) + b.readUInt16BE(r + 8));
      return b.readUInt16BE(r) === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
    }
    return '';
  };

  test.each(Object.keys(fontFileNames) as (keyof typeof fontFileNames)[])('%s: file name and PostScript name match the .ttf', key => {
    const file = path.join(root, 'src/assets/fonts', `${fontFileNames[key]}.ttf`);
    expect(fs.existsSync(file)).toBe(true);
    expect(postScriptName(file)).toBe(fontPostScriptNames[key]);
  });
});
