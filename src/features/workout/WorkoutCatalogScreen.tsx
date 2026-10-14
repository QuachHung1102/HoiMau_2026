import { useIsFocused } from '@react-navigation/native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { WorkoutSummary } from '../../../domain/contract/content.ts';
import type { Modality } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { archetypes } from '../../shared/i18n/vi/onboarding';
import { failureText } from '../../shared/i18n/vi/sync';
import * as vi from '../../shared/i18n/vi/workout';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { FilterChip } from '../../shared/ui/Toggles';
import { useMe } from '../auth/api';
import { DURATIONS, EQUIPMENT, SPACES, useWorkoutCatalog, type CatalogFilters } from './api';

export const MODALITY_ICON: Record<Modality, IconName> = { RESISTANCE: 'Dumbbell', CARDIO: 'HeartPulse', HIIT: 'Zap', MOBILITY: 'PersonStanding', BREATHING: 'Wind' };

/** What a person most often has: a quarter of an hour, a room, nothing else. */
const START: CatalogFilters = { duration: 15, space: 'ROOM', equipment: [] };

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="caption" weight="semibold" accessibilityRole="header">
        {title}
      </AppText>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

/**
 * S17: workouts for the time, the space and the equipment a person has. The server filters and orders; the first
 * recommended one is the highlighted card. S48 (nothing matches) is a state of this screen, and is not what a list
 * that could not be loaded looks like.
 */
export function WorkoutCatalogScreen({ navigation }: ScreenProps<'WorkoutCatalog'>) {
  const focused = useIsFocused();
  const palette = useTheme();
  const [filters, setFilters] = useState(START);
  const catalog = useWorkoutCatalog(filters);
  const archetype = useMe().data?.user.archetype;
  const open = (item: WorkoutSummary) => navigation.navigate('WorkoutDetail', { id: item.id });

  // The selection is what the person has: "Không cần" is the empty one, and choosing it clears the others.
  const toggle = (code: string) =>
    setFilters(now => ({ ...now, equipment: EQUIPMENT.filter(item => (item === code ? !now.equipment.includes(item) : now.equipment.includes(item))) }));
  // S48: take a filter away, the equipment first (owning everything filters nothing out), then the space.
  const ownsAll = filters.equipment.length === EQUIPMENT.length;
  const canLoosen = !ownsAll || filters.space !== null;
  const loosen = () => setFilters(now => (now.equipment.length < EQUIPMENT.length ? { ...now, equipment: [...EQUIPMENT] } : { ...now, space: null }));

  const items = catalog.data?.items;
  const featured = items?.find(item => item.recommended);
  const code = catalog.error instanceof ApiError ? catalog.error.code : '';

  let results: ReactNode;
  if (!items) {
    // A list that could not be loaded is an error with a retry, never "nothing matches".
    results = catalog.isError && !catalog.isFetching ? <ErrorState message={failureText(code)} onRetry={() => catalog.refetch()} /> : <LoadingState active={focused} />;
  } else if (items.length === 0) {
    results = (
      <View accessibilityLiveRegion="polite">
        <EmptyState
          illustration={<Icon name="SearchX" size={40} />}
          title={vi.emptyTitle}
          body={vi.emptyBody}
          primary={canLoosen ? { label: vi.clearFilters, onPress: loosen } : undefined}
        />
      </View>
    );
  } else {
    results = (
      <>
        {featured ? (
          <Card tone="primary">
            <Icon name={MODALITY_ICON[featured.modality]} size={32} color={palette.white} />
            <AppText variant="headline" color="white" accessibilityRole="header">
              {featured.name}
            </AppText>
            {archetype ? (
              <View style={[styles.fits, { backgroundColor: palette.white }]}>
                <Icon name="Shield" size={16} />
                <AppText variant="caption" weight="semibold" color="primary">
                  {vi.fitsArchetype(archetypes[archetype].name)}
                </AppText>
              </View>
            ) : null}
            <AppText variant="secondary" color="white">
              {vi.suggested(vi.modalityText[featured.modality])}
            </AppText>
            <AppText variant="caption" color="white">
              {vi.dotted(vi.minutes(featured.durationSec / 60), vi.kcalEstimate(featured.kcalEstimate))}
            </AppText>
            <Button variant="secondary" label={vi.seeGuide} accessibilityLabel={`${vi.seeGuide}: ${featured.name}`} onPress={() => open(featured)} />
          </Card>
        ) : null}
        <View>
          {items
            .filter(item => item !== featured)
            .map(item => (
              <ListRow
                key={item.id}
                icon={MODALITY_ICON[item.modality]}
                title={item.name}
                description={vi.dotted(vi.modalityText[item.modality], vi.kcalEstimate(item.kcalEstimate))}
                onPress={() => open(item)}
              />
            ))}
        </View>
      </>
    );
  }

  return (
    <Screen title={vi.catalogTitle} subtitle={vi.catalogSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <Group title={vi.durationGroup}>
        {DURATIONS.map(duration => (
          <FilterChip key={duration} label={vi.minutes(duration)} selected={filters.duration === duration} onPress={() => setFilters(now => ({ ...now, duration }))} />
        ))}
      </Group>
      <Group title={vi.spaceGroup}>
        {SPACES.map(space => (
          <FilterChip key={space} label={vi.spaceText[space]} selected={filters.space === space} onPress={() => setFilters(now => ({ ...now, space }))} />
        ))}
      </Group>
      <Group title={vi.equipmentGroup}>
        <FilterChip label={vi.noEquipment} selected={filters.equipment.length === 0} onPress={() => setFilters(now => ({ ...now, equipment: [] }))} />
        {EQUIPMENT.map(item => (
          <FilterChip key={item} label={vi.equipmentText[item] ?? item} selected={filters.equipment.includes(item)} onPress={() => toggle(item)} />
        ))}
      </Group>
      <View style={styles.results}>{results}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  results: { gap: 12, marginTop: spacing.section - 8 },
  fits: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.button },
});
