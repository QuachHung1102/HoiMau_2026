import { JOURNAL_XP, STREAK_MILESTONES, TICKET_CAP } from '../../../domain/economy.ts';
import { DAY_START_HOUR, RESCUE_DEADLINE_HOUR } from '../../../domain/logicalDate.ts';
import { titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { QUESTS } from '../../../server/content/quests.ts';
import { earnBody } from '../../shared/i18n/vi/journal';
import { boardQuestTitle } from '../../shared/i18n/vi/quests';
import * as vi from '../../shared/i18n/vi/settings';
import { levelTitleText } from '../../shared/i18n/vi/today';

export type HelpSection = { title: string; lines: string[] };

/** Levels whose step is named in the text (the spec's table: 100, 1.118, 3.162, 8.944 XP). */
const STEP_LEVELS = [1, 5, 10, 20];
/** Far past the last change of title (level 35), so the last range is open-ended. */
const LAST_LEVEL = 60;

const clock = (hour: number, minute = 0) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** The levels of each title, in order, as the domain gives them; the last one has no end. */
function titleRanges() {
  const ranges: { from: number; to: number | null; name: string }[] = [];
  for (let level = 1; level <= LAST_LEVEL; level += 1) {
    const name = levelTitleText[titleKeyForLevel(level)];
    const last = ranges[ranges.length - 1];
    if (last?.name === name) last.to = level;
    else ranges.push({ from: level, to: level, name });
  }
  ranges[ranges.length - 1].to = null;
  return ranges;
}

/**
 * "Cách giữ nhịp mỗi ngày" (S53): every number is read from the constant or the function that decides it. The shared domain
 * and the seed content are imported (the quests are the very table the server is seeded from); what only the server decides is
 * compared with the server's own files by `helpContent.test.ts`.
 */
export function rhythmSections(): HelpSection[] {
  const named = (code: string) => boardQuestTitle[code] ?? code;
  const story = QUESTS.filter(quest => quest.category === 'STORY');
  const daily = QUESTS.filter(quest => quest.category === 'DAILY');
  const hidden = QUESTS.filter(quest => quest.category === 'HIDDEN');
  return [
    {
      title: vi.rhythm.questsTitle,
      lines: [
        ...story.map(quest => vi.rhythm.storyLine(named(quest.code), quest.xpReward, quest.coinReward)),
        ...daily.map(quest => vi.rhythm.dailyLine(named(quest.code), quest.xpReward, quest.coinReward, quest.targetCount)),
        ...hidden.map(quest => vi.rhythm.hiddenLine(quest.xpReward, quest.coinReward)),
        vi.rhythm.journalLine(JOURNAL_XP),
      ],
    },
    {
      title: vi.rhythm.levelsTitle,
      lines: [
        ...STEP_LEVELS.map(level => vi.rhythm.levelStep(level, xpRequiredForLevel(level))),
        vi.rhythm.levelPoint,
        ...titleRanges().map(({ from, to, name }) => vi.rhythm.titleRange(from, to, name)),
      ],
    },
    {
      title: vi.rhythm.streakTitle,
      lines: [vi.rhythm.storyRule, vi.rhythm.streakBreak, ...STREAK_MILESTONES.map(({ days, coins }) => vi.rhythm.streakMilestone(days, coins))],
    },
    {
      title: vi.rhythm.introTitle,
      // 02:59 is the last minute of a day; 02:30 is an example of a time that still belongs to the day before
      lines: [vi.rhythm.dayBoundary(clock(DAY_START_HOUR), clock(DAY_START_HOUR - 1, 59), clock(DAY_START_HOUR - 1, 30))],
    },
    {
      title: vi.rhythm.ticketsTitle,
      lines: [earnBody, vi.rhythm.ticketsFrozen, vi.rhythm.ticketsCap(TICKET_CAP.base, TICKET_CAP.withPerk), vi.rhythm.ticketsWindow(clock(RESCUE_DEADLINE_HOUR))],
    },
  ];
}

/** The first sections of `legalVi` are the terms of use (who may use the app, not medical advice); the rest say what is kept and shared. */
export const TERMS_SECTIONS = 2;
