/* eslint-env jest */
// Test kit for the four auth screens (used by their *.test.tsx files; never imported by app code).
// The screens run inside the real providers and the real navigators against a stubbed `fetch`; the stub records
// every request so a test can read the path, headers and body that were actually sent.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigation, stateForRoute } from '../../app/navigation';
import type { RouteName } from '../../app/routes';
import { SessionProvider, wipeQueries } from '../../shared/api/session';
import { profileTitle } from '../../shared/i18n/vi/onboarding';
import { MotionPreferenceProvider, resetSystemMotionForTests } from '../../shared/motion/useReducedMotion';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { OnboardingProvider } from '../onboarding/OnboardingProvider';

export const USER = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';
export const TOKEN = 'tok-auth-test-secret';
const BASE = 'http://localhost:8787/api/v1';

type Init = { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
export const fetchMock = jest.fn<Promise<unknown>, [string, Init]>();
export const respond = (status: number, body?: unknown) => ({
  ok: status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
export const refuse = (status: number, code: string, details?: unknown) =>
  respond(status, { error: { code, message: 'diagnostic, never shown', details } });
export const session = { token: TOKEN, userId: USER, onboarded: false };
/** GET /me of the person who has just signed in: not onboarded yet, so the gate shows the onboarding group. */
export const me = {
  user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: null, archetypeChangeAvailableAt: null, onboarded: false },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
};
/** Answers `path` with `response`, GET /me with the new account, anything else with 404. */
export function answer(path: string, response: unknown) {
  fetchMock.mockImplementation(async url => (url.endsWith(path) ? response : url.endsWith('/me') ? respond(200, me) : respond(404)));
}

/** What was sent, in order: method, path (without the base URL), headers, parsed JSON body. */
export const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: init.method,
    path: url.replace(BASE, ''),
    headers: init.headers,
    body: init.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>),
  }));

/** The request to `path` stays open until `finish` is called (or its signal aborts, as a real fetch does). */
export function pendingRequest(path: string) {
  let finish!: (response: unknown) => void;
  fetchMock.mockImplementation(
    (url, init) =>
      url.endsWith(path)
        ? new Promise((resolve, reject) => {
            finish = resolve;
            init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
          })
        : Promise.resolve(respond(200, me)),
  );
  return { finish: (response: unknown) => finish(response) };
}

let client: QueryClient | undefined;
export const queryClient = () => client as QueryClient;

/** Renders the real navigators, signed out, opened on `name`. */
export function mount(name: RouteName, params?: object) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <MotionPreferenceProvider value="REDUCED">
          <QueryClientProvider client={client}>
            <SessionProvider>
              {/* as in App.tsx: after a sign-in the gate opens onboarding, whose screens need their provider */}
              <OnboardingProvider>
                <AppNavigation initialState={stateForRoute(name, params)} />
              </OnboardingProvider>
            </SessionProvider>
          </QueryClientProvider>
        </MotionPreferenceProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

/**
 * Lets a request that a screen has only just started (the stub answers at once) land inside act(), so that nothing
 * updates the tree between the end of a test and its cleanup. Real timers only.
 */
export const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });

/** The gate has moved on to onboarding: its first step (S05) is on screen and its zone-list request has settled. */
export async function onboardingOpened() {
  const header = await screen.findByRole('header', { name: profileTitle });
  await settle();
  return header;
}

/**
 * Counts the `focus()` calls the screen makes on the input with this label (read it before the screen changes the
 * label, e.g. by adding an error). Jest's TextInput mock shares one `focus` between all inputs, so each input gets its own.
 */
export function watchFocus(label: string): jest.Mock {
  let node: ReturnType<typeof screen.getByLabelText> | null = screen.getByLabelText(label);
  while (node && typeof (node.instance as { focus?: unknown } | null)?.focus !== 'function') node = node.parent;
  const watcher = jest.fn();
  (node?.instance as { focus: jest.Mock }).focus = watcher;
  return watcher;
}

const realFetch = globalThis.fetch;
let errors: jest.SpyInstance;

/** beforeEach / afterEach for a screen's test file; the console must stay silent. */
export function installAuthTestEnv() {
  beforeEach(() => {
    fetchMock.mockReset();
    jest.mocked(Keychain.setGenericPassword).mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // The OS "reduce motion" value stays unknown, so the screens render their static (reduced) state.
    const { AccessibilityInfo } = require('react-native');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
    errors = jest.spyOn(console, 'error');
  });
  afterEach(async () => {
    const complaints = errors.mock.calls.map(call => String(call[0]));
    // RNTL has already unmounted the tree: only now is it safe to drop the cache (never while screens are mounted).
    if (client) wipeQueries(client);
    client = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
    resetSystemMotionForTests();
    await Keychain.resetGenericPassword();
    await AsyncStorage.clear();
    globalThis.fetch = realFetch;
    expect(complaints).toEqual([]);
  });
}
