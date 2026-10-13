import { StyleSheet, View } from 'react-native';
import type { Archetype } from '../../../domain/types.ts';
import { healthVi } from '../../shared/i18n/vi/health';
import * as vi from '../../shared/i18n/vi/onboarding';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';

type Props = {
  /** One of the two directions that are offered instead. */
  onChoose: (archetype: Archetype) => void;
  /** Go back to the measurements; without it the button is not shown. */
  onReviewProfile?: () => void;
  onDismiss: () => void;
};

/**
 * S43: the reduce-fat direction is not applied to this profile. It explains (the reviewed copy of health.ts, never
 * a judgement of the person) and offers the two directions that are; there is no way to confirm the refused one.
 * Mount it only while it is open.
 */
export function SafetySheet({ onChoose, onReviewProfile, onDismiss }: Props) {
  const copy = healthVi.blockedArchetype;
  return (
    <BottomSheet title={copy.title} onDismiss={onDismiss}>
      <AppText variant="secondary">{copy.subtitle}</AppText>
      <Card tone="soft" style={styles.card}>
        <Icon name="ShieldCheck" size={40} />
        <AppText variant="title">{copy.cardTitle}</AppText>
        <AppText variant="secondary">{copy.body}</AppText>
      </Card>
      <View style={styles.actions}>
        {copy.directions.map(direction => (
          <Button key={direction.archetype} label={vi.chooseDirection(direction.label)} onPress={() => onChoose(direction.archetype)} />
        ))}
        {onReviewProfile ? <Button variant="secondary" label={vi.reviewProfile} onPress={onReviewProfile} /> : null}
      </View>
      <AppText variant="caption">{copy.footer}</AppText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12 },
  actions: { gap: 12, marginVertical: 16 },
});
