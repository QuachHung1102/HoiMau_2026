import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { ShopItem } from '../../../domain/contract/content.ts';
import type { PetStage } from '../../../domain/types.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/shop';
import { failureText } from '../../shared/i18n/vi/sync';
import { motion } from '../../shared/motion/motion';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { radius } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { OwnedChip } from '../../shared/ui/Badges';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { Mam } from '../../shared/ui/mam/Mam';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/States';
import { useMe } from '../auth/api';
import { useEquip, usePurchase, useShop } from './api';
import { mamSkinOf, samplePalette, themePalette } from './themePreview';

const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A refusal said in place, by its code: the server's own text is never shown. */
function refusalText(code: string, details?: Record<string, unknown>) {
  if (code === 'ITEM_LOCKED_LEVEL') {
    const level = asNumber(details?.minLevel);
    return level === undefined ? vi.notBought : vi.lockedLevel(level);
  }
  return vi.refusal[code] ?? (code === 'NETWORK' || code === 'TIMEOUT' ? failureText(code) : `${vi.notBought} ${failureText(code)}`);
}

/** What the item looks like: a sample card in the theme's own colours, Mầm wearing the skin, or the badge. */
function Preview({ item, stage }: { item: ShopItem; stage: PetStage }) {
  if (item.kind === 'THEME') {
    const colors = themePalette(item.assetKey);
    if (colors) {
      const sample = samplePalette(colors);
      return (
        <View style={[styles.preview, { backgroundColor: sample.bg, borderColor: sample.line }]}>
          <View style={[styles.sample, { backgroundColor: sample.soft }]}>
            <AppText variant="title" style={{ color: sample.primary }}>
              {vi.sampleTitle}
            </AppText>
            <AppText variant="secondary" style={{ color: sample.ink }}>
              {vi.sampleBody}
            </AppText>
            <View testID="theme-sample-button" style={[styles.sampleButton, { backgroundColor: sample.primary }]}>
              <AppText weight="semibold" style={{ color: sample.white }}>
                {vi.sampleAction}
              </AppText>
            </View>
          </View>
        </View>
      );
    }
  }
  return (
    <Card tone="soft" style={styles.picture}>
      {item.kind === 'PET_SKIN' ? <Mam stage={stage} mood="NEUTRAL" skin={mamSkinOf(item.assetKey)} size={160} decorative /> : <Icon name="Award" size={72} />}
    </Card>
  );
}

/**
 * The item pops when the server has confirmed the purchase; under reduced motion it is simply there.
 * ponytail: the sheen and the turning stamp of the catalog entry are left out (the chip below appears at once).
 */
function UnlockPop({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [pop] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) return;
    // motion: purchase-unlock
    const run = Animated.timing(pop, { toValue: 1, duration: motion.durationsMs.celebration, easing: Easing.bezier(...motion.springs.pop.webApprox), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [reduced, pop]);
  const scale = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.96, 1.03, 1] });
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

/**
 * S40 (look first, then confirm), S71 (not enough coins), S72 (bought: the server's balance, use it now). The coins and
 * the inventory change on this screen only after the server has answered; every refusal is explained here.
 */
