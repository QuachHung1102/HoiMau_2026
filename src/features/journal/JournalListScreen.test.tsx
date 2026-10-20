import { act, everythingOnDisk, fetchMock, fireEvent, hold, installTodayTestEnv, landed, openList, refuse, saveText, screen, seedJournal, type JournalRow, world } from './journalTestKit';

// The real registry: S49 is reached from S32 (itself opened from the profile tab).
installTodayTestEnv();

let n = 0;
/** `count` entries, the first the newest: one minute apart, the oldest of them first written. */
const pages = (count: number, more: (at: number) => Partial<JournalRow> = () => ({})): JournalRow[] =>
  Array.from({ length: count }, (_, at) => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    createdAt: new Date(Date.now() - (at + 1) * 60_000).toISOString(),
    body: `Trang số ${at + 1}.`,
    quoteCode: 'Q001',
    logicalDate: '2026-10-13',
    ...more(at),
  }));
/** The GET /journal requests, as asked. */
const asked = () => fetchMock.mock.calls.map(([url]) => String(url)).filter(url => /\/journal(\?|$)/.test(url));
const list = () => screen.getByTestId('journal-list');
const shown = () => list().props.data as { id: string; preview: string }[];
const bottom = async () => {
  fireEvent(list(), 'endReached');
  await landed();
};

