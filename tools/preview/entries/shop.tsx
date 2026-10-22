import type { Inventory, PurchaseResult, Shop, ShopItem } from '../../../domain/contract/content.ts';
import type { Perks } from '../../../domain/contract/core.ts';
import { SHOP_ITEMS } from '../../../server/content/shopItems.ts';
import { cumulativeXpForLevel, titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { inventoryKey, perksKey, shopKey } from '../../../src/features/shop/api';
import { progressionKey } from '../../../src/features/progression/api';
import * as vi from '../../../src/shared/i18n/vi/shop';
import type { Entries } from '../harness';
import { petOf } from './pet';
import { PressWhen } from './guild';
import { app, meOf, pathOf, respond } from './today';

// The items are the server's own content (server/content/shopItems.ts); what is owned, equipped or locked is worked out
// here the way the server's read model does it (default items owned, level against `minLevel`).
type Kind = ShopItem['kind'];
const KINDS: Kind[] = ['THEME', 'PET_SKIN', 'BADGE'];
function itemsOf(owned: string[] = [], equipped: Partial<Record<Kind, string>> = {}, level = 5): ShopItem[] {
  return [...SHOP_ITEMS]
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || Number(b.isDefault) - Number(a.isDefault) || a.minLevel - b.minLevel || a.priceCoin - b.priceCoin || (a.code < b.code ? -1 : 1))
    .map(item => ({ ...item, owned: item.isDefault || owned.includes(item.code), equipped: equipped[item.kind] === item.code || (item.isDefault && equipped[item.kind] === undefined), locked: level < item.minLevel }));
}
const shopOf = (coin: number, owned?: string[], equipped?: Partial<Record<Kind, string>>, level = 5): Shop => ({ coin, level, items: itemsOf(owned, equipped, level).filter(item => item.purchasable || item.isDefault) });
const inventoryOf = (owned?: string[], equipped?: Partial<Record<Kind, string>>): Inventory => ({ items: itemsOf(owned, equipped).filter(item => item.owned) });
const perksOf = (pointsAvailable: number): Perks => ({
  pointsAvailable,
  perks: [
    { code: 'MEAL_SWAP_PLUS', cost: 2, unlocked: false, repeatable: false },
    { code: 'TICKET_CAP_PLUS', cost: 3, unlocked: false, repeatable: false },
    { code: 'THEME_UNLOCK', cost: 1, unlocked: false, repeatable: true },
  ],
});
const FOREST = 'THEME_FOREST';
const FOX = 'SKIN_FOX';

const byText = (role: string, text: string) => () => Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find(node => node.textContent?.includes(text)) ?? null;

const seeded = (coin: number, owned?: string[], equipped?: Partial<Record<Kind, string>>, level = 5): [readonly unknown[], unknown][] => [
  [shopKey, shopOf(coin, owned, equipped, level)],
  [inventoryKey, inventoryOf(owned, equipped)],
];

/** The profile at level `level` with `coin` coins and `points` perk points (the numbers of the shop come from `seeded`). */
const meAt = (coin: number, points = 0, level = 5, appearance = { themeCode: 'THEME_DEFAULT', petSkinCode: 'SKIN_DEFAULT', badgeCode: null as string | null }) => {
  const base = meOf(340, coin);
  return {
    ...base,
    pet: petOf({ skinCode: appearance.petSkinCode }),
    appearance,
    progression: base.progression && {
      ...base.progression,
      level,
      titleKey: titleKeyForLevel(level),
      xp: cumulativeXpForLevel(level) + 340,
      xpForNextLevel: xpRequiredForLevel(level),
      perkPointsAvailable: points,
    },
  };
};

/** A server for the purchase of the forest theme: the answer, and the reads after it. */
const afterPurchase = (url: string, init?: RequestInit) => {
  const path = pathOf(url);
  const owned = [FOREST];
  if (init?.method === 'POST') return respond(200, { coin: 170, item: itemsOf(owned).find(candidate => candidate.code === FOREST) } as PurchaseResult);
  if (path === '/shop') return respond(200, shopOf(170, owned));
  if (path === '/inventory') return respond(200, inventoryOf(owned));
  if (path === '/me') return respond(200, meAt(170));
  if (path === '/progression') return respond(200, meAt(170).progression);
  return respond(404);
};

export const entries: Entries = {
  's23-shop': () => app({ route: 'Shop', me: meAt(250), queries: seeded(250) }),
  's23-shop-skins': () => app({ route: 'Shop', me: meAt(250), queries: seeded(250), extra: <PressWhen find={byText('radio', vi.groupName.PET_SKIN)} /> }),
  's40-shop-item': () => app({ route: 'ShopItem', params: { code: FOREST }, me: meAt(250), queries: seeded(250) }),
  // 120 against 70: 50 short, as the frame says; the price is the server's own content.
  's71-shop-item-short': () => app({ route: 'ShopItem', params: { code: FOX }, me: meAt(70), queries: seeded(70) }),
  // The purchase of frame S40, pressed: the server's answer is 170 coins left.
  's72-shop-item-unlocked': () =>
    app({ route: 'ShopItem', params: { code: FOREST }, me: meAt(250), queries: seeded(250), fetchStub: afterPurchase, extra: <PressWhen find={byText('button', vi.confirmBuy)} /> }),
  's24-inventory': () => app({ route: 'Inventory', me: meAt(250), queries: seeded(250, [FOREST, 'BADGE_STREAK_7']) }),
  // The forest theme is the one in use: the profile says so, and the whole screen is drawn with its palette.
  's24-inventory-forest-theme': () =>
    app({
      route: 'Inventory',
      me: meAt(250, 0, 5, { themeCode: FOREST, petSkinCode: 'SKIN_DEFAULT', badgeCode: null }),
      queries: seeded(250, [FOREST, 'BADGE_STREAK_7'], { THEME: FOREST }),
    }),
  // The sheet of the theme perk: 3 points, and the themes the person does not have yet (the sky waits for level 8).
  's46-perk-sheet': () =>
    app({
      route: 'Levels',
      me: meAt(250, 3),
      queries: [...seeded(250), [perksKey, perksOf(3)], [progressionKey, meAt(250, 3).progression]],
      extra: <PressWhen find={byText('button', vi.perkSheetTitle.THEME_UNLOCK)} />,
    }),
};
