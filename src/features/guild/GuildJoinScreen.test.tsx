import { fireEvent, fullTeam, hold, installTodayTestEnv, landed, openJoin, queryClient, requested, screen, seedGuild, seedOtherGuild, settle, world, writesOf } from './guildTestKit';

installTodayTestEnv();

const JOIN = 'POST /guilds/join';
const joinPath = '/guilds/join';
const field = () => screen.getByLabelText(/^Mã mời/);
const typeCode = (text: string) => fireEvent.changeText(field(), text);
const submit = () => screen.getByRole('button', { name: 'Kiểm tra & tham gia' });
const INVALID = 'Mã này chưa đúng, bạn kiểm tra lại nhé';

describe('S26: the invite code', () => {
  test('one field "Mã mời", the card, "Kiểm tra & tham gia", and that a person belongs to one guild only', async () => {
    const view = await openJoin();
    expect(screen.getByRole('header', { name: 'Tham gia tổ đội' })).toBeTruthy();
    expect(screen.getByText('Bạn có mã từ bạn bè?')).toBeTruthy();
    expect(field()).toBeTruthy();
    expect(submit()).toBeTruthy();
    expect(screen.getByText('Bạn chỉ thuộc một tổ đội tại một thời điểm.')).toBeTruthy();
    view.unmount();
  });

  test('the code is upper-cased as it is typed, kept to 8 characters, and sent upper-cased', async () => {
    const guild = seedOtherGuild({ inviteCode: 'NHJPM2K9' });
    const view = await openJoin();
    typeCode('nhjpm2k9');
    expect(field().props.value).toBe('NHJPM2K9');
    typeCode('nhjp m2k9zz');
    expect(field().props.value).toBe('NHJPM2K9');
    typeCode('nhjpm2k9');
    fireEvent.press(submit());
    expect(await screen.findByRole('header', { name: guild.name })).toBeTruthy();
    const sent = writesOf(joinPath);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ inviteCode: 'NHJPM2K9' });
    view.unmount();
  });

  test('success: the guild is read again from the server and the tab shows S27 with the person among the members', async () => {
    const guild = seedOtherGuild();
    const view = await openJoin();
    const reads = requested('/guilds/me');
    typeCode('abcd2345');
    fireEvent.press(submit());
    expect(await screen.findByRole('header', { name: guild.name })).toBeTruthy();
    await landed();
    expect(requested('/guilds/me')).toBeGreaterThan(reads);
    expect(screen.getByRole('header', { name: 'Có bạn, dễ bắt đầu hơn.' })).toBeTruthy();
    expect(screen.getByText('An · bạn')).toBeTruthy();
    expect(screen.getByText('Bình')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Đi cùng người quen' })).toBeNull();
    view.unmount();
  });

  test('success also reaches the weekly ranking: a query of it is marked old', async () => {
    seedOtherGuild();
    const view = await openJoin();
    queryClient().setQueryData(['leaderboard'], { entries: [] });
    typeCode('abcd2345');
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'Tổ khác' });
    await landed();
    expect(queryClient().getQueryState(['leaderboard'])?.isInvalidated).toBe(true);
    view.unmount();
  });

  test('a code that no guild has (INVITE_CODE_INVALID, 404): the words at the field, still on S26', async () => {
    seedOtherGuild();
    const view = await openJoin();
    typeCode('zzzz2222');
    fireEvent.press(submit());
    expect(await screen.findByText(INVALID)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Tham gia tổ đội' })).toBeTruthy();
    expect(writesOf(joinPath)).toHaveLength(1);
    // editing the code takes the message away
    typeCode('zzzz222');
    expect(screen.queryByText(INVALID)).toBeNull();
    view.unmount();
  });

  test('a code of another length is no guild\'s: the same words, and no request', async () => {
    const view = await openJoin();
    typeCode('abc');
    fireEvent.press(submit());
    expect(await screen.findByText(INVALID)).toBeTruthy();
    typeCode('');
    fireEvent.press(submit());
    expect(await screen.findByText(INVALID)).toBeTruthy();
    expect(writesOf(joinPath)).toEqual([]);
    view.unmount();
  });

  test('a full guild (GUILD_FULL): "Tổ đội này đã đủ 8 thành viên"', async () => {
    seedOtherGuild({ members: fullTeam() });
    const view = await openJoin();
    typeCode('abcd2345');
    fireEvent.press(submit());
    expect(await screen.findByText('Tổ đội này đã đủ 8 thành viên')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Tham gia tổ đội' })).toBeTruthy();
    view.unmount();
  });

  test('already in a guild (ALREADY_IN_GUILD): said in words, and the tab, read again, shows the guild the person is in', async () => {
    seedOtherGuild();
    const view = await openJoin();
    // meanwhile (another device) the person made a guild: the screen did not know
    seedGuild({ id: '00000000-0000-4000-9000-900000000003', name: 'Nhóm đã có', inviteCode: 'KLMN4567' });
    typeCode('abcd2345');
    fireEvent.press(submit());
    expect(await screen.findByText('Bạn đang ở trong một tổ đội rồi. Muốn đổi nhóm thì rời nhóm hiện tại trước nhé.')).toBeTruthy();
    await landed();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Nhóm đã có' })).toBeTruthy();
    view.unmount();
  });

  test('no connection: the words and "Thử lại", which sends the SAME request (one key) and then succeeds', async () => {
    seedOtherGuild();
    const view = await openJoin();
    typeCode('abcd2345');
    world.down = true;
    fireEvent.press(submit());
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Tổ khác' })).toBeTruthy();
    const sent = writesOf(joinPath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    expect(sent[0].id).toMatch(/^[0-9a-f-]{36}$/);
    view.unmount();
  });

  test('after the server has answered (a refusal included) the same code is a NEW request with a new key', async () => {
    const full = seedOtherGuild({ members: fullTeam() });
    const view = await openJoin();
    typeCode('abcd2345');
    fireEvent.press(submit());
    await screen.findByText('Tổ đội này đã đủ 8 thành viên');
    // room is made (a member left); the same code again
    full.members = full.members.slice(1);
    fireEvent.press(submit());
    expect(await screen.findByRole('header', { name: 'Tổ khác' })).toBeTruthy();
    const sent = writesOf(joinPath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).not.toBe(sent[0].id);
    view.unmount();
  });

  test('a double press is ONE request, and the button says it is busy meanwhile', async () => {
    seedOtherGuild();
    const view = await openJoin();
    typeCode('abcd2345');
    const gate = hold(JOIN);
    const button = submit();
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);
    await settle();
    expect(submit().props.accessibilityState).toMatchObject({ busy: true });
    gate.release();
    expect(await screen.findByRole('header', { name: 'Tổ khác' })).toBeTruthy();
    await settle();
    expect(writesOf(joinPath)).toHaveLength(1);
    view.unmount();
  });

  test('nothing about the guild changes on screen before the server has answered', async () => {
    seedOtherGuild();
    const view = await openJoin();
    typeCode('abcd2345');
    const gate = hold(JOIN);
    fireEvent.press(submit());
    await settle();
    expect(screen.getByRole('header', { name: 'Tham gia tổ đội' })).toBeTruthy();
    gate.release();
    await screen.findByRole('header', { name: 'Tổ khác' });
    view.unmount();
  });
});
