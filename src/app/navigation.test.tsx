import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { Me } from '../../domain/contract/core.ts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SessionProvider } from '../shared/api/session';
import { enqueueAction, resetPendingForTests } from '../shared/storage/pendingActions';
import { MotionPreferenceProvider } from '../shared/motion/useReducedMotion';
import { AppNavigation, stateForRoute } from './navigation';
import { TAB_BAR_HEIGHT } from './TabBar';

// A stand-in registry with every group filled, so the real navigators are exercised before the features land.
// Each stub shows its name and params and has links: "go <Route>", "back" and "snack" (shows a snackbar).
// `SignUp` is declared but not registered here; `Nowhere` is not a route at all.
jest.mock('./screens', () => {
  const { createElement } = require('react');
  const { Text, View } = require('react-native');
  const { useSnackbar } = require('../shared/ui/Snackbar');
  const links: [string, object?][] = [
    ['SignIn'],
    ['SignUp'],
    ['Nowhere'],
    ['Today'],
    ['Plan'],
    ['Profile'],
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
  // silenced, then checked in afterEach: any complaint fails the test that caused it
  errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  const complaints = errors.mock.calls
    // bottom-tabs clears its previous screen on a 32 ms timer of its own; when that fires between the end of a
    // test and its cleanup, React reports it as an update outside act(). It is the library's timer, not a flow.
    .filter(call => !(String(call[0]).includes('not wrapped in act') && call[1] === 'BottomTabView'))
    .map(call => call.map(String).join(' | '));
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

test('a link to a declared route that is not registered yet is inert and silent (AR-25)', async () => {
  await open({ signedIn: false });
  await screen.findByText('screen Welcome {}');
  press('go SignUp');
  expect(screen.getByText('screen Welcome {}')).toBeTruthy();
  expect(errors).not.toHaveBeenCalled();
});

test('a registered route of the current group navigates', async () => {
  await open({ signedIn: false });
  await screen.findByText('screen Welcome {}');
  press('go SignIn');
  expect(await screen.findByText('screen SignIn {}')).toBeTruthy();
  expect(errors).not.toHaveBeenCalled();
});

test.each([
  ['an undeclared name', 'go Nowhere', 'Navigation: NAVIGATE "Nowhere" was not handled by any navigator.'],
  ['a route of a group that is not on screen', 'go QuestBoard', 'Navigation: NAVIGATE "QuestBoard" was not handled by any navigator.'],
  ['a tab root while the tabs are not on screen', 'go Today', 'Navigation: NAVIGATE "Today" was not handled by any navigator.'],
])('%s is reported in development and changes nothing', async (_name, link, message) => {
  errors.mockImplementation(() => undefined);
  await open({ signedIn: false });
  await screen.findByText('screen Welcome {}');
  press(link);
  expect(errors.mock.calls).toEqual([[message]]);
  expect(screen.getByText('screen Welcome {}')).toBeTruthy();
  errors.mockClear();
});

test('a back with nowhere to go is reported too, by its action type', async () => {
  errors.mockImplementation(() => undefined);
  await open({ signedIn: false });
  await screen.findByText('screen Welcome {}');
  press('back');
  expect(errors.mock.calls).toEqual([['Navigation: GO_BACK was not handled by any navigator.']]);
  errors.mockClear();
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

// navigate('<tab root>') by name, from wherever a signed-in, onboarded user can be
const on = (text: string) => within(screen.getByText(text).parent!.parent!);
const selectedTab = () => screen.queryAllByRole('tab', { selected: true }).map(tab => tab.props.accessibilityLabel);

test('tab root to tab root by name, also to a tab that was never opened, and back again', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(on('screen Today {}').getByText('go Plan'));
  expect(await screen.findByText('screen Plan {}')).toBeTruthy();
  await waitFor(() => expect(selectedTab()).toEqual(['Lộ trình']));

  fireEvent.press(on('screen Plan {}').getByText('go Today'));
  await waitFor(() => expect(selectedTab()).toEqual(['Hôm nay']));
  // second visit to a tab that is already mounted
  fireEvent.press(on('screen Today {}').getByText('go Plan'));
  await waitFor(() => expect(selectedTab()).toEqual(['Lộ trình']));
  fireEvent.press(on('screen Plan {}').getByText('go Profile'));
  expect(await screen.findByText('screen Profile {}')).toBeTruthy();
  await waitFor(() => expect(selectedTab()).toEqual(['Cá nhân']));
});

test('from a detail to another tab root by name', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(on('screen Today {}').getByText('go QuestBoard'));
  await screen.findByText('screen QuestBoard {}');
  fireEvent.press(on('screen QuestBoard {}').getByText('go Plan'));
  expect(await screen.findByText('screen Plan {}')).toBeTruthy();
  await waitFor(() => expect(selectedTab()).toEqual(['Lộ trình']));
});

test('from a detail to the root of its own tab by name: one root, not a second copy', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(on('screen Today {}').getByText('go QuestBoard'));
  await screen.findByText('screen QuestBoard {}');
  expect(selectedTab()).toEqual([]);
  fireEvent.press(on('screen QuestBoard {}').getByText('go Today'));
  await waitFor(() => expect(selectedTab()).toEqual(['Hôm nay']));
  expect(screen.queryByText('screen QuestBoard {}')).toBeNull();
  expect(screen.getAllByText('screen Today {}')).toHaveLength(1);
});

test('a tab root reached by name shows the root even when a detail was left open in that tab', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(on('screen Today {}').getByText('go QuestBoard'));
  await screen.findByText('screen QuestBoard {}');
  fireEvent.press(on('screen QuestBoard {}').getByText('go Plan'));
  await screen.findByText('screen Plan {}');
  fireEvent.press(on('screen Plan {}').getByText('go Today'));
  await waitFor(() => expect(selectedTab()).toEqual(['Hôm nay']));
  expect(screen.queryByText('screen QuestBoard {}')).toBeNull();
});

test('from the focus flow to a tab root by name: the modal closes and that tab is selected', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(on('screen Today {}').getByText('go FocusSession'));
  await screen.findByText('screen FocusSession {"id":"w1"}');
  fireEvent.press(on('screen FocusSession {"id":"w1"}').getByText('go Profile'));
  expect(await screen.findByText('screen Profile {}')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('screen FocusSession {"id":"w1"}')).toBeNull());
  expect(selectedTab()).toEqual(['Cá nhân']);
});

