import { ScrollView, Share } from 'react-native';
import { within } from '@testing-library/react-native';
import { act, CODE, fireEvent, guildTab, installTodayTestEnv, landed, NAME, openGuild, openToday, queryClient, respond, screen, seedGuild, serverAnswer, world } from './guildTestKit';

// The leaderboard, the nudge and the nudge settings are other tasks' screens: a probe answers each route and shows its params.
jest.mock('../../app/screens', () => require('./guildProbes').withProbes(jest.requireActual('../../app/screens')));

installTodayTestEnv();

const row = (name: string | RegExp) => screen.queryByRole('button', { name });
const probeText = (route: string) => screen.findByRole('header', { name: new RegExp(`^${route} `) });

describe('S25: no guild', () => {
  test('what a guild is for, the two ways in, and that only habit progress is shared', async () => {
    const view = await openGuild();
    expect(screen.getByRole('header', { name: 'Tổ đội' })).toBeTruthy();
    expect(screen.getByText('Cùng nhau giữ nhịp, không so sánh cơ thể.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    expect(screen.getByText('Tạo một nhóm nhỏ hoặc tham gia bằng mã mời từ bạn bè.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tham gia bằng mã mời' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo tổ đội' })).toBeTruthy();
    expect(screen.getByText('Chỉ tiến độ thói quen được chia sẻ. Số đo và nhật ký luôn riêng tư.')).toBeTruthy();
    // no member list, no week bar
    expect(screen.queryByText(/Tuần này/)).toBeNull();
    view.unmount();
  });

  test('"Tham gia bằng mã mời" opens S26, "Tạo tổ đội" opens S42', async () => {
    const view = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Tham gia bằng mã mời' }));
    expect(await screen.findByRole('header', { name: 'Tham gia tổ đội' })).toBeTruthy();
    view.unmount();

    const second = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Tạo tổ đội' }));
    expect(await screen.findByRole('header', { name: 'Tạo tổ đội' })).toBeTruthy();
    second.unmount();
  });
});

