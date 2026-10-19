/* eslint-env jest */
// Test kit for the inbox (used by *.test.tsx files; never imported by app code): the guild kit's stand-in server and
// helpers, and the way in that people use, the bell of the home tab.
import { fireEvent, screen } from '@testing-library/react-native';
import { inbox as bell } from '../../shared/i18n/vi/today';
import * as vi from '../../shared/i18n/vi/inbox';
import { landed, openToday } from '../guild/guildTestKit';

export * from '../guild/guildTestKit';

/** The home tab, then its bell: S30 (S75 when the inbox is empty), with the first page read. */
export async function openInbox(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${bell}`) }));
  await screen.findByRole('header', { name: vi.title });
  await landed();
  return view;
}
