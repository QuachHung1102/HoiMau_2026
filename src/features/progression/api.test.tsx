import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { bindApiSession } from '../../shared/api/client';
import { dayOf, USER } from '../dashboard/todayTestKit';
import { dayKey } from '../quests/api';
import { markInboxRead } from './api';
import { milestoneItem } from './progressionTestKit';

// `markInboxRead` writes the day on screen and its copy on disk only for the user it was sent for.
const ITEM = '9d1c2f3a-4b5e-4f60-8a71-b2c3d4e5f601';
const DISK = `cache:v1:${USER}:day`;
const realFetch = globalThis.fetch;
let client: QueryClient;
let release: () => void;
const answer = { ok: true, status: 200, text: async () => JSON.stringify({ unreadCount: 0 }) };

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient();
  client.setQueryData(dayKey, dayOf({ celebrations: [milestoneItem(ITEM)], unreadCount: 1 }), { updatedAt: 1234 });
  globalThis.fetch = jest.fn(() => new Promise(resolve => (release = () => resolve(answer)))) as unknown as typeof fetch;
  bindApiSession({ token: 't', userId: USER, onInvalid: () => undefined });
});
afterEach(() => {
  bindApiSession(null);
  client.clear();
  globalThis.fetch = realFetch;
});
const settleDisk = () => new Promise(resolve => setTimeout(resolve, 20));

test('for the bound user: the item leaves the day in the cache (same updatedAt) and on disk, and the unread count is the server\'s', async () => {
  const sent = markInboxRead(client, USER, [ITEM]);
  release();
  await sent;
  await settleDisk();
  const day = client.getQueryData<ReturnType<typeof dayOf>>(dayKey);
  expect(day?.celebrations).toEqual([]);
  expect(day?.unreadCount).toBe(0);
  expect(client.getQueryState(dayKey)?.dataUpdatedAt).toBe(1234);
  expect(JSON.parse((await AsyncStorage.getItem(DISK)) ?? 'null').celebrations).toEqual([]);
});

test('the answer arrives after the user has signed out: neither the cache nor the disk is written', async () => {
  const sent = markInboxRead(client, USER, [ITEM]);
  bindApiSession(null); // the sign-out
  release();
  await sent;
  await settleDisk();
  expect(client.getQueryData<ReturnType<typeof dayOf>>(dayKey)?.celebrations).toHaveLength(1);
  expect(client.getQueryData<ReturnType<typeof dayOf>>(dayKey)?.unreadCount).toBe(1);
  expect(await AsyncStorage.getItem(DISK)).toBeNull();
});

test('the answer arrives after another user has signed in: it is not written for them either', async () => {
  const sent = markInboxRead(client, USER, [ITEM]);
  bindApiSession({ token: 't2', userId: 'someone-else', onInvalid: () => undefined });
  release();
  await sent;
  await settleDisk();
  expect(client.getQueryData<ReturnType<typeof dayOf>>(dayKey)?.celebrations).toHaveLength(1);
  expect(await AsyncStorage.getItem(DISK)).toBeNull();
  expect(await AsyncStorage.getItem(`cache:v1:someone-else:day`)).toBeNull();
});
