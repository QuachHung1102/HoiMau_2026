import * as lucide from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

type Catalog = typeof lucide;
export type IconName = { [K in keyof Catalog]: Catalog[K] extends LucideIcon ? K : never }[keyof Catalog];

// ponytail: the whole lucide set stays in the bundle (Metro does not tree-shake the barrel);
// switch to a curated name -> icon map if bundle size ever matters.
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const palette = useTheme();
  const Glyph = lucide[name] as LucideIcon;
  // Decorative: an svg view is not focusable by default, the touchable or text beside it carries the meaning.
  return <Glyph size={size} color={color ?? palette.primary} />;
}
