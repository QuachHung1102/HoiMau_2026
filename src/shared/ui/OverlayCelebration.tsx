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
import { useNumberRoll } from './Badges';
import { useFocusOnShow } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './Icon';
import { Mam } from './mam/Mam';
import { MilestoneMedal, MilestoneRibbon } from './MilestoneBadge';
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
const curves = {
  enter: Easing.bezier(...easing.enter),
  exit: Easing.bezier(...easing.exit),
  pop: Easing.bezier(...motion.springs.pop.webApprox),
};
const STAGE_ORDER: PetStage[] = ['EGG', 'HATCHLING', 'JUVENILE', 'ADULT', 'MYTHIC'];
const DOT = 8;
/** Room around the picture for the halo: at full size it ends where the picture block ends, clear of the title. */
const HALO_ROOM = 16;
// Catalog delays shared by the kinds that have the track: the level count, the label under the badge, the ribbon.
const COUNT_DELAY = 200;
const LABEL_DELAY = durationsMs.celebration;
const RIBBON_DELAY = 600;

// Per kind, from design/motion/catalog.json: `art` is the picture's height in dp (S65 136, S66 medal + ribbon, S69 168);
// `pop*` is the `.badge` track (level-up, streak-milestone) or the `.to` track (mam-evolve).
// ponytail: one halo replaces the catalog tracks `.rays` (level-up) and `.d-flame` (streak-milestone); it is `.glow` of mam-evolve.
const choreography = {
  // motion: level-up
  LEVEL_UP: { art: 136, haloMs: durationsMs.celebrationLong, popDelay: 0, popFrom: 0.6, popPeakAt: 0.6, burstDelay: 150, particles: 24, travel: 100 },
  // motion: streak-milestone
  STREAK_MILESTONE: { art: 104, haloMs: durationsMs.transition, popDelay: 250, popFrom: 0.6, popPeakAt: 0.7, burstDelay: 300, particles: 20, travel: 90 },
  // motion: mam-evolve
  PET_STAGE_UP: { art: 168, haloMs: durationsMs.celebrationLong, popDelay: 350, popFrom: scale.successFrom, popPeakAt: 0.6, burstDelay: 400, particles: 24, travel: 100 },
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
      pop: new Animated.Value(from),
      leave: new Animated.Value(from),
      label: new Animated.Value(from),
      ribbon: new Animated.Value(from),
      burst: new Animated.Value(from),
    };
  });
  const played = useRef(false);
  // The level counts up from the previous one once the animation reaches that step; reduced motion shows it directly.
  const [counted, setCounted] = useState(reduced);
  const level = useNumberRoll(props.kind === 'LEVEL_UP' ? props.level - (counted ? 0 : 1) : 0, durationsMs.celebration);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  useEffect(() => {
    if (reduced || played.current) return;
    const all = Object.values(tracks);
    all.forEach(track => track.setValue(0));
    const run = (track: Animated.Value, curve: keyof typeof curves, duration: number, delay: number) =>
      Animated.timing(track, { toValue: 1, duration, delay, easing: curves[curve], useNativeDriver: true });
    const show = Animated.parallel([
      run(tracks.halo, 'enter', plan.haloMs, 0),
      run(tracks.leave, 'pop', durationsMs.celebration, 0),
      run(tracks.pop, 'pop', durationsMs.celebration, plan.popDelay),
      run(tracks.label, 'enter', durationsMs.transition, LABEL_DELAY),
      run(tracks.ribbon, 'enter', durationsMs.transition, RIBBON_DELAY),
      run(tracks.burst, 'exit', durationsMs.celebrationLong, plan.burstDelay),
    ]);
    show.start(({ finished }) => {
      if (finished) played.current = true;
    });
    const counting = setTimeout(() => setCounted(true), COUNT_DELAY);
    return () => {
      // Interrupted (unmount, or motion just got reduced): the final card.
      show.stop();
      clearTimeout(counting);
      all.forEach(track => track.setValue(1));
      setCounted(true);
    };
  }, [reduced, tracks, plan]);

  // The pop curve overshoots 1: opacity is clamped, scale is allowed to follow it.
  const pop = {
    opacity: tracks.pop.interpolate({ inputRange: [0, plan.popPeakAt], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ scale: tracks.pop.interpolate({ inputRange: [0, plan.popPeakAt, 1], outputRange: [plan.popFrom, scale.celebrationPeak, scale.rest] }) }],
  };
  const leaving = {
    opacity: tracks.leave.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
    transform: [{ scale: tracks.leave.interpolate({ inputRange: [0, 0.4, 1], outputRange: [scale.rest, scale.celebrationPeak, scale.successFrom] }) }],
  };
  const rise = {
    opacity: tracks.label,
    transform: [{ translateY: tracks.label.interpolate({ inputRange: [0, 1], outputRange: [motion.translationDp.enter, 0] }) }],
  };
  // The halo never grows past its own box, which is no taller than the picture block (and is clipped to it).
  const glow = {
    opacity: tracks.halo.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.9, 0] }),
    transform: [{ scale: tracks.halo.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.5, 0.9, 1] }) }],
  };
  const haloSize = plan.art + 2 * HALO_ROOM;
  const previous = props.kind === 'PET_STAGE_UP' ? STAGE_ORDER[STAGE_ORDER.indexOf(props.stage) - 1] : undefined;
  // Gold is for coins and prices only, so the milestone burst is flame and lime.
  const particleColors = kind === 'STREAK_MILESTONE' ? [palette.flame, palette.lime] : [motion.particles.colors[0], palette.lime, palette.white];
  const portrait = { width: plan.art, height: plan.art, borderRadius: plan.art / 2, backgroundColor: palette.soft };
  const mamSize = Math.round(plan.art * 0.76);

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
          <View
            testID="celebration-art"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.art, { minHeight: haloSize }]}
          >
            {reduced ? null : (
              <>
                <View testID="celebration-halo-clip" style={styles.haloClip}>
                  <Animated.View
                    testID="celebration-halo"
                    style={[{ width: haloSize, height: haloSize, borderRadius: haloSize / 2, backgroundColor: palette.white }, glow]}
                  />
                </View>
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
                          opacity: tracks.burst.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 0] }),
                          transform: [
                            { translateX: tracks.burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * reach] }) },
                            { translateY: tracks.burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * reach] }) },
                            { scale: tracks.burst.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                          ],
                        },
                      ]}
                    />
                  );
                })}
              </>
            )}
            {props.kind === 'STREAK_MILESTONE' ? (
              <View style={styles.medal}>
                <Animated.View style={pop}>
                  <MilestoneMedal days={props.days} achieved />
                </Animated.View>
                <Animated.View testID="celebration-ribbon" style={{ transform: [{ scaleX: tracks.ribbon }] }}>
                  <MilestoneRibbon text={vi.milestoneRibbon(props.days)} achieved />
                </Animated.View>
              </View>
            ) : props.kind === 'LEVEL_UP' ? (
              <View style={styles.artRow}>
                <View style={[styles.portrait, portrait]}>
                  <Mam stage={props.stage} mood="HAPPY" skin={skin} size={mamSize} animation="cheer" decorative />
                </View>
                <Animated.View style={[styles.number, { backgroundColor: palette.soft, borderColor: palette.lime }, pop]}>
                  <AppText variant="headline" color="primary">
                    {level}
                  </AppText>
                </Animated.View>
              </View>
            ) : (
              <Animated.View style={[styles.portrait, portrait, pop]}>
                <Mam stage={props.stage} mood="HAPPY" skin={skin} size={mamSize} decorative />
              </Animated.View>
            )}
            {previous && !reduced ? (
              <Animated.View style={[styles.portrait, portrait, styles.leaving, leaving]}>
                <Mam stage={previous} mood="HAPPY" skin={skin} size={mamSize} decorative />
              </Animated.View>
            ) : null}
          </View>

          <View style={styles.text}>
            <View ref={ref} accessible accessibilityRole="header">
              <AppText variant="headline" color="white" style={styles.centered}>
                {title}
              </AppText>
            </View>
            {subtitle ? (
              <Animated.View style={rise}>
                <AppText weight="bold" color="lime" style={styles.centered}>
                  {subtitle}
                </AppText>
              </Animated.View>
            ) : null}
            <AppText color="white" style={[styles.centered, styles.body]}>
              {body}
            </AppText>
          </View>

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
  art: { alignItems: 'center', justifyContent: 'center' },
  artRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  // Clips the halo to the picture block, whatever its scale: the title under the block stays clear.
  haloClip: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  particle: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  portrait: { alignItems: 'center', justifyContent: 'center' },
  leaving: { position: 'absolute' },
  medal: { alignItems: 'center', gap: 8 },
  number: { minWidth: 72, minHeight: 72, paddingHorizontal: 8, borderRadius: 999, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  text: { gap: 4 },
  centered: { textAlign: 'center' },
  body: { marginTop: 8 },
  secondary: { minHeight: sizes.minTouch, alignItems: 'center', justifyContent: 'center' },
});
