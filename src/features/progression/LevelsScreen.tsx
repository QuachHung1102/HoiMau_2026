import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TitleKey } from '../../../domain/contract/common.ts';
import type { PerkCode } from '../../../domain/contract/core.ts';
import { PERKS } from '../../../domain/economy.ts';
import { MAX_SEEDED_LEVEL, titleKeyForLevel } from '../../../domain/progression.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { levelTitle } from '../../shared/i18n/vi/pet';
import * as vi from '../../shared/i18n/vi/progression';
import * as shopVi from '../../shared/i18n/vi/shop';
import { failureText } from '../../shared/i18n/vi/sync';
import { levelTitleText } from '../../shared/i18n/vi/today';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius, spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { ProgressBar } from '../../shared/ui/LevelStrip';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { usePerks } from '../shop/api';
import { PerkSheet } from '../shop/PerkSheet';
import { useProgression } from './api';

type Range = { key: TitleKey; from: number; to: number | null };
/** The five titles with the levels they cover, read off `titleKeyForLevel` so that there is one source for the thresholds. */
const RANGES: readonly Range[] = (() => {
  const out: Range[] = [];
  for (let level = 1; level <= MAX_SEEDED_LEVEL; level++) {
    const key = titleKeyForLevel(level);
    const last = out[out.length - 1];
    if (last?.key === key) last.to = level;
    else out.push({ key, from: level, to: level });
  }
  out[out.length - 1].to = null; // the last title has no end
  return out;
})();

const PERK_ICONS: Record<keyof typeof PERKS, IconName> = { MEAL_SWAP_PLUS: 'Utensils', TICKET_CAP_PLUS: 'Ticket', THEME_UNLOCK: 'Palette' };

function TitleRow({ range, current }: { range: Range; current: boolean }) {
  const palette = useTheme();
  const text = vi.titleRange(levelTitleText[range.key], range.from, range.to);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={current ? `${text}. ${vi.currentTitle}` : text}
      accessibilityState={{ selected: current }}
      style={[styles.titleRow, { backgroundColor: current ? palette.soft : palette.white }]}
    >
      <AppText weight={current ? 'semibold' : 'regular'} color={current ? 'primary' : 'ink'} style={styles.fill}>
        {text}
      </AppText>
      {/* The current one says so in words and with a check, not by its tint alone. */}
      {current ? (
        <View style={styles.current}>
          <Icon name="Check" size={18} />
          <AppText variant="caption" weight="semibold" color="primary">
            {vi.currentTitle}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** S46: the level and the XP to the next one, the five titles, and the perks: each opens a sheet where it can be unlocked. */
export function LevelsScreen({ navigation }: ScreenProps<'Levels'>) {
  const focused = useIsFocused();
  const query = useProgression();
  const perks = usePerks().data?.perks;
  const [open, setOpen] = useState<PerkCode | null>(null);
  const progression = query.data;
  const header = { title: vi.levelsTitle, subtitle: vi.levelsSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!progression) {
    const code = query.error instanceof ApiError ? query.error.code : '';
    return (
      <Screen {...header}>
        <View style={styles.section}>
          {query.isError && !query.isFetching ? <ErrorState message={failureText(code)} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
        </View>
      </Screen>
    );
  }
  return (
    <Screen {...header}>
      <View style={styles.section}>
        <Card tone="soft">
          <Icon name="Award" size={40} />
          <AppText variant="headline" accessibilityRole="header">
            {levelTitle(progression.level, levelTitleText[progression.titleKey])}
          </AppText>
          <AppText variant="secondary">{vi.levelsIntro}</AppText>
          <ProgressBar
            value={progression.xpIntoLevel}
            max={progression.xpForNextLevel}
            label={vi.xpToNext(progression.xpIntoLevel, progression.xpForNextLevel, progression.level + 1)}
            track="white"
          />
          <AppText variant="caption" weight="semibold" color="primary">
            {vi.perkPoints(progression.perkPointsAvailable)}
          </AppText>
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="title" accessibilityRole="header">
          {vi.titlesHeading}
        </AppText>
        <View style={styles.titles}>
          {RANGES.map(range => (
            <TitleRow key={range.key} range={range} current={range.key === progression.titleKey} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        {(Object.keys(vi.perkRows) as (keyof typeof PERKS)[]).map(code => {
          // An unlocked perk that can be used once says so; a repeatable one (a theme) keeps its cost.
          const opened = perks?.some(perk => perk.code === code && perk.unlocked && !perk.repeatable);
          return <ListRow key={code} icon={PERK_ICONS[code]} {...vi.perkRows[code]} status={opened ? shopVi.perkOpened : vi.perkCost(PERKS[code].cost)} onPress={() => setOpen(code)} />;
        })}
        {open ? <PerkSheet code={open} onDismiss={() => setOpen(null)} /> : null}
      </View>
      <AppText style={styles.section}>{vi.levelsFooter}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // `Screen` puts 8 between blocks; a section starts further down.
  section: { marginTop: spacing.section - 8 },
  titles: { gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 14, minHeight: 48 },
  current: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
