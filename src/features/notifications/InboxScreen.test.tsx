import { act, fetchMock, fireEvent, hold, inboxItem, installTodayTestEnv, landed, openInbox, refuse, requested, screen, seedInbox, world, writes, writesOf } from './inboxTestKit';
import { forget, navigated } from '../guild/navigationSpy';

// The real registry, every `navigate` recorded: a link is asserted by name, and by the screen that arrives.
jest.mock('../../app/screens', () => require('../guild/navigationSpy').spied(jest.requireActual('../../app/screens')));

installTodayTestEnv();
beforeEach(forget);

const READ = '/inbox/read';
const POST_READ = 'POST /inbox/read';
const NUDGE = () => inboxItem(1, 'NUDGE', { senderName: 'Linh', templateCode: 'MOVE_TOGETHER', text: 'Mình cùng vận động nhé?' });
const MILESTONE = () => inboxItem(2, 'STREAK_MILESTONE', { days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' });
const PET = () => inboxItem(3, 'PET_TIRED', {});
const WEEKLY = () => inboxItem(4, 'GUILD_WEEKLY_RESULT', { rank: 2, coins: 100, weekStart: '2026-10-05' });
const REMINDER = () => inboxItem(5, 'QUEST_REMINDER', {});
const dots = () => screen.queryAllByTestId('unread-dot');
const rowOf = (title: string | RegExp) => screen.getByRole('button', { name: title });
/** What an opened screen has made `navigate` do since the inbox was opened. */
const linked = () => navigated.filter(([to]) => to !== 'Inbox');
const opened = async (options?: Parameters<typeof openInbox>[0]) => {
  const view = await openInbox(options);
  navigated.length = 0;
  return view;
};

describe('from the bell of the home tab', () => {
  test('the bell with unread mail opens S30: the title, the subtitle, the items newest first, each unread one with a dot and the words "chưa đọc"', async () => {
    seedInbox([REMINDER(), NUDGE(), MILESTONE(), inboxItem(9, 'PET_TIRED', {}, { read: true })]);
    const view = await openInbox();
    expect(screen.getByRole('header', { name: 'Hộp thư' })).toBeTruthy();
    expect(screen.getByText('Lời nhắc và những cột mốc của bạn.')).toBeTruthy();
    const names = screen.getAllByRole('button').map(button => button.props.accessibilityLabel).filter((name: string | undefined) => name && !/Quay lại|Cài đặt|Đánh dấu/.test(name));
    expect(names).toEqual([
      'Linh đã nhắc bạn. “Mình cùng vận động nhé?”. chưa đọc',
      'Một cột mốc mới. Xem huy hiệu trong hành trình. chưa đọc',
      'Một việc nhỏ cho hôm nay. Mở Hôm nay để chọn một việc. chưa đọc',
      'Mầm đang đợi bạn. Bắt đầu lại từ một việc nhỏ',
    ]);
    expect(dots()).toHaveLength(3);
    view.unmount();
  });
});

describe('each kind says what it is and leads on', () => {
  const KINDS: [string, () => ReturnType<typeof NUDGE>, string, string | undefined, string | undefined, string | undefined][] = [
    ['NUDGE', NUDGE, 'Linh đã nhắc bạn', '“Mình cùng vận động nhé?”', undefined, undefined],
    ['STREAK_MILESTONE', MILESTONE, 'Một cột mốc mới', 'Xem huy hiệu trong hành trình', 'Journey', 'Hành trình của bạn'],
    ['PET_TIRED', PET, 'Mầm đang đợi bạn', 'Bắt đầu lại từ một việc nhỏ', 'QuestBoard', 'Nhiệm vụ hôm nay'],
    ['GUILD_WEEKLY_RESULT', WEEKLY, 'Kết quả tuần của tổ đội', 'Hạng 2 · +100 xu', 'Leaderboard', 'Bảng xếp hạng'],
    ['QUEST_REMINDER', REMINDER, 'Một việc nhỏ cho hôm nay', 'Mở Hôm nay để chọn một việc', 'Today', 'Hôm nay'],
  ];
  test.each(KINDS)('%s: its words; pressing it marks it read and leads on to where it should', async (_kind, make, title, line, target, arrives) => {
    const item = make();
    seedInbox([item]);
    const view = await opened();
    expect(screen.getByText(title)).toBeTruthy();
    if (line) expect(screen.getByText(line)).toBeTruthy();
    // a row that leads nowhere holds the chevron's place, so the unread dots of all rows share one column
    expect(screen.queryAllByTestId('chevron-spacer')).toHaveLength(target ? 0 : 1);
    fireEvent.press(rowOf(new RegExp(`^${title}`)));
    await landed();
    // the weekly result opens the board of the week it is about: last week's
    expect(linked()).toEqual(target ? [target === 'Leaderboard' ? [target, { week: 'previous' }] : [target]] : []);
    expect(writesOf(READ).map(request => request.body)).toEqual([{ ids: [item.id] }]);
    if (arrives) {
      expect(await screen.findByRole('header', { name: arrives })).toBeTruthy();
      expect(screen.queryByRole('header', { name: 'Hộp thư' })).toBeNull();
      if (target === 'Leaderboard') expect(await screen.findByRole('radio', { name: 'Tuần trước', checked: true })).toBeTruthy();
    } else {
      // the nudge has nowhere to lead: it stays, and now it is read
      expect(screen.getByRole('header', { name: 'Hộp thư' })).toBeTruthy();
    }
    view.unmount();
  });

  test('a weekly result without coins says only the rank', async () => {
    seedInbox([inboxItem(1, 'GUILD_WEEKLY_RESULT', { rank: 5, coins: 0, weekStart: '2026-10-05' })]);
    const view = await opened();
    expect(screen.getByText('Hạng 5')).toBeTruthy();
    view.unmount();
  });
});

describe('opening marks it read', () => {
  test('one request with the id; the dot stays until the server has answered, then goes with the words "chưa đọc"; the unread count of the day follows', async () => {
    seedInbox([NUDGE(), REMINDER()]);
    const view = await opened();
    expect(dots()).toHaveLength(2);
    const out = hold(POST_READ);
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    expect(dots()).toHaveLength(2);
    await act(async () => out.release());
    await landed();
    const [request] = writes();
    expect([request.path, request.body]).toEqual([READ, { ids: [NUDGE().id] }]);
    expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dots()).toHaveLength(1);
    expect(screen.getByLabelText('Linh đã nhắc bạn. “Mình cùng vận động nhé?”')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Linh đã nhắc bạn/ })).toBeNull();
    expect(world.day.unreadCount).toBe(1);
    view.unmount();
  });

  test('a double press sends one request; an item that is read already sends none', async () => {
    seedInbox([NUDGE(), inboxItem(2, 'STREAK_MILESTONE', { days: 7, coins: 50, badgeCode: 'B' }, { read: true })]);
    const view = await opened();
    const out = hold(POST_READ);
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    await act(async () => out.release());
    await landed();
    expect(writesOf(READ)).toHaveLength(1);
    // a read item that leads somewhere still leads there, and asks for nothing
    fireEvent.press(rowOf(/^Một cột mốc mới/));
    expect(await screen.findByRole('header', { name: 'Hành trình của bạn' })).toBeTruthy();
    expect(writesOf(READ)).toHaveLength(1);
    view.unmount();
  });

  test('a link that leads away is followed even when the mark could not be made; the item stays unread, and the person is told', async () => {
    seedInbox([PET()]);
    world.down = false;
    const view = await opened();
    world.answer = request => {
      if (request === POST_READ) throw new TypeError('Network request failed');
      return undefined;
    };
    fireEvent.press(rowOf(/^Mầm đang đợi bạn/));
    expect(await screen.findByRole('header', { name: 'Nhiệm vụ hôm nay' })).toBeTruthy();
    expect(await screen.findByText('Chưa đánh dấu đã đọc được. Bạn thử lại nhé.')).toBeTruthy();
    expect(world.inbox[0].readAt).toBeNull();
    view.unmount();
  });

  test('the key: a lost connection keeps it for the next press of the same item, an answer of the server ends it', async () => {
    seedInbox([NUDGE()]);
    const view = await opened();
    let answer: 'lost' | 'refused' | 'fine' = 'lost';
    world.answer = request => {
      if (request !== POST_READ) return undefined;
      if (answer === 'lost') throw new TypeError('Network request failed');
      return answer === 'refused' ? refuse(500, 'INTERNAL') : undefined;
    };
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    expect(await screen.findByText('Chưa đánh dấu đã đọc được. Bạn thử lại nhé.')).toBeTruthy();
    answer = 'refused';
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    await landed();
    answer = 'fine';
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    await landed();
    const [first, again, afterRefusal] = writesOf(READ).map(request => request.id);
    expect(again).toBe(first);
    expect(afterRefusal).not.toBe(again);
    expect(dots()).toHaveLength(0);
    view.unmount();
  });
});

