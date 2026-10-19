import { NUDGE_TEMPLATES } from '../../../server/content/nudgeTemplates.ts';
import { act, fetchMock, fireEvent, hold, installTodayTestEnv, landed, openGuild, openNudge, refuse, requested, screen, seedGuild, world, writesOf } from './guildTestKit';
import { forget, navigations } from './navigationSpy';

// The real registry; the latest `navigation` of each screen is kept, to open the nudge with a member whose reason is known.
jest.mock('../../app/screens', () => require('./navigationSpy').spied(jest.requireActual('../../app/screens')));

installTodayTestEnv();
beforeEach(forget);

const NUDGE = '/guilds/nudge';
const SEND = 'POST /guilds/nudge';
const TEMPLATES = '/guilds/nudge-templates';
const minh = () => world.guild.teams[0].members[2];
const MOVE = /^Mình cùng vận động nhé\?/;
const sendButton = () => screen.getByRole('button', { name: 'Gửi cho Minh' });
const choose = (template: RegExp = MOVE) => fireEvent.press(screen.getByRole('radio', { name: template }));
const sentWords = 'Đã gửi lời nhắc';

describe('from the guild screen', () => {
  test('a member who can be nudged opens S29: the name, the fixed lines from the server in its order, the rule, the two actions', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    expect(screen.getByRole('header', { name: 'Gửi một lời nhắc' })).toBeTruthy();
    expect(screen.getByText('Một lời mời nhẹ nhàng cho Minh.')).toBeTruthy();
    const texts = [...NUDGE_TEMPLATES].sort((a, b) => (a.code < b.code ? -1 : 1)).map(template => template.text);
    const rows = screen.getAllByRole('radio');
    expect(rows).toHaveLength(texts.length);
    // in the order of the server's list (by code), none chosen
    texts.forEach((text, n) => {
      expect(rows[n]).toHaveTextContent(text, { exact: false });
      expect(rows[n]).toHaveProp('accessibilityState', expect.objectContaining({ checked: false }));
    });
    expect(screen.getAllByText('Mẫu lời nhắc')).toHaveLength(texts.length);
    expect(screen.getByLabelText('Lời nhắc có sẵn')).toBeTruthy();
    expect(screen.getByText('Chỉ gửi khi Minh cho phép, trong giờ nhận nhắc và còn lượt gửi.')).toBeTruthy();
    expect(sendButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Để lúc khác' })).toBeTruthy();
    expect(requested(TEMPLATES)).toBe(1);
    expect(writesOf(NUDGE)).toEqual([]);
    view.unmount();
  });

  test('"Để lúc khác" and Back both close it and nothing is sent', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    fireEvent.press(screen.getByRole('button', { name: 'Để lúc khác' }));
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Gửi một lời nhắc' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: /^Minh\./ }));
    expect(await screen.findByRole('header', { name: 'Gửi một lời nhắc' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    expect(writesOf(NUDGE)).toEqual([]);
    view.unmount();
  });
});

describe('choosing and sending', () => {
  test('a line has to be chosen: the button is disabled and says why until one is; choosing moves the mark; nothing goes out from a disabled button', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText('Chọn một lời nhắc để gửi')).toBeTruthy();
    fireEvent.press(sendButton());
    expect(writesOf(NUDGE)).toEqual([]);
    choose();
    expect(screen.getByRole('radio', { name: MOVE, checked: true })).toBeTruthy();
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByText('Chọn một lời nhắc để gửi')).toBeNull();
    choose(/^Hôm nay bạn thế nào\?/);
    expect(screen.getByRole('radio', { name: /^Hôm nay bạn thế nào\?/, checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: MOVE, checked: false })).toBeTruthy();
    view.unmount();
  });

  test('sending posts the receiver and the code with a key; the button becomes "Đã gửi lời nhắc", the turns left are said, the sheet closes with "Đóng"; it does not turn into a refusal when the guild is read again', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    const before = requested('/guilds/me');
    fireEvent.press(sendButton());
    expect(await screen.findByRole('button', { name: sentWords })).toBeDisabled();
    const [request] = writesOf(NUDGE);
    expect(request.body).toEqual({ receiverId: minh().userId, templateCode: 'MOVE_TOGETHER' });
    expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText('Hôm nay bạn còn 2 lượt nhắc.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Để lúc khác' })).toBeNull();
    // the receiver's row changes on the server: the guild is read again, and this screen stays what it was
    await landed();
    expect(requested('/guilds/me')).toBeGreaterThan(before);
    expect(screen.getByRole('button', { name: sentWords })).toBeTruthy();
    expect(screen.queryByText('Chưa gửi được lúc này')).toBeNull();
    // the rows cannot be changed any more
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    expect(screen.getByText('Hôm nay bạn ấy đã được nhắc rồi')).toBeTruthy();
    expect(writesOf(NUDGE)).toHaveLength(1);
    view.unmount();
  });

  test('a double press sends one request: the button is busy while it is out, and a press after the answer is of a disabled button', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    const out = hold(SEND);
    fireEvent.press(sendButton());
    fireEvent.press(sendButton());
    expect(screen.getByRole('button', { name: 'Gửi cho Minh', busy: true })).toBeTruthy();
    await act(async () => out.release());
    fireEvent.press(await screen.findByRole('button', { name: sentWords }));
    expect(writesOf(NUDGE)).toHaveLength(1);
    expect(world.guild.sent).toHaveLength(1);
    view.unmount();
  });

  test('the key: a lost connection keeps it for the retry, an answer of the server (a refusal included) ends it', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    let down = true;
    world.answer = request => {
      if (down && request === SEND) throw new TypeError('Network request failed');
      return undefined;
    };
    fireEvent.press(sendButton());
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gửi cho Minh' })).toBeEnabled();
    expect(world.guild.sent).toEqual([]);
    down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: sentWords })).toBeTruthy();
    const [first, again] = writesOf(NUDGE).map(request => request.id);
    expect(again).toBe(first);
    expect(world.guild.sent).toHaveLength(1);
    view.unmount();
  });

  test('after the server answered (it said no), the next send is a new request with a new key', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    let broken = true;
    world.answer = request => (broken && request === SEND ? refuse(500, 'INTERNAL') : undefined);
    fireEvent.press(sendButton());
    expect(await screen.findByText('Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    broken = false;
    fireEvent.press(sendButton());
    expect(await screen.findByRole('button', { name: sentWords })).toBeTruthy();
    const [first, second] = writesOf(NUDGE).map(request => request.id);
    expect(second).not.toBe(first);
    expect(screen.queryByText('Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeNull();
    view.unmount();
  });

  test('too many requests in a minute: the calm line of the limit, the form stays, nothing is sent twice', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    world.answer = request => (request === SEND ? refuse(429, 'RATE_LIMITED') : undefined);
    fireEvent.press(sendButton());
    expect(await screen.findByText('Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Chưa gửi được lúc này')).toBeNull();
    expect(screen.getByRole('button', { name: 'Gửi cho Minh' })).toBeEnabled();
    view.unmount();
  });

  test('a line the server no longer has: said, the choice cleared, the list read again', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    world.answer = request => (request === SEND ? refuse(422, 'NUDGE_TEMPLATE_UNKNOWN') : undefined);
    fireEvent.press(sendButton());
    expect(await screen.findByText('Lời nhắc này không còn nữa. Bạn chọn một lời nhắc khác nhé.')).toBeTruthy();
    await landed();
    expect(requested(TEMPLATES)).toBe(2);
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole('radio', { name: MOVE, checked: false })).toBeTruthy();
    view.unmount();
  });
});

