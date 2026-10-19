import type { ReactNode } from 'react';
import { useMe } from '../features/auth/api';
import { themeCodeOf } from '../features/shop/themePreview';
import { ThemeProvider } from '../shared/theme/ThemeProvider';
import type { ThemeCode } from '../shared/theme/tokens';

/**
 * The palette follows what the server says is equipped (`me.appearance.themeCode`), and nothing else: an equip changes
 * it only once `['me']` has been read again. Until the profile is known it is `fallback` (the default), and a code this
 * app has no palette for is the default. Needs the query and session providers above it.
 */
export function MeTheme({ fallback = 'default', children }: { fallback?: ThemeCode; children: ReactNode }) {
  const code = useMe().data?.appearance?.themeCode;
  // motion: theme-apply (static: the palette changes at once, when the server's appearance does)
  return <ThemeProvider theme={code === undefined ? fallback : themeCodeOf(code)}>{children}</ThemeProvider>;
}
