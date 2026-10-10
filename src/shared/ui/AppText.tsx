import { Text, type TextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fontFamilies, typography, type Palette } from '../theme/tokens';

export type TextVariant = keyof typeof typography;
type InterWeight = 'regular' | 'medium' | 'semibold' | 'bold';

type Props = TextProps & {
  variant?: TextVariant;
  /** Picks the per-weight Inter file; ignored by headline and title (Be Vietnam Pro 700). */
  weight?: InterWeight;
  color?: keyof Palette;
};

const defaultColor: Record<TextVariant, keyof Palette> = {
  headline: 'ink',
  title: 'ink',
  body: 'ink',
  secondary: 'muted',
  caption: 'muted',
  navLabel: 'muted',
};

export function AppText({ variant = 'body', weight, color, style, ...rest }: Props) {
  const palette = useTheme();
  const base = typography[variant];
  const fontFamily = weight && variant !== 'headline' && variant !== 'title' ? fontFamilies[weight] : base.fontFamily;
  return <Text {...rest} style={[base, { fontFamily, color: palette[color ?? defaultColor[variant]] }, style]} />;
}
