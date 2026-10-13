import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { failureText, recordLabel, rejectionText } from '../../shared/i18n/vi/sync';
import { app, idsOnDisk, installSyncTestEnv, mountApp, pendingKey, refuse, rejectedKey, seedQueue, server, settle, stored, writes } from './syncTestKit';

installSyncTestEnv();

const DAY_CLOSED = 'Ngày đó đã khép lại nên ghi nhận này không được tính. Bạn không làm gì sai cả.';
const TITLE = 'Ghi nhận không được tính';
const GENERIC = 'Hệ thống không nhận ghi nhận này nên nó không được tính.';
const rejectedOnDisk = async () => JSON.parse((await AsyncStorage.getItem(rejectedKey())) ?? 'null') as { id: string; code: string }[] | null;
const understood = () => fireEvent.press(screen.getByRole('button', { name: 'Đã hiểu' }));

test('a record sent later and refused with DAY_CLOSED: the explanation, which record it was, and dismissing forgets it', async () => {
  await seedQueue([stored('a1', { path: '/nutrition/log', body: { kcal: 300 } })]);
  server.write = () => refuse(409, 'DAY_CLOSED');
  const view = await mountApp();
  expect(screen.getByRole('header', { name: TITLE })).toBeTruthy();
  expect(screen.getByText(DAY_CLOSED)).toBeTruthy();
  expect(screen.getByText('Ghi nhận: bữa ăn')).toBeTruthy();
  expect(await idsOnDisk()).toEqual([]);
  expect(await rejectedOnDisk()).toMatchObject([{ id: 'a1', code: 'DAY_CLOSED' }]);

  understood();
  await settle();
  expect(screen.queryByText(DAY_CLOSED)).toBeNull();
  expect(await rejectedOnDisk()).toEqual([]);
  expect(writes()).toHaveLength(1);
  view.unmount();
});

test('other refusals: the generic line with the copy of the code, one notice at a time, oldest first', async () => {
  await seedQueue([stored('a1', { path: '/nutrition/log', body: { mealSlot: 'LUNCH' } }), stored('a2'), stored('a3', { path: '/day/bedtime', body: {} })]);
  const answers = [() => refuse(409, 'MEAL_ALREADY_LOGGED'), () => refuse(422, 'VALIDATION_FAILED'), () => refuse(409, 'DAY_CLOSED')];
  let n = 0;
  server.write = () => answers[n++]();
  const view = await mountApp();

  expect(screen.getByText(`${GENERIC} Bữa này đã được ghi từ trước.`)).toBeTruthy();
  expect(screen.getByText('Ghi nhận: bữa ăn')).toBeTruthy();
  understood();
  await settle();

  // no copy of its own: the generic line alone
  expect(screen.getByText(GENERIC)).toBeTruthy();
  expect(screen.getByText('Ghi nhận: nhiệm vụ trong ngày')).toBeTruthy();
  understood();
  await settle();

  expect(screen.getByText(DAY_CLOSED)).toBeTruthy();
  expect(screen.getByText('Ghi nhận: giờ đi ngủ')).toBeTruthy();
  understood();
  await settle();
  expect(screen.queryByRole('button', { name: 'Đã hiểu' })).toBeNull();
  expect(await rejectedOnDisk()).toEqual([]);
  view.unmount();
});

test('a refusal waits for its user: shown again after a restart, not shown to nobody', async () => {
  await AsyncStorage.setItem(rejectedKey(), JSON.stringify([{ id: 'a1', path: '/workout/complete', code: 'DAY_CLOSED', at: '2026-10-14T01:00:00.000Z' }]));
  const signedOut = await mountApp({ signedIn: false });
  expect(screen.queryByText(DAY_CLOSED)).toBeNull();
  signedOut.unmount();

  const view = await mountApp();
  expect(screen.getByText(DAY_CLOSED)).toBeTruthy();
  expect(screen.getByText('Ghi nhận: buổi tập')).toBeTruthy();
  view.unmount();
});

test('a stored queue that cannot be read: told once, the text kept, the app goes on', async () => {
  await AsyncStorage.setItem(pendingKey(), '[{"id":"a1","pa');
  const view = await mountApp();
  expect(screen.getByRole('header', { name: 'Có ghi nhận chờ gửi bị lỗi' })).toBeTruthy();
  expect(await AsyncStorage.getItem(`${pendingKey()}:corrupt`)).toBe('[{"id":"a1","pa');
  expect(writes()).toEqual([]);

  understood();
  await settle();
  expect(screen.queryByRole('header', { name: 'Có ghi nhận chờ gửi bị lỗi' })).toBeNull();
  expect(await AsyncStorage.getItem(`${pendingKey()}:corrupt`)).toBe('[{"id":"a1","pa');

  // recording works again
  let result: { state: string } | undefined;
  await act(async () => {
    result = await app.send({ path: '/day/bedtime', body: {} });
  });
  expect(result?.state).toBe('confirmed');
  view.unmount();
});

test('the copy per code', () => {
  expect(rejectionText('DAY_CLOSED')).toBe(DAY_CLOSED);
  expect(rejectionText('SOMETHING_NEW')).toBe(GENERIC);
  expect(rejectionText('RATE_LIMITED')).toBe(`${GENERIC} Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.`);
  expect(failureText('DAY_CLOSED')).toBe(DAY_CLOSED);
  expect(failureText('STORAGE_FAILED')).toBe('Máy chưa giữ được ghi nhận này. Bạn thử lại nhé.');
  expect(failureText('SOMETHING_NEW')).toBe('Có lỗi xảy ra. Bạn thử lại nhé.');
  expect(recordLabel('/day/quests/WATER/progress')).toBe('Ghi nhận: nhiệm vụ trong ngày');
  expect(recordLabel('/somewhere/else')).toBeUndefined();
});
