import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { motion } from '../../shared/motion/motion';
import { useLoopGate } from '../../shared/motion/useLoopGate';
import { matrixAt, moves, Rig, tracksOf, type Group, type Matrix } from './rig';

// react-native-svg takes a group's matrix as `matrix` natively and inside `style` on the web.
const place = (group: Group | undefined, matrix: Matrix) => group?.setNativeProps(Platform.OS === 'web' ? { style: { transform: matrix } } : { matrix });

type Props = {
  demoCode: string;
  /** 0.5 plays the cycle at half speed ("Xem chậm"). */
  speed: 1 | 0.5;
  /** False stops the loops (screen not focused, session paused). Background and reduced motion stop them too. */
  active: boolean;
  highlight?: string;
};

/**
 * motion: exercise-* (every `kind: "exercise"` entry). One `Animated` loop per track over the entry's duration
 * token. SVG group transforms cannot use the native driver: each frame sets the group's matrix directly
 * (setNativeProps), so React does not re-render the figure while it moves.
 */
export function RigPlayer({ demoCode, speed, active, highlight }: Props) {
  const move = moves[demoCode];
  const tracks = useMemo(() => tracksOf(move), [move]);
  const [groups] = useState(() => new Map<string, Group>());
  const running = useLoopGate(active);

  useEffect(() => {
    if (!running) return undefined;
    const duration = motion.durationsMs[move.durationToken] / speed;
    const loops = tracks.map(track => {
      const progress = new Animated.Value(0);
      progress.addListener(({ value }) => place(groups.get(track.id), matrixAt(track, value)));
      const [x1, y1, x2, y2] = motion.easing[track.easing];
      const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration, easing: Easing.bezier(x1, y1, x2, y2), useNativeDriver: false }));
      loop.start();
      return { loop, progress };
    });
    return () =>
      loops.forEach(({ loop, progress }) => {
        loop.stop();
        progress.removeAllListeners();
      });
  }, [running, speed, move, tracks, groups]);

  return <Rig move={move} tracks={tracks} at={0} groups={groups} highlight={highlight} />;
}
