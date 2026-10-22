/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { act, render } from '@testing-library/react-native';
import { useEffect, type ReactElement } from 'react';
import { AccessibilityInfo, Animated, AppState, Text, View } from 'react-native';
import { BreathingGuide } from '../src/features/workout/BreathingGuide';
import { RigPlayer } from '../src/features/workout/RigPlayer';
import { motion } from '../src/shared/motion/motion';
import { MotionPreferenceProvider, resetSystemMotionForTests } from '../src/shared/motion/useReducedMotion';
import { StreakChip } from '../src/shared/ui/Badges';
import { Mam } from '../src/shared/ui/mam/Mam';
import { LoadingState } from '../src/shared/ui/States';
import { all, DRIVE_LIMIT_MS, entries, isHost, resetAfterEntry, setTree, settle, textOf, typeOf, type Node } from '../tools/preview/sweepKit';

// Task 50: motion. (1) every tier-1 catalog id has an implementation marker and the table in the docs is the generated one;
// (2) under reduced motion no preview entry starts an animation and none shows less text than under full motion;
// (3) the decorative loops and the one-shot celebrations obey the screen's focus and the app's foreground;
// (4) static scans: no animation callback does business work, every timer is cleared, every loop is gated.
// What only a device shows (the system switch flipped while the app is open, 60 fps, a locked screen) is in
// .superpowers/sdd/device-checks.md.

// Every preview entry builds its tree with withApp(); both passes of the sweep decide the motion preference here.
const mockMotion: { current: 'FULL' | 'REDUCED' } = { current: 'FULL' };
jest.mock('../tools/preview/harness', () => {
  const actual = jest.requireActual('../tools/preview/harness');
  return { ...actual, withApp: (node: ReactElement | null, opts: object = {}) => actual.withApp(node, { ...opts, motion: mockMotion.current }) };
});

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');
// The test kits that sit in src/ are not the app: they wait on timers the way a test does.
const app = walk(src).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$|TestKit\.tsx?$/.test(f));
const read = (f: string) => fs.readFileSync(f, 'utf8');

// ---- 1. The catalog table -------------------------------------------------------------------------------------------------
type Entry = { id: string; tier: 1 | 2; kind: string };
const catalog = JSON.parse(read(path.join(root, 'design/motion/catalog.json'))) as Entry[];
/** `// motion: <id>`, `/* motion: <id> *\/` or ` * motion: <id>` in a comment; `exercise-*` stands for every id with that prefix. */
const MARKER = /(?:\/\/|\/\*|^[ \t]*\*)[ \t]*motion:[ \t]*([a-z0-9]+(?:-[a-z0-9]+)*(?:-\*)?)/gm;
export function markersOf(text: string): string[] {
  return [...text.matchAll(MARKER)].map(m => m[1]);
}
/** The catalog id -> the files that carry its marker. */
export function markedFiles(files: Record<string, string>): { byId: Map<string, string[]>; unknown: string[] } {
  const ids = catalog.map(e => e.id);
  const byId = new Map<string, string[]>();
  const unknown: string[] = [];
  for (const [file, text] of Object.entries(files))
    for (const marker of markersOf(text)) {
      const hit = marker.endsWith('*') ? ids.filter(id => id.startsWith(marker.slice(0, -1))) : ids.filter(id => id === marker);
      if (!hit.length) unknown.push(`${file}: ${marker}`);
      for (const id of hit) byId.set(id, [...new Set([...(byId.get(id) ?? []), file])].sort());
    }
  return { byId, unknown };
}
const STATIC = 'tĩnh (tier 2)';
export function tableOf(files: Record<string, string>): { table: string; missingTier1: string[]; unknown: string[]; marked: number } {
  const { byId, unknown } = markedFiles(files);
  const rows = catalog.map(e => `| ${e.id} | ${e.tier} | ${e.kind} | ${byId.get(e.id)?.join(', ') ?? (e.tier === 2 ? STATIC : '**thiếu**')} |`);
  return {
    table: ['| id | tier | kind | tệp cài đặt |', '|---|---|---|---|', ...rows].join('\n'),
    missingTier1: catalog.filter(e => e.tier === 1 && !byId.has(e.id)).map(e => e.id),
    unknown,
    marked: byId.size,
  };
}
const sources = Object.fromEntries(app.map(f => [rel(f), read(f)]));
const built = tableOf(sources);

