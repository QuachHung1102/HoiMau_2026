import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PetStage } from '../../../domain/types.ts';
import * as common from '../i18n/vi/common';
import * as vi from '../i18n/vi/pet';
import { motion } from '../motion/motion';
import { useReducedMotion } from '../motion/useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { sizes, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { useFocusOnShow } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './Icon';
import { Mam } from './mam/Mam';
import { Touchable } from './Touchable';

type Action = { label: string; onPress: () => void };
type Props = {
  title: string;
  /** A second line under the title, e.g. the title that comes with the new level. */
  subtitle?: string;
  body: string;
  /** Both actions work from the first frame; closing is the caller's job (unmount the overlay). */
  primary: Action;
  secondary: Action;
  /** The close button and Android Back. */
  onClose: () => void;
  skin?: 'fox';
} & (
  // LEVEL_UP draws the mascot as it is now (`stage`) beside the new level; PET_STAGE_UP draws the stage just reached.
  | { kind: 'LEVEL_UP'; level: number; stage: PetStage }
  | { kind: 'STREAK_MILESTONE'; days: number }
  | { kind: 'PET_STAGE_UP'; stage: PetStage }
);

const { durationsMs, easing, scale } = motion;
const STAGE_ORDER: PetStage[] = ['EGG', 'HATCHLING', 'JUVENILE', 'ADULT', 'MYTHIC'];
const PORTRAIT = 152;
const DOT = 8;

// Delays, particle counts and travel are the catalog's; the tracks themselves are shared by the three kinds.
// ponytail: one halo stands in for the level-up rays and the milestone flame flash, and the level does not count
// up from the previous one; per-kind tracks from catalog.json if the overlays need more.
const choreography = {
  // motion: level-up
  LEVEL_UP: { artDelay: 0, burstDelay: 150, particles: 24, travel: 100 },
  // motion: streak-milestone
  STREAK_MILESTONE: { artDelay: 250, burstDelay: 300, particles: 20, travel: 90 },
  // motion: mam-evolve
  PET_STAGE_UP: { artDelay: 350, burstDelay: 400, particles: 24, travel: 100 },
} as const;

/**
 * Full-screen celebration above navigation (S65, S66, S69). Mount it to show it: the animation plays once per
 * mount, and under reduced motion the final card is shown at once.
 */
