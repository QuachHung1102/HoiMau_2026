/* eslint-env jest */
// Test kit for the settings screens (used by *.test.tsx files; never imported by app code). The whole app against the stand-in
// server of the home-tab kit, which answers the settings and profile routes as server Task 14 does (`world.settings`, `world.me`,
// `world.profile`), opened on the Profile tab and from there on the screen under test.
import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { profileRows } from '../../shared/i18n/vi/progression';
import * as vi from '../../shared/i18n/vi/settings';
import { settle, fetchMock } from '../dashboard/todayTestKit';
import { openProfile } from '../progression/progressionTestKit';

export { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
export { app, fetchMock, hold, installTodayTestEnv, meOf, queryClient, refuse, requested, respond, seedQueue, settingsOf, settle, stored, USER, world } from '../dashboard/todayTestKit';
export { openProfile };

/** The reads a screen has just asked for have landed inside act(). */
export const landed = async () => {
  await settle();
  await settle();
  await settle();
};
const header = (name: string) => screen.findByRole('header', { name });
const press = (name: RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const row = (title: string) => new RegExp(`^${title}\\.`);

type Options = Parameters<typeof openProfile>[0];
/** The Profile tab, then "Cài đặt": S35. */
export async function openSettings(options: Options = {}) {
  const view = await openProfile(options);
  press(row(profileRows.settings.title));
  await header(vi.title);
  await landed();
  return view;
}
/** S35, then "Thông báo": S36. */
export async function openNotifications(options: Options = {}) {
  const view = await openSettings(options);
  press(new RegExp(`^${vi.rows.notifications.title}\\.`));
  await header(vi.notificationsTitle);
  await landed();
  return view;
}
/** S35, then "Hiển thị & chuyển động": S79. */
export async function openDisplay(options: Options = {}) {
  const view = await openSettings(options);
  press(new RegExp(`^${vi.rows.display.title}`));
  await header(vi.displayTitle);
  await landed();
  return view;
}
/** S35, then "Giới thiệu & trợ giúp": S53. */
export async function openHelp(options: Options = {}) {
  const view = await openSettings(options);
  press(new RegExp(`^${vi.rows.help.title}\\.`));
  await header(vi.helpTitle);
  await landed();
  return view;
}
/** S35, then "Quyền riêng tư": S44. */
export async function openPrivacy(options: Options = {}) {
  const view = await openSettings(options);
  press(new RegExp(`^${vi.rows.privacy.title}\\.`));
  await header(vi.privacyTitle);
  await landed();
  return view;
}
/** S44, then "Xem & xác nhận xóa": S52. */
export async function openDeleteAccount(options: Options = {}) {
  const view = await openPrivacy(options);
  press(new RegExp(`^${vi.deleteCard.action}`));
  await header(vi.deleteTitle);
  return view;
}
/** S35, then "Hồ sơ & mục tiêu": S37. */
export async function openEditProfile(options: Options = {}) {
  const view = await openSettings(options);
  press(new RegExp(`^${vi.rows.profile.title}\\.`));
  await header(vi.profileTitle);
  await landed();
  return view;
}

/** The writes of this method and path that reached the server, in order: the body and the Idempotency-Key of each. */
export const sent = (method: string, path: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => init.method === method && url.endsWith(`/api/v1${path}`))
    .map(([, init]) => ({ body: JSON.parse(init.body ?? 'null') as Record<string, unknown>, key: init.headers['Idempotency-Key'] as string }));
export const settingsPatches = () => sent('PATCH', '/settings');
/** How many times the server was asked for this path. */
export const reads = (path: string) => fetchMock.mock.calls.filter(([url, init]) => init.method === 'GET' && url.endsWith(`/api/v1${path}`)).length;
export const switchOf = (name: string) => screen.getByRole('switch', { name });

/** What `useReducedMotion()` says for a component inside the app: "reduced" or "full". Mount it with `extra` (the motion comes from the settings: `motion: 'settings'`). */
export function MotionProbe() {
  return <Text testID="motion-probe">{useReducedMotion() ? 'reduced' : 'full'}</Text>;
}
export const motionNow = () => screen.getByTestId('motion-probe').props.children as string;