const DOC = path.join(root, 'docs/testing-and-release.md');
const START = '<!-- motion-table:start -->';
const END = '<!-- motion-table:end -->';

describe('catalog table', () => {
  const tier1 = catalog.filter(e => e.tier === 1).length;
  afterAll(() => {
    const tier2 = catalog.length - tier1;
    const tier2Marked = catalog.filter(e => e.tier === 2 && markedFiles(sources).byId.has(e.id)).length;
    console.log(
      `motion catalog: ${catalog.length} ids; tier 1 ${tier1} (marked ${tier1 - built.missingTier1.length}); tier 2 ${tier2} (marked ${tier2Marked}, static ${tier2 - tier2Marked}); table rows ${built.table.split('\n').length - 2}`,
    );
  });

  test('every tier-1 id carries a `// motion: <id>` marker in src/', () => {
    expect(built.missingTier1).toEqual([]);
  });
  test('every marker names an id of design/motion/catalog.json', () => {
    expect(built.unknown).toEqual([]);
  });
  test('the table in docs/testing-and-release.md is the generated one (MOTION_TABLE_WRITE=1 rewrites it)', () => {
    const doc = read(DOC);
    const a = doc.indexOf(START);
    const b = doc.indexOf(END);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const eol = doc.includes('\r\n') ? '\r\n' : '\n'; // a Windows checkout has CRLF
    if (process.env.MOTION_TABLE_WRITE === '1') fs.writeFileSync(DOC, `${doc.slice(0, a + START.length)}${eol}${built.table.replace(/\n/g, eol)}${eol}${doc.slice(b)}`);
    else expect(doc.slice(a + START.length, b).replace(/\r\n/g, '\n').trim()).toBe(built.table);
  });
  test('negative control: an unmarked tier-1 id and a marker of an unknown id are reported', () => {
    const none = tableOf({});
    expect(none.missingTier1).toEqual(catalog.filter(e => e.tier === 1).map(e => e.id));
    expect(none.table).toContain('**thiếu**');
    expect(none.table).toContain(STATIC);
    const typo = tableOf({ 'src/x.tsx': '// motion: press-scal\n/* motion: press-scale */\n * motion: exercise-*' });
    expect(typo.unknown).toEqual(['src/x.tsx: press-scal']);
    expect(typo.marked).toBe(1 + catalog.filter(e => e.id.startsWith('exercise-')).length);
    expect(tableOf({ 'src/x.tsx': '// motion: press-scale' }).table).toContain('| press-scale | 1 | micro | src/x.tsx |');
  });
});

// ---- 2. Reduced motion over every preview entry -------------------------------------------------------------------------
const FACTORIES = ['timing', 'spring', 'loop', 'sequence', 'parallel'] as const;
/**
 * The library's own animations: the bottom tabs run a zero-length timing (`animation` "none", `duration: 0`) on every
 * tab change, whatever the app does. They move nothing, so they are listed apart from the app's.
 */
const fromLibrary = () => {
  const frames = String(new Error().stack).split(/\r?\n/).slice(1).filter(line => line.includes(root));
  // The first frame that is neither this file nor React Native's own Animated code is whoever started the animation.
  const caller = frames.find(line => !line.includes('motion-sweep.test') && !/node_modules[\\/]react-native[\\/]/.test(line)) ?? '';
  return /node_modules[\\/]@react-navigation[\\/]/.test(caller);
};
/** Counts every `.start()` of an animation made by one of the Animated factories until `stop()`; the real animations still run. */
export function watchAnimations() {
  const started: string[] = [];
  const library: string[] = [];
  const spies = FACTORIES.map(name => {
    const real = Animated[name] as (...args: unknown[]) => { start: (cb?: unknown) => void };
    return jest.spyOn(Animated, name).mockImplementation(((...args: unknown[]) => {
      const animation = real(...args);
      const start = animation.start.bind(animation);
      animation.start = (cb?: unknown) => {
        (fromLibrary() ? library : started).push(name);
        return start(cb);
      };
      return animation;
    }) as never);
  });
  return { started, library, stop: () => spies.forEach(spy => spy.mockRestore()) };
}
/** Hidden from the screen reader on purpose (a flourish that repeats what a visible text already says), by itself or by an ancestor. */
const decorative = (n: Node): boolean => {
  for (let p: Node | null = n; p; p = p.parent)
    if (isHost(p) && (p.props.importantForAccessibility === 'no-hide-descendants' || p.props.accessibilityElementsHidden === true)) return true;
  return false;
};
/** Every text on screen that carries information, trimmed. */
export const stringsOf = (tree: Node): Set<string> =>
  new Set(all(tree).filter(n => isHost(n) && typeOf(n) === 'Text' && !decorative(n)).map(n => textOf(n).trim()).filter(Boolean));
