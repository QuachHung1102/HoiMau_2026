import { act, fireEvent, hold, installTodayTestEnv, openCreate, queryClient, requested, respond, screen, seedGuild, seedOtherGuild, settle, world, writesOf } from './guildTestKit';

installTodayTestEnv();

const CREATE = 'POST /guilds';
const createPath = '/guilds';
const nameField = () => screen.getByLabelText(/^Tên tổ đội/);
const mottoField = () => screen.getByLabelText(/^Khẩu hiệu/);
const submit = () => screen.getByRole('button', { name: 'Tạo nhóm & lấy mã mời' });
const fill = (name: string, motto = '') => {
  fireEvent.changeText(nameField(), name);
  if (motto) fireEvent.changeText(mottoField(), motto);
};
const LENGTH = 'Tên tổ đội cần từ 3 đến 30 ký tự';

describe('S42: making a guild', () => {
  test('the two fields with their limits, the note on what is shared, the main action and the way to the code', async () => {
    const view = await openCreate();
    expect(screen.getByRole('header', { name: 'Tạo tổ đội' })).toBeTruthy();
    expect(screen.getByText('Một nhóm nhỏ, cùng một nhịp tốt hơn.')).toBeTruthy();
    expect(nameField()).toBeTruthy();
    expect(screen.getByText('Từ 3 đến 30 ký tự')).toBeTruthy();
    expect(mottoField()).toBeTruthy();
    expect(screen.getByText('Tối đa 80 ký tự')).toBeTruthy();
    expect(screen.getByText('Sau khi tạo nhóm, bạn nhận mã mời để chia sẻ. Mã không công khai số đo hoặc nhật ký.')).toBeTruthy();
    expect(submit()).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tôi có mã mời rồi' }));
    expect(await screen.findByRole('header', { name: 'Tham gia tổ đội' })).toBeTruthy();
    view.unmount();
  });

  test.each([
    ['empty', ''],
    ['two characters', 'Ab'],
    ['only spaces', '     '],
    ['31 characters', 'a'.repeat(31)],
  ])('a name that is %s: the rule in words at the field, and no request', async (_label, name) => {
    const view = await openCreate();
    fill(name);
    fireEvent.press(submit());
    expect(await screen.findByText(LENGTH)).toBeTruthy();
    expect(writesOf(createPath)).toEqual([]);
    view.unmount();
  });

  test('a name with no letter or digit is refused in words: no request', async () => {
    const view = await openCreate();
    fill('!!!');
    fireEvent.press(submit());
    expect(await screen.findByText('Tên tổ đội cần có chữ hoặc số và không có ký tự ẩn')).toBeTruthy();
    expect(writesOf(createPath)).toEqual([]);
    view.unmount();
  });

  test('the limits are inclusive: 3 and 30 characters are sent', async () => {
    const view = await openCreate();
    fill('Abc');
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'Abc' });
    view.unmount();

    world.guild.teams.length = 0;
    const second = await openCreate();
    fill('b'.repeat(30));
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'b'.repeat(30) });
    expect(writesOf(createPath).map(request => (request.body as { name: string }).name.length)).toEqual([3, 30]);
    second.unmount();
  });

  test('a motto of 81 characters, or with an invisible character, is refused in words: no request; 80 is fine', async () => {
    const view = await openCreate();
    fill('Nhịp mới', 'm'.repeat(81));
    fireEvent.press(submit());
    expect(await screen.findByText('Khẩu hiệu tối đa 80 ký tự')).toBeTruthy();
    fireEvent.changeText(mottoField(), 'ẩn​ký tự');
    fireEvent.press(submit());
    expect(await screen.findByText('Khẩu hiệu không được có ký tự ẩn')).toBeTruthy();
    expect(writesOf(createPath)).toEqual([]);
    fireEvent.changeText(mottoField(), 'm'.repeat(80));
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'Nhịp mới' });
    expect(writesOf(createPath)).toHaveLength(1);
    view.unmount();
  });

  test('editing a field takes its message away, and only its own', async () => {
    const view = await openCreate();
    fill('Ab', 'm'.repeat(81));
    fireEvent.press(submit());
    await screen.findByText(LENGTH);
    expect(screen.getByText('Khẩu hiệu tối đa 80 ký tự')).toBeTruthy();
    fireEvent.changeText(nameField(), 'Abc');
    expect(screen.queryByText(LENGTH)).toBeNull();
    expect(screen.getByText('Khẩu hiệu tối đa 80 ký tự')).toBeTruthy();
    view.unmount();
  });

  test('success: the name and motto are sent trimmed and in NFC; the tab shows S27 with the person as leader, and the code is in S54', async () => {
    const view = await openCreate();
    const decomposed = '  Nhịp sống mới  '.normalize('NFD');
    fill(decomposed, '  Cùng nhau  ');
    fireEvent.press(submit());
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    const sent = writesOf(createPath);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ name: 'Nhịp sống mới', motto: 'Cùng nhau' });
    expect(sent[0].body.name).toBe('Nhịp sống mới'.normalize('NFC'));
    expect(screen.getByText('Cùng nhau')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Có bạn, dễ bắt đầu hơn.' })).toBeTruthy();
    expect(screen.getByText('An · bạn')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Đi cùng người quen' })).toBeNull();
    // the invite code is reachable in the manage screen, with the leader's controls (no one to hand over to yet)
    fireEvent.press(screen.getByRole('button', { name: 'Mời bạn & quản lý nhóm' }));
    expect(await screen.findByRole('header', { name: 'Quản lý tổ đội' })).toBeTruthy();
    expect(screen.getByLabelText('Mã mời của nhóm').props.value).toBe(world.guild.teams[0].inviteCode);
    expect(screen.getByText('Trưởng nhóm')).toBeTruthy();
    view.unmount();
  });

  test('an empty motto is not sent at all', async () => {
    const view = await openCreate();
    fill('Nhịp mới');
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'Nhịp mới' });
    expect(writesOf(createPath)[0].body).toEqual({ name: 'Nhịp mới' });
    view.unmount();
  });

  test('success reads the guild again and marks the weekly ranking old', async () => {
    const view = await openCreate();
    queryClient().setQueryData(['leaderboard'], { entries: [] });
    const reads = requested('/guilds/me');
    fill('Nhịp mới');
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'Nhịp mới' });
    await act(async () => {
      await settle();
      await settle();
    });
    expect(requested('/guilds/me')).toBeGreaterThan(reads);
    expect(queryClient().getQueryState(['leaderboard'])?.isInvalidated).toBe(true);
    view.unmount();
  });

  test('a name another guild has, in any case (GUILD_NAME_TAKEN): the words at the name field; nothing was made', async () => {
    seedOtherGuild({ name: 'Tổ Khác' });
    const view = await openCreate();
    fill('tổ khác');
    fireEvent.press(submit());
    expect(await screen.findByText('Tên này đã có tổ đội dùng rồi, bạn chọn tên khác nhé')).toBeTruthy();
    // at the name field itself, not above the button
    expect(screen.getByLabelText('Tên tổ đội, lỗi: Tên này đã có tổ đội dùng rồi, bạn chọn tên khác nhé')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Tạo tổ đội' })).toBeTruthy();
    expect(world.guild.teams).toHaveLength(1);
    view.unmount();
  });

  test.each([
    ['name', 'Kẻ lười', ''],
    ['motto', 'Nhịp mới', 'Ai thất bại thì thôi'],
  ])('a banned word in the %s (NAME_NOT_ALLOWED): the words above the button; nothing was made', async (_where, name, motto) => {
    const view = await openCreate();
    fill(name, motto);
    fireEvent.press(submit());
    expect(await screen.findByText('Tên hoặc khẩu hiệu này chưa phù hợp. Bạn chọn cách nói khác nhé.')).toBeTruthy();
    expect(world.guild.teams).toHaveLength(0);
    view.unmount();
  });

  test('already in a guild (ALREADY_IN_GUILD): said in words, and the tab shows the guild the person is in', async () => {
    const view = await openCreate();
    seedGuild();
    fill('Nhịp mới');
    fireEvent.press(submit());
    expect(await screen.findByText('Bạn đang ở trong một tổ đội rồi. Muốn đổi nhóm thì rời nhóm hiện tại trước nhé.')).toBeTruthy();
    await act(async () => {
      await settle();
      await settle();
    });
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    view.unmount();
  });

  test('a 422 of the server for a field the screen did not catch is shown at that field (never lost)', async () => {
    const view = await openCreate();
    world.answer = request => (request === CREATE ? respond(422, { error: { code: 'VALIDATION_FAILED', details: { fields: [{ field: 'name', rule: 'format' }] } } }) : undefined);
    fill('Nhịp mới');
    fireEvent.press(submit());
    expect(await screen.findByText('Tên tổ đội cần có chữ hoặc số và không có ký tự ẩn')).toBeTruthy();
    view.unmount();
  });

  test('no connection: the words and "Thử lại" sending the SAME request (one key)', async () => {
    const view = await openCreate();
    fill('Nhịp mới');
    world.down = true;
    fireEvent.press(submit());
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByRole('header', { name: 'Nhịp mới' });
    const sent = writesOf(createPath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    view.unmount();
  });

  test('a refusal ends the attempt: the same name again, once free, is a new request with a new key', async () => {
    seedOtherGuild({ name: 'Nhịp mới' });
    const view = await openCreate();
    fill('Nhịp mới');
    fireEvent.press(submit());
    await screen.findByText('Tên này đã có tổ đội dùng rồi, bạn chọn tên khác nhé');
    world.guild.teams.length = 0;
    fireEvent.press(submit());
    await screen.findByRole('header', { name: 'Nhịp mới' });
    const sent = writesOf(createPath);
    expect(sent).toHaveLength(2);
    expect(sent[1].id).not.toBe(sent[0].id);
    view.unmount();
  });

  test('a double press is ONE request; the button says it is busy', async () => {
    const view = await openCreate();
    fill('Nhịp mới');
    const gate = hold(CREATE);
    const button = submit();
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);
    await settle();
    expect(submit().props.accessibilityState).toMatchObject({ busy: true });
    gate.release();
    await screen.findByRole('header', { name: 'Nhịp mới' });
    await settle();
    expect(writesOf(createPath)).toHaveLength(1);
    expect(world.guild.teams).toHaveLength(1);
    view.unmount();
  });
});
