import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Pet } from '../../../domain/contract/core.ts';
import { moodText } from '../../shared/i18n/vi/pet';
import * as questsVi from '../../shared/i18n/vi/quests';
import * as vi from '../../shared/i18n/vi/today';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Mam } from '../../shared/ui/mam/Mam';

type Props = {
  pet: Pet;
  /** Set while a record the server has just confirmed is fresh; a new number makes Mầm hop again. */
  cheer: number | null;
  /** Without it the card has no button (the day has no water quest). */
  onRecord?: () => void;
  /** Why the button is off (every part is recorded); it also goes into the button's label. */
  disabledReason?: string;
};

// The one skin there is (server/content/shopItems.ts); any other code shows Mầm as it is.
const skinOf = (code: string) => (code === 'SKIN_FOX' ? ('fox' as const) : undefined);

/** Mầm beside the day's one-tap action. Its mood is the server's; tired is an invitation, never a reproach. */
export function CompanionCard({ pet, cheer, onRecord, disabledReason }: Props) {
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const [hop, setHop] = useState<{ n: number; over: boolean } | null>(null);
  useEffect(() => {
    if (reduced || cheer === null) return;
    // motion: mam-happy (one hop per confirmed record; the frame without an animation in between lets a second
    // record replay it, and the timers only return Mầm to idling)
    const start = setTimeout(() => setHop({ n: cheer, over: false }), 0);
    const end = setTimeout(() => setHop({ n: cheer, over: true }), motion.durationsMs.celebration + 50);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [cheer, reduced]);
  const animation = reduced || cheer === null ? 'idle' : hop?.n !== cheer ? undefined : hop.over ? 'idle' : 'happy';

  const glad = cheer !== null;
  const mood = glad ? 'HAPPY' : pet.mood;
  return (
    <Card tone="primary">
      <View style={styles.row}>
        <View style={styles.text}>
          <AppText variant="title" color="white" accessibilityRole="header">
            {vi.companionHeadline.join('\n')}
          </AppText>
          <AppText variant="secondary" color="white">
            {/* by the server's mood, not the glad face of the moment: the card keeps its height */}
            {pet.mood === 'TIRED' ? vi.companionInvite : vi.companionBody}
          </AppText>
        </View>
        {/* decorative: the line under it says the mood */}
        <Mam stage={pet.stage} mood={mood} skin={skinOf(pet.skinCode)} size={88} animation={animation} active={focused} decorative />
      </View>
      {/* The full width of the card: the line changes with a record, and must not change the card's height. */}
      <AppText variant="secondary" color="white">
        {glad ? vi.mamGlad : moodText[pet.mood]}
      </AppText>
      {onRecord ? (
        <Button
          variant="onPrimary"
          label={questsVi.recordWater}
          accessibilityLabel={disabledReason ? `${questsVi.recordWater}. ${disabledReason}` : undefined}
          disabled={disabledReason !== undefined}
          onPress={onRecord}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 4 },
});
