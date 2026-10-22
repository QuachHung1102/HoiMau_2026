/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

// Task 49: every preview entry is rendered under Jest and its tree is checked for what a machine can see of
// accessibility (P1.6-UI-STD). What only a device shows is in .superpowers/sdd/device-checks.md.

type Node = ReactTestInstance;
const isHost = (n: Node) => typeof n.type === 'string';
/** The host component name ('View', 'Text', 'Image', 'TextInput', 'RNSVGSvgView', ...). */
const typeOf = (n: Node) => String(n.type);
const kids = (n: Node) => n.children.filter((c): c is Node => typeof c !== 'string');
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => n.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
const roleOf = (n: Node): string | undefined => n.props.accessibilityRole ?? n.props.role;
const stateOf = (n: Node): Record<string, unknown> => n.props.accessibilityState ?? {};
/** A host element the user can press: a Pressable's view (it carries the responder handlers) or a Text with onPress. */
const isPressable = (n: Node) => isHost(n) && (typeof n.props.onPress === 'function' || typeof n.props.onClick === 'function');
const shown = (n: Node) => `<${typeOf(n)} role=${roleOf(n) ?? '-'} label=${JSON.stringify(n.props.accessibilityLabel ?? textOf(n).slice(0, 40))}>`;
const RAW_KEY = /^[A-Z_]{4,}$/;

/** Hidden from the screen reader, by itself or by an ancestor. */
function hidden(n: Node): boolean {
  if (n.props.importantForAccessibility === 'no') return true;
  for (let p: Node | null = n; p; p = p.parent)
    if (isHost(p) && (p.props.accessible === false || p.props.importantForAccessibility === 'no-hide-descendants')) return true;
  return false;
}
/** Not read on its own: hidden, or inside an accessible group that is read as one element. */
function silenced(n: Node): boolean {
  for (let p = n.parent; p; p = p.parent) if (isHost(p) && p.props.accessible === true) return true;
  return hidden(n);
}

/** Every finding of the six tree rules, plus a press target that does nothing. */
export function audit(root: Node): { findings: string[]; pressables: number } {
  const findings: string[] = [];
  const nodes = all(root);
  const pressables = nodes.filter(isPressable);
  for (const n of pressables) {
    const { disabled, busy } = stateOf(n);
    // 1. a role
    if (!roleOf(n)) findings.push(`pressable without accessibilityRole: ${shown(n)}`);
    // 2. a name (a touch target hidden from the screen reader on purpose, like the scrim of a sheet, has none to give)
    if (!hidden(n) && !String(n.props.accessibilityLabel ?? '').trim() && !textOf(n).trim()) findings.push(`pressable without a name: ${shown(n)}`);
    // a live control with no handler is a dead tap (a busy one swallows presses on purpose)
    if (n.props.onClick && disabled !== true && busy !== true) {
      let owner: Node | null = n.parent;
      while (owner && !('onPress' in owner.props) && !('onLongPress' in owner.props)) owner = owner.parent;
      if (owner && typeof owner.props.onPress !== 'function' && typeof owner.props.onLongPress !== 'function')
        findings.push(`enabled pressable whose onPress is empty (dead tap): ${shown(n)}`);
    }
  }
  // 3. a component told it is disabled / loading / selected / checked exposes it on the control it renders
  for (const c of nodes.filter(x => !isHost(x))) {
    const control = all(c).find(isPressable);
    if (!control) continue;
    const s = stateOf(control);
    const p = c.props;
    if (p.disabled === true && s.disabled !== true) findings.push(`disabled not exposed: ${shown(control)}`);
    if ((p.loading === true || p.busy === true) && s.busy !== true) findings.push(`busy not exposed: ${shown(control)}`);
    if (p.selected === true && s.selected !== true && s.checked !== true) findings.push(`selected not exposed: ${shown(control)}`);
    if (p.checked === true && s.checked !== true) findings.push(`checked not exposed: ${shown(control)}`);
    if (typeof p.value === 'boolean' && ['switch', 'checkbox'].includes(roleOf(control) ?? '') && s.checked !== p.value)
      findings.push(`checked (${p.value}) not exposed: ${shown(control)}`);
  }
  for (const n of nodes.filter(isHost)) {
    // 4. images: a label or hidden
    const image = typeOf(n) === 'Image' || /^RNSVGSvg/.test(typeOf(n));
    if (image && !n.props.accessibilityLabel && !silenced(n)) findings.push(`image with no label that is not accessible={false}: ${shown(n)}`);
    // 5. progress: a value and a visible number (an indeterminate, busy one has neither)
    if (roleOf(n) === 'progressbar' && stateOf(n).busy !== true) {
      const v = n.props.accessibilityValue;
      if (typeof v?.now !== 'number' && !v?.text) findings.push(`progressbar without accessibilityValue: ${shown(n)}`);
      if (!/\d/.test(textOf(n))) findings.push(`progressbar without a visible number: ${shown(n)}`);
    }
    if (typeOf(n) === 'Text') {
      // 6. no empty text, no raw key
      const text = textOf(n).trim();
      if (!text) findings.push(`empty text: ${shown(n.parent ?? n)}`);
      else if (RAW_KEY.test(text)) findings.push(`raw key on screen: "${text}"`);
      // text grows with font scale: never a fixed height
      if (StyleSheet.flatten(n.props.style)?.height !== undefined) findings.push(`Text with a fixed height: "${text}"`);
    }
  }
  return { findings, pressables: pressables.length };
}

