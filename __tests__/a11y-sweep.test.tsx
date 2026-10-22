/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { resetPendingForTests } from '../src/shared/storage/pendingActions';

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

/**
 * Hidden from the screen reader: by itself (`accessible={false}`, `importantForAccessibility` "no" / "no-hide-descendants",
 * `accessibilityElementsHidden`), or by an ancestor that hides its descendants. An ancestor's `accessible={false}` hides
 * nothing below it: its children stay focusable.
 */
function hidden(n: Node): boolean {
  const own = n.props;
  if (own.accessible === false || own.importantForAccessibility === 'no' || own.importantForAccessibility === 'no-hide-descendants' || own.accessibilityElementsHidden === true)
    return true;
  for (let p = n.parent; p; p = p.parent)
    if (isHost(p) && (p.props.importantForAccessibility === 'no-hide-descendants' || p.props.accessibilityElementsHidden === true)) return true;
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

// The entries that drive their screen count themselves while they do (`beginDrive` in tools/preview/harness.tsx).
const drives = () => (globalThis as { __previewDrives?: { pending: number; lastDoneAt: number } }).__previewDrives ?? { pending: 0, lastDoneAt: 0 };
export const DRIVE_LIMIT_MS = 15000;
/** After the last step of a drive, the answer it causes (a refused request, a dialog) is given this long to show. */
const AFTER_DRIVE_MS = 300;

/**
 * Lets the session restore, the queries settle and the first effects run (600 ms at least), then waits until no entry is
 * driving, and the screen has had AFTER_DRIVE_MS to answer the last step. An entry still driving at DRIVE_LIMIT_MS fails:
 * its designed state was never reached, and the state before it must not pass for it. performance.now, not Date.now: the
 * focus-session entries move the device clock forward.
 */
export async function settle(limitMs = DRIVE_LIMIT_MS) {
  const start = performance.now();
  const now = () => performance.now();
  // As testing-library's waitFor does: while waiting the screen runs as it does in the app (act off), so the async work of
  // an entry (requests, the pending queue, its timers) never lands in a gap between two act scopes.
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    while (now() - start < 600 || drives().pending > 0 || now() - drives().lastDoneAt < AFTER_DRIVE_MS) {
      if (now() - start > limitMs) throw new Error(`entry never reached its driven state: ${drives().pending} drive(s) still running after ${limitMs} ms`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous;
  }
  await act(async () => undefined);
}

/** What some driven entries must show when they are checked: the designed state itself, not the screen before it. */
const DRIVEN_STATE: Record<string, string> = {
  'auth.tsx s02-sign-in-error': 'Email hoặc mật khẩu chưa đúng.',
  'guild.tsx s26-guild-join-invalid': 'Mã này chưa đúng, bạn kiểm tra lại nhé',
  'privacy.tsx s52-delete-account-wrong-password': 'Tài khoản của bạn chưa bị xóa.',
  'workout.tsx s41-focus-paused': 'Đang tạm dừng',
  'workout.tsx s63-exit-dialog': 'Thoát buổi tập?',
  'workout.tsx s20-result-queued': 'Buổi tập đã lưu trên máy, đang chờ gửi',
  'workout.tsx s20-result-refused-later': 'Buổi tập không được tính',
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
  drives().pending = 0; // a failed entry must not hold up the next one
  globalThis.fetch = realFetch;
  Date.now = realNow; // the focus-session entries move the clock forward
  // each entry starts from an empty device: the pending queue lives in memory too, and a record one entry left waiting
  // would be sent by the next one
  resetPendingForTests();
  await AsyncStorage.clear();
});
afterAll(() => {
  console.log(`a11y sweep: ${tally.rendered} entries rendered, ${tally.pressables} pressables checked`);
});

test.each(entries.map(e => [`${e.file} ${e.name}`, e] as const))('%s', async (name, { make }) => {
  const view = render(make());
  tree = view.UNSAFE_root;
  try {
    await settle();
    if (DRIVEN_STATE[name]) expect(textOf(view.UNSAFE_root)).toContain(DRIVEN_STATE[name]);
    tally.pressables += assertAccessible(view.UNSAFE_root);
    tally.rendered += 1;
  } finally {
    view.unmount();
  }
}, DRIVE_LIMIT_MS + 10000);

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

const PRESS = '(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback|Button)';
/**
 * The press primitives of react-native a file takes: named imports, destructured requires, and member use through a namespace
 * import, a require binding or `require('react-native').X`, in either quote style.
 */
export function pressPrimitives(text: string): string[] {
  const RN = String.raw`['"]react-native['"]`;
  const named = [...text.matchAll(new RegExp(String.raw`import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*${RN}|\{([^}]*)\}\s*=\s*require\(\s*${RN}\s*\)`, 'g'))].flatMap(m =>
    (m[1] ?? m[2]).split(',').map(part => part.trim().split(/\s+as\s+|\s*:\s*/)[0]),
  );
  const spaces = [...text.matchAll(new RegExp(String.raw`import\s*\*\s*as\s+(\w+)\s+from\s*${RN}|(\w+)\s*=\s*require\(\s*${RN}\s*\)`, 'g'))].map(m => m[1] ?? m[2]);
  const members = [...spaces.map(ns => `\\b${ns}`), String.raw`require\(\s*${RN}\s*\)`].flatMap(owner =>
    [...text.matchAll(new RegExp(`${owner}\\.${PRESS}\\b`, 'g'))].map(m => m[1]),
  );
  return [...named.filter(name => new RegExp(`^${PRESS}$`).test(name)), ...members];
}

// Test files too: a test that renders its own Pressable would hide a role or 48 dp gap behind the kit.
test('only Touchable takes a press primitive from react-native, anywhere in src/', () => {
  const hits = sources.filter(f => rel(f) !== 'shared/ui/Touchable.tsx').flatMap(f => pressPrimitives(read(f)).map(name => `${rel(f)}: ${name}`));
  expect(hits).toEqual([]);
});

test('negative control: every way of taking a press primitive is seen', () => {
  expect(pressPrimitives("import { View, Pressable } from 'react-native';")).toEqual(['Pressable']);
  expect(pressPrimitives('import { TouchableNativeFeedback as T } from "react-native";')).toEqual(['TouchableNativeFeedback']);
  expect(pressPrimitives("import * as RN from 'react-native';\nconst x = <RN.TouchableOpacity />;")).toEqual(['TouchableOpacity']);
  expect(pressPrimitives("const { Button } = require('react-native');")).toEqual(['Button']);
  expect(pressPrimitives("const RN = require('react-native');\nRN.Pressable;")).toEqual(['Pressable']);
  expect(pressPrimitives("const P = require('react-native').Pressable;")).toEqual(['Pressable']);
  expect(pressPrimitives("import { Text, type PressableProps } from 'react-native';\nimport { Button } from './Button';")).toEqual([]);
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
