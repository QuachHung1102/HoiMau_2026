import { Share } from 'react-native';
import { act, CODE, fireEvent, hold, installTodayTestEnv, landed, mateOf, mates, NAME, openManage, queryClient, requested, screen, seedGuild, settle, USER, within, world, writesOf } from './guildTestKit';

// The leaderboard and the nudge are answered by probes (guildProbes); the nudge settings are the real screen.
jest.mock('../../app/screens', () => require('./guildProbes').withProbes(jest.requireActual('../../app/screens')));

installTodayTestEnv();

const TRANSFER = 'POST /guilds/me/transfer';
const LEAVE = 'POST /guilds/me/leave';
const transferPath = '/guilds/me/transfer';
const leavePath = '/guilds/me/leave';
const transferTo = (name: string) => screen.getByRole('button', { name: `Chuyển vai trò trưởng nhóm cho ${name}` });
const leaveButton = () => screen.getByRole('button', { name: 'Xem xác nhận rời nhóm' });
const LEADER_RULE = 'Bạn đang là trưởng nhóm và còn thành viên khác. Hãy chuyển vai trò trưởng nhóm cho một người rồi mới rời được.';
const reread = () => act(() => queryClient().invalidateQueries({ queryKey: ['guild'] }));
const linh = () => world.guild.teams[0].members[1];
const members = () => within(screen.getByTestId('guild-members'));
const leaveCard = () => within(screen.getByTestId('guild-leave'));
const OFFLINE = 'Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.';
const mateNamed = (name: string) => world.guild.teams[0].members.find(mate => mate.displayName === name)!;

describe('S54: the code and sharing it', () => {
  test('the invite code in a field that cannot be edited, "Chia sẻ mã mời", the three sections', async () => {
    seedGuild();
    const view = await openManage();
    expect(screen.getByRole('header', { name: 'Quản lý tổ đội' })).toBeTruthy();
    expect(screen.getByText(NAME)).toBeTruthy();
    const code = screen.getByLabelText('Mã mời của nhóm');
    expect(code.props.value).toBe(CODE);
    expect(code.props.editable).toBe(false);
    expect(screen.getByRole('button', { name: 'Chia sẻ mã mời' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Thành viên' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Nhắc nhở trong nhóm/ })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Rời tổ đội' })).toBeTruthy();
    view.unmount();
  });

  test('"Chia sẻ mã mời" opens the system share with a short invitation that holds the code', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    seedGuild();
    const view = await openManage();
    fireEvent.press(screen.getByRole('button', { name: 'Chia sẻ mã mời' }));
    expect(share).toHaveBeenCalledTimes(1);
    const { message } = share.mock.calls[0][0];
    expect(message).toContain(CODE);
    expect(message).toContain(NAME);
    expect(message?.length).toBeLessThan(140);
    share.mockRestore();
    view.unmount();
  });

  test('a share sheet that cannot open says so in words', async () => {
    const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('no sheet'));
    seedGuild();
    const view = await openManage();
    fireEvent.press(screen.getByRole('button', { name: 'Chia sẻ mã mời' }));
    expect(await screen.findByText('Chưa mở được bảng chia sẻ. Bạn thử lại nhé.')).toBeTruthy();
    share.mockRestore();
    view.unmount();
  });

  test('"Nhắc nhở trong nhóm" goes to the nudge settings', async () => {
    seedGuild();
    const view = await openManage();
    fireEvent.press(screen.getByRole('button', { name: /^Nhắc nhở trong nhóm/ }));
    expect(await screen.findByRole('header', { name: 'Thông báo' })).toBeTruthy();
    // the real screen: its own switch, read from the server's settings
    expect(await screen.findByRole('switch', { name: 'Nhận lời nhắc từ tổ đội', checked: true })).toBeTruthy();
    view.unmount();
  });
});

describe('S54: the members and their roles', () => {
  test('a member sees every member with the role in words, and no way to hand anything over', async () => {
    seedGuild({ members: [...mates().map(mate => (mate.displayName === 'Linh' ? { ...mate, role: 'LEADER' as const } : mate))] });
    const view = await openManage();
    expect(screen.getByText('An · bạn')).toBeTruthy();
    expect(screen.getAllByText('Thành viên')).toHaveLength(4); // the heading and three members
    expect(screen.getAllByText('Trưởng nhóm')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Chuyển vai trò/ })).toBeNull();
    view.unmount();
  });

  test('the leader sees "Chuyển vai trò trưởng nhóm" for every OTHER member', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    expect(screen.getAllByText('Trưởng nhóm')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Chuyển vai trò trưởng nhóm cho / })).toHaveLength(3);
    for (const name of ['Linh', 'Minh', 'Hà']) expect(transferTo(name)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chuyển vai trò trưởng nhóm cho An' })).toBeNull();
    view.unmount();
  });
});