/** What the full-motion screen shows and the reduced one does not. */
export const lostUnderReduced = (full: Set<string>, reduced: Set<string>) => [...full].filter(s => !reduced.has(s));
/**
 * Controls that exist only to act on a moving figure. The S82 rig demos (squat, neck tilt) show a still pose under reduced
 * motion, which has nothing to pause or slow down, so "Tạm dừng" and "Xem chậm" go (MoveDemoScreen.tsx: `moving`); "Đang tắt" is
 * the switch's own state. The timed demos (breath, body scan) are NOT listed: their phase text keeps cycling, so they keep Pause.
 */
const MOVEMENT_CONTROLS: [RegExp, string[]][] = [[/^workout\.tsx s82-move-demo(-reduced-motion|-front)?$/, ['Tạm dừng', 'Xem chậm 0,5×', 'Đang tắt']]];
const allowedLoss = (name: string) => MOVEMENT_CONTROLS.filter(([entry]) => entry.test(name)).flatMap(([, strings]) => strings);

/**
 * Renders the element under the given motion preference (the OS switch answers the same way, for the entries that follow the
 * system, like the whole <App />), lets it settle, and reports what it showed and which animations it started.
 */
async function observe(make: () => ReactElement, mode: 'FULL' | 'REDUCED', extraMs = 0) {
  mockMotion.current = mode;
  resetSystemMotionForTests();
  const system = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(mode === 'REDUCED');
  await resetAfterEntry();
  const watch = watchAnimations();
  const view = render(make());
  setTree(view.UNSAFE_root);
  try {
    await settle();
    // a number that counts up reads its final value only when the count is over
    if (extraMs) await act(async () => new Promise(resolve => setTimeout(resolve, extraMs)));
    return { strings: stringsOf(view.UNSAFE_root), started: [...watch.started], library: [...watch.library] };
  } finally {
    watch.stop();
    system.mockRestore();
    view.unmount();
  }
}

const tally = { entries: 0, full: 0, fullEntries: 0, reduced: 0, strings: 0, extras: 0, settledAgain: 0, allowed: 0 };
afterEach(resetAfterEntry);
afterAll(() => {
  console.log(
    `motion sweep: ${tally.entries} entries rendered under FULL and REDUCED; animations started under REDUCED ${tally.reduced}; under FULL ${tally.full} (in ${tally.fullEntries} entries); strings compared ${tally.strings}; extra strings only under REDUCED ${tally.extras}; entries whose FULL pass was read again after a count-up ${tally.settledAgain}; strings lost by design ${tally.allowed}`,
  );
});

