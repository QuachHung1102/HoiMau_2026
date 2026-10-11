import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

/**
 * True while decorative motion may run: the screen is focused (`active`), the app is in the foreground
 * (`AppState` is `active`, both at mount and after every change) and motion is not reduced.
 */
export function useLoopGate(active = true): boolean {
  const reduced = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  return active && foreground && !reduced;
}
