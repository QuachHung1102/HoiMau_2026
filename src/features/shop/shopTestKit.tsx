/* eslint-env jest */
// Test kit for Mầm, the shop, the inventory and the perk sheet (used by *.test.tsx files; never imported by app code).
// It builds on the home-tab kit: the same whole app against the same stand-in server, which also holds what the shop knows
// of the person (`world.shop`) and answers the shop, the inventory, the perks and the pet as the routes of server Task 37 do.
import { fireEvent, screen } from '@testing-library/react-native';
import type { Progression } from '../../../domain/contract/core.ts';
import { Text } from 'react-native';
import * as pet from '../../shared/i18n/vi/pet';
import { profileRows } from '../../shared/i18n/vi/progression';
import * as vi from '../../shared/i18n/vi/shop';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { openToday, settle, world, writes } from '../dashboard/todayTestKit';

export { act, fireEvent, screen } from '@testing-library/react-native';
export { fetchMock, hold, installTodayTestEnv, queryClient, refuse, requested, respond, serverAnswer, settle, world, writes } from '../dashboard/todayTestKit';
export { openLevels, setLevel } from '../progression/progressionTestKit';

export const FOREST = 'THEME_FOREST';
export const FOX = 'SKIN_FOX';

/** What a screen has just asked for (the profile, the shop, the pet) has landed inside act(). */
export const landed = async () => {
  await settle();
  await settle();
  await settle();
};
const header = (name: string) => screen.findByRole('header', { name });

/** The coins and the perk points of the profile (the server's sums). */
export function setWallet(coin: number, perkPointsAvailable = 0) {
  world.me = { ...world.me, progression: { ...(world.me.progression as Progression), coin, perkPointsAvailable } };
}
/** Mầm as the server has it. */
export function setPet(more: Partial<NonNullable<typeof world.me.pet>>) {
  world.me = { ...world.me, pet: { ...(world.me.pet as NonNullable<typeof world.me.pet>), ...more } };
}

/** The writes of one route, in order. */
export const writesOf = (path: string) => writes().filter(request => request.path === path);

/** Renders the palette the app is drawn with, so that a test can read it through `useTheme`. */
export function ThemeProbe() {
  const palette = useTheme();
  return <Text testID="theme-primary">{palette.primary}</Text>;
}
export const primary = () => screen.getByTestId('theme-primary').props.children as string;
const withProbe = (options: Parameters<typeof openToday>[0] = {}) => ({ ...options, inside: <ThemeProbe /> });

/** The fourth tab, then "Mầm của bạn": S22 (S70 when Mầm is tired). */
export async function openPet(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(withProbe(options));
  fireEvent.press(screen.getByRole('tab', { name: tabLabel.Profile }));
  await header(tabLabel.Profile);
  await landed();
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${profileRows.pet.title}`) }));
  await header(pet.petTitle);
  await landed();
  return view;
}
/** Mầm, then "Hành trình lớn lên": S68. */
export async function openStages(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openPet(options);
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${pet.growthRow.title}`) }));
  await header(pet.stagesTitle);
  await landed();
  return view;
}
/** Mầm, then "Ghé cửa hàng": S23. */
export async function openShop(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openPet(options);
  fireEvent.press(screen.getByRole('button', { name: pet.visitShop }));
  await header(vi.shopTitle);
  await landed();
  return view;
}
/** The shop, a kind, then "Xem" on one card: S40 (or S71). */
export async function openItem(name: string, kind: vi.Kind = 'THEME', options: Parameters<typeof openToday>[0] = {}) {
  const view = await openShop(options);
  fireEvent.press(screen.getByRole('radio', { name: vi.groupName[kind] }));
  fireEvent.press(screen.getByRole('button', { name: `${vi.view} ${name}` }));
  await header(vi.itemTitle(kind, name));
  await landed();
  return view;
}
/** Mầm, then "Đổi diện mạo": S24. */
export async function openInventory(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openPet(options);
  fireEvent.press(screen.getByRole('button', { name: pet.changeLook }));
  await header(vi.inventoryTitle);
  await landed();
  return view;
}
