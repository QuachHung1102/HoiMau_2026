import { useEffect, useMemo, useRef, useState } from 'react';
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
 * motion: exercise-* (every `kind: "exercise"` entry). One linear `Animated` loop over the entry's duration token
 * drives every track, each through its own easing. SVG group transforms cannot use the native driver: each frame
 * sets the group's matrix directly (setNativeProps), so React does not re-render the figure while it moves.
 * Stopped and started again (pause, "Xem chậm"), the cycle goes on from where it was, not from its first pose.
 */
export function RigPlayer({ demoCode, speed, active, highlight }: Props) {
  const move = moves[demoCode];
  const tracks = useMemo(() => tracksOf(move), [move]);
  const [groups] = useState(() => new Map<string, Group>());
  const running = useLoopGate(active);
  // The cycle fraction last drawn, for this move.
  const last = useRef({ move, at: 0 });

  useEffect(() => {
    if (!running) return undefined;
    const from = last.current.move === move ? last.current.at : 0;
    const eased = tracks.map(track => {
      const [x1, y1, x2, y2] = motion.easing[track.easing];
      return Easing.bezier(x1, y1, x2, y2);
    });
    const progress = new Animated.Value(0);
    progress.addListener(({ value }) => {
      const at = (from + value) % 1;
      last.current = { move, at };
      tracks.forEach((track, i) => place(groups.get(track.id), matrixAt(track, eased[i](at))));
    });
    const duration = motion.durationsMs[move.durationToken] / speed;
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => {
      loop.stop();
      progress.removeAllListeners();
    };
  }, [running, speed, move, tracks, groups]);

  return <Rig move={move} tracks={tracks} at={0} groups={groups} highlight={highlight} />;
}
