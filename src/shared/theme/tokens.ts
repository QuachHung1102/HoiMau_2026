// Mirrors the DESIGN.md frontmatter; __tests__/tokens.test.ts fails on drift.
export const colors = {
  primary: '#2458D3',
  soft: '#EAF0FF',
  lime: '#D8F58A',
  bg: '#F7F9FC',
  ink: '#182743',
  muted: '#56647B',
  line: '#DCE3EE',
  white: '#FFFFFF',
  error: '#B63838',
  flame: '#C2410C',
  flameSoft: '#FFF1E6',
  frost: '#0E7490',
  frostSoft: '#E3F6F9',
  gold: '#B45309',
  goldSoft: '#FFF4DB',
  forestPrimary: '#166534',
  forestSoft: '#E4F2E6',
  forestBg: '#F4F8F3',
  skyPrimary: '#0369A1',
  skySoft: '#E3F1FA',
  skyBg: '#F5F9FC',
} as const;

export type Palette = Record<keyof typeof colors, string>;
export type ThemeCode = 'default' | 'forest' | 'sky';

// The three purchasable palettes replace only these three colours.
export const themes: Record<ThemeCode, Pick<Palette, 'primary' | 'soft' | 'bg'>> = {
  default: { primary: colors.primary, soft: colors.soft, bg: colors.bg },
  forest: { primary: colors.forestPrimary, soft: colors.forestSoft, bg: colors.forestBg },
  sky: { primary: colors.skyPrimary, soft: colors.skySoft, bg: colors.skyBg },
};

// Android resolves a font by file name (one family per weight; fontWeight is ignored).
export const fontFamilies = {
  headline: 'BeVietnamPro_700Bold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const typography = {
  headline: { fontFamily: fontFamilies.headline, fontSize: 28, lineHeight: 36 },
  // `title` (section headings) is not in the DESIGN.md frontmatter; read off the S09 frame.
  title: { fontFamily: fontFamilies.headline, fontSize: 20, lineHeight: 28 },
  body: { fontFamily: fontFamilies.regular, fontSize: 16, lineHeight: 24 },
  secondary: { fontFamily: fontFamilies.regular, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fontFamilies.regular, fontSize: 14, lineHeight: 20 },
  navLabel: { fontFamily: fontFamilies.medium, fontSize: 11, lineHeight: 14 },
} as const;

export const radius = { button: 14, surface: 20 } as const;
export const spacing = { screen: 22, section: 24 } as const;
export const sizes = { buttonHeight: 52, navItemHeight: 60, minTouch: 48 } as const;