describe('reduced motion', () => {
  test.each(entries.map(e => [`${e.file} ${e.name}`, e] as const))('%s', async (name, { make }) => {
    let full = await observe(make, 'FULL');
    const reduced = await observe(make, 'REDUCED');
    const allowed = allowedLoss(name);
    const lost = (from: Set<string>) => lostUnderReduced(from, reduced.strings).filter(s => !allowed.includes(s));
    if (lost(full.strings).length) {
      tally.settledAgain += 1;
      full = await observe(make, 'FULL', motion.durationsMs.countUp + 900);
    }
    tally.entries += 1;
    tally.full += full.started.length;
    tally.fullEntries += full.started.length ? 1 : 0;
    tally.reduced += reduced.started.length;
    tally.strings += full.strings.size;
    tally.extras += [...reduced.strings].filter(s => !full.strings.has(s)).length;
    tally.allowed += lostUnderReduced(full.strings, reduced.strings).length - lost(full.strings).length;
    expect({ started: reduced.started, lost: lost(full.strings) }).toEqual({ started: [], lost: [] });
  }, 2 * DRIVE_LIMIT_MS + 10000);

  test('the sweep is not vacuous: some entries do start animations under full motion', () => {
    expect(tally.fullEntries).toBeGreaterThan(0);
  });

  describe('negative control', () => {
    function Fixture({ gone, flourish }: { gone?: boolean; flourish?: boolean }) {
      useEffect(() => {
        const value = new Animated.Value(0);
        Animated.loop(Animated.timing(value, { toValue: 1, duration: 100, useNativeDriver: true })).start();
      }, []);
      return (
        <>
          {gone ? null : <Text>Xin chào</Text>}
          {flourish ? (
            <View importantForAccessibility="no-hide-descendants">
              <Text>+10</Text>
            </View>
          ) : null}
        </>
      );
    }
    const strings = async (node: ReactElement, mode: 'FULL' | 'REDUCED') =>
      (await observe(() => <MotionPreferenceProvider value={mode}>{node}</MotionPreferenceProvider>, mode)).strings;

    test('an Animated.loop started under reduced motion is caught', async () => {
      const { started } = await observe(() => <MotionPreferenceProvider value="REDUCED"><Fixture /></MotionPreferenceProvider>, 'REDUCED');
      expect(started).toContain('loop');
    });
    test('text that goes missing under reduced motion is caught; extra text and a hidden flourish are not', async () => {
      const full = await strings(<Fixture flourish />, 'FULL');
      const reduced = await strings(<Fixture gone />, 'REDUCED');
      expect([...full]).toEqual(['Xin chào']); // the hidden "+10" is not information
      expect(lostUnderReduced(full, reduced)).toEqual(['Xin chào']);
      expect(lostUnderReduced(reduced, full)).toEqual([]);
      expect(lostUnderReduced(new Set(['a']), new Set(['a', '3 giây']))).toEqual([]);
    });
  });
});

// ---- 3. Lifecycle: Mam, RigPlayer, LoadingState, the streak flame, BreathingGuide -----------------------------------------
type AppStateChange = (state: string) => void;
const appState = AppState as unknown as { currentState: unknown };
const stateAtLoad = appState.currentState;
const spies: jest.SpyInstance[] = [];

/**
 * Animated.loop and Animated.sequence are replaced by animations that only keep count: `live` is how many are started and not
 * yet stopped, `finish()` ends every one that is still running the way a finished animation does.
 */
function fakeAnimations() {
  const live = new Set<object>();
  const log = { started: 0 };
  const ends: (() => void)[] = [];
  const make = () => {
    let done: ((result: { finished: boolean }) => void) | undefined;
    const animation = {
      start: (callback?: typeof done) => {
        if (live.has(animation)) return;
        live.add(animation);
        log.started += 1;
        done = callback;
        ends.push(() => live.delete(animation) && done?.({ finished: true }));
      },
      stop: () => live.delete(animation) && done?.({ finished: false }),
      reset: () => undefined,
    };
    return animation;
  };
  spies.push(jest.spyOn(Animated, 'loop').mockImplementation(make as never), jest.spyOn(Animated, 'sequence').mockImplementation(make as never));
  return { live: () => live.size, started: () => log.started, finish: () => ends.splice(0).forEach(end => end()) };
}
function fakeAppState() {
  appState.currentState = 'active';
  const listeners: AppStateChange[] = [];
  const removes: jest.Mock[] = [];
  spies.push(
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: AppStateChange) => {
      listeners.push(listener);
      const remove = jest.fn();
      removes.push(remove);
      return { remove };
    }) as never),
  );
  return {
    go: (state: string) => act(() => listeners.forEach(listener => listener(state))),
    allRemoved: () => removes.length > 0 && removes.every(remove => remove.mock.calls.length === 1),
  };
}
afterEach(() => {
  appState.currentState = stateAtLoad;
  spies.splice(0).forEach(spy => spy.mockRestore());
  jest.useRealTimers();
});

const full = (node: ReactElement) => <MotionPreferenceProvider value="FULL">{node}</MotionPreferenceProvider>;
const breath = [
  { label: 'In', ms: 4000 },
  { label: 'Out', ms: 4000 },
];
const loopers: [string, (active: boolean) => ReactElement][] = [
  ['Mam', active => <Mam stage="HATCHLING" mood="NEUTRAL" size={64} animation="idle" active={active} decorative />],
  ['RigPlayer', active => <RigPlayer demoCode="exercise-squat" speed={1} active={active} />],
  ['LoadingState', active => <LoadingState active={active} />],
  ['streak flame', active => <StreakChip days={5} active={active} />],
  ['BreathingGuide', active => <BreathingGuide pattern={breath} active={active} circle />],
];

