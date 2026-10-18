// The shop, the item screens, the inventory and the perk sheet (Task 38: S23 S40 S71 S72 S24 and the sheet of S46).
import type { PerkCode } from '../../../../domain/contract/core.ts';
import { SWAPS_PER_SLOT, TICKET_CAP } from '../../../../domain/economy.ts';
import { formatNumber } from './pet';

export type Kind = 'THEME' | 'PET_SKIN' | 'BADGE';

// S23
export const shopTitle = 'Cửa hàng';
export const shopSubtitle = 'Một chút cá tính cho hành trình của bạn.';
export const coinCardTitle = 'Xu của bạn';
export const coinCardLine = (coin: number) => `${formatNumber(coin)} xu · không dùng tiền thật`;
export const kindTabsLabel = 'Loại vật phẩm';
export const kindTabs: readonly { value: Kind; label: string }[] = [
  { value: 'THEME', label: 'Chủ đề' },
  { value: 'PET_SKIN', label: 'Trang phục' },
  { value: 'BADGE', label: 'Huy hiệu' },
];
/** What the item is, under its name. */
export const kindName: Record<Kind, string> = { THEME: 'Chủ đề giao diện', PET_SKIN: 'Trang phục cho Mầm', BADGE: 'Huy hiệu' };
export const itemLine = (kind: Kind, price: number, isDefault: boolean) => (isDefault ? kindName[kind] : `${kindName[kind]} · ${formatNumber(price)} xu`);
export const view = 'Xem';
export const lockedAt = (level: number) => `Mở ở cấp ${level}`;
export const notYet = 'Chưa mở';
export const shopFooter = 'Vật phẩm chỉ đổi diện mạo. Không bán XP, chuỗi hoặc lợi thế tổ đội.';
export const openInventory = 'Mở kho đồ';
export const kindEmptyTitle = 'Chưa có gì ở đây';
export const kindEmptyBody = 'Loại vật phẩm này chưa có món nào để mua.';
export const shopLoadFailed = 'Chưa tải được cửa hàng. Bạn thử lại nhé.';

// S40
export const itemTitle = (kind: Kind, name: string) => (kind === 'THEME' ? `Chủ đề ${name}` : name);
export const itemSubtitle: Record<Kind, string> = {
  THEME: 'Xem trước trước khi dùng xu.',
  PET_SKIN: 'Trang phục cho Mầm',
  BADGE: 'Huy hiệu thành tích',
};
export const themeTagline = 'Đổi không khí cho hành trình';
export const priceShort = (price: number, coin: number) => `Giá: ${formatNumber(price)} xu · bạn đang có ${formatNumber(coin)} xu`;
export const priceLine = (price: number, coin: number) => `${priceShort(price, coin)}. Chỉ thay diện mạo, không thay đổi tiến trình.`;
export const confirmBuy = 'Xác nhận mua';
export const notBuying = 'Chưa mua';
export const sampleTitle = 'Thẻ mẫu';
export const sampleBody = 'Màu của thẻ này sẽ thay cho màu hiện tại.';
export const sampleAction = 'Nút mẫu';
export const missingItemTitle = 'Không thấy vật phẩm này';
export const missingItemBody = 'Vật phẩm này không còn trong cửa hàng.';
export const backToShop = 'Về cửa hàng';

// S71
/** The coins still needed. */
export const shortBy = (coins: number) => `Còn thiếu ${formatNumber(coins)} xu. Hoàn thành nhiệm vụ để nhận thêm xu.`;
export const seeQuests = 'Xem nhiệm vụ';

// S72
export const unlocked = 'Đã mở khóa';
export const coinLeft = (coin: number) => `Còn ${formatNumber(coin)} xu`;
export const isYours = (name: string) => `${name} đã là của bạn`;
export const alreadyOwnedTitle = 'Đã sở hữu';
export const useNow = 'Dùng ngay';

