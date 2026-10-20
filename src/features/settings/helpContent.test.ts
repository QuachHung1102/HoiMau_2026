/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { JOURNAL_XP, STREAK_MILESTONES, TICKET_CAP } from '../../../domain/economy.ts';
import { DAY_START_HOUR, RESCUE_DEADLINE_HOUR } from '../../../domain/logicalDate.ts';
import { cumulativeXpForLevel, perkPointsEarned, titleKeyForLevel, xpRequiredForLevel } from '../../../domain/progression.ts';
import { closeDays, INITIAL_STREAK_STATE } from '../../../domain/streak.ts';
import { QUESTS } from '../../../server/content/quests.ts';
import { legalVi } from '../../shared/i18n/vi/legal';
import { grouped } from '../../shared/i18n/vi/onboarding';
import { rhythmSections, TERMS_SECTIONS } from './helpContent';
import { ARCHETYPE_COOLDOWN_DAYS } from './rules';

// S53 "Cách giữ nhịp mỗi ngày": every number in the text is the one the product decides. What the shared domain and the seed content
// hold is read from them (so the text cannot drift); what only the server decides is compared here with the server's own files, read as text.
const root = path.join(__dirname, '../../..');
const server = (file: string) => fs.readFileSync(path.join(root, 'server', file), 'utf8');
const text = () => rhythmSections().flatMap(section => [section.title, ...section.lines]).join('\n');

describe('what only the server decides, against the server\'s own files', () => {
  test('the day starts at DAY_START_HOUR: app.logical_date shifts the clock back by that many hours', () => {
    const hours = /interval '(\d+) hours'/.exec(server('sql/01-app-context.sql'))?.[1];
    expect(Number(hours)).toBe(DAY_START_HOUR);
  });

  test('a ticket can be used for yesterday from DAY_START_HOUR until RESCUE_DEADLINE_HOUR (app._ticket_dates)', () => {
    const [, from, to] = /x\.hour >= (\d+) AND x\.hour < (\d+)/.exec(server('sql/60-journal.sql')) ?? [];
    expect([Number(from), Number(to)]).toEqual([DAY_START_HOUR, RESCUE_DEADLINE_HOUR]);
  });

  test('the cap of tickets is TICKET_CAP: 2, or 3 with the perk (app._ticket_cap)', () => {
    const [, withPerk, base] = /THEN (\d+) ELSE (\d+)/.exec(server('sql/60-journal.sql')) ?? [];
    expect([Number(base), Number(withPerk)]).toEqual([TICKET_CAP.base, TICKET_CAP.withPerk]);
  });

  test('one ticket a week: the week is decided once, a row of ticket_grant_weeks per user and Monday', () => {
    const table = /CREATE TABLE IF NOT EXISTS ticket_grant_weeks \(([\s\S]*?)\);/.exec(server('sql/32-dayclose.sql'))?.[1] ?? '';
    expect(table).toContain('PRIMARY KEY (user_id, week_start)');
    expect(table).toContain('extract(isodow FROM week_start) = 1');
  });

  test('the server is seeded from the very table of quests the text is built from', () => {
    expect(server('src/seed/quests.ts')).toContain("from '../../content/quests.ts'");
  });

  test('the cooldown between two changes of direction is ARCHETYPE_COOLDOWN_DAYS: 336 hours in the SQL function, 14 days in Me', () => {
    expect(server('sql/21-profile.sql')).toContain(`interval '${ARCHETYPE_COOLDOWN_DAYS * 24} hours'`);
    expect(server('src/readModels/me.ts')).toContain(`const ARCHETYPE_COOLDOWN_MS = ${ARCHETYPE_COOLDOWN_DAYS} * 24 * 60 * 60 * 1000;`);
  });
});

describe('what the shared domain decides, checked by running it', () => {
  test('a finished day adds one to the streak (the text says "một ngày")', () => {
    const closed = closeDays({ ...INITIAL_STREAK_STATE, streakCurrent: 5, streakBest: 5 }, [{ date: '2026-10-14', storyCompleted: true, ticketApplied: false }]);
    expect(closed.state.streakCurrent).toBe(6);
  });

  test('a day with a ticket neither adds to the streak nor breaks it', () => {
    const closed = closeDays({ ...INITIAL_STREAK_STATE, streakCurrent: 5, streakBest: 5 }, [{ date: '2026-10-14', storyCompleted: false, ticketApplied: true }]);
    expect(closed.state.streakCurrent).toBe(5);
  });

  test('a day with nothing done and no ticket stops the streak, and the best one stays', () => {
    const closed = closeDays({ ...INITIAL_STREAK_STATE, streakCurrent: 5, streakBest: 9 }, [{ date: '2026-10-14', storyCompleted: false, ticketApplied: false }]);
    expect([closed.state.streakCurrent, closed.state.streakBest]).toEqual([0, 9]);
  });

  test('each level-up is one perk point (the text says "một điểm")', () => {
    expect(perkPointsEarned(cumulativeXpForLevel(7)) - perkPointsEarned(cumulativeXpForLevel(6))).toBe(1);
  });
});

