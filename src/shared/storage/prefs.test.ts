import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUserCache } from './cache';
import { prefsKey, readMotionPref, writeMotionPref } from './prefs';

afterEach(() => AsyncStorage.clear());

test('the motion word is stored under prefs:v1:<userId> as one JSON object and read back', async () => {
  await writeMotionPref('user-a', 'REDUCED');
  expect(await AsyncStorage.getAllKeys()).toEqual(['prefs:v1:user-a']);
  expect(await AsyncStorage.getItem(prefsKey('user-a'))).toBe('{"motion":"REDUCED"}');
  expect(await readMotionPref('user-a')).toBe('REDUCED');
  await writeMotionPref('user-a', 'FULL');
  expect(await readMotionPref('user-a')).toBe('FULL');
});

test('users do not see each other', async () => {
  await writeMotionPref('user-a', 'REDUCED');
  expect(await readMotionPref('user-b')).toBeUndefined();
});

test.each(['{"motion":', 'null', '"REDUCED"', '{}', '{"motion":"LOUD"}', '{"motion":3}', '{"motion":null}'])('%s reads as nothing stored', async raw => {
  await AsyncStorage.setItem(prefsKey('user-a'), raw);
  expect(await readMotionPref('user-a')).toBeUndefined();
});

test('a storage failure never rejects', async () => {
  const boom = () => Promise.reject(new Error('disk full'));
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(boom);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(boom);
  await expect(readMotionPref('user-a')).resolves.toBeUndefined();
  await expect(writeMotionPref('user-a', 'FULL')).resolves.toBeUndefined();
  jest.restoreAllMocks();
});

test('clearUserCache (sign-out, account deletion) removes the preference of that user and of nobody else', async () => {
  await writeMotionPref('user-a', 'REDUCED');
  await writeMotionPref('user-b', 'FULL');
  await AsyncStorage.setItem('pending:v1:user-a', '[]');
  await clearUserCache('user-a');
  expect(await readMotionPref('user-a')).toBeUndefined();
  expect(await readMotionPref('user-b')).toBe('FULL');
  expect(await AsyncStorage.getItem('pending:v1:user-a')).toBe('[]');
});