// A refusal explained in place (chosen by the code, never the server's text).
export const refusal: Record<string, string> = {
  ALREADY_OWNED: 'Bạn đã sở hữu vật phẩm này rồi, xu của bạn không bị trừ thêm.',
  ITEM_NOT_PURCHASABLE: 'Vật phẩm này không bán bằng xu. Nó đến từ hành trình của bạn.',
  ITEM_NOT_FOUND: 'Vật phẩm này không còn trong cửa hàng.',
  ITEM_NOT_OWNED: 'Bạn chưa sở hữu vật phẩm này.',
  PERK_ALREADY_UNLOCKED: 'Tiện ích này đã được mở khóa từ trước, điểm của bạn không bị trừ thêm.',
};
export const lockedLevel = (level: number) => `Vật phẩm này mở ở cấp ${level}. Xu của bạn chưa bị trừ.`;
export const notBought = 'Chưa mua được. Xu của bạn chưa bị trừ.';
export const notApplied = 'Chưa áp dụng được. Bạn thử lại nhé.';

// S24
export const inventoryTitle = 'Kho đồ của bạn';
export const inventorySubtitle = 'Những điều bạn đã mở khóa.';
export const groupName: Record<Kind, string> = { THEME: 'Chủ đề', PET_SKIN: 'Trang phục', BADGE: 'Huy hiệu' };
export const ownedLine = 'Đã sở hữu';
export const inUse = 'Đang dùng';
export const earnedBadge = 'Huy hiệu thành tích';
export const noBadgesTitle = 'Chưa có huy hiệu';
export const noBadgesBody = 'Huy hiệu đến từ những cột mốc bạn đạt được, như giữ nhịp 7 ngày.';
export const applyLook = 'Áp dụng diện mạo';
export const pickAnother = 'Chọn một vật phẩm khác để áp dụng.';
export const inventoryFooter = 'Bạn có thể đổi lại diện mạo bất cứ lúc nào.';
export const inventoryLoadFailed = 'Chưa tải được kho đồ. Bạn thử lại nhé.';
export const applied = 'Đã áp dụng diện mạo';

// S46: the perk sheet.
export const perkSheetTitle: Record<PerkCode, string> = {
  MEAL_SWAP_PLUS: 'Thêm lựa chọn đổi món',
  TICKET_CAP_PLUS: 'Thêm chỗ giữ vé',
  THEME_UNLOCK: 'Chủ đề mới',
};
export const perkDoes: Record<PerkCode, string> = {
  MEAL_SWAP_PLUS: `Mỗi bữa đổi được ${SWAPS_PER_SLOT.withPerk} lần mỗi ngày thay vì ${SWAPS_PER_SLOT.base}.`,
  TICKET_CAP_PLUS: `Bạn giữ được ${TICKET_CAP.withPerk} vé giữ nhịp thay vì ${TICKET_CAP.base}.`,
  THEME_UNLOCK: 'Mở một chủ đề giao diện mà không tốn xu. Mỗi chủ đề tốn 1 điểm.',
};
export const perkCostLine = (cost: number, points: number) => `Cần ${cost} điểm · bạn có ${points} điểm`;
export const unlockPerk = 'Mở khóa';
export const perkOpened = 'Đã mở';
export const pickTheme = 'Chọn chủ đề muốn mở';
export const noThemeLeft = 'Bạn đã có mọi chủ đề đang mở. Chủ đề mới sẽ có khi bạn lên cấp.';
export const themeOpened = (name: string) => `Đã mở chủ đề ${name}`;
export const earnPoints = 'Mỗi lần lên cấp bạn nhận 1 điểm tiện ích. Cứ giữ nhịp, điểm sẽ đến.';
export const perkNotDone = 'Chưa mở khóa được. Điểm của bạn chưa bị trừ.';
export const perkLoadFailed = 'Chưa tải được điểm tiện ích. Bạn thử lại nhé.';
