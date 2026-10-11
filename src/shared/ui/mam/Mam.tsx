import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import Svg, { G } from 'react-native-svg';
import type { PetMood, PetStage } from '../../../../domain/types.ts';
import * as vi from '../../i18n/vi/pet';
import { motion } from '../../motion/motion';
import { useReducedMotion } from '../../motion/useReducedMotion';
import { SkinFox } from './SkinFox';
import { stages } from './stages';

/**
 * True while decorative motion may run: the screen is focused (`active`), the app is in the foreground
 * and motion is not reduced.
 */
export function useLoopGate(active = true): boolean {
  const reduced = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  return active && foreground && !reduced;
}

type Bezier = readonly [number, number, number, number];
type Shape = {
  duration: number;
  easing: Bezier;
  loop: boolean;
  /** At progress 1: vertical travel in dp, lean, and scale. */
  lift: number;
  tilt: string;
  grow: number;
  /** [progress to reach, share of the duration]. */
  steps: readonly (readonly [number, number])[];
};
const { durationsMs, easing, springs, translationDp } = motion;
const there = [1, 0.5] as const;
const back = [0, 0.5] as const;

// ponytail: whole-body motion only; per-part tracks from catalog.json if the mascot needs more life
const shapes: Record<'idle' | 'tired' | 'happy' | 'cheer', Shape> = {
  // motion: mam-idle
  idle: { duration: durationsMs.mascotIdle, easing: easing.idle, loop: true, lift: -translationDp.mascotIdle, tilt: '0deg', grow: 1, steps: [there, back] },
  // motion: mam-tired
  tired: { duration: durationsMs.mascotTired, easing: easing.idle, loop: true, lift: 2, tilt: '-2deg', grow: 1, steps: [there, back] },
  // motion: mam-happy
  happy: {
    duration: durationsMs.celebration,
    easing: springs.pop.webApprox,
    loop: false,
    lift: -translationDp.hop,
    tilt: '0deg',
    grow: 1.03,
    steps: [
      [1, 0.4],
      [0, 0.6],
    ],
  },
  // motion: mam-cheer (two hops, 12 dp then 8 dp)
  cheer: {
    duration: durationsMs.celebrationLong,
    easing: easing.enter,
    loop: false,
    lift: -12,
    tilt: '0deg',
    grow: 1,
    steps: [
      [1, 0.2],
      [0, 0.2],
      [8 / 12, 0.2],
      [0, 0.4],
    ],
  },
};

// The seed's head sits lower than the other stages': stage-egg.svg moves its face groups by this much, so a skin follows.
const EGG_HEAD = 'translate(2.2 31)';

type Props = {
  stage: PetStage;
  mood: PetMood;
  skin?: 'fox';
  /** Width and height in dp. */
  size: number;
  /** `idle` loops (slowly when the mood is TIRED); `happy` and `cheer` play once. Without it Mầm stands still. */
  animation?: 'idle' | 'happy' | 'cheer';
  /** True when text beside it already says the stage and the mood: hidden from screen readers. */
  decorative?: boolean;
  /** Pass the screen's focus state; motion stops while false. */
  active?: boolean;
};

export function Mam({ stage, mood, skin, size, animation, decorative = false, active = true }: Props) {
  const running = useLoopGate(active);
  const [progress] = useState(() => new Animated.Value(0));
  const played = useRef<string | undefined>(undefined);
  const shapeKey = animation === 'idle' && mood === 'TIRED' ? 'tired' : animation;
  const shape = shapeKey ? shapes[shapeKey] : undefined;

  useEffect(() => {
    if (!shapeKey) {
      played.current = undefined;
      return;
    }
    const { duration, easing: curve, loop, steps } = shapes[shapeKey];
    // A one-shot that ran to its end is not played again for the same `animation` value: coming back to the
    // foreground or to the screen must not replay a reward.
    if (!running || (!loop && played.current === shapeKey)) return;
    const sequence = Animated.sequence(
      steps.map(([toValue, share]) =>
        Animated.timing(progress, { toValue, duration: duration * share, easing: Easing.bezier(...curve), useNativeDriver: true }),
      ),
    );
    const playing = loop ? Animated.loop(sequence) : sequence;
    playing.start(({ finished }) => {
      if (finished) played.current = shapeKey;
    });
    return () => {
      playing.stop();
      progress.setValue(0);
    };
  }, [running, shapeKey, progress]);

  const Stage = stages[stage];
  const a11y = decorative
    ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true }
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: vi.mamLabel(stage, mood) };
  const inputRange = [0, 1];
  const transform = shape && [
    { translateY: progress.interpolate({ inputRange, outputRange: [0, shape.lift] }) },
    { rotate: progress.interpolate({ inputRange, outputRange: ['0deg', shape.tilt] }) },
    { scale: progress.interpolate({ inputRange, outputRange: [1, shape.grow] }) },
  ];
  return (
    <Animated.View {...a11y} style={{ width: size, height: size, transform }}>
      <Svg width={size} height={size} viewBox="0 0 128 128">
        <Stage mood={mood} />
        {skin === 'fox' ? (
          <G transform={stage === 'EGG' ? EGG_HEAD : undefined}>
            <SkinFox />
          </G>
        ) : null}
      </Svg>
    </Animated.View>
  );
}