/**
 * Fake timers on, and a count of the timers that code in src/ set and has neither cleared nor seen fire (nothing here advances
 * the clock): React Native's and the test renderer's own timers are not the app's to clean up.
 */
function appTimers() {
  jest.useFakeTimers();
  const pending = new Set<unknown>();
  const fromApp = () => String(new Error().stack).split(/\r?\n/).some(line => line.includes(src + path.sep) && !/\.test\.tsx?/.test(line));
  for (const [set, clear] of [['setTimeout', 'clearTimeout'], ['setInterval', 'clearInterval']] as const) {
    const realSet = globalThis[set] as (...args: unknown[]) => unknown;
    const realClear = globalThis[clear] as (id: unknown) => void;
    spies.push(
      jest.spyOn(globalThis, set).mockImplementation(((...args: unknown[]) => {
        const id = realSet(...args);
        if (fromApp()) pending.add(id);
        return id;
      }) as never),
      jest.spyOn(globalThis, clear).mockImplementation(((id: unknown) => {
        pending.delete(id);
        return realClear(id);
      }) as never),
    );
  }
  return () => pending.size;
}

describe.each(loopers)('lifecycle of %s', (_name, element) => {
  test('runs while focused and in the foreground; stops on unmount, on active=false and on background', () => {
    const timers = appTimers();
    const animations = fakeAnimations();
    const states = fakeAppState();
    const view = render(full(element(true)));
    expect(animations.live()).toBeGreaterThan(0);

    view.rerender(full(element(false))); // the screen lost focus
    expect(animations.live()).toBe(0);
    view.rerender(full(element(true)));
    expect(animations.live()).toBeGreaterThan(0);

    states.go('background'); // the app went away
    expect(animations.live()).toBe(0);
    states.go('active');
    expect(animations.live()).toBeGreaterThan(0);

    view.unmount();
    expect(animations.live()).toBe(0);
    expect(states.allRemoved()).toBe(true);
    expect(timers()).toBe(0); // no timer of its own outlives it
  });

  test('under reduced motion nothing starts', () => {
    const animations = fakeAnimations();
    fakeAppState();
    const view = render(<MotionPreferenceProvider value="REDUCED">{element(true)}</MotionPreferenceProvider>);
    expect(animations.started()).toBe(0);
    view.unmount();
  });
});

test('BreathingGuide keeps no timer running while the app is in the background', () => {
  const timers = appTimers();
  fakeAnimations();
  const states = fakeAppState();
  const view = render(full(<BreathingGuide pattern={breath} active circle />));
  expect(timers()).toBeGreaterThan(0); // the phase clock
  states.go('background');
  expect(timers()).toBe(0);
  states.go('active');
  expect(timers()).toBeGreaterThan(0);
  view.unmount();
});

test('a celebration that has played is not played again when the app comes back or the screen is focused again', () => {
  const animations = fakeAnimations();
  const states = fakeAppState();
  const cheer = (active: boolean) => full(<Mam stage="HATCHLING" mood="HAPPY" size={64} animation="cheer" active={active} decorative />);
  const view = render(cheer(true));
  expect(animations.started()).toBe(1);
  act(() => animations.finish());
  states.go('background');
  states.go('active');
  view.rerender(cheer(false));
  view.rerender(cheer(true));
  expect(animations.started()).toBe(1);
  view.unmount();
});

