import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import { rejectionText } from '../../shared/i18n/vi/sync';
import { idsOnDisk, openToday, seedQueue, settle, stored, world, writes } from '../dashboard/todayTestKit';
import { detail, gym, installWorkoutTestEnv } from '../workout/workoutTestKit';
import { rejectedKey } from './syncTestKit';

// A meal or a session that waited in the queue meets the real answers of the server when it is sent: the day had
// closed (409 DAY_CLOSED), or the device clock was so far ahead that the instant it names does not exist yet
// (422 OCCURRED_AT_INVALID). Both go to the app-wide notice, with their reason; neither earns anything.
installWorkoutTestEnv();

const waiting = { createdAt: new Date(Date.now() - 90_000).toISOString() }; // late: the queue adds occurredAt
const records = {
  'a meal': stored('m1', { ...waiting, path: '/nutrition/log', body: { kcal: 600 } }),
  'a session': stored('w1', { ...waiting, path: '/workout/complete', body: { exerciseItemId: detail.id, elapsedSec: 600 } }),
};
const refusals = {
  DAY_CLOSED: () => (world.closedDate = world.day.logicalDate),
  OCCURRED_AT_INVALID: () => (world.skew = 5 * 60_000), // the device runs 5 minutes ahead of the server
};

describe.each(Object.entries(records))('%s sent later by the queue', (_name, record) => {
  test.each(Object.entries(refusals))('%s: the app-wide notice says why; nothing was earned, nothing stays queued', async (code, refuse) => {
    refuse();
    await seedQueue([record]);
    const view = await openToday();
    await settle();

    // it left with the moment it was made, and the server judged that moment
    expect(writes()).toEqual([{ path: record.path, id: record.id, body: { ...record.body, occurredAt: record.createdAt } }]);
    expect(screen.getByRole('header', { name: 'Ghi nhận không được tính' })).toBeTruthy();
    expect(screen.getByText(rejectionText(code))).toBeTruthy();
    expect(await idsOnDisk()).toEqual([]);
    expect(await AsyncStorage.getItem(rejectedKey())).toContain(record.id);
    // no reward: the server's day and profile are as they were
    expect(world.day.caloriesIn).toBe(1650);
    expect(world.day.story.done).toBe(0);
    expect(gym.given).toBe(0);
    expect(screen.getByLabelText('250 xu')).toBeTruthy();
    expect(screen.queryByText(/Đã ghi nhận/)).toBeNull();

    // reading it clears it
    fireEvent.press(screen.getByRole('button', { name: 'Đã hiểu' }));
    await settle();
    expect(screen.queryByRole('header', { name: 'Ghi nhận không được tính' })).toBeNull();
    view.unmount();
  });
});