export function assertAccessible(root: Node): number {
  const { findings, pressables } = audit(root);
  if (findings.length) throw new Error(findings.join('\n'));
  return pressables;
}

// Several entries reach their designed state (an error, a confirmation) by typing and pressing through the DOM of the
// browser preview, since shot.mjs cannot. Here the same few selectors are answered from the rendered tree, so the sweep
// checks those states too.
let tree: Node | null = null;
let lastQuery = 0;
class HTMLInputElement {
  node: Node | null = null;
  text = '';
  get value() {
    return this.text;
  }
  set value(text: string) {
    this.text = text;
  }
  dispatchEvent() {
    if (this.node) fireEvent.changeText(this.node, this.text);
    return true;
  }
}
// The entries set the value through the prototype's own setter, so each class has its own.
class HTMLTextAreaElement extends HTMLInputElement {
  get value() {
    return this.text;
  }
  set value(text: string) {
    this.text = text;
  }
}
const asElement = (n: Node) => {
  const input = typeOf(n) === 'TextInput' ? Object.assign(n.props.multiline ? new HTMLTextAreaElement() : new HTMLInputElement(), { node: n }) : {};
  const attributes: Record<string, unknown> = { role: roleOf(n), 'aria-label': n.props.accessibilityLabel, 'aria-disabled': stateOf(n).disabled ? 'true' : undefined };
  return Object.assign(input, { textContent: textOf(n), click: () => fireEvent.press(n), getAttribute: (name: string) => attributes[name] ?? null });
};
function select(selector: string): Node[] {
  const hosts = tree ? all(tree).filter(isHost) : [];
  if (selector === '*') return []; // scroll-to-the-end has no meaning here
  lastQuery = performance.now();
  if (selector === 'textarea') return hosts.filter(n => typeOf(n) === 'TextInput' && n.props.multiline);
  if (selector === '[dir="auto"]') return hosts.filter(n => typeOf(n) === 'Text');
  const m = /^(input)?\[(role|aria-label)(\^?)="(.*)"\]$/.exec(selector);
  if (!m) throw new Error(`a11y sweep: the document shim does not know the selector ${selector}`);
  const [, input, attr, prefix, value] = m;
  return hosts.filter(n => {
    const v = attr === 'role' ? roleOf(n) : n.props.accessibilityLabel;
    return (!input || typeOf(n) === 'TextInput') && typeof v === 'string' && (prefix ? v.startsWith(value) : v === value);
  });
}
Object.assign(globalThis, {
  HTMLInputElement,
  HTMLTextAreaElement,
  document: { querySelector: (s: string) => select(s).map(asElement)[0] ?? null, querySelectorAll: (s: string) => select(s).map(asElement) },
});

// Let the session restore, the queries settle and the first effects run (an entry that drives the screen starts after up to
// 400 ms); while it is still driving it (it queried the document lately), keep going a little longer. performance.now, not
// Date.now: the focus-session entries move the device clock forward.
const settle = async () => {
  const start = performance.now();
  const now = () => performance.now();
  // As testing-library's waitFor does: while waiting the screen runs as it does in the app (act off), so the async work of
  // an entry (requests, the pending queue, its timers) never lands in a gap between two act scopes.
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    while (now() - start < 600 || (now() - lastQuery < 400 && now() - start < 5000)) await new Promise(resolve => setTimeout(resolve, 25));
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous;
  }
  await act(async () => undefined);
};

