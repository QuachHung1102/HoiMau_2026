// Game components and Mầm (Task 12): stats, level, chips, milestones, the mascot.
import type { PetMood, PetStage } from '../../../../domain/types.ts';

/** 1118 -> "1.118". Hermes is not guaranteed to ship `Intl.NumberFormat('vi-VN')`. */
export const formatNumber = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

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
