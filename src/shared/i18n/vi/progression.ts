// The profile tab, the journey, the history of a day, levels and the celebrations (S31 S21 S67 S51 S46 S65 S66).
import type { DayOutcome, MealSlot } from '../../../../domain/types.ts';
import { SWAPS_PER_SLOT, TICKET_CAP } from '../../../../domain/economy.ts';
import { formatNumber, milestoneRibbon } from './pet';

// S31, the tab "Cá nhân".
export const profileSubtitle = 'Hành trình này là của bạn.';
export const profileRows = {
  journey: { title: 'Hành trình & chỉ số', description: 'Lịch sử, XP và huy hiệu' },
  pet: { title: 'Mầm của bạn', description: 'Linh vật và diện mạo' },
  levels: { title: 'Cấp độ & tiện ích', description: 'Điểm tiện ích và danh hiệu' },
  journal: { title: 'Góc giải tỏa', description: 'Một khoảng riêng để viết' },
  settings: { title: 'Cài đặt', description: 'Hồ sơ, thông báo và quyền dữ liệu' },
} as const;

// S21, the journey.
export const journeyTitle = 'Hành trình của bạn';
export const journeySubtitle = 'Nhìn lại những ngày bạn đã có mặt.';
export const streakRunning = 'Đang giữ nhịp';
export const streakIdle = 'Bắt đầu từ hôm nay';
export const record = (days: number) => `Kỷ lục: ${days} ngày`;
export const weekHint = 'Mỗi dấu là một ngày bạn hoàn thành việc chính.';
export const weekdayShort = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;
export const weekdayLong = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'] as const;
export const legendDone = 'Ngày hoàn thành việc chính';
export const legendFrozen = 'Ngày dùng vé';
/** The state of one day of the week, in words (the mark itself is a ring or a check). */
export type MarkState = 'COMPLETED' | 'FROZEN' | 'MISSED' | 'OPEN' | 'FUTURE' | 'NONE' | 'UNKNOWN';
export const markText: Record<MarkState, string> = {
  COMPLETED: 'đã hoàn thành việc chính',
  FROZEN: legendFrozen,
  MISSED: 'chưa hoàn thành việc chính',
  OPEN: 'hôm nay, ngày còn mở',
  FUTURE: 'chưa tới',
  NONE: 'trước ngày bạn bắt đầu',
  UNKNOWN: 'chưa có dữ liệu',
};
/** "Thứ Tư, 15/10: đã hoàn thành việc chính". */
export const markLabel = (weekday: string, shortDate: string, state: MarkState) => `${weekday}, ${shortDate}: ${markText[state]}`;
export const milestonesTitle = 'Cột mốc chuỗi';
export const untilMilestone = (remaining: number, days: number) => `Còn ${remaining} ngày tới huy hiệu ${days} ngày`;
export const journeyRows = {
  history: { title: 'Lịch sử ghi nhận', description: 'Nước, bữa ăn và các buổi tập' },
  levels: { title: 'Cấp độ & huy hiệu', description: 'Tiến bộ từ hành vi, không từ cân nặng' },
  tickets: { title: 'Vé giữ nhịp', description: 'Một khoảng nghỉ khi bạn cần' },
} as const;
export const journeyFooter = 'Kỷ lục vẫn ở lại kể cả khi một chuỗi kết thúc.';

// S67, the journey after a streak has ended: the record stays, nobody is blamed.
export const restartTitle = 'Một khởi đầu mới';
export const restartBody = (current: number, best: number) => `Chuỗi hiện tại: ${current} ngày. Kỷ lục ${best} ngày của bạn vẫn ở đây.`;
/** On a provisional day the streak is not known: only the record, which never goes down. */
export const restartBodyRecordOnly = (best: number) => `Kỷ lục ${best} ngày của bạn vẫn ở đây.`;
export const restartAction = 'Bắt đầu từ một việc nhỏ';
export const seeTickets = 'Xem vé giữ nhịp';

