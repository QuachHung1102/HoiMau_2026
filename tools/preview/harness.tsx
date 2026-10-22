// Providers shared by every preview entry. Importable under Jest too: no import.meta, no DOM at module scope.
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Keychain from 'react-native-keychain';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MeTheme } from '../../src/app/MeTheme';
import { AppNavigation, stateForRoute } from '../../src/app/navigation';
import type { RouteName } from '../../src/app/routes';
import { SessionProvider } from '../../src/shared/api/session';
import { MotionPreferenceProvider } from '../../src/shared/motion/useReducedMotion';
import { ThemeProvider } from '../../src/shared/theme/ThemeProvider';
import { SnackbarProvider } from '../../src/shared/ui/Snackbar';
import type { ThemeCode } from '../../src/shared/theme/tokens';

export type EntryOptions = {
  theme?: ThemeCode;
  motion?: 'REDUCED' | 'FULL';
  /** Pre-seeded query cache: [queryKey, data]. */
  queries?: [readonly unknown[], unknown][];
  /** Installed as globalThis.fetch; without one, any fetch throws. */
  fetchStub?: (url: string, init?: RequestInit) => unknown;
  /** The signed-in user (a token goes into the keychain stub); null or omitted = signed out. */
  session?: { userId: string } | null;
  /**
   * Opens the app's real navigators on this route (tab bar, stacks, session gate) instead of rendering `node`
   * alone; `node`, if any, is rendered above them. The route shows only when `session` and a seeded `['me']`
   * match its group: signed out for auth routes, `onboarded: false` for onboarding, `true` for the rest.
   */
  route?: { name: RouteName; params?: object };
};

export type Entries = Record<string, () => ReactElement>;

/**
 * An entry that types or presses for its designed state (shot.mjs cannot) counts itself as driving: `beginDrive()` when it
 * starts, the returned `done()` after its last step (and on unmount; extra calls do nothing). The Jest a11y sweep waits
 * until no entry is driving, and fails an entry still driving at its time limit.
 */
export const drives = { pending: 0, lastDoneAt: 0 };
(globalThis as { __previewDrives?: typeof drives }).__previewDrives = drives;
export function beginDrive(): () => void {
  drives.pending += 1;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    drives.pending -= 1;
    drives.lastDoneAt = performance.now();
  };
}

export function withApp(node: ReactElement | null, opts: EntryOptions = {}): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } } });
  for (const [key, data] of opts.queries ?? []) client.setQueryData(key, data);
  const { fetchStub } = opts;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (!fetchStub) throw new Error('preview: no network');
    return fetchStub(String(input), init);
  }) as typeof fetch;
  // The keychain is the in-memory stub here (and the Jest mock under Jest); both store before the provider reads.
  if (opts.session) Keychain.setGenericPassword(opts.session.userId, 'preview-token');
  else Keychain.resetGenericPassword();
  const { route } = opts;
  return (
    <SafeAreaProvider>
      <ThemeProvider theme={opts.theme}>
        <MotionPreferenceProvider value={opts.motion ?? 'FULL'}>
          <QueryClientProvider client={client}>
            <SessionProvider>
              <MeTheme fallback={opts.theme}>
                {route ? (
                  <AppNavigation initialState={stateForRoute(route.name, route.params)}>{node}</AppNavigation>
                ) : (
                  <SnackbarProvider>{node}</SnackbarProvider>
                )}
              </MeTheme>
            </SessionProvider>
          </QueryClientProvider>
        </MotionPreferenceProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
