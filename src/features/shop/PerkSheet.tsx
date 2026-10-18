import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PerkCode } from '../../../domain/contract/core.ts';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/shop';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { RadioRow } from '../../shared/ui/Toggles';
import { usePerks, useShop, useUnlockPerk } from './api';

/** Why a perk was refused, by its code (the server's own text is never shown). */
function refusalText(code: string, details?: Record<string, unknown>) {
  if (code === 'PERK_POINTS_INSUFFICIENT') return vi.earnPoints;
  if (code === 'ITEM_LOCKED_LEVEL') return typeof details?.minLevel === 'number' ? vi.lockedLevel(details.minLevel) : vi.perkNotDone;
  return vi.refusal[code] ?? `${vi.perkNotDone} ${failureText(code)}`;
}

/**
 * What a perk does, what it costs and the points there are, with "Mở khóa" (S46). Points are the server's
 * (`GET /perks`) and change here only after its answer; `THEME_UNLOCK` first asks which theme.
 */
export function PerkSheet({ code, onDismiss }: { code: PerkCode; onDismiss: () => void }) {
  const perksQuery = usePerks();
  const shopQuery = useShop();
  const [unlock, unlocking] = useUnlockPerk();
  const [theme, setTheme] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ code: string; details?: Record<string, unknown> } | null>(null);
  const [openedTheme, setOpenedTheme] = useState<string | null>(null);
  const perks = perksQuery.data;
  const perk = perks?.perks.find(item => item.code === code);
  const themes = (shopQuery.data?.items ?? []).filter(item => item.kind === 'THEME' && !item.owned);
  const chosen = themes.find(item => item.code === theme && !item.locked);

  const confirm = async () => {
    setRefused(null);
    const outcome = await unlock(code, code === 'THEME_UNLOCK' ? chosen?.code : undefined);
    if (!outcome) return;
    if (outcome.state === 'done') {
      setOpenedTheme(chosen?.name ?? null);
      setTheme(null);
      return;
    }
    setRefused({ code: outcome.code, details: outcome.details });
    // The server answered: points and ownership on screen are read again from it. A lost connection has nothing new.
    if (outcome.code !== 'NETWORK' && outcome.code !== 'TIMEOUT') {
      perksQuery.refetch();
      shopQuery.refetch();
    }
  };

  let body;
  if (!perks || !perk) {
    body =
      perksQuery.isError && !perksQuery.isFetching ? (
        <ErrorState message={vi.perkLoadFailed} onRetry={() => perksQuery.refetch()} />
      ) : (
        <LoadingState />
      );
  } else {
    const done = perk.unlocked && !perk.repeatable;
    const short = perk.cost > perks.pointsAvailable;
    const offline = refused?.code === 'NETWORK' || refused?.code === 'TIMEOUT';
    body = (
      <>
        <AppText>{vi.perkDoes[code]}</AppText>
        <AppText weight="semibold">{vi.perkCostLine(perk.cost, perks.pointsAvailable)}</AppText>
        {openedTheme !== null ? (
          <View accessibilityLiveRegion="polite" style={styles.done}>
            <Icon name="Check" size={20} />
            <AppText weight="semibold" color="primary">
              {vi.themeOpened(openedTheme)}
            </AppText>
          </View>
        ) : null}
        {done ? (
          <View accessibilityLiveRegion="polite" style={styles.done}>
            <Icon name="Check" size={20} />
            <AppText weight="semibold" color="primary">
              {vi.perkOpened}
            </AppText>
          </View>
        ) : (
          <>
            {code === 'THEME_UNLOCK' ? (
              themes.length === 0 ? (
                <AppText variant="secondary">{vi.noThemeLeft}</AppText>
              ) : (
                <View accessibilityRole="radiogroup" accessibilityLabel={vi.pickTheme}>
                  <AppText weight="semibold">{vi.pickTheme}</AppText>
                  {themes.map(item => (
                    <RadioRow key={item.code} label={item.name} description={item.locked ? vi.lockedAt(item.minLevel) : undefined} selected={theme === item.code} disabled={item.locked} onPress={() => setTheme(item.code)} />
                  ))}
                </View>
              )
            ) : null}
            {refused ? <InlineError message={refusalText(refused.code, refused.details)} action={offline ? { label: retry, onPress: confirm } : undefined} /> : null}
            {short ? (
              <DisabledReason reason={vi.earnPoints} />
            ) : (
              <Button label={vi.unlockPerk} loading={unlocking} disabled={code === 'THEME_UNLOCK' && !chosen} onPress={confirm} />
            )}
          </>
        )}
      </>
    );
  }
  return (
    <BottomSheet title={vi.perkSheetTitle[code]} onDismiss={onDismiss}>
      {body}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  done: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
});
