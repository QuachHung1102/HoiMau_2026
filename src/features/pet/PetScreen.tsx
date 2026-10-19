import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import type { Pet } from '../../../domain/contract/core.ts';
import type { PetStage } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/pet';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { ProgressBar } from '../../shared/ui/LevelStrip';
import { Mam } from '../../shared/ui/mam/Mam';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { mamSkinOf } from '../shop/themePreview';
import { useKnownPet } from '../shop/api';

/** "64% tới Chồi non"; the last stage has nothing to grow into. */
export const growthText = (pet: Pick<Pet, 'growthPercent' | 'nextStage'>) =>
  pet.nextStage === null ? vi.grownUp : vi.growthLine(pet.growthPercent, vi.stageName[pet.nextStage]);

/** The stage chip of S22 / S70: an icon and the stage's name. */
export function StageChip({ stage }: { stage: PetStage }) {
  const palette = useTheme();
  return (
    <View accessible accessibilityLabel={vi.stageName[stage]} style={[styles.chip, { backgroundColor: palette.soft }]}>
      <Icon name="Sprout" size={16} />
      <AppText variant="caption" weight="semibold" color="primary">
        {vi.stageName[stage]}
      </AppText>
    </View>
  );
}

/**
 * S22, and S70 when Mầm is tired: the two independent axes of Mầm, its stage and growth (earned, never lost) and its
 * mood (it follows the last days), both as the server says them.
 */
export function PetScreen({ navigation }: ScreenProps<'Pet'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const { query, pet } = useKnownPet();
  const header = { title: vi.petTitle, subtitle: vi.petSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!pet) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }
  const tired = pet.mood === 'TIRED';
  return (
    <Screen {...header}>
      <View style={styles.chipRow}>
        <StageChip stage={pet.stage} />
      </View>
      {/* motion: progress-fill (ProgressBar) */}
      <ProgressBar value={pet.growthPercent} max={100} label={growthText(pet)} />
      <View style={[styles.stage, { backgroundColor: palette.soft }]}>
        {/* decorative: the mood line under it says the same. motion: mam-idle, mam-tired (both live in Mam) */}
        <Mam stage={pet.stage} mood={pet.mood} skin={mamSkinOf(pet.skinCode)} size={176} animation="idle" decorative active={focused} />
      </View>
      <AppText variant="headline" accessibilityRole="header">
        {vi.moodText[pet.mood]}
      </AppText>
      <AppText variant="body" style={styles.note}>
        {tired ? vi.tiredNote : vi.petCare}
      </AppText>
      <ListRow icon="Sprout" {...vi.growthRow} onPress={() => navigation.navigate('PetStages')} />
      {tired ? (
        <Button label={vi.tiredAction} onPress={() => navigation.navigate('QuestBoard')} />
      ) : (
        <>
          <Button label={vi.changeLook} onPress={() => navigation.navigate('Inventory')} />
          <Button variant="secondary" label={vi.visitShop} onPress={() => navigation.navigate('Shop')} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.button },
  stage: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.surface, paddingVertical: 28, marginVertical: 8 },
  note: { marginTop: 8, marginBottom: 8 },
});
