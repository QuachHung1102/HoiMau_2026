/* eslint-env jest */
// Test kit for the journal and ticket screens (used by *.test.tsx files; never imported by app code). The whole app against the
// stand-in server of the home-tab kit, which holds the journal and the tickets (`world.journal`, `world.tickets`) and answers
// their routes as the server does.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import * as vi from '../../shared/i18n/vi/journal';
import { journeyRows, profileRows, seeTickets } from '../../shared/i18n/vi/progression';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { openToday, settle, writes } from '../dashboard/todayTestKit';
import { openJourney, openProfile } from '../progression/progressionTestKit';

export { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
export { breakStreak, fetchMock, giveTickets, hold, installTodayTestEnv, nearLevelUp, queryClient, refuse, requested, respond, seedJournal, serverAnswer, settle, USER, world, writes } from '../dashboard/todayTestKit';
export type { JournalRow } from '../dashboard/todayTestKit';
export { openJourney, openProfile, openToday };

/** The reads a screen has just asked for have landed inside act(). */
export const landed = async () => {
  await settle();
  await settle();
  await settle();
};
const header = (name: string) => screen.findByRole('header', { name });

/** The profile tab, then "Góc giải tỏa": S32. */
export async function openWrite(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openProfile(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${profileRows.journal.title}[.]`) }));
  await header(vi.writeTitle);
  await landed();
  return view;
}
/** S32, then "Những trang đã viết": S49. */
export async function openList(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openWrite(options);
  fireEvent.press(screen.getByRole('button', { name: vi.pastPages }));
  await header(vi.listTitle);
  await landed();
  return view;
}
/** The journey, then its "Vé giữ nhịp" row: S34. */
export async function openTickets(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openJourney(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^(${journeyRows.tickets.title}|${seeTickets})`) }));
  await header(vi.ticketsTitle);
  await landed();
  return view;
}

export const field = () => screen.getByLabelText(new RegExp(`^${vi.fieldLabel}`));
export const type = (text: string) => fireEvent.changeText(field(), text);
export const saveButton = () => screen.getByRole('button', { name: vi.save });
/** The POST /journal requests that reached the server, in order. */
export const saves = () => writes().filter(request => request.path === '/journal');
/** The POST /freeze-tickets/use requests that reached the server, in order. */
export const uses = () => writes().filter(request => request.path === '/freeze-tickets/use');
/** Writes the text and presses save; the feedback screen has come up. */
export async function saveText(text: string) {
  type(text);
  fireEvent.press(saveButton());
  await header(vi.feedbackTitle);
  await landed();
}
/** Whether this text is anywhere in what the screen has drawn. */
export const draws = (text: string) => JSON.stringify(screen.toJSON()).includes(text);
/** Everything the device keeps on disk, as one string. */
export async function everythingOnDisk() {
  const keys = await AsyncStorage.getAllKeys();
  return JSON.stringify(await AsyncStorage.getMany(keys));
}
export const profileTab = () => screen.getByRole('tab', { name: tabLabel.Profile });