describe('S27: the guild', () => {
  test('a member of a guild sees S27, not S25: the name, the week in a number beside a bar, the four members in the words of the frame', async () => {
    seedGuild();
    const view = await openGuild();
    expect(screen.getByRole('header', { name: NAME })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Có bạn, dễ bắt đầu hơn.' })).toBeTruthy();
    expect(screen.getByText('Cùng hoàn thành việc chính hôm nay.')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Tuần này: 79% việc chính hoàn thành' });
    expect(bar.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 79 });
    expect(screen.getByText('Tuần này: 79% việc chính hoàn thành')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Đi cùng người quen' })).toBeNull();
    expect(screen.getByText('An · bạn')).toBeTruthy();
    expect(screen.getByText('Cấp 5 · 6/7 ngày')).toBeTruthy();
    expect(screen.getByText('Linh')).toBeTruthy();
    expect(screen.getByText('Cấp 7 · 7/7 ngày · đã xong hôm nay')).toBeTruthy();
    expect(screen.getByText('Minh')).toBeTruthy();
    expect(screen.getByText('Cấp 3 · 4/7 ngày · có thể nhắc')).toBeTruthy();
    expect(screen.getByText('Hà')).toBeTruthy();
    expect(screen.getByText('Cấp 6 · 5/7 ngày')).toBeTruthy();
    expect(screen.getByText('Đã tắt nhận nhắc nhở')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem bảng xếp hạng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mời bạn & quản lý nhóm' })).toBeTruthy();
    view.unmount();
  });

  test('the guild\'s own words: a motto replaces the line under the name', async () => {
    seedGuild({ motto: 'Cùng giữ những thói quen nhỏ' });
    const view = await openGuild();
    expect(screen.getByText('Cùng giữ những thói quen nhỏ')).toBeTruthy();
    expect(screen.queryByText('Tổ đội của bạn')).toBeNull();
    view.unmount();
  });

  test('the percentage is the server\'s number rounded, not a figure worked out here', async () => {
    seedGuild({ weekCompletion: 0.666 });
    const view = await openGuild();
    expect(screen.getByText('Tuần này: 67% việc chính hoàn thành')).toBeTruthy();
    view.unmount();
  });

  test('"Xem bảng xếp hạng" goes to the leaderboard, "Mời bạn & quản lý nhóm" to S54', async () => {
    seedGuild();
    const view = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Xem bảng xếp hạng' }));
    expect(await probeText('Leaderboard')).toBeTruthy();
    view.unmount();

    world.guild.teams.length = 0;
    seedGuild();
    const second = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Mời bạn & quản lý nhóm' }));
    expect(await screen.findByRole('header', { name: 'Quản lý tổ đội' })).toBeTruthy();
    second.unmount();
  });
});

describe('the member rows: each nudge reason in words, one door to the nudge', () => {
  test('only the member the server says can be nudged is a button, and it opens the nudge with their id and name', async () => {
    seedGuild();
    const view = await openGuild();
    const minh = world.guild.teams[0].members[2];
    fireEvent.press(screen.getByRole('button', { name: /^Minh/ }));
    const opened = await probeText('Nudge');
    expect(opened.props.children).toBe(`Nudge ${JSON.stringify({ receiverId: minh.userId, receiverName: 'Minh' })}`);
    view.unmount();
  });

  test('the caller, a member who is done and one who has muted nudges are not buttons: nothing to tap, nothing opens', async () => {
    seedGuild();
    const view = await openGuild();
    for (const name of [/^An/, /^Linh/, /^Hà/]) expect(row(name)).toBeNull();
    // pressing their text does nothing
    for (const text of ['An · bạn', 'Linh', 'Hà', 'Đã tắt nhận nhắc nhở']) fireEvent.press(screen.getByText(text));
    await landed();
    expect(screen.queryByRole('header', { name: /^Nudge / })).toBeNull();
    expect(screen.getByRole('header', { name: NAME })).toBeTruthy();
    view.unmount();
  });

  test('a member the server refuses is never a button, and the reason is said in their row: outside the window, already nudged today, the caller has sent enough', async () => {
    world.hour = 10;
    seedGuild();
    const outside = await openGuild();
    expect(row(/^Minh/)).toBeNull();
    expect(screen.getByText('Chỉ nhắc được từ 12:00 đến 20:00 theo giờ của bạn ấy')).toBeTruthy();
    outside.unmount();

    world.hour = 19;
    world.guild.teams[0].members[2].nudgedToday = true;
    const nudged = await openGuild();
    expect(row(/^Minh/)).toBeNull();
    expect(screen.getByText('Hôm nay bạn ấy đã được nhắc rồi')).toBeTruthy();
    nudged.unmount();

    world.guild.teams[0].members[2].nudgedToday = false;
    world.guild.nudgesSent = 3;
    const sender = await openGuild();
    expect(row(/^Minh/)).toBeNull();
    expect(screen.getByText('Hôm nay bạn đã nhắc đủ số lần rồi')).toBeTruthy();
    sender.unmount();
  });

  test('a row follows the server when the facts change: once the member is done the row says so and is not a button', async () => {
    seedGuild();
    const view = await openGuild();
    expect(row(/^Minh/)).toBeTruthy();
    world.guild.teams[0].members[2].storyDone = true;
    await act(() => queryClient().invalidateQueries({ queryKey: ['guild'] }));
    expect(await screen.findByText('Cấp 3 · 4/7 ngày · đã xong hôm nay')).toBeTruthy();
    expect(row(/^Minh/)).toBeNull();
    view.unmount();
  });
});

describe('never a measurement of anyone', () => {
  test('a server that sent weight, height and calories with a member (it must not) is still drawn without any of them', async () => {
    seedGuild();
    world.answer = request => {
      if (request !== 'GET /guilds/me') return undefined;
      const state = serverAnswer(request, { headers: {} } as never) as { text(): Promise<string> };
      return state.text().then(text => {
        const body = JSON.parse(text);
        body.guild.members = body.guild.members.map((member: object) => ({ ...member, weightKg: 77.7, heightCm: 177.7, caloriesIn: 9876, calorieTarget: 8765, bmr: 1666.5, tdee: 2555.5 }));
        return respond(200, body);
      });
    };
    const view = await openGuild();
    expect(screen.getByText('Minh')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    for (const leaked of ['77.7', '177.7', '9876', '8765', '1666.5', '2555.5']) expect(tree).not.toContain(leaked);
    // and in the words of the list itself (the other tab is on screen too): no measurement, whatever its name
    const words = within(screen.getByLabelText('Thành viên của tổ đội'))
      .queryAllByText(/.*/)
      .map(node => String(node.props.children))
      .join(' | ');
    expect(words).not.toMatch(/kcal|calo|\bkg\b|\bcm\b|cân nặng|chiều cao|BMR|TDEE/i);
    view.unmount();
  });
});

describe('S76: a guild that has been quiet', () => {
  test('inactive: a calm hint above the list, with the server\'s number of days, the two ways on and nobody named', async () => {
    seedGuild({ inactiveDays: 14 });
    const view = await openGuild();
    expect(screen.getByRole('header', { name: 'Tổ đội đang lặng' })).toBeTruthy();
    expect(screen.getByText('Tổ đội đã yên ắng 14 ngày. Rủ mọi người quay lại hoặc tìm một nhóm mới.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chia sẻ mã mời' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tìm nhóm khác' })).toBeTruthy();
    // the list is still there, with its rows
    expect(screen.getByText('An · bạn')).toBeTruthy();
    expect(screen.getByText('Cấp 3 · 4/7 ngày · có thể nhắc')).toBeTruthy();
    view.unmount();
  });

  test('the hint appears only when the server says inactive: 13 quiet days is S27, 14 is S76', async () => {
    seedGuild({ inactiveDays: 13 });
    const active = await openGuild();
    expect(screen.queryByRole('header', { name: 'Tổ đội đang lặng' })).toBeNull();
    expect(screen.getByRole('header', { name: 'Có bạn, dễ bắt đầu hơn.' })).toBeTruthy();
    active.unmount();

    world.guild.teams[0].inactiveDays = 14;
    const quiet = await openGuild();
    expect(screen.getByRole('header', { name: 'Tổ đội đang lặng' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Có bạn, dễ bắt đầu hơn.' })).toBeNull();
    quiet.unmount();
  });

  test('"Chia sẻ mã mời" shares the invitation with the code; "Tìm nhóm khác" opens S54 where the guild can be left', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    seedGuild({ inactiveDays: 20 });
    const view = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Chia sẻ mã mời' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].message).toContain(CODE);
    expect(share.mock.calls[0][0].message).toContain(NAME);
    fireEvent.press(screen.getByRole('button', { name: 'Tìm nhóm khác' }));
    expect(await screen.findByRole('header', { name: 'Quản lý tổ đội' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Rời tổ đội' })).toBeTruthy();
    share.mockRestore();
    view.unmount();
  });

  test('"Tìm nhóm khác" opens S54 with focus on the leave card and S54 scrolls there, once', async () => {
    const scrollTo = jest.mocked(ScrollView.prototype.scrollTo);
    seedGuild({ inactiveDays: 20 });
    const view = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Tìm nhóm khác' }));
    await screen.findByRole('header', { name: 'Quản lý tổ đội' });
    scrollTo.mockClear();
    fireEvent(screen.getByTestId('guild-leave'), 'layout', { nativeEvent: { layout: { x: 0, y: 640, width: 358, height: 220 } } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 640, animated: false });
    fireEvent(screen.getByTestId('guild-leave'), 'layout', { nativeEvent: { layout: { x: 0, y: 640, width: 358, height: 220 } } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('"Mời bạn & quản lý nhóm" opens S54 at the top: no scrolling', async () => {
    const scrollTo = jest.mocked(ScrollView.prototype.scrollTo);
    seedGuild();
    const view = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Mời bạn & quản lý nhóm' }));
    await screen.findByRole('header', { name: 'Quản lý tổ đội' });
    scrollTo.mockClear();
    fireEvent(screen.getByTestId('guild-leave'), 'layout', { nativeEvent: { layout: { x: 0, y: 640, width: 358, height: 220 } } });
    expect(scrollTo).not.toHaveBeenCalled();
    view.unmount();
  });

  test('a share sheet that cannot open says so in words', async () => {
    const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('no sheet'));
    seedGuild({ inactiveDays: 20 });
    const view = await openGuild();
    fireEvent.press(screen.getByRole('button', { name: 'Chia sẻ mã mời' }));
    expect(await screen.findByText('Chưa mở được bảng chia sẻ. Bạn thử lại nhé.')).toBeTruthy();
    share.mockRestore();
    view.unmount();
  });
});

describe('loading and failing', () => {
  test('the guild cannot be read: the error with "Thử lại", which reads it again; S25 is not shown as if the person had no guild', async () => {
    seedGuild();
    const view = await openToday();
    world.down = true;
    fireEvent.press(guildTab());
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Đi cùng người quen' })).toBeNull();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Có bạn, dễ bắt đầu hơn.' })).toBeTruthy();
    view.unmount();
  });
});