const entriesDir = path.join(__dirname, '../tools/preview/entries');
const entries = fs
  .readdirSync(entriesDir)
  .filter(f => f.endsWith('.tsx'))
  .flatMap(f => Object.entries(require(path.join(entriesDir, f)).entries as Record<string, () => ReactElement>).map(([name, make]) => ({ file: f, name, make })));
const tally = { rendered: 0, pressables: 0 };
const realFetch = globalThis.fetch;

const realNow = Date.now;
afterEach(async () => {
  tree = null;
  globalThis.fetch = realFetch;
  Date.now = realNow; // the focus-session entries move the clock forward
  await AsyncStorage.clear();
});
afterAll(() => {
  console.log(`a11y sweep: ${tally.rendered} entries rendered, ${tally.pressables} pressables checked`);
});

test.each(entries.map(e => [`${e.file} ${e.name}`, e] as const))('%s', async (_, { make }) => {
  const view = render(make());
  tree = view.UNSAFE_root;
  await settle();
  try {
    tally.pressables += assertAccessible(view.UNSAFE_root);
    tally.rendered += 1;
  } finally {
    view.unmount();
  }
}, 20000);

test('negative control: an unlabelled pressable with no role fails the audit', () => {
  const view = render(
    <View>
      <Pressable onPress={() => undefined}>
        <View />
      </Pressable>
      <Text> </Text>
      <Text>STORY_DONE</Text>
    </View>,
  );
  try {
    expect(() => assertAccessible(view.UNSAFE_root)).toThrow(/without accessibilityRole[\s\S]*without a name[\s\S]*empty text[\s\S]*raw key/);
  } finally {
    view.unmount();
  }
});

// ---- Static checks over the sources ----
const src = path.join(__dirname, '../src');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f: string) => path.relative(src, f).split(path.sep).join('/');
const isTest = (f: string) => /\.test\.tsx?$/.test(f);
const sources = walk(src).filter(f => /\.tsx?$/.test(f));
// NFC + \u escapes decoded, so a decomposed letter or an escaped one is still seen as the letter it is.
const normalised = (text: string) => text.replace(/\\u\{?([0-9a-fA-F]{4,5})\}?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).normalize('NFC');
const read = (f: string) => normalised(fs.readFileSync(f, 'utf8'));

export const VIETNAMESE = /[à-ỹÀ-ỸđĐ]/;
/** Lines that write Vietnamese outside a comment. */
export function vietnameseLines(text: string): number[] {
  return normalised(text)
    .split(/\r?\n/)
    .flatMap((line, i) => (!/^\s*(\/\/|\/\*|\*)/.test(line) && VIETNAMESE.test(line) ? [i + 1] : []));
}

test('only Touchable imports a press primitive from react-native', () => {
  const banned = /import\s*\{[^}]*\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|Button)\b[^}]*\}\s*from\s*'react-native'/;
  const hits = sources.filter(f => !isTest(f) && rel(f) !== 'shared/ui/Touchable.tsx' && banned.test(read(f))).map(rel);
  expect(hits).toEqual([]);
});

test('font scaling is never switched off, and capped only on the tab labels', () => {
  const off = sources.filter(f => /allowFontScaling(=\{\s*|\s*:\s*)false/.test(read(f))).map(rel);
  const capped = sources.filter(f => !isTest(f) && /maxFontSizeMultiplier/.test(read(f))).map(rel);
  expect(off).toEqual([]);
  expect(capped.filter(f => f !== 'app/TabBar.tsx')).toEqual([]);
});

test('no Vietnamese is written in features, app or the UI kit (strings live in src/shared/i18n/vi)', () => {
  const scoped = sources.filter(f => !isTest(f) && /^(features|app|shared\/ui)\//.test(rel(f)));
  const hits = scoped.flatMap(f => vietnameseLines(fs.readFileSync(f, 'utf8')).map(line => `${rel(f)}:${line}`));
  expect(hits).toEqual([]);
});

test('negative control: the Vietnamese guard sees decomposed and escaped letters', () => {
  expect(vietnameseLines(`const a = 'Hồi';`)).toEqual([1]); // NFD "Hồi"
  expect(vietnameseLines("const b = '\\u0111i';")).toEqual([1]); // escaped "đi"
  expect(vietnameseLines("// Hồi Máu\nconst c = 'Hoi Mau';")).toEqual([]);
});
