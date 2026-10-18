import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ShopItem } from '../../../domain/contract/content.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/shop';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { LockChip, OwnedChip } from '../../shared/ui/Badges';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon, type IconName } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, EmptyState, LoadingState } from '../../shared/ui/States';
import { SegmentedControl } from '../../shared/ui/Toggles';
import { useShop } from './api';

/** The glyph of an item: its theme, its skin, or a medal. */
export const itemIcon = (item: Pick<ShopItem, 'kind' | 'assetKey'>): IconName =>
  item.kind === 'THEME' ? (item.assetKey === 'forest' ? 'TreePine' : item.assetKey === 'sky' ? 'CloudSun' : 'Palette') : item.kind === 'PET_SKIN' ? (item.assetKey === 'fox' ? 'PawPrint' : 'Sprout') : 'Award';

function ItemCard({ item, onOpen }: { item: ShopItem; onOpen: () => void }) {
  const palette = useTheme();
  const line = vi.itemLine(item.kind, item.priceCoin, item.isDefault);
  return (
    <View style={styles.cell}>
      {/* Exactly one of: owned (in use or not), locked by level, or open to look at. */}
      <Card style={styles.card}>
        <Icon name={itemIcon(item)} size={40} color={palette.primary} />
        <AppText variant="title" style={styles.name}>
          {item.name}
        </AppText>
        <AppText variant="caption">{line}</AppText>
        {item.owned ? (
          <OwnedChip equipped={item.equipped} />
        ) : item.locked ? (
          <>
            <LockChip minLevel={item.minLevel} />
            <AppText variant="caption">{vi.lockedAt(item.minLevel)}</AppText>
            <Button variant="secondary" label={vi.notYet} disabled />
          </>
        ) : (
          <Button variant="secondary" label={vi.view} accessibilityLabel={`${vi.view} ${item.name}`} onPress={onOpen} />
        )}
      </Card>
    </View>
  );
}

/** S23: the coin balance, the items by kind, and the one thing each can do. Cosmetic only: nothing here sells XP, streaks or an edge. */
export function ShopScreen({ navigation }: ScreenProps<'Shop'>) {
  const focused = useIsFocused();
  const query = useShop();
  const [kind, setKind] = useState<vi.Kind>('THEME');
  const shop = query.data;
  const header = { title: vi.shopTitle, subtitle: vi.shopSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!shop) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }
  const items = shop.items.filter(item => item.kind === kind);
  return (
    <Screen {...header}>
      <Card tone="soft">
        <View style={styles.coin}>
          <Icon name="Coins" size={28} />
          <View style={styles.name}>
            <AppText weight="semibold">{vi.coinCardTitle}</AppText>
            <AppText variant="caption">{vi.coinCardLine(shop.coin)}</AppText>
          </View>
        </View>
      </Card>
      <SegmentedControl accessibilityLabel={vi.kindTabsLabel} options={vi.kindTabs} value={kind} onChange={value => setKind(value as vi.Kind)} />
      {items.length === 0 ? (
        <EmptyState title={vi.kindEmptyTitle} body={vi.kindEmptyBody} />
      ) : (
        <View style={styles.grid}>
          {items.map(item => (
            <ItemCard key={item.code} item={item} onOpen={() => navigation.navigate('ShopItem', { code: item.code })} />
          ))}
        </View>
      )}
      <AppText variant="secondary">{vi.shopFooter}</AppText>
      <Button variant="secondary" label={vi.openInventory} onPress={() => navigation.navigate('Inventory')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  coin: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  name: { flex: 1, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 8 },
  cell: { width: '47.5%' },
  card: { flex: 1, borderRadius: radius.surface, alignItems: 'flex-start' },
});
