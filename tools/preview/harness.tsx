// Providers shared by every preview entry. Importable under Jest too: no import.meta, no DOM at module scope.
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MotionPreferenceProvider } from '../../src/shared/motion/useReducedMotion';
import { ThemeProvider } from '../../src/shared/theme/ThemeProvider';
import type { ThemeCode } from '../../src/shared/theme/tokens';

export type EntryOptions = {
  theme?: ThemeCode;
  motion?: 'REDUCED' | 'FULL';
  /** Pre-seeded query cache: [queryKey, data]. */
  queries?: [readonly unknown[], unknown][];
  /** Installed as globalThis.fetch; without one, any fetch throws. */
  fetchStub?: (url: string, init?: RequestInit) => unknown;
};

export type Entries = Record<string, () => ReactElement>;

// Later tasks extend this with the session, snackbar and navigation providers when those exist.
export function withApp(node: ReactElement, opts: EntryOptions = {}): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } } });
  for (const [key, data] of opts.queries ?? []) client.setQueryData(key, data);
  const { fetchStub } = opts;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (!fetchStub) throw new Error('preview: no network');
    return fetchStub(String(input), init);
  }) as typeof fetch;
  return (
    <SafeAreaProvider>
      <ThemeProvider theme={opts.theme}>
        <MotionPreferenceProvider value={opts.motion ?? 'FULL'}>
          <QueryClientProvider client={client}>{node}</QueryClientProvider>
        </MotionPreferenceProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
