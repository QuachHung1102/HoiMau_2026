import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { Me } from '../../domain/contract/core.ts';
import { SessionProvider } from '../shared/api/session';
import { MotionPreferenceProvider } from '../shared/motion/useReducedMotion';
import { AppNavigation, stateForRoute } from './navigation';
import { TAB_BAR_HEIGHT } from './TabBar';

// A stand-in registry with every group filled, so the real navigators are exercised before the features land.
// Each stub shows its name and params and has links: "go <Route>", "back" and "snack" (shows a snackbar).
jest.mock('./screens', () => {
  const { createElement } = require('react');
  const { Text, View } = require('react-native');
  const { useSnackbar } = require('../shared/ui/Snackbar');
  const links: [string, object?][] = [
    ['SignIn'],
    ['SignUp'],
    ['QuestBoard'],
    ['MealDetail', { mealSlot: 'LUNCH' }],
    ['FocusSession', { id: 'w1' }],
  ];
  const stub = (name: string) =>
    function StubScreen({ navigation, route }: { navigation: { navigate(to: string, params?: object): void; goBack(): void }; route: { params?: object } }) {
      const snackbar = useSnackbar();
      return createElement(
        View,
        null,
        createElement(Text, null, `screen ${name} ${JSON.stringify(route.params ?? {})}`),
        ...links.map(([to, params]) => createElement(Text, { key: to, onPress: () => navigation.navigate(to, params) }, `go ${to}`)),
        createElement(Text, { onPress: () => navigation.goBack() }, 'back'),
        createElement(Text, { onPress: () => snackbar.show({ message: `snack on ${name}` }) }, 'snack'),
      );
    };
  const entry = (name: string) => ({ name, component: stub(name) });
  return {
    authScreens: [entry('Welcome'), entry('SignIn')],
    onboardingScreens: [entry('OnbProfile')],
    // registered out of order on purpose: the bar order is fixed by the shell
    tabRoots: [
      { ...entry('Profile'), label: 'Cá nhân', icon: 'User' },
      { ...entry('Today'), label: 'Hôm nay', icon: 'Sun' },
      { ...entry('Guild'), label: 'Tổ đội', icon: 'Users' },
      { ...entry('Plan'), label: 'Lộ trình', icon: 'Route' },
    ],
    detailScreens: [entry('QuestBoard'), entry('MealDetail')],
    focusScreens: [entry('FocusSession')],
  };
});

const USER = 'user-1';
const meOf = (onboarded: boolean): Me => ({
  user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: null, archetypeChangeAvailableAt: null, onboarded },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
});
const respond = (status: number, body?: unknown) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

const fetchMock = jest.fn<Promise<unknown>, [string, unknown]>();
const realFetch = globalThis.fetch;
let client: QueryClient;
let errors: jest.SpyInstance;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  errors = jest.spyOn(console, 'error');
});
afterEach(async () => {
  const complaints = errors.mock.calls.map(call => String(call[0]));
  jest.restoreAllMocks();
  client.clear();
  await Keychain.resetGenericPassword();
  globalThis.fetch = realFetch;
  // no React, navigation or act() complaint in any of these flows
  expect(complaints).toEqual([]);
});

// Reduced motion keeps the OS setting (an async read) out of these tests.
const app = (initialState?: ReturnType<typeof stateForRoute>) => (
  <MotionPreferenceProvider value="REDUCED">
    <QueryClientProvider client={client}>
      <SessionProvider>
        <AppNavigation initialState={initialState} />
      </SessionProvider>
    </QueryClientProvider>
  </MotionPreferenceProvider>
);

type Options = { signedIn?: boolean; onboarded?: boolean; initialState?: ReturnType<typeof stateForRoute> };
async function open({ signedIn = true, onboarded = true, initialState }: Options = {}) {
  if (signedIn) await Keychain.setGenericPassword(USER, 'tok-1');
  fetchMock.mockResolvedValue(respond(200, meOf(onboarded)));
  render(app(initialState));
}
const press = (text: string) => fireEvent.press(screen.getByText(text));
const tabNames = () => screen.queryAllByRole('tab').map(tab => tab.props.accessibilityLabel);
/** Bottom padding of the snackbar host: 16 above the safe area, plus the tab bar when one is showing. */
const snackbarLift = (message: string) => {
  for (let node = screen.getByText(message).parent; node; node = node.parent) {
    const style = StyleSheet.flatten(node.props.style);
    if (style?.position === 'absolute' && typeof style.paddingBottom === 'number') return style.paddingBottom;
  }
  throw new Error('snackbar host not found');
};

test('signed out: the auth screens, starting on Welcome, and no request', async () => {
  await open({ signedIn: false });
  expect(await screen.findByText('screen Welcome {}')).toBeTruthy();
  expect(tabNames()).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a link to a route that is not registered is inert and silent (AR-25)', async () => {
  await open({ signedIn: false });
  await screen.findByText('screen Welcome {}');
  press('go SignUp');
  expect(screen.getByText('screen Welcome {}')).toBeTruthy();
});

test('signed in, not onboarded: the onboarding screens without a tab bar', async () => {
  await open({ onboarded: false });
  expect(await screen.findByText('screen OnbProfile {}')).toBeTruthy();
  expect(tabNames()).toEqual([]);
});