export function OverlayCelebration(props: Props) {
  const { kind, title, subtitle, body, primary, secondary, onClose, skin } = props;
  const palette = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { ref, focus } = useFocusOnShow();
  const plan = choreography[kind];
  const [tracks] = useState(() => {
    const from = reduced ? 1 : 0;
    return {
      halo: new Animated.Value(from),
      art: new Animated.Value(from),
      leave: new Animated.Value(from),
      text: new Animated.Value(from),
      burst: new Animated.Value(from),
    };
  });
  const played = useRef(false);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  useEffect(() => {
    if (reduced || played.current) return;
    const { halo, art, leave, text, burst } = tracks;
    const all = [halo, art, leave, text, burst];
    all.forEach(track => track.setValue(0));
    const run = (track: Animated.Value, duration: number, delay: number) =>
      Animated.timing(track, { toValue: 1, duration, delay, easing: Easing.bezier(...easing.enter), useNativeDriver: true });
    const show = Animated.parallel([
      run(halo, durationsMs.celebrationLong, 0),
      run(leave, durationsMs.celebration, 0),
      run(art, durationsMs.celebration, plan.artDelay),
      run(text, durationsMs.transition, durationsMs.celebration),
      run(burst, durationsMs.celebrationLong, plan.burstDelay),
    ]);
    show.start(({ finished }) => {
      if (finished) played.current = true;
    });
    return () => {
      show.stop();
      all.forEach(track => track.setValue(1)); // interrupted (unmount, or motion just got reduced): final card
    };
  }, [reduced, tracks, plan]);

  const pop = {
    opacity: tracks.art.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: tracks.art.interpolate({ inputRange: [0, 0.6, 1], outputRange: [scale.successFrom, scale.celebrationPeak, scale.rest] }) }],
  };
  const rise = {
    opacity: tracks.text,
    transform: [{ translateY: tracks.text.interpolate({ inputRange: [0, 1], outputRange: [motion.translationDp.enter, 0] }) }],
  };
  const glow = {
    opacity: tracks.halo.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.9, 0] }),
    transform: [{ scale: tracks.halo.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.6, 1.2, 1.4] }) }],
  };
  const previous = props.kind === 'PET_STAGE_UP' ? STAGE_ORDER[STAGE_ORDER.indexOf(props.stage) - 1] : undefined;
  const particleColors = [motion.particles.colors[0], palette.lime, palette.white];
  const portrait = [styles.portrait, { backgroundColor: palette.soft }];

  return (
    <Modal visible statusBarTranslucent animationType={reduced ? 'none' : 'fade'} onRequestClose={onClose} onShow={focus}>
      <View accessibilityViewIsModal style={[styles.fill, { backgroundColor: palette.primary }]}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.section, paddingBottom: insets.bottom + spacing.section }]}
        >
          <Touchable accessibilityRole="button" accessibilityLabel={common.close} onPress={onClose} style={styles.close}>
            <Icon name="X" color={palette.white} />
          </Touchable>

          {/* The picture repeats what the title and body say, so screen readers skip it. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.art}>
            {reduced ? null : (
              <>
                <Animated.View style={[styles.halo, { backgroundColor: palette.white }, glow]} />
                {Array.from({ length: Math.min(plan.particles, motion.particles.maxCount) }, (_, i) => {
                  const angle = (2 * Math.PI * i) / plan.particles;
                  const reach = plan.travel * (0.6 + 0.1 * (i % 5));
                  return (
                    <Animated.View
                      key={i}
                      testID="celebration-particle"
                      style={[
                        styles.particle,
                        {
                          backgroundColor: particleColors[i % particleColors.length],
                          opacity: tracks.burst.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                          transform: [
                            { translateX: tracks.burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * reach] }) },
                            { translateY: tracks.burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * reach] }) },
                          ],
                        },
                      ]}
                    />
                  );
                })}
              </>
            )}
            <Animated.View style={[styles.artRow, pop]}>
              {props.kind === 'STREAK_MILESTONE' ? (
                <View style={styles.medal}>
                  <View style={[styles.number, { backgroundColor: palette.flameSoft, borderColor: palette.flame }]}>
                    <AppText variant="headline" color="flame">
                      {props.days}
                    </AppText>
                  </View>
                  <View style={[styles.ribbon, { backgroundColor: palette.flame }]}>
                    <AppText variant="caption" weight="semibold" color="white">
                      {vi.milestoneRibbon(props.days)}
                    </AppText>
                  </View>
                </View>
              ) : (
                <View style={portrait}>
                  <Mam stage={props.stage} mood="HAPPY" skin={skin} size={PORTRAIT - 32} animation="cheer" decorative />
                </View>
              )}
              {props.kind === 'LEVEL_UP' ? (
                <View style={[styles.number, { backgroundColor: palette.soft, borderColor: palette.lime }]}>
                  <AppText variant="headline" color="primary">
                    {props.level}
                  </AppText>
                </View>
              ) : null}
            </Animated.View>
            {previous && !reduced ? (
              <Animated.View
                style={[
                  portrait,
                  styles.leaving,
                  {
                    opacity: tracks.leave.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1, 0] }),
                    transform: [{ scale: tracks.leave.interpolate({ inputRange: [0, 0.4, 1], outputRange: [scale.rest, scale.celebrationPeak, scale.successFrom] }) }],
                  },
                ]}
              >
                <Mam stage={previous} mood="HAPPY" skin={skin} size={PORTRAIT - 32} decorative />
              </Animated.View>
            ) : null}
          </View>

          <Animated.View style={[styles.text, rise]}>
            <View ref={ref} accessible accessibilityRole="header">
              <AppText variant="headline" color="white" style={styles.centered}>
                {title}
              </AppText>
            </View>
            {subtitle ? (
              <AppText weight="bold" color="lime" style={styles.centered}>
                {subtitle}
              </AppText>
            ) : null}
            <AppText color="white" style={[styles.centered, styles.body]}>
              {body}
            </AppText>
          </Animated.View>

          <Button variant="onPrimary" label={primary.label} onPress={primary.onPress} />
          <Touchable accessibilityRole="button" onPress={secondary.onPress} style={styles.secondary}>
            <AppText weight="semibold" color="white">
              {secondary.label}
            </AppText>
          </Touchable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // flexGrow + center: the card sits in the middle of the screen and scrolls at a large font scale.
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.screen, gap: 12 },
  close: { alignSelf: 'flex-end', width: sizes.minTouch, height: sizes.minTouch, alignItems: 'center', justifyContent: 'center' },
  art: { alignItems: 'center', justifyContent: 'center', minHeight: PORTRAIT },
  artRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  halo: { position: 'absolute', width: PORTRAIT, height: PORTRAIT, borderRadius: PORTRAIT / 2 },
  particle: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  portrait: { width: PORTRAIT, height: PORTRAIT, borderRadius: PORTRAIT / 2, alignItems: 'center', justifyContent: 'center' },
  leaving: { position: 'absolute' },
  medal: { alignItems: 'center', gap: 8 },
  number: { minWidth: 72, minHeight: 72, paddingHorizontal: 8, borderRadius: 999, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  ribbon: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 10 },
  text: { gap: 4 },
  centered: { textAlign: 'center' },
  body: { marginTop: 8 },
  secondary: { minHeight: sizes.minTouch, alignItems: 'center', justifyContent: 'center' },
});
