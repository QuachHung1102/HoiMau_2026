import AsyncStorage from '@react-native-async-storage/async-storage';

// The highest level of one user that has been celebrated on this device (Task 28, the celebration host): a level number
// only, never anything about health. Not in `cache.ts` on purpose: that file is the list of what a person's data may
// keep on disk. Sign-out removes it (`leave` in session.ts).
export const celebratedKey = (userId: string) => `celebrated:v1:${userId}`;

/** The level, or undefined when nothing is stored, it is corrupted or storage fails (then the next Me seeds it again). */
export async function loadCelebratedLevel(userId: string): Promise<number | undefined> {
  try {
    const raw = await AsyncStorage.getItem(celebratedKey(userId));
    const level: unknown = raw === null ? undefined : JSON.parse(raw);
    return typeof level === 'number' && Number.isInteger(level) && level >= 1 ? level : undefined;
  } catch {
    return undefined;
  }
}

/** Best effort: a level that is not kept only means the next sign-in seeds it again, never a repeated celebration. */
export async function saveCelebratedLevel(userId: string, level: number): Promise<void> {
  try {
    await AsyncStorage.setItem(celebratedKey(userId), JSON.stringify(level));
  } catch {
    // nothing to do
  }
}

export async function clearCelebratedLevel(userId: string): Promise<void> {
  await AsyncStorage.removeItem(celebratedKey(userId));
}