test('signed in and onboarded: four tabs in the fixed order, Today first and selected', async () => {
  await open();
  expect(await screen.findByText('screen Today {}')).toBeTruthy();
  expect(tabNames()).toEqual(['Hôm nay', 'Lộ trình', 'Tổ đội', 'Cá nhân']);
  expect(screen.getByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
  expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
});

test('choosing a tab shows its root; the tab left behind keeps its place', async () => {
  await open();
  await screen.findByText('screen Today {}');
  press('go QuestBoard');
  expect(await screen.findByText('screen QuestBoard {}')).toBeTruthy();
  // a detail screen has no tab bar; Back returns to the root it was opened from
  expect(tabNames()).toEqual([]);
  press('back');
  expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();

  fireEvent.press(screen.getByRole('tab', { name: 'Lộ trình' }));
  expect(await screen.findByText('screen Plan {}')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Lộ trình', selected: true })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Hôm nay', selected: false })).toBeTruthy();
});

test('a detail opens with its params inside the stack of the tab it was opened from', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(screen.getByRole('tab', { name: 'Cá nhân' }));
  const profile = await screen.findByText('screen Profile {}');
  fireEvent.press(within(profile.parent!.parent!).getByText('go MealDetail'));
  expect(await screen.findByText('screen MealDetail {"mealSlot":"LUNCH"}')).toBeTruthy();
  const detail = screen.getByText('screen MealDetail {"mealSlot":"LUNCH"}');
  fireEvent.press(within(detail.parent!.parent!).getByText('back'));
  // back on the Profile root, not on Today
  expect(await screen.findByRole('tab', { name: 'Cá nhân', selected: true })).toBeTruthy();
});

test('the focus flow is a full-screen modal above the tabs with the back gesture off', async () => {
  await open();
  await screen.findByText('screen Today {}');
  press('go FocusSession');
  const focus = await screen.findByText('screen FocusSession {"id":"w1"}');
  // what native-stack hands to react-native-screens for this screen
  let item = focus.parent;
  while (item && !('gestureEnabled' in item.props && 'stackPresentation' in item.props)) item = item.parent;
  expect(item?.props).toMatchObject({ stackPresentation: 'fullScreenModal', gestureEnabled: false });
  expect(tabNames()).toEqual([]);
});

test('the snackbar floats above the tab bar on a tab root only', async () => {
  await open();
  const today = await screen.findByText('screen Today {}');
  const onToday = within(today.parent!.parent!);
  fireEvent.press(onToday.getByText('snack'));
  expect(snackbarLift('snack on Today')).toBe(16 + TAB_BAR_HEIGHT);

  fireEvent.press(onToday.getByText('go QuestBoard'));
  const board = await screen.findByText('screen QuestBoard {}');
  fireEvent.press(within(board.parent!.parent!).getByText('snack'));
  expect(snackbarLift('snack on QuestBoard')).toBe(16);
  fireEvent.press(within(board.parent!.parent!).getByText('back'));
  await screen.findByRole('tab', { name: 'Hôm nay', selected: true });

  fireEvent.press(onToday.getByText('go FocusSession'));
  const focus = await screen.findByText('screen FocusSession {"id":"w1"}');
  fireEvent.press(within(focus.parent!.parent!).getByText('snack'));
  expect(snackbarLift('snack on FocusSession')).toBe(16);
  await act(async () => undefined);
});

test('a session the server ended lands on SignIn with Welcome underneath', async () => {
  await Keychain.setGenericPassword(USER, 'tok-1');
  fetchMock.mockResolvedValue(respond(401, { error: { code: 'SESSION_INVALID', message: 'session is not valid' } }));
  render(app());
  const signIn = await screen.findByText('screen SignIn {}');
  expect(await Keychain.getGenericPassword()).toBe(false);
  fireEvent.press(within(signIn.parent!.parent!).getByText('back'));
  expect(await screen.findByText('screen Welcome {}')).toBeTruthy();
});

test.each([
  ['a tab root', 'Guild', undefined, 'screen Guild {}', 'Tổ đội'],
  ['a detail (in the first tab, above its root)', 'MealDetail', { mealSlot: 'DINNER' }, 'screen MealDetail {"mealSlot":"DINNER"}', null],
  ['a focus screen', 'FocusSession', { id: 'w9' }, 'screen FocusSession {"id":"w9"}', null],
] as const)('stateForRoute opens the app on %s', async (_name, route, params, text, selectedTab) => {
  await open({ initialState: stateForRoute(route, params) });
  const shown = await screen.findByText(text);
  if (selectedTab) expect(screen.getByRole('tab', { name: selectedTab, selected: true })).toBeTruthy();
  else {
    fireEvent.press(within(shown.parent!.parent!).getByText('back'));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
  }
});

test('stateForRoute opens an auth or onboarding route directly in the root stack', async () => {
  expect(stateForRoute('SignIn')).toEqual({ routes: [{ name: 'SignIn', params: undefined }] });
  await open({ signedIn: false, initialState: stateForRoute('SignIn') });
  expect(await screen.findByText('screen SignIn {}')).toBeTruthy();
});
