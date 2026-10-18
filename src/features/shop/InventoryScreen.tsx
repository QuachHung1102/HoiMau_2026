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
  const [chosen, setChosen] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
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
  const pick = items.find(item => item.code === chosen);
  const apply = async () => {
    if (!pick) return;
    setFailed(null);
    setApplied(false);
    const outcome = await equip(pick.code);
    if (!outcome) return;
    if (outcome.state === 'done') {
      setChosen(null);
      setApplied(true);
    } else {
      setFailed(vi.refusal[outcome.code] ?? `${vi.notApplied} ${failureText(outcome.code)}`);
      // A refusal means the list on screen is not the server's: read it again.
      if (outcome.code !== 'NETWORK' && outcome.code !== 'TIMEOUT') query.refetch();
    }
  };
  const ready = pick !== undefined && !pick.equipped;
  return (
    <Screen {...header}>
      {KINDS.map(kind => {
        const group = items.filter(item => item.kind === kind);
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
              group.map(item => <RadioRow key={item.code} label={item.name} description={rowText(item)} selected={chosen === item.code} onPress={() => setChosen(item.code)} />)
            )}
          </View>
        );
      })}
      {failed ? <InlineError message={failed} action={{ label: retry, onPress: apply }} /> : null}
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