// S51, the history of one day.
export const historyTitle = 'Lịch sử ghi nhận';
export const historySubtitle = 'Nhìn lại việc bạn đã làm.';
export const todayName = 'Hôm nay';
/** "Thứ Tư, 15/10/2026" for a day that is not today. */
export const dayName = (weekday: string, fullDate: string) => `${weekday}, ${fullDate}`;
export const previousDay = 'Ngày trước';
export const nextDay = 'Ngày sau';
export const oldestDay = (days: number) => `Chỉ xem được ${days} ngày gần nhất.`;
export const newestDay = 'Đây là ngày hôm nay.';
export const outcomeText: Record<DayOutcome | 'OPEN' | 'NONE', string> = {
  COMPLETED: 'Đã hoàn thành việc chính',
  FROZEN: 'Ngày dùng vé',
  MISSED: 'Chưa hoàn thành việc chính',
  OPEN: 'Ngày đang mở',
  NONE: 'Trước ngày bạn bắt đầu',
};
export const storyLine = (done: number, total: number) => `Việc chính: ${done}/${total}`;
export const waterLine = (ml: number) => `Nước: ${formatNumber(ml)} ml`;
export const kcalLine = (kcal: number) => `Năng lượng đã ghi: ${formatNumber(kcal)} kcal`;
export const workoutLine = (minutes: number) => `Vận động: ${minutes} phút`;
export const actionsTitle = 'Đã ghi nhận';
export const tickFallback = 'Ghi nhận';
export const nutritionFallback = 'Bữa ăn';
export const slotName: Record<MealSlot, string> = { BREAKFAST: 'Bữa sáng', LUNCH: 'Bữa trưa', DINNER: 'Bữa tối', SNACK: 'Bữa phụ' };
export const bedtimeAction = 'Kết thúc ngày';
export const workoutFallback = 'Buổi tập';
export const minutes = (count: number) => `${count} phút`;
export const kcal = (value: number) => `${formatNumber(value)} kcal`;
export const undone = 'đã hoàn tác';
/** "Bữa trưa · Bún gà" style joins and "07:45 · 450 kcal". */
export const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
export const emptyTitle = 'Chưa có ghi nhận';
export const emptyBody = 'Ngày này chưa có gì được ghi lại.';
export const historyFooter = 'Lịch sử phản ánh dữ liệu đã lưu.';
export const backToToday = 'Về Hôm nay';

// S46, levels and perks.
export const levelsTitle = 'Cấp độ & tiện ích';
export const levelsSubtitle = 'Tiến bộ đến từ những việc bạn đã làm.';
export const levelsIntro = 'Mỗi lần lên cấp mở thêm lựa chọn cho hành trình.';
export const xpToNext = (xpIntoLevel: number, xpForNextLevel: number, nextLevel: number) =>
  `${formatNumber(xpIntoLevel)} / ${formatNumber(xpForNextLevel)} XP tới cấp ${nextLevel}`;
export const perkPoints = (points: number) => `${points} điểm tiện ích`;
export const titlesHeading = 'Danh hiệu';
export const titleRange = (title: string, from: number, to: number | null) => `${title} · cấp ${from}${to === null ? '+' : `–${to}`}`;
export const currentTitle = 'Hiện tại';
export const perkCost = (points: number) => `${points} điểm`;
export const perkRows = {
  MEAL_SWAP_PLUS: { title: 'Thêm lựa chọn đổi món', description: `Mỗi bữa đổi được ${SWAPS_PER_SLOT.withPerk} lần thay vì ${SWAPS_PER_SLOT.base}` },
  TICKET_CAP_PLUS: { title: 'Thêm chỗ giữ vé', description: `Giữ được ${TICKET_CAP.withPerk} vé thay vì ${TICKET_CAP.base}` },
  THEME_UNLOCK: { title: 'Chủ đề mới', description: 'Thay đổi diện mạo' },
} as const;
export const levelsFooter = 'Điểm tiện ích không cộng vào chỉ số cơ thể hoặc điểm tổ đội.';

// S65 and S66, the celebrations.
/** The title line; the title that goes with the level is the overlay's subtitle. */
export const levelUpTitle = (level: number) => `Bạn lên cấp ${level}`;
export const levelUpBody = (points: number) => `Bạn nhận ${points} điểm tiện ích.`;
export const seePerks = 'Xem tiện ích';
export const later = 'Để sau';
export const milestoneTitle = milestoneRibbon;
/** Names of the streak badges, as in server/content/shopItems.ts (a test compares them). */
export const badgeNames: Record<string, string> = {
  BADGE_STREAK_7: 'Người giữ nhịp',
  BADGE_STREAK_30: 'Giữ nhịp 30 ngày',
  BADGE_STREAK_100: 'Giữ nhịp 100 ngày',
};
const unnamedBadge = 'giữ nhịp';
/** A milestone is paid once ever, so `days` is a new record. */
export const milestoneBody = (badgeCode: string, coins: number, days: number) =>
  `Huy hiệu ${badgeNames[badgeCode] ?? unnamedBadge} đã vào kho đồ, kèm ${formatNumber(coins)} xu. Kỷ lục mới của bạn: ${days} ngày.`;
export const seeBadge = 'Xem huy hiệu';
export const keepGoing = 'Tiếp tục';
