import { act, fireEvent, hold, installTodayTestEnv, landed, NAME, openGuild, openLeaderboard, queryClient, refuse, requested, screen, seedGuild, world, type Board } from './guildTestKit';

import * as clock from './clockTime';

installTodayTestEnv();

const UPDATED = '2026-10-14T02:40:00.000Z';
/** The time of day of an instant on this device, worked out by the platform's own formatter, not by the code under test. */
const localTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const board = (more: Partial<Board> = {}): Board => ({
  updatedAt: UPDATED,
  standings: [
    { guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.86, activeMembers: 5 },
    { guildName: NAME, avgCompletion: 0.79, activeMembers: 4 },
    { guildName: 'Bạn cùng tiến', avgCompletion: 0.71, activeMembers: 6 },
  ],
  ...more,
});
const rowLabel = (name: string | RegExp) => screen.getByLabelText(name);
const BOARD_CURRENT = 'GET /leaderboard?week=current';

describe('from the guild screen', () => {
  test('"Xem bảng xếp hạng" opens S28 with the title, the subtitle and the two weeks; Back returns to the guild', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const view = await openLeaderboard();
    expect(screen.getByRole('header', { name: 'Bảng xếp hạng' })).toBeTruthy();
    expect(screen.getByText('Theo mức hoàn thành, không theo số đo.')).toBeTruthy();
    expect(screen.getByLabelText('Chọn tuần')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Tuần này', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Tuần trước', checked: false })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: NAME })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Bảng xếp hạng' })).toBeNull();
    view.unmount();
  });
});

describe('S28: this week', () => {
  test('the explanation, every guild with its rank, ratio and active members, and the caller\'s guild marked in words', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const view = await openLeaderboard();
    expect(screen.getByRole('header', { name: 'Cùng đều đặn hơn' })).toBeTruthy();
    expect(screen.getByText('Điểm phản ánh tỉ lệ hoàn thành của nhóm, không phải nhóm nào đông hơn.')).toBeTruthy();
    expect(screen.getByText('Bước nhỏ mỗi ngày')).toBeTruthy();
    expect(screen.getByText('86% · 5 bạn hoạt động')).toBeTruthy();
    expect(screen.getByText('71% · 6 bạn hoạt động')).toBeTruthy();
    // the own guild says so in text, not only in the colour of its tile
    expect(screen.getByText('79% · 4 bạn hoạt động · Tổ đội của bạn')).toBeTruthy();
    expect(screen.getAllByText(/Tổ đội của bạn/)).toHaveLength(1);
    expect(rowLabel('Hạng 1. Bước nhỏ mỗi ngày. 86% · 5 bạn hoạt động')).toBeTruthy();
    expect(rowLabel(`Hạng 2. ${NAME}. 79% · 4 bạn hoạt động · Tổ đội của bạn`)).toBeTruthy();
    expect(rowLabel('Hạng 3. Bạn cùng tiến. 71% · 6 bạn hoạt động')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    view.unmount();
  });

  test('the footer says when the board was computed, in the time of this device, and that the week closes on Monday morning', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const view = await openLeaderboard();
    expect(screen.getByText(`Cập nhật lúc ${localTime(UPDATED)} · kết quả tuần chốt vào sáng thứ Hai`)).toBeTruthy();
    expect(screen.queryByText('Kết quả đã chốt')).toBeNull();
    view.unmount();
  });

  test('the time in the footer is what the device-zone formatter (clockTime.test.ts runs it under other zones) makes of updatedAt, and of nothing else', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const spy = jest.spyOn(clock, 'clockTime').mockReturnValue('07:08');
    try {
      const view = await openLeaderboard();
      expect(screen.getByText('Cập nhật lúc 07:08 · kết quả tuần chốt vào sáng thứ Hai')).toBeTruthy();
      expect(spy).toHaveBeenCalledWith(UPDATED);
      view.unmount();
    } finally {
      spy.mockRestore();
    }
  });

  test('a guild below the top 50 is an extra row with its own rank and numbers', async () => {
    seedGuild();
    const others = Array.from({ length: 50 }, (_, n) => ({ guildName: `Tổ ${n + 1}`, avgCompletion: 0.9, activeMembers: 4 }));
    world.guild.boards.current = board({ standings: [...others, { guildName: NAME, avgCompletion: 0.3, activeMembers: 3 }] });
    const view = await openLeaderboard();
    expect(screen.getByText('Tổ 50')).toBeTruthy();
    expect(rowLabel(`Hạng 51. ${NAME}. 30% · 3 bạn hoạt động · Tổ đội của bạn`)).toBeTruthy();
    expect(screen.getByText('30% · 3 bạn hoạt động · Tổ đội của bạn')).toBeTruthy();
    expect(screen.getByText('51')).toBeTruthy();
    view.unmount();
  });

  test('no guild is ranked yet: the own guild alone, its count, the time of the board, nothing that reads as an error', async () => {
    seedGuild();
    world.guild.boards.current = board({ standings: [], unranked: { avgCompletion: 0.2, activeMembers: 1 } });
    const view = await openLeaderboard();
    expect(screen.getByRole('header', { name: 'Chưa lên bảng tuần này' })).toBeTruthy();
    expect(screen.getByText('Cần ít nhất 3 thành viên hoạt động trong tuần để lên bảng. Tuần này: 1 thành viên hoạt động.')).toBeTruthy();
    expect(screen.getByText(`Cập nhật lúc ${localTime(UPDATED)} · kết quả tuần chốt vào sáng thứ Hai`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Chưa có tổ đội nào lên bảng tuần này' })).toBeNull();
    view.unmount();
  });
});