test('from the focus flow, opened from a detail, back to the root of the tab it started in', async () => {
  await open();
  await screen.findByText('screen Today {}');
  fireEvent.press(on('screen Today {}').getByText('go QuestBoard'));
  await screen.findByText('screen QuestBoard {}');
  fireEvent.press(on('screen QuestBoard {}').getByText('go FocusSession'));
  await screen.findByText('screen FocusSession {"id":"w1"}');
  fireEvent.press(on('screen FocusSession {"id":"w1"}').getByText('go Today'));
  await waitFor(() => expect(screen.queryByText('screen FocusSession {"id":"w1"}')).toBeNull());
  await waitFor(() => expect(selectedTab()).toEqual(['Hôm nay']));
  expect(screen.queryByText('screen QuestBoard {}')).toBeNull();
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
] as const)('stateForRoute opens the app on %s', async (_name, route, params, text, tabLabel) => {
  await open({ initialState: stateForRoute(route, params) });
  const shown = await screen.findByText(text);
  if (tabLabel) expect(screen.getByRole('tab', { name: tabLabel, selected: true })).toBeTruthy();
  else {
    // opened directly on a detail or a focus screen: no tab bar there either
    expect(tabNames()).toEqual([]);
    fireEvent.press(within(shown.parent!.parent!).getByText('back'));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
  }
});

test('stateForRoute opens an auth or onboarding route directly in the root stack', async () => {
  expect(stateForRoute('SignIn')).toEqual({ routes: [{ name: 'SignIn', params: undefined }] });
  await open({ signedIn: false, initialState: stateForRoute('SignIn') });
  expect(await screen.findByText('screen SignIn {}')).toBeTruthy();
});

test('"Đăng xuất" on the start-up error works again after "Ở lại": the button does not stay busy', async () => {
  const busy = () => screen.getByRole('button', { name: 'Đăng xuất' }).props.accessibilityState.busy;
  try {
    await Keychain.setGenericPassword(USER, 'tok-1');
    await enqueueAction({ id: 'a1', userId: USER, method: 'POST', path: '/day/bedtime', body: {}, createdAt: new Date().toISOString() });
    // GET /me fails (the S39 error with its sign-out button) and the record cannot leave either
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/auth/logout') ? respond(204) : respond(500, { error: { code: 'INTERNAL', message: 'x' } })));
    render(app());
    fireEvent.press(await screen.findByRole('button', { name: 'Đăng xuất' }));
    expect(busy()).toBe(true);
    fireEvent.press(await screen.findByRole('button', { name: 'Ở lại' }));
    await waitFor(() => expect(busy()).toBe(false));

    // pressed again: the question is asked again, and this time the user leaves
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Đăng xuất và bỏ các ghi nhận này' }));
    expect(await screen.findByText('screen Welcome {}')).toBeTruthy();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  } finally {
    screen.unmount();
    resetPendingForTests();
    await AsyncStorage.clear();
  }
});
