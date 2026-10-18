import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { PET_STAGES } from '../../../domain/pet.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/pet';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Icon } from '../../shared/ui/Icon';
import { ProgressBar } from '../../shared/ui/LevelStrip';
import { Mam } from '../../shared/ui/mam/Mam';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useKnownPet } from '../shop/api';
import { mamSkinOf } from '../shop/themePreview';
import { growthText } from './PetScreen';

const THUMB = 56;

/** S68: the five stages in order, which are behind, which is now, which is ahead. Growth never goes backwards. */
export function PetStagesScreen({ navigation }: ScreenProps<'PetStages'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const { query, pet } = useKnownPet();
  const header = { title: vi.stagesTitle, subtitle: vi.stagesSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!pet) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }
  return (
    <Screen {...header}>
      <View style={styles.list}>
        {PET_STAGES.map(({ stage, sizeXp }, index) => {
          const state: vi.StageState = index < pet.stageIndex ? 'past' : index === pet.stageIndex ? 'current' : 'next';
          const current = state === 'current';
          return (
            <View
              key={stage}
              accessible={!current}
              accessibilityLabel={current ? undefined : vi.stageRowLabel(vi.stageName[stage], state, vi.stageSize(sizeXp))}
              accessibilityState={{ selected: current }}
              style={[styles.row, { backgroundColor: current ? palette.soft : palette.white, borderColor: palette.line }, !current && styles.outlined]}
            >
              {/* Stages ahead are drawn paler and also say so in words: never the tint alone. */}
              <View style={[styles.thumb, state === 'next' && styles.ahead]}>
                <Mam stage={stage} mood="NEUTRAL" skin={mamSkinOf(pet.skinCode)} size={THUMB} decorative />
              </View>
              <View style={styles.text}>
                <AppText weight="semibold" color={state === 'next' ? 'muted' : 'ink'}>
                  {vi.stageName[stage]}
                </AppText>
                <AppText variant="caption" weight="semibold" color={current ? 'primary' : 'muted'}>
                  {vi.stageState[state]}
                </AppText>
                <AppText variant="caption">{vi.stageSize(sizeXp)}</AppText>
                {/* motion: stage-path (static: the bar is drawn at its value) */}
                {current ? <ProgressBar value={pet.growthPercent} max={100} label={growthText(pet)} track="white" /> : null}
              </View>
              {state === 'past' ? <Icon name="CircleCheck" /> : state === 'next' ? <Icon name="Lock" color={palette.muted} /> : null}
            </View>
          );
        })}
      </View>
      <AppText variant="secondary">{vi.stagesFooter}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: radius.surface, padding: 16, minHeight: 80 },
  thumb: { width: THUMB, height: THUMB },
  ahead: { opacity: 0.45 },
  outlined: { borderWidth: 1 },
  text: { flex: 1, gap: 2 },
});