describe('S49', () => {
  test('no page yet: the empty state, calm words and "Viết trang mới"; the list was asked for once', async () => {
    const view = await openList();
    expect(screen.getByRole('header', { name: 'Những trang đã viết' })).toBeTruthy();
    expect(screen.getByText('Chưa có trang nào')).toBeTruthy();
    expect(screen.getByText('Trang đầu tiên của bạn sẽ nằm ở đây, chỉ mình bạn đọc được.')).toBeTruthy();
    expect(asked()).toEqual([expect.stringMatching(/\/journal$/)]);
    fireEvent.press(screen.getByRole('button', { name: 'Viết trang mới' }));
    expect(await screen.findByRole('header', { name: 'Góc giải tỏa' })).toBeTruthy();
    view.unmount();
  });

  test('entries newest first, each with its words and its day, then "Viết trang mới" and the line that nothing is shown outside; a row opens S50', async () => {
    const weekday = (date: Date) => ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][date.getDay()];
    const old = new Date(Date.now() - 5 * 24 * 3_600_000);
    seedJournal([
      ...pages(1, () => ({ body: 'Hôm nay mình đã chậm lại.' })),
      ...pages(1, () => ({ body: 'Một ngày không như dự định.\n\nHai đoạn.', createdAt: new Date(Date.now() - 24 * 3_600_000).toISOString() })),
      ...pages(1, () => ({ body: 'Niềm vui nhỏ cuối tuần.', createdAt: old.toISOString() })),
    ]);
    const view = await openList();
    expect(shown().map(entry => entry.preview)).toEqual(['Hôm nay mình đã chậm lại.', 'Một ngày không như dự định.\n\nHai đoạn.', 'Niềm vui nhỏ cuối tuần.']);
    const row = (text: string) => screen.getByRole('button', { name: new RegExp(`^${text}`) });
    expect(row('Hôm nay mình đã chậm lại\\.')).toHaveAccessibleName('Hôm nay mình đã chậm lại.. Hôm nay · chạm để đọc');
    // a break in the words is a space in the row
    expect(row('Một ngày không như dự định').props.accessibilityLabel).toBe('Một ngày không như dự định. Hai đoạn.. Hôm qua · chạm để đọc');
    expect(row('Niềm vui nhỏ cuối tuần')).toHaveAccessibleName(`Niềm vui nhỏ cuối tuần.. ${weekday(old)}, ${old.getDate()}/${old.getMonth() + 1} · chạm để đọc`);
    expect(screen.getByRole('button', { name: 'Viết trang mới' })).toBeTruthy();
    expect(screen.getByText('Nội dung không hiển thị trong thông báo hoặc tổ đội.')).toBeTruthy();
    fireEvent.press(row('Niềm vui nhỏ cuối tuần'));
    const opened = world.journal.rows.find(entry => entry.body === 'Niềm vui nhỏ cuối tuần.')?.id;
    expect(await screen.findByRole('header', { name: 'Một trang của bạn' })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/journal/${opened}`))).toBe(true);
    view.unmount();
  });

  test('paging follows the cursor: the next page is asked for with the id of the last row, once per arrival at the end, and never after the last', async () => {
    const rows = pages(45);
    seedJournal(rows);
    const view = await openList();
    expect(shown()).toHaveLength(20);
    expect(asked()).toHaveLength(1);
    await bottom();
    expect(shown()).toHaveLength(40);
    expect(asked()[1]).toMatch(new RegExp(`before=${rows[19].id}$`));
    await bottom();
    expect(shown()).toHaveLength(45);
    expect(asked()[2]).toMatch(new RegExp(`before=${rows[39].id}$`));
    expect(shown().map(entry => entry.id)).toEqual(rows.map(row => row.id));
    // the last page had no cursor: the end of the list asks for nothing more
    await bottom();
    await bottom();
    expect(asked()).toHaveLength(3);
    view.unmount();
  });

  test('a page can be short and still have a next one (entries the server cannot open are left out): paging goes on by the cursor, not by the length of the page', async () => {
    const rows = pages(23, at => ({ corrupt: at < 3 }));
    seedJournal(rows);
    const view = await openList();
    // 20 rows were read, 3 of them left out: 17 shown, fewer than the page, and a cursor
    expect(shown()).toHaveLength(17);
    await bottom();
    expect(asked()).toHaveLength(2);
    expect(asked()[1]).toMatch(new RegExp(`before=${rows[19].id}$`));
    expect(shown()).toHaveLength(20);
    expect(shown().map(entry => entry.id)).toEqual(rows.filter(row => !row.corrupt).map(row => row.id));
    view.unmount();
  });

  test('a whole page that could not be opened is not "no pages": the next page is asked for by itself, and the empty state shows only when no cursor is left', async () => {
    const rows = pages(22, at => ({ corrupt: at < 20 }));
    seedJournal(rows);
    // while the next page is on its way, the list is loading: not "no pages yet"
    const next = hold(`GET /journal?before=${rows[19].id}`);
    const view = await openList();
    await landed();
    expect(screen.queryByText('Chưa có trang nào')).toBeNull();
    expect(asked()).toHaveLength(2);
    await act(async () => next.release());
    await landed();
    expect(asked()).toHaveLength(2);
    expect(shown()).toHaveLength(2);
    expect(screen.queryByText('Chưa có trang nào')).toBeNull();
    view.unmount();
    // ... and with nothing readable at all, the empty state
    const again = await (async () => {
      world.journal.rows = pages(3, () => ({ corrupt: true }));
      return openList();
    })();
    expect(screen.getByText('Chưa có trang nào')).toBeTruthy();
    again.unmount();
  });

  test('the first read fails: the calm error with "Thử lại", and the retry loads the list', async () => {
    seedJournal(pages(2));
    world.answer = request => {
      if (request === 'GET /journal') throw new TypeError('Network request failed');
      return undefined;
    };
    const view = await openList();
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.getByText(/Không kết nối được mạng/)).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByTestId('journal-list')).toBeTruthy();
    await landed();
    expect(shown()).toHaveLength(2);
    view.unmount();
  });

  test('the next page fails: the list stays, the failure says so with "Thử lại", scrolling does not ask again, the retry does', async () => {
    seedJournal(pages(30));
    const view = await openList();
    world.answer = request => (request.startsWith('GET /journal?before=') ? refuse(500, 'INTERNAL') : undefined);
    await bottom();
    expect(await screen.findByText('Chưa tải thêm được. Bạn thử lại nhé.')).toBeTruthy();
    expect(shown()).toHaveLength(20);
    const times = asked().length;
    await bottom();
    await bottom();
    expect(asked()).toHaveLength(times);
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await landed();
    expect(shown()).toHaveLength(30);
    view.unmount();
  });

  test('a page saved from here shows at the top when the person comes back (the list is read again after a save)', async () => {
    seedJournal(pages(2));
    const view = await openList();
    fireEvent.press(screen.getByRole('button', { name: 'Viết trang mới' }));
    await screen.findByRole('header', { name: 'Góc giải tỏa' });
    await saveText('Một trang mới viết từ danh sách.');
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Những trang đã viết' })).toBeTruthy();
    await landed();
    expect(shown().map(entry => entry.preview)[0]).toBe('Một trang mới viết từ danh sách.');
    expect(shown()).toHaveLength(3);
    view.unmount();
  });

  test('a slow first read shows the loading state, not the empty one', async () => {
    seedJournal(pages(1));
    const gate = hold('GET /journal');
    const view = await openList();
    expect(screen.getByRole('progressbar', { name: 'Đang tải' })).toBeTruthy();
    expect(screen.queryByText('Chưa có trang nào')).toBeNull();
    await act(async () => gate.release());
    await landed();
    expect(shown()).toHaveLength(1);
    view.unmount();
  });
});

describe('the pages are not kept on the device', () => {
  test('nothing of the entries is kept on the device', async () => {
    seedJournal(pages(2, at => ({ body: `Rất riêng tư ${at}` })));
    const view = await openList();
    expect(await everythingOnDisk()).not.toContain('riêng tư');
    view.unmount();
  });
});