describe('S54: handing over leadership', () => {
  test('a confirmation first, with the name; cancelling sends nothing', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    fireEvent.press(transferTo('Linh'));
    expect(await screen.findByRole('header', { name: 'Chuyển vai trò trưởng nhóm?' })).toBeTruthy();
    expect(screen.getByText('Linh sẽ là trưởng nhóm, còn bạn trở thành thành viên. Bạn có thể rời tổ đội sau khi chuyển.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Chưa chuyển' }));
    await settle();
    expect(screen.queryByRole('header', { name: 'Chuyển vai trò trưởng nhóm?' })).toBeNull();
    expect(writesOf(transferPath)).toEqual([]);
    view.unmount();
  });

  test('confirmed: ONE request with the user id, then the new roles from the server: Linh leads, the person is a member with no controls', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    const target = linh().userId;
    fireEvent.press(transferTo('Linh'));
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    expect(await screen.findByText('Linh đã là trưởng nhóm.')).toBeTruthy();
    const sent = writesOf(transferPath);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ userId: target });
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(linh().role).toBe('LEADER');
    expect(world.guild.teams[0].members.find(mate => mate.userId === USER)?.role).toBe('MEMBER');
    expect(screen.queryByRole('button', { name: /^Chuyển vai trò trưởng nhóm cho / })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Chuyển vai trò trưởng nhóm?' })).toBeNull();
    // the old leader can now leave: no explanation, the button works
    expect(screen.queryByText(LEADER_RULE)).toBeNull();
    expect(leaveButton().props.accessibilityState).toMatchObject({ disabled: false });
    view.unmount();
  });

  test('a double press of the confirmation is ONE request', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    fireEvent.press(transferTo('Minh'));
    const confirm = await screen.findByRole('button', { name: 'Chuyển vai trò' });
    const gate = hold(TRANSFER);
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    await settle();
    gate.release();
    expect(await screen.findByText('Minh đã là trưởng nhóm.')).toBeTruthy();
    await settle();
    expect(writesOf(transferPath)).toHaveLength(1);
    view.unmount();
  });

  test('nothing changes before the server has answered: the roles stay as they were while the request is out', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    fireEvent.press(transferTo('Linh'));
    const gate = hold(TRANSFER);
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    await settle();
    expect(screen.queryByText('Linh đã là trưởng nhóm.')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Chuyển vai trò trưởng nhóm cho / })).toHaveLength(3);
    gate.release();
    await screen.findByText('Linh đã là trưởng nhóm.');
    view.unmount();
  });

  test('NOT_LEADER (the person was handed nothing, or lost the role elsewhere): in words, and the roles are read again', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    mateNamed('Linh').role = 'LEADER';
    world.guild.teams[0].members.find(mate => mate.userId === USER)!.role = 'MEMBER';
    fireEvent.press(transferTo('Minh'));
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    expect(await screen.findByText('Bạn không còn là trưởng nhóm nên chưa chuyển được.')).toBeTruthy();
    await landed();
    expect(screen.queryByRole('button', { name: /^Chuyển vai trò trưởng nhóm cho / })).toBeNull();
    view.unmount();
  });

  test('TRANSFER_TARGET_INVALID (the member is gone): in words, and the member list is read again without them', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    world.guild.teams[0].members = world.guild.teams[0].members.filter(mate => mate.displayName !== 'Minh');
    fireEvent.press(transferTo('Minh'));
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    expect(await screen.findByText('Người này không còn trong tổ đội nên chưa chuyển được.')).toBeTruthy();
    await landed();
    expect(screen.queryByText('Minh')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Chuyển vai trò trưởng nhóm cho / })).toHaveLength(2);
    view.unmount();
  });

  test('no connection: the words and "Thử lại" sending the SAME request (one key)', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    fireEvent.press(transferTo('Linh'));
    world.down = true;
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(linh().role).toBe('MEMBER');
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Linh đã là trưởng nhóm.')).toBeTruthy();
    const sent = writesOf(transferPath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    expect(sent[1].body).toEqual(sent[0].body);
    view.unmount();
  });

  test('a transfer that was refused is said in the members section beside its result, with its own "Thử lại"; the leave card stays clean', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    fireEvent.press(transferTo('Linh'));
    world.down = true;
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    await screen.findByText(OFFLINE);
    expect(members().getByText(OFFLINE)).toBeTruthy();
    expect(members().getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(leaveCard().queryByText(OFFLINE)).toBeNull();
    expect(leaveCard().queryByRole('button', { name: 'Thử lại' })).toBeNull();
    world.down = false;
    fireEvent.press(members().getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Linh đã là trưởng nhóm.');
    expect(writesOf(transferPath)).toHaveLength(2);
    expect(writesOf(leavePath)).toEqual([]);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    view.unmount();
  });

  test('a transfer refused by the server (NOT_LEADER) is also said in the members section, not under the leave button', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    mateNamed('Linh').role = 'LEADER';
    world.guild.teams[0].members.find(mate => mate.userId === USER)!.role = 'MEMBER';
    fireEvent.press(transferTo('Minh'));
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    await screen.findByText('Bạn không còn là trưởng nhóm nên chưa chuyển được.');
    expect(members().getByText('Bạn không còn là trưởng nhóm nên chưa chuyển được.')).toBeTruthy();
    expect(leaveCard().queryByText('Bạn không còn là trưởng nhóm nên chưa chuyển được.')).toBeNull();
    view.unmount();
  });

  test('a refused transfer ends the attempt: the same member again is a new request with a new key', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    mateNamed('Linh').role = 'LEADER';
    world.guild.teams[0].members.find(mate => mate.userId === USER)!.role = 'MEMBER';
    fireEvent.press(transferTo('Minh'));
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    await screen.findByText('Bạn không còn là trưởng nhóm nên chưa chuyển được.');
    // the person is the leader again (Linh handed it back), the screen reads it, and the same transfer is asked for
    mateNamed('Linh').role = 'MEMBER';
    world.guild.teams[0].members.find(mate => mate.userId === USER)!.role = 'LEADER';
    await reread();
    await landed();
    fireEvent.press(transferTo('Minh'));
    fireEvent.press(await screen.findByRole('button', { name: 'Chuyển vai trò' }));
    await screen.findByText('Minh đã là trưởng nhóm.');
    const sent = writesOf(transferPath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).not.toBe(sent[0].id);
    view.unmount();
  });
});

