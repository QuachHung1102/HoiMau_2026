import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import type { DayState } from '../../../domain/contract/core.ts';
import { readCache } from '../../shared/storage/cache';
import { dayOf } from '../dashboard/todayTestKit';
import { acceptDay, dayKey } from './api';

// A replayed answer is the stored answer of the first execution: its day can be older than the one already held.
const USER = 'user-a';
const at = (iso: string, more: Partial<DayState> = {}) => dayOf({ serverTime: iso, ...more });
const NOON = '2026-10-14T05:00:00.000Z';
const LATER = '2026-10-14T05:00:09.000Z';

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
});
afterEach(async () => {
  client.clear(); // its garbage-collection timers would keep Jest alive
  await AsyncStorage.clear();
});

const held = () => client.getQueryData<DayState>(dayKey);
/** What `writeCache` left on disk, once its write has landed. */
const onDisk = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  return readCache<DayState>(USER, 'day');
};

test('nothing held yet: the answer\'s day is taken, in the cache and on disk', async () => {
  const day = at(NOON);
  acceptDay(client, USER, day);
  expect(held()).toEqual(day);
  expect(await onDisk()).toEqual(day);
});

test('a day with an earlier logical date never replaces the held one (the 03:00 rollover): not in the cache, not on disk', async () => {
  const today = at(NOON, { logicalDate: '2026-10-15' });
  acceptDay(client, USER, today);
  acceptDay(client, USER, at(LATER, { logicalDate: '2026-10-14' })); // yesterday's, with a later serverTime still
  expect(held()).toEqual(today);
  expect(await onDisk()).toEqual(today);
});

test('the same date with an earlier serverTime never replaces the held one', async () => {
  const newer = at(LATER);
  acceptDay(client, USER, newer);
  acceptDay(client, USER, at(NOON, { caloriesIn: 1 }));
  expect(held()).toEqual(newer);
  expect(await onDisk()).toEqual(newer);
});

test('a later date, a later serverTime and the very same serverTime are taken', async () => {
  acceptDay(client, USER, at(NOON));
  const same = at(NOON, { caloriesIn: 1700 });
  acceptDay(client, USER, same);
  expect(held()).toEqual(same);
  const later = at(LATER);
  acceptDay(client, USER, later);
  expect(held()).toEqual(later);
  const tomorrow = at(NOON, { logicalDate: '2026-10-15' });
  acceptDay(client, USER, tomorrow);
  expect(held()).toEqual(tomorrow);
  expect(await onDisk()).toEqual(tomorrow);
});
