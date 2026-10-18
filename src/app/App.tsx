import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OnboardingProvider } from '../features/onboarding/OnboardingProvider';
import { CelebrationHost } from '../features/progression/CelebrationHost';
import { PendingBanner } from '../features/sync/PendingBanner';
import { RejectedNotice } from '../features/sync/RejectedNotice';
import { SessionProvider, wipeQueries } from '../shared/api/session';
import { ThemeProvider } from '../shared/theme/ThemeProvider';
import { MeTheme } from './MeTheme';
import { AppNavigation } from './navigation';

function App() {
  // Created per mounted app, never at import time. No automatic retry: a failed load shows "Thử lại".
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  // Runs before the screens below have let go of their queries, hence the wipe that leaves no timer behind.
  useEffect(() => () => wipeQueries(queryClient), [queryClient]);
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            {/* Slot: a provider that must sit above every navigator wraps <AppNavigation /> right here.
                OnboardingProvider keeps what was typed while Back moves between the onboarding steps. */}
            <MeTheme>
            <OnboardingProvider>
              <View style={styles.fill}>
                {/* Offline / waiting-to-send (S38): its own row above the app, so it never covers a screen or the
                    snackbar. It also runs the pending queue; mounted exactly once. */}
                <PendingBanner />
                {/* The overlays S65 / S66 are not routes: the host lives inside the container, above the navigators. */}
                <AppNavigation>
                  <CelebrationHost />
                </AppNavigation>
              </View>
              <RejectedNotice />
            </OnboardingProvider>
            </MeTheme>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

export default App;
