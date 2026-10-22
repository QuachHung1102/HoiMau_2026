import type { ReactNode } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, sizes, type Palette } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Touchable } from './Touchable';

type Tone = 'surface' | 'soft' | 'primary';
const toneBackground: Record<Tone, keyof Palette> = { surface: 'white', soft: 'soft', primary: 'primary' };

export function Card({ tone = 'surface', style, ...rest }: ViewProps & { tone?: Tone }) {
  const palette = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.card,
        { backgroundColor: palette[toneBackground[tone]] },
        tone === 'surface' && [styles.outlined, { borderColor: palette.line }],
        style,
      ]}
    />
  );
}

type RowProps = {
  title: string;
  description?: string;
  icon?: IconName;
  thumbnail?: ImageSourcePropType;
  /** Text state shown at the trailing edge and read by screen readers after the description (e.g. on / off). */
  status?: string;
  /** Non-text node that replaces the default chevron. */
  trailing?: ReactNode;
  /** Without it the row is plain (its trailing node is its own control). */
  onPress?: () => void;
  /** Work started by this row is under way: it reads as disabled and busy, and a press does nothing. */
  busy?: boolean;
};

export function ListRow({ title, description, icon, thumbnail, status, trailing, onPress, busy = false }: RowProps) {
  const palette = useTheme();
  const content = (
    <View style={styles.row}>
      {icon ? <Icon name={icon} /> : null}
      {thumbnail ? <Image source={thumbnail} style={styles.thumb} accessible={false} /> : null}
      <View style={styles.text}>
        <AppText weight="semibold">{title}</AppText>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
      {status ? (
        <AppText variant="caption" weight="semibold">
          {status}
        </AppText>
      ) : null}
      {trailing ?? (onPress ? <Icon name="ChevronRight" color={palette.muted} /> : null)}
    </View>
  );
  if (!onPress) return content;
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={[title, description, status].filter(Boolean).join('. ')}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
    >
      {content}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.surface, padding: 20, gap: 12 },
  outlined: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: sizes.minTouch, paddingVertical: 12 },
  text: { flex: 1, gap: 2 },
  thumb: { width: 44, height: 44, borderRadius: 12 },
});