describe('the text', () => {
  test('the five parts of the frame order: quests and XP, levels, streak, the day boundary, tickets', () => {
    expect(rhythmSections().map(section => section.title)).toEqual(['Nhiệm vụ và XP', 'Cấp độ', 'Chuỗi ngày', 'Một ngày của bạn', 'Vé giữ nhịp']);
  });

  test('the quests are those of the seed, each with its own XP and coins, in words the quest board uses', () => {
    const lines = rhythmSections()[0].lines;
    expect(lines).toEqual([
      'Buổi tập chính: +50 XP và +20 xu.',
      'Bữa ăn theo mục tiêu: +50 XP và +20 xu.',
      'Uống nước: mỗi lần ghi +10 XP và +5 xu, đủ 8 lần là xong.',
      'Đứng dậy một chút: mỗi lần ghi +10 XP và +5 xu, đủ 6 lần là xong.',
      'Nhiệm vụ ẩn mở vào buổi tối: +30 XP và +15 xu.',
      `Trang nhật ký đầu tiên của mỗi ngày: +${JOURNAL_XP} XP.`,
    ]);
    // and these are the numbers of the seed content, not the other way round
    for (const quest of QUESTS) expect(lines.join('\n')).toContain(`+${quest.xpReward} XP và +${quest.coinReward} xu`);
  });

  test('the levels: the XP of a step is the formula\'s, the titles cover the same levels as the domain', () => {
    const lines = rhythmSections()[1].lines;
    for (const level of [1, 5, 10, 20]) expect(lines).toContain(`Từ cấp ${level} lên cấp ${level + 1} cần ${grouped(xpRequiredForLevel(level))} XP.`);
    // the spec's table: 100, 1.118, 3.162, 8.944
    expect([1, 5, 10, 20].map(level => grouped(xpRequiredForLevel(level)))).toEqual(['100', '1.118', '3.162', '8.944']);
    const ranges = lines.filter(line => /^(Cấp|Từ cấp) .*(:)/.test(line) && !line.includes('cần'));
    expect(ranges).toEqual(['Cấp 1–4: Tân binh', 'Cấp 5–9: Người kiên trì', 'Cấp 10–19: Chiến binh kỷ luật', 'Cấp 20–34: Kiện tướng', 'Từ cấp 35 trở lên: Huyền thoại thể hình']);
    expect([4, 5, 9, 10, 19, 20, 34, 35].map(titleKeyForLevel)).toEqual(['TAN_BINH', 'NGUOI_KIEN_TRI', 'NGUOI_KIEN_TRI', 'CHIEN_BINH_KY_LUAT', 'CHIEN_BINH_KY_LUAT', 'KIEN_TUONG', 'KIEN_TUONG', 'HUYEN_THOAI_THE_HINH']);
  });

  test('the streak: a milestone per entry of STREAK_MILESTONES, with its coins', () => {
    const lines = rhythmSections()[2].lines;
    for (const { days, coins } of STREAK_MILESTONES) expect(lines).toContain(`Mốc ${days} ngày: một huy hiệu và +${coins} xu.`);
    expect(STREAK_MILESTONES.map(({ days, coins }) => [days, coins])).toEqual([[7, 50], [30, 200], [100, 500]]);
  });

  test('the day boundary: starts at 03:00, its last minute is 02:59, and 02:30 is the example', () => {
    expect(rhythmSections()[3].lines).toEqual(['Ngày của bạn bắt đầu lúc 03:00 và kết thúc lúc 02:59 sáng hôm sau, theo múi giờ trong hồ sơ. Một ghi nhận lúc 02:30 vẫn tính cho ngày hôm trước.']);
  });

  test('the tickets: one a week, the cap, and the window of yesterday', () => {
    const lines = rhythmSections()[4].lines;
    expect(lines).toContain('Mỗi tuần, trang nhật ký đầu tiên của bạn được tặng một vé giữ nhịp. Tuần bắt đầu từ thứ Hai.');
    expect(lines).toContain('Bạn giữ tối đa 2 vé, hoặc 3 vé khi đã mở tiện ích tăng chỗ chứa vé.');
    expect(lines).toContain('Vé dùng được cho hôm nay, hoặc cho hôm qua cho đến 15:00.');
  });

  test('no number is in the text that does not come from the above: every figure of it is accounted for', () => {
    const found = new Set(text().match(/\d+(?:[.:]\d+)*/g));
    const clock = (hour: number, minute = 0) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const allowed = new Set<string>([
      ...QUESTS.flatMap(quest => [quest.xpReward, quest.coinReward, quest.targetCount]).map(String),
      String(JOURNAL_XP),
      ...[1, 5, 10, 20].flatMap(level => [String(level), String(level + 1), grouped(xpRequiredForLevel(level))]),
      '1', '4', '5', '9', '10', '19', '20', '34', '35',
      ...STREAK_MILESTONES.flatMap(({ days, coins }) => [String(days), String(coins)]),
      clock(DAY_START_HOUR), clock(DAY_START_HOUR - 1, 59), clock(DAY_START_HOUR - 1, 30),
      String(TICKET_CAP.base), String(TICKET_CAP.withPerk), clock(RESCUE_DEADLINE_HOUR),
    ]);
    expect([...found].filter(figure => !allowed.has(figure))).toEqual([]);
    expect(found.size).toBeGreaterThan(20);
  });
});

describe('the legal text is split into the terms and the privacy policy without losing a section', () => {
  test('the terms are the first sections (who may use it, not medical advice); the policy is the rest; together they are all of legalVi', () => {
    const terms = legalVi.sections.slice(0, TERMS_SECTIONS).map(section => section.heading);
    const policy = legalVi.sections.slice(TERMS_SECTIONS).map(section => section.heading);
    expect(terms).toEqual(['Ai có thể dùng Hồi Máu', 'Không phải tư vấn y tế']);
    expect(policy).toEqual(['Hồi Máu lưu gì', 'Bài viết nhật ký', 'Điều thành viên tổ đội thấy', 'Dữ liệu của bạn', 'Quyền của bạn']);
    expect([...terms, ...policy]).toEqual(legalVi.sections.map(section => section.heading));
  });
});
