import * as lucide from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Catalog = typeof lucide;
/**
 * Every lucide icon name (PascalCase, e.g. 'ChevronRight'). This is the public contract of `Icon`:
 * screens pick any name from the full set, so do not narrow it to a curated list.
 */
export type IconName = { [K in keyof Catalog]: Catalog[K] extends LucideIcon ? K : never }[keyof Catalog];

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Without a label the icon is decorative and hidden from screen readers. */
  accessibilityLabel?: string;
};

// ponytail: the whole lucide set stays in the bundle (Metro does not tree-shake the barrel);
// switch to a curated name -> icon map if bundle size ever matters.
export function Icon({ name, size = 24, color, accessibilityLabel }: Props) {
  const palette = useTheme();
  const Glyph = lucide[name] as LucideIcon;
  // The accessibility props go on a wrapper: on the web an svg would pass them on to the DOM element.
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true };
  return (
    <View {...a11y}>
      <Glyph size={size} color={color ?? palette.primary} />
    </View>
  );
}
