import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ShopItem } from '../../../domain/contract/content.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/shop';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { InlineError, DisabledReason } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { RadioRow } from '../../shared/ui/Toggles';
import { useEquip, useInventory } from './api';

const KINDS: readonly vi.Kind[] = ['THEME', 'PET_SKIN', 'BADGE'];

const rowText = (item: ShopItem) => (item.equipped ? vi.inUse : item.kind === 'BADGE' ? vi.earnedBadge : vi.ownedLine);

/**
 * S24: what is owned, by kind (the defaults and the earned badges are in it), and which one is in use. Choosing a row
 * changes nothing; "Áp dụng diện mạo" asks the server, and the palette follows `me.appearance` once it is read again.
 */
export function InventoryScreen({ navigation }: ScreenProps<'Inventory'>) {
  const focused = useIsFocused();
  const query = useInventory();
  const [equip, equipping] = useEquip();
  // One choice per kind: each group is its own single-choice list.
  const [chosen, setChosen] = useState<Partial<Record<vi.Kind, string>>>({});
  const [failed, setFailed] = useState<{ text: string; offline: boolean } | null>(null);
  const [applied, setApplied] = useState(false);
  const items = query.data?.items;
  const header = { title: vi.inventoryTitle, subtitle: vi.inventorySubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!items) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }
  // What was picked and is not what is in use already; each is one equip, one after the other.
  const picks = items.filter(item => chosen[item.kind] === item.code && !item.equipped);
  const apply = async () => {
    setFailed(null);
    setApplied(false);
    for (const pick of picks) {
      const outcome = await equip(pick.code);
      if (!outcome) return;
      if (outcome.state !== 'done') {
        const offline = outcome.code === 'NETWORK' || outcome.code === 'TIMEOUT';
        setFailed({ text: vi.refusal[outcome.code] ?? `${vi.notApplied} ${failureText(outcome.code)}`, offline });
        // A refusal means the list on screen is not the server's: read it again. A lost connection is no answer, so it can be retried.
        if (!offline) query.refetch();
        return;
      }
      setChosen(current => ({ ...current, [pick.kind]: undefined }));
    }
    setApplied(true);
  };
  const ready = picks.length > 0;
  return (
    <Screen {...header}>
      {KINDS.map(kind => {
        const group = items.filter(item => item.kind === kind);
        const selected = chosen[kind] ?? group.find(item => item.equipped)?.code;
        return (
          <View key={kind} style={styles.group}>
            <AppText variant="title" accessibilityRole="header">
              {vi.groupName[kind]}
            </AppText>
            {group.length === 0 ? (
              kind === 'BADGE' && <View style={styles.none}>
                <AppText weight="semibold">{vi.noBadgesTitle}</AppText>
                <AppText variant="secondary">{vi.noBadgesBody}</AppText>
              </View>
            ) : (
              <View accessibilityRole="radiogroup" accessibilityLabel={vi.groupName[kind]}>
                {group.map(item => (
                  <RadioRow key={item.code} label={item.name} description={rowText(item)} selected={selected === item.code} onPress={() => setChosen(current => ({ ...current, [kind]: item.code }))} />
                ))}
              </View>
            )}
          </View>
        );
      })}
      {failed ? <InlineError message={failed.text} action={failed.offline ? { label: retry, onPress: apply } : undefined} /> : null}
      {applied ? <AppText accessibilityLiveRegion="polite" weight="semibold" color="primary">{vi.applied}</AppText> : null}
      <Button label={vi.applyLook} loading={equipping} disabled={!ready} onPress={apply} />
      {ready ? null : <DisabledReason reason={vi.pickAnother} />}
      <AppText variant="secondary">{vi.inventoryFooter}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 4, marginTop: 8 },
  none: { gap: 4, paddingVertical: 8 },
});
