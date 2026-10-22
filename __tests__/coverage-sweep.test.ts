/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { routeNames } from '../src/app/routes';
import { authScreens, detailScreens, focusScreens, onboardingScreens, tabRoots } from '../src/app/screens';

// Task 49: every designed frame has a preview entry, every declared route is registered (and the reverse), and every
// registered route can be reached: it is a navigator root or the target of a navigate(...) somewhere in the app.
const root = path.join(__dirname, '..');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
// App code only: no tests, no test kits (they carry `eslint-env jest`).
const appSources = walk(path.join(root, 'src'))
  .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map(f => fs.readFileSync(f, 'utf8'))
  .filter(text => !text.includes('eslint-env jest'));

/** S-codes of the frame tables in the screen map. */
export function frameCodes(screenMap: string): string[] {
  return [...new Set([...screenMap.matchAll(/^\| (S\d+) \|/gm)].map(m => m[1]))];
}

/** Frames without a preview entry named `<code>-…` (lower case). */
export function framesWithoutEntry(codes: string[], entryNames: string[]): string[] {
  return codes.filter(code => !entryNames.some(name => name.startsWith(`${code.toLowerCase()}-`)));
}

/** The source without its comments, so a `navigate('X')` written in a comment does not count. */
export const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/**
 * Routes nobody can reach: not a navigator root and never the target of navigate / push / replace with its name as the
 * first argument, nor named as `route: '<Name>'` in a row table whose rows navigate to their `route`.
 */
export function unreachable(routes: string[], roots: string[], sources: string[]): string[] {
  const text = sources.map(withoutComments).join('\n');
  return routes.filter(
    name => !roots.includes(name) && !new RegExp(`\\b(navigate|push|replace)\\(\\s*'${name}'|\\broute: '${name}'`).test(text),
  );
}

const entriesDir = path.join(root, 'tools/preview/entries');
const entryNames = fs
  .readdirSync(entriesDir)
  .filter(f => f.endsWith('.tsx'))
  .flatMap(f => Object.keys(require(path.join(entriesDir, f)).entries as object));
const codes = frameCodes(fs.readFileSync(path.join(root, 'docs/design/screen-map.md'), 'utf8'));
const registered = [authScreens, onboardingScreens, tabRoots, detailScreens, focusScreens].flatMap(group => group.map(e => e.name as string));
// The first screen of a signed-out or onboarding stack is where that stack opens; a tab root is opened by the tab bar.
const roots = [authScreens[0].name, onboardingScreens[0].name, ...tabRoots.map(t => t.name)];

test('the screen map has frames S01..S82', () => {
  expect(codes).toHaveLength(82);
});

test('every frame has a preview entry', () => {
  expect(framesWithoutEntry(codes, entryNames)).toEqual([]);
});

test('every declared route is registered, and every registered screen is declared', () => {
  expect(routeNames.filter(name => !registered.includes(name))).toEqual([]);
  expect(registered.filter(name => !(routeNames as string[]).includes(name))).toEqual([]);
});

test('every registered route is reachable (a root or a navigate target)', () => {
  expect(unreachable(registered, roots, appSources)).toEqual([]);
});

test('the coverage counts', () => {
  const covered = codes.length - framesWithoutEntry(codes, entryNames).length;
  const reachable = registered.length - unreachable(registered, roots, appSources).length;
  console.log(
    `coverage sweep: frames with an entry ${covered}/${codes.length}; ` +
      `declared routes registered ${routeNames.filter(n => registered.includes(n)).length}/${routeNames.length}; ` +
      `registered routes reachable ${reachable}/${registered.length}`,
  );
  expect(covered).toBe(codes.length);
});

describe('negative controls', () => {
  test('an invented frame S99 is reported missing', () => {
    expect(framesWithoutEntry([...codes, 'S99'], entryNames)).toEqual(['S99']);
  });
  test('a route nobody navigates to is reported unreachable', () => {
    expect(unreachable(['Orphan', 'Today'], ['Today'], ["navigation.navigate('Shop')"])).toEqual(['Orphan']);
    expect(unreachable(['Orphan'], [], ["// navigation.navigate('Orphan')\n/* route: 'Orphan' */ const url = 'http://x';"])).toEqual(['Orphan']);
    expect(unreachable(['Shop'], [], ["const url = 'http://x'; navigation.navigate('Shop'); // back"])).toEqual([]);
  });
});
