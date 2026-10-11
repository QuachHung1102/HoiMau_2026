import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, wipeQueries } from '../shared/api/session';
import { ThemeProvider } from '../shared/theme/ThemeProvider';
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
            <AppNavigation />
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
