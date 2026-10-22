/// <reference types="node" />
// What the Jest sweeps over every preview entry share (Task 49: __tests__/a11y-sweep.test.tsx, Task 50: __tests__/motion-sweep.test.tsx):
// the entries, the tree helpers, the document shim the driven entries need, and the settle that waits for them.
import fs from 'node:fs';
import path from 'node:path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { resetPendingForTests } from '../../src/shared/storage/pendingActions';

export type Node = ReactTestInstance;
export const isHost = (n: Node) => typeof n.type === 'string';
/** The host component name ('View', 'Text', 'Image', 'TextInput', 'RNSVGSvgView', ...). */
export const typeOf = (n: Node) => String(n.type);
export const kids = (n: Node) => n.children.filter((c): c is Node => typeof c !== 'string');
export const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
export const textOf = (n: Node): string => n.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
export const roleOf = (n: Node): string | undefined => n.props.accessibilityRole ?? n.props.role;
export const stateOf = (n: Node): Record<string, unknown> => n.props.accessibilityState ?? {};

// Several entries reach their designed state (an error, a confirmation) by typing and pressing through the DOM of the
// browser preview, since shot.mjs cannot. Here the same few selectors are answered from the rendered tree, so the sweeps
// check those states too.
let tree: Node | null = null;
/** The tree the document shim answers from: the one entry on screen now (null between entries). */
export const setTree = (root: Node | null) => {
  tree = root;
};
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
  if (!m) throw new Error(`preview sweep: the document shim does not know the selector ${selector}`);
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

const entriesDir = path.join(__dirname, 'entries');
/** Every entry of every tools/preview/entries/*.tsx file. */
export const entries: { file: string; name: string; make: () => ReactElement }[] = fs
  .readdirSync(entriesDir)
  .filter(f => f.endsWith('.tsx'))
  .flatMap(f => Object.entries(require(path.join(entriesDir, f)).entries as Record<string, () => ReactElement>).map(([name, make]) => ({ file: f, name, make })));

const realFetch = globalThis.fetch;
const realNow = Date.now;
/** For `afterEach`: the next entry starts from an empty device. */
export async function resetAfterEntry() {
  tree = null;
  drives().pending = 0; // a failed entry must not hold up the next one
  globalThis.fetch = realFetch;
  Date.now = realNow; // the focus-session entries move the clock forward
  // the pending queue lives in memory too, and a record one entry left waiting would be sent by the next one
  resetPendingForTests();
  await AsyncStorage.clear();
}
