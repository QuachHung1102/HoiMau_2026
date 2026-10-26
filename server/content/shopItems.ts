import type { ShopItemSeed } from './types.ts';

// Cosmetic only (R-10.1): no field here can touch XP, streak or guild score.
// Names and prices of S23, S24, S40, S66 win over the brief (D-07).
const item = (
  code: string,
  name: string,
  kind: ShopItemSeed['kind'],
  assetKey: string,
  extra: Partial<ShopItemSeed> = {},
): ShopItemSeed => ({
  code,
  name,
  kind,
  priceCoin: 0,
  minLevel: 1,
  assetKey,
  purchasable: true,
  isDefault: false,
  ...extra,
});

const earned = { purchasable: false };

export const SHOP_ITEMS: ShopItemSeed[] = [
  item('THEME_DEFAULT', 'Hồi Máu nguyên bản', 'THEME', 'default', {
    purchasable: false,
    isDefault: true,
  }),
  item('THEME_FOREST', 'Rừng xanh', 'THEME', 'forest', {
    priceCoin: 80,
    minLevel: 1,
  }),
  item('THEME_SKY', 'Bầu trời', 'THEME', 'sky', {
    priceCoin: 300,
    minLevel: 8,
  }),
  item('SKIN_DEFAULT', 'Mầm nguyên bản', 'PET_SKIN', 'none', {
    purchasable: false,
    isDefault: true,
  }),
  item('SKIN_FOX', 'Mũ cáo nhỏ', 'PET_SKIN', 'fox', {
    priceCoin: 120,
    minLevel: 3,
  }),
  item('BADGE_STREAK_7', 'Người giữ nhịp', 'BADGE', 'streak-7', earned),
  item('BADGE_STREAK_30', 'Giữ nhịp 30 ngày', 'BADGE', 'streak-30', earned),
  item('BADGE_STREAK_100', 'Giữ nhịp 100 ngày', 'BADGE', 'streak-100', earned),
  item('BADGE_GUILD_TOP1', 'Tổ đội dẫn đầu', 'BADGE', 'guild-top1', earned),
  item('BADGE_NEW_DAY', 'Chào ngày mới', 'BADGE', 'new-day', {
    priceCoin: 60,
    minLevel: 2,
  }),
  item('BADGE_STEP_BY_STEP', 'Từng bước một', 'BADGE', 'step-by-step', {
    priceCoin: 120,
    minLevel: 5,
  }),
];