describe('"Đánh dấu đã đọc"', () => {
  test('marks every unread item with one request that names no ids; the dots, the button and the bell\'s mark all go', async () => {
    seedInbox([NUDGE(), MILESTONE(), REMINDER()]);
    const view = await opened();
    const out = hold(POST_READ);
    fireEvent.press(screen.getByRole('button', { name: 'Đánh dấu đã đọc' }));
    fireEvent.press(screen.getByRole('button', { name: 'Đánh dấu đã đọc' }));
    expect(dots()).toHaveLength(3);
    await act(async () => out.release());
    await landed();
    expect(writesOf(READ).map(request => request.body)).toEqual([{}]);
    expect(dots()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Đánh dấu đã đọc' })).toBeNull();
    expect(world.day.unreadCount).toBe(0);
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('button', { name: 'Hộp thư' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hộp thư, có thư mới' })).toBeNull();
    view.unmount();
  });

  test('nothing to mark: no button', async () => {
    seedInbox([inboxItem(1, 'PET_TIRED', {}, { read: true })]);
    const view = await opened();
    expect(screen.queryByRole('button', { name: 'Đánh dấu đã đọc' })).toBeNull();
    view.unmount();
  });

  test('a lost connection: the words of it and "Thử lại" with the same key; items stay unread until the server has said so', async () => {
    seedInbox([NUDGE(), REMINDER()]);
    const view = await opened();
    let down = true;
    world.answer = request => {
      if (down && request === POST_READ) throw new TypeError('Network request failed');
      return undefined;
    };
    fireEvent.press(screen.getByRole('button', { name: 'Đánh dấu đã đọc' }));
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(dots()).toHaveLength(2);
    down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await landed();
    const [first, again] = writesOf(READ).map(request => request.id);
    expect(again).toBe(first);
    expect(dots()).toHaveLength(0);
    expect(screen.queryByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeNull();
    view.unmount();
  });
});

describe('S75: nothing yet', () => {
  test('what will appear here, and "Cài đặt thông báo", which goes to the settings; the bell had no mark', async () => {
    seedInbox([]);
    const view = await openInbox();
    expect(screen.getByText('Chưa có thư mới')).toBeTruthy();
    expect(screen.getByText('Lời nhắc từ tổ đội và cột mốc của bạn sẽ xuất hiện ở đây.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đánh dấu đã đọc' })).toBeNull();
    // Mầm is decorative here: the words say the same
    expect(screen.queryByRole('image')).toBeNull();
    navigated.length = 0;
    fireEvent.press(screen.getByRole('button', { name: 'Cài đặt thông báo' }));
    expect(navigated).toEqual([['NotificationSettings']]);
    expect(await screen.findByRole('header', { name: 'Thông báo' })).toBeTruthy();
    view.unmount();
  });

  test('with items the settings are at the end of the list', async () => {
    seedInbox([NUDGE()]);
    const view = await opened();
    fireEvent.press(screen.getByRole('button', { name: 'Cài đặt thông báo' }));
    expect(navigated).toEqual([['NotificationSettings']]);
    expect(await screen.findByRole('header', { name: 'Thông báo' })).toBeTruthy();
    view.unmount();
  });
});

describe('pages', () => {
  const many = (count: number) => Array.from({ length: count }, (_, n) => inboxItem(n + 1, 'QUEST_REMINDER', {}, { read: true }));
  const rows = () => screen.queryAllByRole('button', { name: /^Một việc nhỏ cho hôm nay/ });
  /** What the list holds (a long list draws its rows in batches, so the count of drawn rows is not the count of items). */
  const held = (): string[] => screen.getByTestId('inbox-list').props.data.map((item: { id: string }) => item.id);
  const list = () => screen.getByTestId('inbox-list');
  const atEnd = () => fireEvent(list(), 'endReached');
  /** The reads of the inbox so far, as paths with their query. */
  const reads = () => fetchMock.mock.calls.map(([url]) => url.replace('http://localhost:8787/api/v1', '')).filter(url => url === '/inbox' || url.startsWith('/inbox?'));

  test('the first page is the 20 newest; the end of the list asks for the next with the cursor, and its items follow, none twice; the last page asks for nothing more', async () => {
    seedInbox(many(25));
    const view = await openInbox();
    expect(rows()).toHaveLength(20);
    expect(reads()).toEqual(['/inbox']);
    const cursor = `${world.inbox.find(item => item.id === many(25)[19].id)?.createdAt.slice(0, 23)}000Z`;
    await act(async () => atEnd());
    await landed();
    expect(reads()).toEqual(['/inbox', `/inbox?before=${encodeURIComponent(cursor)}`]);
    expect(held()).toEqual(world.inbox.map(item => item.id));
    await act(async () => atEnd());
    await landed();
    expect(reads()).toHaveLength(2);
    view.unmount();
  });

  test('a page that cannot be read: said, with "Thử lại", and scrolling does not hammer the server', async () => {
    seedInbox(many(25));
    const view = await openInbox();
    let failing = true;
    world.answer = request => (failing && request.startsWith('GET /inbox?before=') ? refuse(500, 'INTERNAL') : undefined);
    await act(async () => atEnd());
    await landed();
    expect(await screen.findByText('Chưa tải thêm được thư. Bạn thử lại nhé.')).toBeTruthy();
    expect(rows()).toHaveLength(20);
    // scrolling again does not hammer the server
    await act(async () => atEnd());
    await landed();
    expect(reads()).toHaveLength(2);
    failing = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await landed();
    expect(held()).toEqual(world.inbox.map(item => item.id));
    expect(screen.queryByText('Chưa tải thêm được thư. Bạn thử lại nhé.')).toBeNull();
    view.unmount();
  });

  test('marking an item read reads every page loaded so far again, so a second page keeps its items', async () => {
    seedInbox([...many(24), inboxItem(30, 'NUDGE', { senderName: 'Linh', templateCode: 'X', text: 'Chào' }, { minutesAgo: 0 })]);
    const view = await openInbox();
    await act(async () => atEnd());
    await landed();
    expect(held()).toHaveLength(25);
    fireEvent.press(rowOf(/^Linh đã nhắc bạn/));
    await landed();
    expect(held()).toHaveLength(25);
    expect(dots()).toHaveLength(0);
    view.unmount();
  });
});

describe('a kind this app does not know', () => {
  test('a generic row, a payload that is not what the contract says is left out, and nothing crashes; opening marks it read and goes nowhere', async () => {
    const strange = [
      inboxItem(1, 'SOMETHING_NEW' as never, { x: 1 }),
      inboxItem(2, 'NUDGE', {}),
      inboxItem(3, 'GUILD_WEEKLY_RESULT', {}),
      inboxItem(4, 'ANOTHER_NEW' as never, null as never),
      inboxItem(5, 'GUILD_WEEKLY_RESULT', { rank: 'first', coins: 'many' }),
      inboxItem(6, 'NUDGE', { senderName: 7, text: { nested: true } }),
      inboxItem(7, 'NUDGE', null as never),
    ];
    seedInbox(strange);
    const view = await opened();
    expect(screen.getAllByText('Thông báo mới')).toHaveLength(2);
    expect(screen.getAllByText('Nội dung này chưa hiển thị được ở phiên bản hiện tại.')).toHaveLength(2);
    expect(screen.getAllByText('Một thành viên đã nhắc bạn')).toHaveLength(3);
    expect(screen.getAllByText('Kết quả tuần của tổ đội')).toHaveLength(2);
    expect(screen.queryByText(/Hạng/)).toBeNull();
    expect(dots()).toHaveLength(7);
    fireEvent.press(screen.getAllByRole('button', { name: /^Thông báo mới/ })[0]);
    await landed();
    expect(writesOf(READ).map(request => request.body)).toEqual([{ ids: [strange[0].id] }]);
    expect(linked()).toEqual([]);
    expect(dots()).toHaveLength(6);
    expect(screen.getByRole('header', { name: 'Hộp thư' })).toBeTruthy();
    view.unmount();
  });
});

describe('loading and failing', () => {
  test('first load: the title and a skeleton, no rows; then the items', async () => {
    seedInbox([NUDGE()]);
    const read = hold('GET /inbox');
    const view = await openInbox();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Linh đã nhắc bạn')).toBeNull();
    await act(async () => read.release());
    expect(await screen.findByText('Linh đã nhắc bạn')).toBeTruthy();
    view.unmount();
  });

  test('a read the server could not answer: calm words and "Thử lại"', async () => {
    seedInbox([NUDGE()]);
    let failing = true;
    world.answer = request => (failing && request === 'GET /inbox' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openInbox();
    expect(await screen.findByText('Chưa tải được hộp thư. Bạn thử lại nhé.')).toBeTruthy();
    failing = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Linh đã nhắc bạn')).toBeTruthy();
    expect(requested('/inbox')).toBe(2);
    view.unmount();
  });
});
