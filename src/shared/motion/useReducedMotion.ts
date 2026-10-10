import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

export type MotionPreference = 'SYSTEM' | 'REDUCED' | 'FULL';

const MotionPreferenceContext = createContext<MotionPreference>('SYSTEM');

export function MotionPreferenceProvider({ value, children }: { value: MotionPreference; children: ReactNode }) {
  return createElement(MotionPreferenceContext.Provider, { value }, children);
}

/** The `motion` setting: REDUCED -> true, FULL -> false, SYSTEM -> the OS "reduce motion" switch. */
export function useReducedMotion(): boolean {
  const preference = useContext(MotionPreferenceContext);
  const [system, setSystem] = useState(false);
  useEffect(() => {
    if (preference !== 'SYSTEM') return undefined;
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => active && setSystem(enabled));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [preference]);
  if (preference === 'SYSTEM') return system;
  return preference === 'REDUCED';
}
