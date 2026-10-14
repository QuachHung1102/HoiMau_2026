import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import { SessionProvider } from '../shared/api/session';
import { MotionPreferenceProvider } from '../shared/motion/useReducedMotion';
import { AppNavigation } from './navigation';

// A registry of its own: one tab root registered, three not. Which tabs the real app has by now does not matter here.
jest.mock('./screens', () => {
  const { createElement } = require('react');
  const { Text, View } = require('react-native');
  function Today({ navigation }: { navigation: { navigate(to: string): void } }) {
    return createElement(View, null, createElement(Text, null, 'screen Today'), createElement(Text, { onPress: () => navigation.navigate('Plan') }, 'go Plan'));
  }
  const Welcome = () => createElement(Text, null, 'screen Welcome');
  return {
    authScreens: [{ name: 'Welcome', component: Welcome }],
    onboardingScreens: [],
    tabRoots: [{ name: 'Today', component: Today, label: 'Hôm nay', icon: 'Sun' }],
    detailScreens: [],
    focusScreens: [],
  };
});

const USER = 'user-1';
const me = {
  user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: 'TANKER', archetypeChangeAvailableAt: null, onboarded: true },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
};
const respond = (status: number, body?: unknown) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const NOTICE = 'Phần này đang được hoàn thiện';

const realFetch = globalThis.fetch;
let client: QueryClient;
let errors: jest.SpyInstance;
beforeEach(async () => {
  // The stand-up reminder (StandUpHost) reads the day in every onboarded shell; this stand-in has none to give.
  globalThis.fetch = jest.fn(async (url: string) => (url.endsWith('/auth/logout') ? respond(204) : url.endsWith('/day') ? respond(404) : respond(200, me))) as unknown as typeof fetch;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await Keychain.setGenericPassword(USER, 'tok-1');
});
afterEach(async () => {
  const complaints = errors.mock.calls
    // bottom-tabs clears its previous screen on a 32 ms timer of its own (see navigation.test.tsx)
    .filter(call => !(String(call[0]).includes('not wrapped in act') && call[1] === 'BottomTabView'))
    .map(call => call.map(String).join(' | '));
  jest.restoreAllMocks();
  client.clear();
  await Keychain.resetGenericPassword();
  globalThis.fetch = realFetch;
  expect(complaints).toEqual([]);
});

const open = () =>
  render(
    <MotionPreferenceProvider value="REDUCED">
      <QueryClientProvider client={client}>
        <SessionProvider>
          <AppNavigation />
        </SessionProvider>
      </QueryClientProvider>
    </MotionPreferenceProvider>,
  );
const tabNames = () => screen.getAllByRole('tab').map(tab => tab.props.accessibilityLabel);

test('the bar has its four tabs whatever is registered; the registered one opens first', async () => {
  open();
  expect(await screen.findByText('screen Today')).toBeTruthy();
  expect(tabNames()).toEqual(['Hôm nay', 'Lộ trình', 'Tổ đội', 'Cá nhân']);
  expect(screen.getByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
  expect(screen.queryByText(NOTICE)).toBeNull();
});

test.each(['Lộ trình', 'Tổ đội', 'Cá nhân'])('the tab "%s" has no screen yet: it says so and offers "Đăng xuất", which signs out', async label => {
  open();
  await screen.findByText('screen Today');
  fireEvent.press(screen.getByRole('tab', { name: label }));
  expect(await screen.findByText(NOTICE)).toBeTruthy();
  expect(screen.getByRole('tab', { name: label, selected: true })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
  expect(await screen.findByText('screen Welcome')).toBeTruthy();
  expect(await Keychain.getGenericPassword()).toBe(false);
});

test('a link by name to a tab without a screen opens its notice (and not an error)', async () => {
  open();
  await screen.findByText('screen Today');
  fireEvent.press(screen.getByText('go Plan'));
  expect(await screen.findByText(NOTICE)).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Lộ trình', selected: true })).toBeTruthy();
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
  });
});
