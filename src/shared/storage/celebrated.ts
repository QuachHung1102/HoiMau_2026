import AsyncStorage from '@react-native-async-storage/async-storage';

// The highest level and the highest pet stage of one user that have been celebrated on this device (kept by the
// celebration host): a number only, never anything about health. Not in `cache.ts` on purpose: that file is the list of
// what a person's data may keep on disk. Sign-out removes both (`leave` in session.ts).
export const celebratedKey = (userId: string) => `celebrated:v1:${userId}`;
/** The stage is kept as its index in PET_STAGES (0 = EGG). */
export const celebratedStageKey = (userId: string) => `celebratedStage:v1:${userId}`;

/** The number, or undefined when nothing is stored, it is corrupted or storage fails (then the next Me seeds it again). */
async function load(key: string, min: number): Promise<number | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const value: unknown = raw === null ? undefined : JSON.parse(raw);
    return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Best effort: a number that is not kept only means the next sign-in seeds it again, never a repeated celebration. */
async function save(key: string, value: number): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // nothing to do
  }
}

export const loadCelebratedLevel = (userId: string) => load(celebratedKey(userId), 1);
export const saveCelebratedLevel = (userId: string, level: number) => save(celebratedKey(userId), level);
export async function clearCelebratedLevel(userId: string): Promise<void> {
  await AsyncStorage.removeItem(celebratedKey(userId));
}

export const loadCelebratedStage = (userId: string) => load(celebratedStageKey(userId), 0);
export const saveCelebratedStage = (userId: string, stageIndex: number) => save(celebratedStageKey(userId), stageIndex);
export async function clearCelebratedStage(userId: string): Promise<void> {
  await AsyncStorage.removeItem(celebratedStageKey(userId));
}
