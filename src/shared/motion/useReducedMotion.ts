import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

export type MotionPreference = 'SYSTEM' | 'REDUCED' | 'FULL';

const MotionPreferenceContext = createContext<MotionPreference>('SYSTEM');

export function MotionPreferenceProvider({ value, children }: { value: MotionPreference; children: ReactNode }) {
  return createElement(MotionPreferenceContext.Provider, { value }, children);
}

// The OS "reduce motion" value lives here once for the whole app. Until it is known (or if reading it fails)
// it is `undefined` and the hook reports reduced: static is the safe default.
// The single native listener starts with the first SYSTEM subscriber and lives for the app's lifetime.
let osValue: boolean | undefined;
let started = false;
let nativeSubscription: { remove(): void } | undefined;
let generation = 0; // lets a reset ignore a read that is still in flight
const listeners = new Set<() => void>();

/** Test hook only: forget the OS value and the native listener so each test starts cold. */
export function resetSystemMotionForTests() {
  nativeSubscription?.remove();
  nativeSubscription = undefined;
  osValue = undefined;
  started = false;
  generation += 1;
  listeners.clear();
}
const publish = (value: boolean) => {
  osValue = value;
  listeners.forEach(notify => notify());
};

function start() {
  started = true;
  const mine = generation;
  let changed = false;
  nativeSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
    changed = true;
    publish(value);
  });
  AccessibilityInfo.isReduceMotionEnabled().then(
    // A change event that arrived first is newer than this initial read.
    value => !changed && mine === generation && publish(value),
    () => undefined,
  );
}

function subscribeSystem(notify: () => void) {
  listeners.add(notify);
  if (!started) start();
  return () => {
    listeners.delete(notify);
  };
}
const subscribeNothing = () => () => undefined;

/** The `motion` setting: REDUCED -> true, FULL -> false, SYSTEM -> the OS "reduce motion" switch. */
export function useReducedMotion(): boolean {
  const preference = useContext(MotionPreferenceContext);
  const system = useSyncExternalStore(preference === 'SYSTEM' ? subscribeSystem : subscribeNothing, () => osValue ?? true);
  if (preference === 'SYSTEM') return system;
  return preference === 'REDUCED';
}
