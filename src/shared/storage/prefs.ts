import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MotionPreference } from '../motion/useReducedMotion';

// The motion setting of one user, kept on this device so that the first frame after a cold start already respects it (S79):
// the server's `settings.motion` is read only after the shell is up. A word, never anything about health. Not in `cache.ts`
// on purpose (that file is the list of what a person's data may keep on disk), but `clearUserCache` removes it with the rest.
export const prefsKey = (userId: string) => `prefs:v1:${userId}`;

const MOTIONS: readonly unknown[] = ['SYSTEM', 'REDUCED', 'FULL'];

/** `undefined` when nothing is stored, the stored JSON is corrupted, holds anything but one of the three words, or storage fails. */
export async function readMotionPref(userId: string): Promise<MotionPreference | undefined> {
  try {
    const raw = await AsyncStorage.getItem(prefsKey(userId));
    const stored: unknown = raw === null ? undefined : (JSON.parse(raw) as { motion?: unknown } | null)?.motion;
    return MOTIONS.includes(stored) ? (stored as MotionPreference) : undefined;
  } catch {
    return undefined;
  }
}

/** Best effort: a value that is not kept only means the next cold start waits for the server's answer. */
export async function writeMotionPref(userId: string, motion: MotionPreference): Promise<void> {
  try {
    await AsyncStorage.setItem(prefsKey(userId), JSON.stringify({ motion }));
  } catch {
    // nothing to do
  }
}
