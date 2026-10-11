import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUserCache, readCache, writeCache } from './cache';

afterEach(() => AsyncStorage.clear());

test('a value is stored under cache:v1:<userId>:<key> and read back', async () => {
  await writeCache('user-a', 'me', { user: { id: 'user-a' } });
  expect(await AsyncStorage.getAllKeys()).toEqual(['cache:v1:user-a:me']);
  expect(await readCache('user-a', 'me')).toEqual({ user: { id: 'user-a' } });
});

test('users do not see each other: reads are per user and clearing one keeps the other', async () => {
  await writeCache('user-a', 'me', 'a-me');
  await writeCache('user-a', 'day', 'a-day');
  await writeCache('user-b', 'me', 'b-me');
  expect(await readCache('user-b', 'day')).toBeUndefined();
  expect(await readCache('user-b', 'me')).toBe('b-me');

  await clearUserCache('user-a');
  expect(await readCache('user-a', 'me')).toBeUndefined();
  expect(await readCache('user-a', 'day')).toBeUndefined();
  expect(await AsyncStorage.getAllKeys()).toEqual(['cache:v1:user-b:me']);
});

test('clearing leaves keys that are not this user cache alone', async () => {
  await AsyncStorage.setItem('pending:v1:user-a', '[]');
  await writeCache('user-a', 'me', 1);
  await clearUserCache('user-a');
  expect(await AsyncStorage.getAllKeys()).toEqual(['pending:v1:user-a']);
});

test('a missing key and a corrupted value both read as undefined', async () => {
  expect(await readCache('user-a', 'me')).toBeUndefined();
  await AsyncStorage.setItem('cache:v1:user-a:me', '{"user":');
  expect(await readCache('user-a', 'me')).toBeUndefined();
});

test('a storage failure never rejects: the cache is an optimisation', async () => {
  const boom = () => Promise.reject(new Error('disk full'));
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(boom);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(boom);
  await expect(readCache('user-a', 'me')).resolves.toBeUndefined();
  await expect(writeCache('user-a', 'me', 1)).resolves.toBeUndefined();
  jest.restoreAllMocks();
});
