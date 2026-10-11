import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as vi from '../i18n/vi/pet';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

const STROKE = 10;

type Props = {
  /** 0-1. */
  progress: number;
  size?: number;
  /** `primary` when the ring sits on a primary-coloured card (S19). */
  tone?: 'surface' | 'primary';
  accessibilityLabel?: string;
  /** The number as text, e.g. the time left. Without children the ring shows its percentage. */
  children?: ReactNode;
};

export function ProgressRing({ progress, size = 160, tone = 'surface', accessibilityLabel, children }: Props) {
  const palette = useTheme();
  const ratio = progress > 0 ? Math.min(1, progress) : 0;
  const percent = Math.round(ratio * 100);
  const onPrimary = tone === 'primary';
  const centre = size / 2;
  const r = (size - STROKE) / 2;
  const length = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.ring, { width: size, height: size }]}
    >
      <View style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size}>
          <Circle cx={centre} cy={centre} r={r} fill="none" strokeWidth={STROKE} stroke={onPrimary ? `${palette.white}40` : palette.line} />
          <Circle
            cx={centre}
            cy={centre}
            r={r}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            stroke={onPrimary ? palette.lime : palette.primary}
            strokeDasharray={`${length} ${length}`}
            strokeDashoffset={length * (1 - ratio)}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        </Svg>
      </View>
      {children ?? (
        <AppText variant="title" color={onPrimary ? 'white' : 'ink'}>
          {vi.percent(percent)}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
});
