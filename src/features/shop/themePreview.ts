import { colors, themes, type Palette, type ThemeCode } from '../../shared/theme/tokens';

/** The colours a theme replaces; the rest of a sample card (ink, line, white) is the same in every theme. */
export type ThemeColors = Pick<Palette, 'primary' | 'soft' | 'bg'>;

/** The palette of a shop item's `assetKey` (`default`, `forest`, `sky`), or undefined for a key this app has no palette for. */
export function themePalette(assetKey: string): ThemeColors | undefined {
  return Object.hasOwn(themes, assetKey) ? themes[assetKey as ThemeCode] : undefined;
}

/** The whole palette a sample card of that theme is drawn with. */
export const samplePalette = (theme: ThemeColors): Palette => ({ ...colors, ...theme });

/** `appearance.themeCode` is the code of the equipped shop item (`THEME_FOREST`); anything this app does not know is the default. */
export function themeCodeOf(itemCode: string | null | undefined): ThemeCode {
  const key = (itemCode ?? '').replace(/^THEME_/, '').toLowerCase();
  return Object.hasOwn(themes, key) ? (key as ThemeCode) : 'default';
}

/** The one skin there is (server/content/shopItems.ts), by its code or its asset key; any other shows Mầm as it is. */
export const mamSkinOf = (codeOrKey: string | null | undefined) => (codeOrKey === 'SKIN_FOX' || codeOrKey === 'fox' ? ('fox' as const) : undefined);