describe('S73: a guild that is not on the board', () => {
  test('the threshold, the count of active members this week, the own row in words, and "Mời thêm bạn"', async () => {
    seedGuild();
    world.guild.boards.current = board({ standings: [board().standings[0], board().standings[2]], unranked: { avgCompletion: 0.4, activeMembers: 2 } });
    const view = await openLeaderboard();
    expect(screen.getByRole('header', { name: 'Chưa lên bảng tuần này' })).toBeTruthy();
    expect(screen.getByText('Cần ít nhất 3 thành viên hoạt động trong tuần để lên bảng. Tuần này: 2 thành viên hoạt động.')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Cùng đều đặn hơn' })).toBeNull();
    // the ranked guilds are listed, the own one follows as an unranked row with its name
    expect(screen.getByText('86% · 5 bạn hoạt động')).toBeTruthy();
    expect(screen.getByText(NAME)).toBeTruthy();
    expect(screen.getByText('Chưa xếp hạng tuần này · Tổ đội của bạn')).toBeTruthy();
    expect(rowLabel(`${NAME}. Chưa xếp hạng tuần này · Tổ đội của bạn`)).toBeTruthy();
    expect(screen.getByText(`Cập nhật lúc ${localTime(UPDATED)} · kết quả tuần chốt vào sáng thứ Hai`)).toBeTruthy();
    view.unmount();
  });

  test('"Mời thêm bạn" opens the guild management', async () => {
    seedGuild();
    world.guild.boards.current = board({ standings: [], unranked: { avgCompletion: 0.4, activeMembers: 2 } });
    const view = await openLeaderboard();
    fireEvent.press(screen.getByRole('button', { name: 'Mời thêm bạn' }));
    expect(await screen.findByRole('header', { name: 'Quản lý tổ đội' })).toBeTruthy();
    view.unmount();
  });

  test('a ranked guild has no invitation to make and no S73 card', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const view = await openLeaderboard();
    expect(screen.queryByRole('button', { name: 'Mời thêm bạn' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Chưa lên bảng tuần này' })).toBeNull();
    view.unmount();
  });

  test('no guild at all: a hint to the Guild tab, the board still listed, and the hint leads there', async () => {
    // a tab shows the board without a guild only through the route: open it from a guild, then leave the guild on the server
    seedGuild();
    world.guild.boards.current = board();
    const view = await openLeaderboard();
    world.guild.teams = [];
    await act(() => queryClient().invalidateQueries({ queryKey: ['guild'] }));
    await landed();
    expect(screen.getByRole('header', { name: 'Bạn chưa có tổ đội' })).toBeTruthy();
    expect(screen.getByText('Bước nhỏ mỗi ngày')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mời thêm bạn' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Đến tab Tổ đội' }));
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    view.unmount();
  });
});

describe('S28: the week before', () => {
  test('"Tuần trước" asks for week=previous; the closed board says its result is final and not when it was computed', async () => {
    seedGuild();
    world.guild.boards.current = board();
    world.guild.boards.previous = { updatedAt: '2026-10-12T03:30:00.000Z', standings: [{ guildName: NAME, avgCompletion: 0.7, activeMembers: 4 }, { guildName: 'Bạn cùng tiến', avgCompletion: 0.6, activeMembers: 5 }] };
    const view = await openLeaderboard();
    expect(requested('/leaderboard?week=previous')).toBe(0);
    fireEvent.press(screen.getByRole('radio', { name: 'Tuần trước' }));
    expect(await screen.findByText('Kết quả đã chốt')).toBeTruthy();
    expect(requested('/leaderboard?week=previous')).toBe(1);
    expect(screen.getByRole('radio', { name: 'Tuần trước', checked: true })).toBeTruthy();
    expect(screen.getByText('70% · 4 bạn hoạt động · Tổ đội của bạn')).toBeTruthy();
    expect(screen.getByText('60% · 5 bạn hoạt động')).toBeTruthy();
    expect(screen.queryByText(/Cập nhật lúc/)).toBeNull();
    expect(screen.queryByText('86% · 5 bạn hoạt động')).toBeNull();
    view.unmount();
  });

  test('before the week has settled (Monday after midnight) the board is empty: a calm line, never an error, never "no guild"', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const view = await openLeaderboard();
    fireEvent.press(screen.getByRole('radio', { name: 'Tuần trước' }));
    expect(await screen.findByRole('header', { name: 'Chưa có kết quả tuần trước' })).toBeTruthy();
    expect(screen.getByText('Kết quả được chốt vào sáng thứ Hai. Bạn quay lại sau một chút nhé.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    // the server says mine is null for this board, and the person is in a guild: no hint to join one
    expect(screen.queryByRole('header', { name: 'Bạn chưa có tổ đội' })).toBeNull();
    expect(screen.queryByText('Kết quả đã chốt')).toBeNull();
    view.unmount();
  });

  test('switching weeks asks again each time: back to this week reads it anew, and each week keeps its own board', async () => {
    seedGuild();
    world.guild.boards.current = board();
    world.guild.boards.previous = { standings: [{ guildName: 'Tổ cũ', avgCompletion: 0.5, activeMembers: 3 }] };
    const view = await openLeaderboard();
    expect(requested('/leaderboard?week=current')).toBe(1);
    fireEvent.press(screen.getByRole('radio', { name: 'Tuần trước' }));
    expect(await screen.findByText('Tổ cũ')).toBeTruthy();
    expect(screen.queryByText('Bước nhỏ mỗi ngày')).toBeNull();
    // the running board moved while the other week was open
    world.guild.boards.current = board({ standings: [{ guildName: 'Tổ mới nhất', avgCompletion: 0.95, activeMembers: 7 }, ...board().standings] });
    fireEvent.press(screen.getByRole('radio', { name: 'Tuần này' }));
    expect(await screen.findByText('Tổ mới nhất')).toBeTruthy();
    expect(requested('/leaderboard?week=current')).toBe(2);
    expect(screen.queryByText('Tổ cũ')).toBeNull();
    view.unmount();
  });
});

describe('loading and failing', () => {
  test('first load: the title, the weeks and a skeleton, no rows; then the board', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const held = hold(BOARD_CURRENT);
    const view = await openLeaderboard();
    expect(screen.getByRole('header', { name: 'Bảng xếp hạng' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Bước nhỏ mỗi ngày')).toBeNull();
    await act(async () => held.release());
    expect(await screen.findByText('Bước nhỏ mỗi ngày')).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Đang tải' })).toBeNull();
    view.unmount();
  });

  test('a read the server could not answer: calm words and "Thử lại", which asks again', async () => {
    seedGuild();
    world.guild.boards.current = board();
    let failing = true;
    world.answer = request => (failing && request === BOARD_CURRENT ? refuse(500, 'INTERNAL') : undefined);
    const view = await openLeaderboard();
    expect(await screen.findByText('Chưa tải được bảng xếp hạng. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Bước nhỏ mỗi ngày')).toBeNull();
    failing = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Bước nhỏ mỗi ngày')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được bảng xếp hạng. Bạn thử lại nhé.')).toBeNull();
    view.unmount();
  });

  test('no connection: the words of the connection, and the week control stays usable', async () => {
    seedGuild();
    world.guild.boards.current = board();
    const view = await openGuild();
    world.down = true;
    fireEvent.press(screen.getByRole('button', { name: 'Xem bảng xếp hạng' }));
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    world.down = false;
    fireEvent.press(screen.getByRole('radio', { name: 'Tuần trước' }));
    expect(await screen.findByRole('header', { name: 'Chưa có kết quả tuần trước' })).toBeTruthy();
    view.unmount();
  });
});
