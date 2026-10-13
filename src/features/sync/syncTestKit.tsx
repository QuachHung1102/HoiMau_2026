/* eslint-env jest */
// Test kit for the sync feature (used by its *.test.tsx files; never imported by app code).
// The queue runs inside the same providers and navigators as the app, exactly as App.tsx mounts them, against a
// stubbed `fetch`. A test file of the sync feature mocks the screen registry with no tab roots
// (`jest.mock('../../app/screens', () => ({ ...jest.requireActual('../../app/screens'), tabRoots: [] }))`), so a
// signed-in, onboarded user lands on the notice of a tab without a screen, where "Đăng xuất" is on screen, whatever
// tabs the app itself has by now. A kit that needs the real screens (todayTestKit) passes `landed: false`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigation } from '../../app/navigation';
import { SessionProvider, useSession, wipeQueries, type Session } from '../../shared/api/session';
import { groupPendingTitle } from '../../shared/i18n/vi/nav';
import { MotionPreferenceProvider } from '../../shared/motion/useReducedMotion';
import { resetPendingForTests, type PendingAction } from '../../shared/storage/pendingActions';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { fetchMock, installAuthTestEnv, me, respond, TOKEN, USER } from '../auth/authTestKit';
import { OnboardingProvider } from '../onboarding/OnboardingProvider';
import { PendingBanner } from './PendingBanner';
import { RejectedNotice } from './RejectedNotice';
import { useQueuedWrite, type QueuedWriteResult } from './useQueuedWrite';

export { fetchMock, refuse, respond, TOKEN, USER } from '../auth/authTestKit';

export const WATER = '/day/quests/WATER/progress';
export const onboarded = { ...me, user: { ...me.user, onboarded: true } };
export const pendingKey = (userId = USER) => `pending:v1:${userId}`;
export const rejectedKey = (userId = USER) => `rejected:v1:${userId}`;

/** How the stubbed server behaves; a test changes these as it goes. */
export const server: { down: boolean; write: () => unknown; me: () => unknown } = {
  down: false,
  write: () => respond(200, { ok: true }),
  me: () => respond(200, onboarded),
};
/** Requests to the queueable paths, in order: path, action id, body. */
export const writes = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => init.method === 'POST' && !url.includes('/auth/'))
    .map(([url, init]) => ({ path: url.replace(/^.*\/api\/v1/, ''), id: init.headers['Idempotency-Key'], body: JSON.parse(init.body ?? 'null') }));
export const requested = (path: string) => fetchMock.mock.calls.filter(([url]) => url.endsWith(path)).length;

/** A stored action, as an earlier run of the app left it on disk. */
export const stored = (id: string, more: Partial<PendingAction> = {}): PendingAction => ({
  id,
  userId: USER,
  method: 'POST',
  path: WATER,
  body: { amount: 1 },
  createdAt: new Date().toISOString(),
  attempts: 0,
  status: 'queued',
  ...more,
});
export const seedQueue = (actions: PendingAction[], userId = USER) => AsyncStorage.setItem(pendingKey(userId), JSON.stringify(actions));
export const idsOnDisk = async (userId = USER) => (JSON.parse((await AsyncStorage.getItem(pendingKey(userId))) ?? '[]') as { id: string }[]).map(item => item.id);

/** What a recording screen holds: the session and the queued write. */
export const app = {} as { session: Session; send: (input: { path: string; body: Record<string, unknown> }) => Promise<QueuedWriteResult<unknown>> };
function Recorder() {
  app.session = useSession();
  app.send = useQueuedWrite<unknown>().send;
  return null;
}

let client: QueryClient | undefined;
export const queryClient = () => client as QueryClient;

type Options = { signedIn?: boolean; motion?: 'REDUCED' | 'FULL'; extra?: ReactNode; landed?: boolean };

/** The app as App.tsx mounts it. `signedIn: false` starts on Welcome; `landed: false` does not wait for the main group. */
export async function mountApp({ signedIn = true, motion = 'REDUCED', extra, landed = signedIn }: Options = {}) {
  if (signedIn) await Keychain.setGenericPassword(USER, TOKEN);
  if (client) wipeQueries(client); // a second mount in one test: the first tree is unmounted, its cache must not keep timers
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <SafeAreaProvider>
      <ThemeProvider>
        <MotionPreferenceProvider value={motion}>
          <QueryClientProvider client={client}>
            <SessionProvider>
              <OnboardingProvider>
                <View style={styles.fill}>
                  <PendingBanner />
                  <AppNavigation />
                </View>
                <RejectedNotice />
                <Recorder />
                {extra}
              </OnboardingProvider>
            </SessionProvider>
          </QueryClientProvider>
        </MotionPreferenceProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  if (landed) await screen.findByText(groupPendingTitle);
  await settle(); // the flush that starts with the session has landed
  if (landed) await tabsSettled();
  return view;
}

/**
 * Lets what the app has just started (a flush, a refetch) land inside act(), so that nothing updates the tree
 * between two steps of a test. Under fake timers it moves their clock by the same 10 ms.
 */
export const settle = () =>
  act(async () => {
    if ('clock' in setTimeout) await jest.advanceTimersByTimeAsync(10);
    else await new Promise(resolve => setTimeout(resolve, 10));
  });

/**
 * The tab shell has finished mounting. bottom-tabs ends its mount animation (16 ms in Jest's Animated) and then lets
 * go of the "previous" screen on a 32 ms timer of its own; both happen here, inside act(), instead of somewhere in the
 * middle of a test. Call it once after the tabs have appeared.
 */
export const tabsSettled = () =>
  act(async () => {
    if ('clock' in setTimeout) await jest.advanceTimersByTimeAsync(60);
    else await new Promise(resolve => setTimeout(resolve, 60));
  });

export function installSyncTestEnv() {
  installAuthTestEnv();
  beforeEach(() => {
    Object.assign(server, { down: false, write: () => respond(200, { ok: true }), me: () => respond(200, onboarded) });
    fetchMock.mockImplementation(async (url, init) => {
      if (server.down) throw new TypeError('Network request failed');
      if (init.method === 'GET') return url.endsWith('/me') ? server.me() : respond(200, {});
      return url.endsWith('/auth/logout') ? respond(204) : server.write();
    });
  });
  afterEach(() => {
    // RNTL has already unmounted the tree (see authTestKit): only now is it safe to drop the cache.
    if (client) wipeQueries(client);
    client = undefined;
    resetPendingForTests();
  });
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
