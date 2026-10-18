import { Image, StyleSheet, View } from 'react-native';
import { poses } from '../../assets/motion/poses';
import * as vi from '../../shared/i18n/vi/workout';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { BreathingGuide, usePhase } from './BreathingGuide';
import { moves } from './rig';
import { RigPlayer } from './RigPlayer';

export type MoveDemoProps = {
  /** The move's `demoCode`: an `exercise-*` catalog id, `focus-breathe`, or null (no figure). */
  demoCode: string | null;
  speed?: 1 | 0.5;
  /** The screen is focused and the demo may play (a paused session stops it). */
  active: boolean;
};

/**
 * The move shown, not told: the looping figure, or its key pose under reduced motion. Decorative for screen
 * readers (the steps beside it are the instruction); a breathing phase label is text and stays readable.
 * Renders nothing for a move without a demo.
 */
export function MoveDemoView({ demoCode, speed = 1, active }: MoveDemoProps) {
  const reduced = useReducedMotion();
  const move = demoCode ? moves[demoCode] : undefined;
  // motion: exercise-tha-long-tung-vung (the body scan's region, on the clock of its phases)
  const scanned = usePhase(move?.highlight, active && !reduced);
  const region = move?.highlight?.[scanned].region;
  if (demoCode === 'focus-breathe') return <BreathingGuide pattern={vi.fourFourBreath} active={active} circle />;
  if (!demoCode || !move) return null;
  return (
    <View>
      <View accessible={false} importantForAccessibility="no-hide-descendants">
        {reduced ? (
          <Image source={poses[demoCode]} style={styles.pose} accessible={false} />
        ) : (
          <RigPlayer demoCode={demoCode} speed={move.pattern ? 1 : speed} active={active} highlight={region} />
        )}
      </View>
      {move.pattern ? <BreathingGuide pattern={move.pattern} active={active} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ pose: { width: '100%', height: undefined, aspectRatio: 4 / 3 } });
