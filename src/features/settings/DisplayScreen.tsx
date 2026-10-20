import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import type { Settings } from '../../../domain/contract/core.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Card, ListRow } from '../../shared/ui/Card';
import { Mam } from '../../shared/ui/mam/Mam';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { SegmentedControl, Switch } from '../../shared/ui/Toggles';
import { useInventory, useKnownPet } from '../shop/api';
import { usePatchSettings, useSettings } from './api';

const PREVIEW = 128;

/**
 * S79: how much the app moves, whether the streak count shows on Hôm nay, and which theme is in use. The motion choice is applied
 * to the whole app at once (`MotionFromSettings`), so the Mầm below is the preview: it moves only when motion is effectively on.
 */
export function DisplayScreen({ navigation }: ScreenProps<'Display'>) {
  const focused = useIsFocused();
  const query = useSettings();
  const patch = usePatchSettings();
  const { pet } = useKnownPet();
  const theme = useInventory().data?.items.find(item => item.kind === 'THEME' && item.equipped);
  const settings = query.data;
  const header = { title: vi.displayTitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!settings) {
    return (
      <Screen {...header}>
        <View style={styles.block}>
          {query.isError && !query.isFetching ? (
            <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} />
          ) : (
            <LoadingState active={focused} />
          )}
        </View>
      </Screen>
    );
  }
  return (
    <Screen {...header}>
      <AppText variant="title" accessibilityRole="header" style={styles.heading}>
        {vi.motionHeading}
      </AppText>
      <SegmentedControl
        accessibilityLabel={vi.motionHeading}
        options={vi.motionOptions}
        value={settings.motion}
        onChange={motion => motion !== settings.motion && patch({ motion: motion as Settings['motion'] })}
      />
      <Card tone="soft" style={styles.preview}>
        {/* The words beside it say the same, so it is hidden from screen readers; whether it moves is the motion setting's business. */}
        <Mam stage={pet?.stage ?? 'HATCHLING'} mood={pet?.mood ?? 'HAPPY'} skin={pet?.skinCode === 'SKIN_FOX' ? 'fox' : undefined} size={PREVIEW} animation="idle" active={focused} decorative />
      </Card>
      <AppText variant="secondary">{vi.motionNote}</AppText>
      <AppText variant="title" accessibilityRole="header" style={styles.heading}>
        {vi.streakHeading}
      </AppText>
      <Switch label={vi.hideStreakLabel} value={settings.hideStreak} onChange={hideStreak => patch({ hideStreak })} />
      <AppText variant="secondary">{vi.hideStreakNote}</AppText>
      <AppText variant="title" accessibilityRole="header" style={styles.heading}>
        {vi.themeHeading}
      </AppText>
      <ListRow icon="Palette" title={theme?.name ?? vi.themeOpen} description={theme ? vi.themeInUse : undefined} onPress={() => navigation.navigate('Inventory')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.section - 8 },
  heading: { marginTop: spacing.section - 8 },
  preview: { alignItems: 'center', justifyContent: 'center', minHeight: 160 },
});