describe('S74: the server says not now', () => {
  const REFUSALS: [string, () => void, string][] = [
    ['NUDGE_RECEIVER_MUTED', () => {
      minh().muted = true;
    }, 'Thành viên này đã tắt nhắc nhở'],
    ['NUDGE_RECEIVER_LIMIT', () => {
      minh().nudgedToday = true;
    }, 'Minh đã nhận một lời nhắc hôm nay'],
    ['NUDGE_SENDER_LIMIT', () => {
      world.guild.nudgesSent = 3;
    }, 'Bạn đã gửi đủ 3 lời nhắc hôm nay'],
    ['NUDGE_OUTSIDE_WINDOW', () => {
      world.hour = 21;
    }, 'Chỉ gửi được từ 12:00 đến 20:00 theo giờ của Minh'],
    ['NUDGE_NOT_NEEDED', () => {
      minh().storyDone = true;
    }, 'Minh đã xong việc chính hôm nay'],
    ['NUDGE_NOT_SAME_GUILD', () => {
      world.guild.teams[0].members = world.guild.teams[0].members.filter(member => member !== minh());
    }, 'Chưa nhắc được lúc này'],
    ['NOT_IN_GUILD', () => {
      world.guild.teams = [];
    }, 'Chưa nhắc được lúc này'],
  ];
  test.each(REFUSALS)('%s after the send: its words, one way out, and the guild is read again', async (_code, arrange, words) => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    arrange();
    const before = requested('/guilds/me');
    fireEvent.press(sendButton());
    expect(await screen.findByRole('header', { name: 'Chưa gửi được lúc này' })).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.getAllByRole('button').map(button => button.props.accessibilityLabel ?? '')).not.toContain('Gửi cho Minh');
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Để lúc khác' })).toBeTruthy();
    expect(world.guild.sent).toEqual([]);
    await landed();
    expect(requested('/guilds/me')).toBeGreaterThan(before);
    // still S74 after the read: the reason does not depend on what the guild now says
    expect(screen.getByText(words)).toBeTruthy();
    view.unmount();
  });

  test('"Để lúc khác" leaves S74', async () => {
    seedGuild();
    const view = await openNudge('Minh');
    choose();
    minh().muted = true;
    fireEvent.press(sendButton());
    expect(await screen.findByRole('header', { name: 'Chưa gửi được lúc này' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Để lúc khác' }));
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    view.unmount();
  });
});

describe('S74: the reason is already known', () => {
  const KNOWN: [string, () => void, string][] = [
    ['NUDGE_RECEIVER_MUTED', () => undefined, 'Thành viên này đã tắt nhắc nhở'],
    ['NUDGE_RECEIVER_LIMIT', () => {
      minh().nudgedToday = true;
    }, 'Minh đã nhận một lời nhắc hôm nay'],
    ['NUDGE_SENDER_LIMIT', () => {
      world.guild.nudgesSent = 3;
    }, 'Bạn đã gửi đủ 3 lời nhắc hôm nay'],
    ['NUDGE_OUTSIDE_WINDOW', () => {
      world.hour = 21;
    }, 'Chỉ gửi được từ 12:00 đến 20:00 theo giờ của Minh'],
    ['NUDGE_NOT_NEEDED', () => {
      minh().storyDone = true;
    }, 'Minh đã xong việc chính hôm nay'],
  ];
  test.each(KNOWN)('%s in the guild read: the screen opens as S74 and asks for nothing about a nudge (the guild is only read again to confirm)', async (_code, arrange, words) => {
    seedGuild();
    arrange();
    const view = await openGuild();
    const [asked, name] = _code === 'NUDGE_RECEIVER_MUTED' ? [world.guild.teams[0].members[3], 'Hà'] : [minh(), 'Minh'];
    const before = fetchMock.mock.calls.length;
    await act(async () => navigations.Guild.navigate('Nudge', { receiverId: asked.userId, receiverName: name }));
    expect(await screen.findByRole('header', { name: 'Chưa gửi được lúc này' })).toBeTruthy();
    expect(screen.getByText(words.replace('Minh', name))).toBeTruthy();
    expect(screen.getByText(`Một lời mời nhẹ nhàng cho ${name}.`)).toBeTruthy();
    await landed();
    // the only request is the confirming read of the guild: no templates, no send
    expect(fetchMock.mock.calls.slice(before).map(([url, init]) => `${init.method} ${url.replace('http://localhost:8787/api/v1', '')}`).filter(request => request !== 'GET /guilds/me')).toEqual([]);
    expect(requested(TEMPLATES)).toBe(0);
    expect(writesOf(NUDGE)).toEqual([]);
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.queryByRole('button', { name: `Gửi cho ${name}` })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Để lúc khác' }));
    expect(await screen.findByRole('header', { name: 'Nhịp sống mới' })).toBeTruthy();
    view.unmount();
  });
});

describe('S74 that no longer holds', () => {
  test('the reason was in the guild read this screen opened with, but the confirming read says it is gone: the form appears and the lines are read', async () => {
    seedGuild();
    minh().nudgedToday = true;
    const view = await openGuild();
    minh().nudgedToday = false;
    await act(async () => navigations.Guild.navigate('Nudge', { receiverId: minh().userId, receiverName: 'Minh' }));
    expect(await screen.findByRole('button', { name: 'Gửi cho Minh' })).toBeTruthy();
    expect(await screen.findAllByRole('radio')).toHaveLength(NUDGE_TEMPLATES.length);
    expect(screen.queryByText('Chưa gửi được lúc này')).toBeNull();
    view.unmount();
  });
});

describe('loading and failing', () => {
  test('the lines are being read: a skeleton, no rows and nothing to send yet; then the rows', async () => {
    seedGuild();
    const read = hold(`GET ${TEMPLATES}`);
    const view = await openNudge('Minh');
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(sendButton()).toBeDisabled();
    await act(async () => read.release());
    expect(await screen.findAllByRole('radio')).toHaveLength(NUDGE_TEMPLATES.length);
    view.unmount();
  });

  test('the lines could not be read: calm words and "Thử lại", which reads them again', async () => {
    seedGuild();
    let failing = true;
    world.answer = request => (failing && request === `GET ${TEMPLATES}` ? refuse(500, 'INTERNAL') : undefined);
    const view = await openNudge('Minh');
    expect(await screen.findByText('Chưa tải được các lời nhắc. Bạn thử lại nhé.')).toBeTruthy();
    failing = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findAllByRole('radio')).toHaveLength(NUDGE_TEMPLATES.length);
    view.unmount();
  });
});
