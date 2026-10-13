// Hôm nay (S09, S57, S58) and the stat explainer (S47) — Task 25.
import type { TitleKey } from '../../../../domain/contract/common.ts';
import { formatNumber, statValue } from './pet';

export const greeting = (name: string) => `Chào ${name}, mình bắt đầu từ việc nhỏ nhé.`;
export const inbox = 'Hộp thư';
export const inboxUnread = 'Hộp thư, có thư mới';

/** The title that goes with a level (`Progression.titleKey`). */
export const levelTitleText: Record<TitleKey, string> = {
  TAN_BINH: 'Tân binh',
  NGUOI_KIEN_TRI: 'Người kiên trì',
  CHIEN_BINH_KY_LUAT: 'Chiến binh kỷ luật',
  KIEN_TUONG: 'Kiện tướng',
  HUYEN_THOAI_THE_HINH: 'Huyền thoại thể hình',
};

// The companion card.
export const companionHeadline: readonly [string, string] = ['Uống nước.', 'Giữ nhịp.'];
export const companionBody = 'Mầm ở đây cùng bạn.';
/** Instead of `companionBody` while Mầm is tired: an invitation, never a reproach. */
export const companionInvite = 'Mầm vẫn ở đây. Một việc nhỏ hôm nay là đủ để bắt đầu lại.';
/** The mood line right after a record the server confirmed. */
export const mamGlad = 'Mầm vui vì bạn vừa ghi nhận';

export const statsTitle = 'Chỉ số của bạn';
export const statsLink = 'Hiểu các chỉ số';

export const storyTitle = 'Việc chính hôm nay';
export const workoutNotStarted = 'Chưa bắt đầu';
export const workoutDone = 'Đã hoàn thành buổi tập';
export const kcalLine = (eaten: number, window: { min: number; max: number; target: number }) =>
  `${formatNumber(eaten)} / ${formatNumber(window.target)} kcal · cần trong ${formatNumber(window.min)}–${formatNumber(window.max)}`;

export const seeJourney = 'xem hành trình';
export const endOfDay = 'Khép lại hôm nay';
export const endOfDayHint = 'Ghi lại ý định nghỉ ngơi';
export const endOfDayMarked = 'Đã ghi ý định nghỉ ngơi';
export const allQuests = 'Xem tất cả nhiệm vụ';

// S47.
export const explainerTitle = 'Hiểu chỉ số của bạn';
export const explainerSubtitle = 'Phản ánh hành vi, không đánh giá con người.';
/** What each stat is made of. */
export const statSource = {
  hp: 'Từ phần nước đã ghi, dấu ghi giờ nghỉ và chuỗi ngày giữ nhịp.',
  en: 'Từ lượng kcal đã ghi so với mục tiêu trong ngày.',
  str: 'Từ số phút vận động kháng lực trong 7 ngày gần nhất.',
  spd: 'Từ số phút cardio và HIIT trong 7 ngày gần nhất.',
} as const;
/** What goes into each stat right now, in words. */
export const hpInputs = (waterMl: number, waterTargetMl: number, bedtimeMarked: boolean, streakDays: number) =>
  `Hôm nay: ${formatNumber(waterMl)} / ${formatNumber(waterTargetMl)} ml nước, ${bedtimeMarked ? 'đã ghi giờ nghỉ' : 'chưa ghi giờ nghỉ'}, chuỗi ${streakDays} ngày.`;
export const enInputs = (eaten: number, target: number) => `Hôm nay: đã ghi ${formatNumber(eaten)} / ${formatNumber(target)} kcal.`;
/** The minutes themselves are not sent to the app: the value, and what fills the bar (spec F-03). */
export const minutesInputs = (value: number) => `Hiện tại ${statValue(value)}. Thanh đầy khi đủ 150 phút trong 7 ngày gần nhất.`;
/** The action that feeds each stat. */
export const statAction = {
  hp: 'Ghi nhận nước ở Hôm nay',
  en: 'Ghi nhận bữa ăn',
  str: 'Chọn bài tập kháng lực',
  spd: 'Chọn bài cardio hoặc HIIT',
} as const;
/** Beside `healthVi.estimate.stats`: the stats are read-only (spec F-03, R-03.1 and R-03.2). */
export const statsReadOnly = 'Chỉ số được tính từ những gì bạn ghi nhận: không mua được và không chỉnh sửa được.';
export const seeHistory = 'Xem lịch sử ghi nhận';
