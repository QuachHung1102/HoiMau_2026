import AsyncStorage from '@react-native-async-storage/async-storage';
import { prefsKey } from './prefs';

/**
 * The only things kept on disk: the last `Me` and the last `DayState` of a user. Neither contains
 * measurements, journal text or a token; do not widen this list: measurements, journal text and tokens must never be cached.
 */
export type CacheKey = 'me' | 'day';
// `satisfies` makes tsc fail when a key is added to the union but not here, so sign-out cannot forget it.
const KEYS = Object.keys({ me: true, day: true } satisfies Record<CacheKey, true>) as CacheKey[];

const storageKey = (userId: string, key: CacheKey) => `cache:v1:${userId}:${key}`;

/** `undefined` when nothing is stored, the stored JSON is corrupted or storage fails. */
export async function readCache<T>(userId: string, key: CacheKey): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, key));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

/** Best effort: a failed write never rejects, the cache is an optimisation. */
export async function writeCache(userId: string, key: CacheKey, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId, key), JSON.stringify(value));
  } catch {
    // nothing to do: the next successful read from the server writes it again
  }
}

/** The user's cache and their motion preference (`prefs:v1:<userId>`): sign-out and account deletion leave neither behind. */
export async function clearUserCache(userId: string): Promise<void> {
  await AsyncStorage.removeMany([...KEYS.map(key => storageKey(userId, key)), prefsKey(userId)]);
}