// ---- 4. Static scans ----------------------------------------------------------------------------------------------------
/** The text between the parentheses that open at `from` (the index of the "("), or '' when they never close. */
function argsAt(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && (depth -= 1) === 0) return text.slice(from + 1, i);
  }
  return '';
}
const BUSINESS = /\b(api|navigation|navigate|mutate|mutateAsync|invalidateQueries|setQueryData|fetch|send|saved|setSaved|snackbar|dismiss|goBack|push|replace|reset|dispatch)\b/;
/** The callbacks handed to an animation's `.start(` or `.addListener(`, and what in them is more than drawing. */
export function callbackFindings(text: string): { callbacks: number; findings: string[] } {
  const findings: string[] = [];
  let callbacks = 0;
  for (const m of text.matchAll(/\.(start|addListener)\(/g)) {
    const body = argsAt(text, m.index + m[0].length - 1).trim();
    if (!body) continue;
    callbacks += 1;
    const hit = BUSINESS.exec(body);
    if (hit) findings.push(`.${m[1]}(${body.replace(/\s+/g, ' ').slice(0, 60)}...): ${hit[0]}`);
  }
  return { callbacks, findings };
}
/** setTimeout / setInterval that are not kept in a variable which a clearTimeout / clearInterval then receives. */
export function timerFindings(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const findings: string[] = [];
  for (const m of code.matchAll(/\b(setTimeout|setInterval)\(/g)) {
    const before = code.slice(0, m.index);
    const kept = /([\w.]+)\s*=\s*$/.exec(before);
    const clear = m[1] === 'setTimeout' ? 'clearTimeout' : 'clearInterval';
    if (!kept) findings.push(`${m[1]} not kept in a variable`);
    else if (!new RegExp(`${clear}\\(\\s*${kept[1].replace('.', '\\.')}\\s*\\)`).test(code)) findings.push(`${m[1]} kept in ${kept[1]} is never cleared`);
  }
  return findings;
}

describe('static scans of src/', () => {
  test('no animation callback performs a business effect (api, mutation, navigate, saved state)', () => {
    const per = Object.entries(sources).map(([file, text]) => [file, callbackFindings(text)] as const);
    expect(per.flatMap(([file, r]) => r.findings.map(f => `${file}: ${f}`))).toEqual([]);
    // The callbacks that exist today: the three that remember a one-shot ran to its end, and the listeners that draw.
    expect(per.filter(([, r]) => r.callbacks).map(([file]) => file)).toEqual([
      'src/features/workout/RigPlayer.tsx',
      'src/features/workout/WorkoutResultScreen.tsx',
      'src/shared/ui/Badges.tsx',
      'src/shared/ui/mam/Mam.tsx',
      'src/shared/ui/OverlayCelebration.tsx',
    ]);
  });

  test('every setTimeout / setInterval is kept and cleared', () => {
    expect(Object.entries(sources).flatMap(([file, text]) => timerFindings(text).map(f => `${file}: ${f}`))).toEqual([]);
  });

  test('every Animated.loop sits in a file that gates it on the foreground (useLoopGate or AppState)', () => {
    const loops = Object.entries(sources).filter(([, text]) => /Animated\.loop\(/.test(text));
    expect(loops.length).toBeGreaterThan(0);
    expect(loops.filter(([, text]) => !/useLoopGate|AppState/.test(text)).map(([file]) => file)).toEqual([]);
  });

  test('every animation started in src/ is stopped in the same file (Touchable: a 120 ms press, no loop)', () => {
    const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
    const open = Object.entries(sources)
      .filter(([file, text]) => file !== 'src/shared/ui/Touchable.tsx' && count(text, /\b(run|loop|pulse|slide|shrink|fill|roll|show|playing)\.start\(/g) > count(text, /\b(run|loop|pulse|slide|shrink|fill|roll|show|playing)\.stop\(\)/g))
      .map(([file]) => file);
    expect(open).toEqual([]);
  });

  test('negative control: the scans see a business callback, an uncleared timer and an unkept one', () => {
    expect(callbackFindings('Animated.timing(v, c).start(({ finished }) => { if (finished) api.post("/x"); });').findings).toHaveLength(1);
    expect(callbackFindings('run.start(({ finished }) => { navigation.navigate("Today"); });').findings).toHaveLength(1);
    expect(callbackFindings('run.start(({ finished }) => { played.current = finished; }); run.start();')).toEqual({ callbacks: 1, findings: [] });
    expect(timerFindings('const t = setTimeout(f, 1);')).toEqual(['setTimeout kept in t is never cleared']);
    expect(timerFindings('const t = setTimeout(f, 1); return () => clearTimeout(t);')).toEqual([]);
    expect(timerFindings('ref.current = setInterval(f, 1); clearInterval(ref.current);')).toEqual([]);
    expect(timerFindings('await new Promise(r => setTimeout(r, 1));')).toEqual(['setTimeout not kept in a variable']);
    expect(timerFindings('// setTimeout(f, 1)\n/* setInterval(g) */')).toEqual([]);
  });
});
