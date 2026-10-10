import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { colors, themes, type Palette, type ThemeCode } from './tokens';

const defaultPalette: Palette = { ...colors, ...themes.default };
const ThemeContext = createContext<Palette>(defaultPalette);

export function ThemeProvider({ theme = 'default', children }: { theme?: ThemeCode; children: ReactNode }) {
  const palette = useMemo<Palette>(() => ({ ...colors, ...themes[theme] }), [theme]);
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext);
}
