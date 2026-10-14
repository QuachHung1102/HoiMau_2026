import AsyncStorage from '@react-native-async-storage/async-storage';

// The stand-up countdown of one user (Task 26): timing only, never anything about health. Not in `cache.ts` on
// purpose: that file is the list of what a person's data may keep on disk.
export const standUpKey = (userId: string) => `standup:v1:${userId}`;

/** What was saved, or undefined when nothing is stored, it is corrupted or storage fails. The caller checks its shape. */
export async function loadStandUp(userId: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(standUpKey(userId));
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Best effort: a reminder that is lost starts a fresh hour, nothing worse. */
export async function saveStandUp(userId: string, state: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(standUpKey(userId), JSON.stringify(state));
  } catch {
    // nothing to do
  }
}

export async function clearStandUp(userId: string): Promise<void> {
  await AsyncStorage.removeItem(standUpKey(userId));
}
