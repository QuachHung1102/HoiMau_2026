// Game components and Mầm (Task 12): stats, level, chips, milestones, the mascot.
import type { PetMood, PetStage } from '../../../../domain/types.ts';

/** 1118 -> "1.118"; anything that is not a finite number -> "0". Hermes is not guaranteed to ship `Intl.NumberFormat('vi-VN')`. */
export const formatNumber = (n: number) =>
  (Number.isFinite(n) ? String(Math.round(n)) : '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const statLabel = { hp: 'Sức sống', en: 'Năng lượng', str: 'Sức mạnh', spd: 'Sức bền' } as const;
export const statValue = (value: number) => `${value}/100`;
export const percent = (value: number) => `${value}%`;

export const levelTitle = (level: number, title: string) => `Cấp ${level} · ${title}`;
export const xpProgress = (xpIntoLevel: number, xpForNextLevel: number) =>
  `${formatNumber(xpIntoLevel)} / ${formatNumber(xpForNextLevel)} XP`;

export const coinAmount = (coin: number) => `${formatNumber(coin)} xu`;
export const dayCount = (days: number) => `${days} ngày`;
export const lockLevel = (minLevel: number) => `Cấp ${minLevel}`;
export const owned = 'Đã sở hữu';
export const equipped = 'Đang dùng';
export const ticketUsed = 'Đã dùng vé';
export const pendingCount = (count: number) => `${count} ghi nhận đang chờ gửi`;

export const milestoneAchieved = 'Đã đạt';
export const milestoneNotYet = 'Chưa đạt';
export const milestoneRemaining = (days: number) => `Còn ${days} ngày`;
export const milestoneRibbon = (days: number) => `${days} ngày giữ nhịp`;

export const stageName: Record<PetStage, string> = {
  EGG: 'Hạt giống',
  HATCHLING: 'Mầm nhú',
  JUVENILE: 'Chồi non',
  ADULT: 'Cây xanh',
  MYTHIC: 'Cây huyền thoại',
};
export const moodText: Record<PetMood, string> = {
  HAPPY: 'Mầm đang vui',
  NEUTRAL: 'Mầm đang bình thường',
  TIRED: 'Mầm hơi buồn ngủ, đang chờ bạn quay lại',
};
/** What a screen reader says for the mascot picture. */
export const mamLabel = (stage: PetStage, mood: PetMood) => `${stageName[stage]}. ${moodText[mood]}`;

// S22, S70, S68 and S69 (Task 38).
export const petTitle = 'Mầm của bạn';
export const petSubtitle = 'Người bạn nhỏ trên một hành trình dài.';
/** "64% tới Chồi non". */
export const growthLine = (growth: number, next: string) => `${growth}% tới ${next}`;
export const grownUp = 'Đã lớn hết cỡ';
export const petCare = 'Những ngày bạn chăm sóc mình cũng nuôi lớn Mầm. Tiến hóa đã đạt sẽ không mất đi.';
/** Under the mood line of S70: no illness, no blame, the stage is what it was. */
export const tiredNote = 'Mầm vẫn ở đây. Một việc nhỏ hôm nay là đủ để bắt đầu lại.';
export const growthRow = { title: 'Hành trình lớn lên', description: 'Xem các giai đoạn của Mầm' } as const;
export const changeLook = 'Đổi diện mạo';
export const visitShop = 'Ghé cửa hàng';
export const tiredAction = 'Chọn một việc nhỏ';
export const petLoadFailed = 'Chưa tải được thông tin của Mầm. Bạn thử lại nhé.';

export const stagesTitle = 'Hành trình lớn lên';
export const stagesSubtitle = 'Giai đoạn đã đạt sẽ không mất đi.';
export type StageState = 'past' | 'current' | 'next';
export const stageState: Record<StageState, string> = { past: 'Đã qua', current: 'Hiện tại', next: 'Sắp tới' };
/** The XP earned inside a stage that completes it (R-D07), in words. */
export const stageSize = (xp: number | null) => (xp === null ? 'Giai đoạn cuối, không cần thêm XP' : `Cần ${formatNumber(xp)} XP trong giai đoạn này`);
export const stagesFooter = 'Mầm lớn lên nhờ những việc bạn đã làm, không mua được bằng xu.';
export const stageRowLabel = (name: string, state: StageState, size: string) => `${name}. ${stageState[state]}. ${size}`;

export const stageUpTitle = (stage: PetStage) => `Mầm đã thành ${stageName[stage]}`;
export const stageUpBody = 'Công sức những ngày qua đã giúp Mầm lớn lên.';
export const seeMam = 'Xem Mầm';