describe('S54: leaving', () => {
  test('a member: the card says personal progress stays; the button opens a confirmation; "Ở lại" sends nothing', async () => {
    seedGuild();
    const view = await openManage();
    expect(screen.getByText('Bạn vẫn giữ tiến trình cá nhân.')).toBeTruthy();
    expect(screen.queryByText(LEADER_RULE)).toBeNull();
    fireEvent.press(leaveButton());
    expect(await screen.findByRole('header', { name: 'Rời tổ đội?' })).toBeTruthy();
    expect(screen.getByText(`Bạn sẽ rời tổ đội "${NAME}". Tiến trình cá nhân của bạn (cấp, xu, chuỗi ngày) vẫn được giữ.`)).toBeTruthy();
    expect(writesOf(leavePath)).toEqual([]);
    fireEvent.press(screen.getByRole('button', { name: 'Ở lại' }));
    await settle();
    expect(screen.queryByRole('header', { name: 'Rời tổ đội?' })).toBeNull();
    expect(writesOf(leavePath)).toEqual([]);
    view.unmount();
  });

  test('a member leaves after the confirmation: ONE request, no body; the tab shows S25 and the guild is read again', async () => {
    seedGuild();
    const view = await openManage();
    fireEvent.press(leaveButton());
    fireEvent.press(await screen.findByRole('button', { name: 'Rời tổ đội' }));
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    const sent = writesOf(leavePath);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBeNull();
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(world.guild.teams[0].members.map(mate => mate.displayName)).toEqual(['Linh', 'Minh', 'Hà']);
    await landed();
    expect(screen.getByRole('button', { name: 'Tham gia bằng mã mời' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: NAME })).toBeNull();
    view.unmount();
  });

  test('a double press of the confirmation is ONE request', async () => {
    seedGuild();
    const view = await openManage();
    fireEvent.press(leaveButton());
    const confirm = await screen.findByRole('button', { name: 'Rời tổ đội' });
    const gate = hold(LEAVE);
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    await settle();
    gate.release();
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    await settle();
    expect(writesOf(leavePath)).toHaveLength(1);
    view.unmount();
  });

  test('a leader with members: the explanation is on the screen BEFORE any request, the button cannot be pressed, nothing is sent', async () => {
    seedGuild({ role: 'LEADER' });
    const view = await openManage();
    expect(screen.getByText(LEADER_RULE)).toBeTruthy();
    expect(leaveButton().props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(leaveButton());
    await settle();
    expect(screen.queryByRole('header', { name: 'Rời tổ đội?' })).toBeNull();
    expect(writesOf(leavePath)).toEqual([]);
    view.unmount();
  });

  test('a leader who is alone can leave: the confirmation says the guild and its code go too', async () => {
    seedGuild({ role: 'LEADER', members: [mates()[0]] });
    const view = await openManage();
    expect(screen.queryByText(LEADER_RULE)).toBeNull();
    fireEvent.press(leaveButton());
    expect(await screen.findByText('Bạn là người duy nhất trong tổ đội nên tổ đội và mã mời sẽ được xóa.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Rời tổ đội' }));
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    expect(writesOf(leavePath)).toHaveLength(1);
    expect(world.guild.teams).toHaveLength(0);
    view.unmount();
  });

  test('LEADER_MUST_TRANSFER from the server (a member joined meanwhile): the explanation, the button is off after the guild is read again', async () => {
    seedGuild({ role: 'LEADER', members: [mates()[0]] });
    const view = await openManage();
    world.guild.teams[0].members.push(mateOf(9, 'Mới'));
    fireEvent.press(leaveButton());
    fireEvent.press(await screen.findByRole('button', { name: 'Rời tổ đội' }));
    expect((await screen.findAllByText(LEADER_RULE)).length).toBeGreaterThan(0);
    await landed();
    expect(leaveButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(writesOf(leavePath)).toHaveLength(1);
    view.unmount();
  });

  test('no connection: the words and "Thử lại" sending the SAME request (one key)', async () => {
    seedGuild();
    const view = await openManage();
    fireEvent.press(leaveButton());
    world.down = true;
    fireEvent.press(await screen.findByRole('button', { name: 'Rời tổ đội' }));
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(world.guild.teams[0].members).toHaveLength(4);
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    const sent = writesOf(leavePath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    view.unmount();
  });

  test('a leave that was refused is said in the leave card with its own "Thử lại", which sends the leave and no transfer; the members section stays clean', async () => {
    seedGuild({ role: 'LEADER', members: [mates()[0]] });
    const view = await openManage();
    fireEvent.press(leaveButton());
    world.down = true;
    fireEvent.press(await screen.findByRole('button', { name: 'Rời tổ đội' }));
    await screen.findByText(OFFLINE);
    expect(leaveCard().getByText(OFFLINE)).toBeTruthy();
    expect(members().queryByText(OFFLINE)).toBeNull();
    expect(members().queryByRole('button', { name: 'Thử lại' })).toBeNull();
    world.down = false;
    fireEvent.press(leaveCard().getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    expect(writesOf(leavePath)).toHaveLength(2);
    expect(writesOf(transferPath)).toEqual([]);
    view.unmount();
  });

  test('a confirmed leave reads /guilds/me again and marks the weekly ranking old (the cache is not trusted after leaving)', async () => {
    seedGuild();
    const view = await openManage();
    queryClient().setQueryData(['leaderboard'], { entries: [] });
    const reads = requested('/guilds/me');
    fireEvent.press(leaveButton());
    fireEvent.press(await screen.findByRole('button', { name: 'Rời tổ đội' }));
    await screen.findByRole('header', { name: 'Đi cùng người quen' });
    await landed();
    expect(requested('/guilds/me')).toBeGreaterThan(reads);
    expect(queryClient().getQueryState(['leaderboard'])?.isInvalidated).toBe(true);
    view.unmount();
  });

  test('NOT_IN_GUILD (the person left on another device): in words, and the screen reads the guild again', async () => {
    seedGuild();
    const view = await openManage();
    world.guild.teams.length = 0;
    fireEvent.press(leaveButton());
    fireEvent.press(await screen.findByRole('button', { name: 'Rời tổ đội' }));
    expect(await screen.findByText('Bạn chưa có tổ đội')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Về tab Tổ đội' })).toBeTruthy();
    view.unmount();
  });
});

describe('S54 without a guild', () => {
  test('when the server says there is none the screen says so and leads back to the tab', async () => {
    seedGuild();
    const view = await openManage();
    world.guild.teams.length = 0;
    await reread();
    expect(await screen.findByText('Bạn chưa có tổ đội')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Về tab Tổ đội' }));
    expect(await screen.findByRole('header', { name: 'Đi cùng người quen' })).toBeTruthy();
    view.unmount();
  });
});