export function ShopItemScreen({ navigation, route }: ScreenProps<'ShopItem'>) {
  const focused = useIsFocused();
  const query = useShop();
  const me = useMe().data;
  const [buy, buying] = usePurchase();
  const [equip, equipping] = useEquip();
  const [bought, setBought] = useState<{ coin: number; item: ShopItem } | null>(null);
  const [refused, setRefused] = useState<{ code: string; details?: Record<string, unknown> } | null>(null);
  const [notApplied, setNotApplied] = useState<string | null>(null);
  const shop = query.data;
  const header = { onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  if (!shop) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? <ErrorState message={failureText(query.error instanceof ApiError ? query.error.code : '')} onRetry={() => query.refetch()} /> : <LoadingState active={focused} />}
      </Screen>
    );
  }
  const item = bought?.item ?? shop.items.find(candidate => candidate.code === route.params.code);
  if (!item) {
    return (
      <Screen {...header}>
        <EmptyState title={vi.missingItemTitle} body={vi.missingItemBody} primary={{ label: vi.backToShop, onPress: () => navigation.navigate('Shop') }} />
      </Screen>
    );
  }

  const confirm = async () => {
    setRefused(null);
    const outcome = await buy(item.code);
    if (!outcome) return;
    if (outcome.state === 'done') {
      setBought(outcome.result);
      return;
    }
    setRefused({ code: outcome.code, details: outcome.details });
    // The server answered: what the screen shows is read again from it. A lost connection has nothing new to read.
    if (outcome.code !== 'NETWORK' && outcome.code !== 'TIMEOUT') query.refetch();
  };
  const equipNow = async () => {
    setNotApplied(null);
    const outcome = await equip(item.code);
    if (!outcome) return;
    if (outcome.state === 'done') navigation.navigate('Inventory');
    else setNotApplied(vi.notApplied);
  };

  const title = { title: vi.itemTitle(item.kind, item.name) };
  const stage = me?.pet?.stage ?? 'EGG';
  const offline = refused !== null && (refused.code === 'NETWORK' || refused.code === 'TIMEOUT');
  const notice = refused ? <InlineError message={refusalText(refused.code, refused.details)} action={offline ? { label: retry, onPress: confirm } : undefined} /> : null;

  // S72: the server confirmed the purchase (or the item is the person's already).
  if (bought || item.owned) {
    return (
      <Screen {...header} title={vi.unlocked} subtitle={bought ? vi.coinLeft(bought.coin) : undefined}>
        {bought ? (
          <UnlockPop>
            <Preview item={item} stage={stage} />
          </UnlockPop>
        ) : (
          <Preview item={item} stage={stage} />
        )}
        <AppText variant="title" accessibilityRole="header">
          {vi.isYours(item.name)}
        </AppText>
        <View style={styles.row}>
          <OwnedChip equipped={item.equipped} />
        </View>
        {notice}
        {notApplied ? <InlineError message={notApplied} action={{ label: retry, onPress: equipNow }} /> : null}
        <Button label={vi.useNow} loading={equipping} onPress={equipNow} />
        <Button variant="secondary" label={vi.backToShop} onPress={() => navigation.navigate('Shop')} />
      </Screen>
    );
  }

  // S71: known before pressing (the balance is the server's) or from INSUFFICIENT_COINS (its own numbers).
  const price = asNumber(refused?.details?.price);
  const coin = asNumber(refused?.details?.coin);
  const missing = refused?.code === 'INSUFFICIENT_COINS' && price !== undefined && coin !== undefined ? price - coin : item.priceCoin - shop.coin;
  if (refused?.code === 'INSUFFICIENT_COINS' || (!item.locked && missing > 0)) {
    return (
      <Screen {...header} {...title} subtitle={vi.itemSubtitle[item.kind]}>
        <Preview item={item} stage={stage} />
        <AppText>{vi.priceShort(item.priceCoin, shop.coin)}</AppText>
        <Card tone="soft">
          <AppText accessibilityRole="alert">{vi.shortBy(Math.max(missing, 1))}</AppText>
        </Card>
        <Button variant="secondary" label={vi.seeQuests} onPress={() => navigation.navigate('QuestBoard')} />
      </Screen>
    );
  }

  // S40, or the item the level does not open yet.
  return (
    <Screen {...header} {...title} subtitle={vi.itemSubtitle[item.kind]}>
      <Preview item={item} stage={stage} />
      {item.kind === 'THEME' ? (
        <AppText variant="title" accessibilityRole="header">
          {vi.themeTagline}
        </AppText>
      ) : null}
      <AppText>{vi.priceLine(item.priceCoin, shop.coin)}</AppText>
      {item.locked ? <InlineError message={vi.lockedLevel(item.minLevel)} /> : notice}
      {item.locked ? null : <Button label={vi.confirmBuy} loading={buying} onPress={confirm} />}
      <Button variant="secondary" label={vi.notBuying} onPress={navigation.goBack} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { borderRadius: radius.surface, borderWidth: 1, padding: 20, marginVertical: 8 },
  sample: { borderRadius: radius.surface, padding: 16, gap: 8 },
  sampleButton: { borderRadius: radius.button, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  picture: { alignItems: 'center', marginVertical: 8 },
  row: { flexDirection: 'row' },
});
