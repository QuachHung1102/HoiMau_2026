import { QUOTES } from '../../../server/content/quotes.ts';
import { forget, navigations } from '../guild/navigationSpy';
import { act, everythingOnDisk, fetchMock, fireEvent, installTodayTestEnv, landed, openList, screen, seedJournal, type JournalRow, world } from './journalTestKit';

// The real registry; the latest `navigation` of each screen is kept, to open S50 with an id no row of the list offers.
jest.mock('../../app/screens', () => require('../guild/navigationSpy').spied(jest.requireActual('../../app/screens')));

installTodayTestEnv();
beforeEach(forget);

const BODY = `Mình rời bàn làm việc sớm hơn một chút và đi bộ quanh nhà.\n\nKhông làm được hết mọi thứ đã định, nhưng khoảng nghỉ đó giúp mình thấy dễ chịu hơn. ${'Thêm một câu nữa. '.repeat(10)}`;
const ENTRY: JournalRow = { id: '00000000-0000-4000-8000-0000000000e1', createdAt: new Date(Date.now() - 60_000).toISOString(), body: BODY, quoteCode: 'Q002', logicalDate: '2026-10-13' };
const quote = QUOTES.find(item => item.code === 'Q002');

async function openEntry() {
  const view = await openList();
  fireEvent.press(screen.getByRole('button', { name: /^Mình rời bàn làm việc/ }));
  await screen.findByRole('header', { name: 'Một trang của bạn' });
  await landed();
  return view;
}

describe('S50', () => {
  test('from the list: the whole text (longer than the preview), its day, the quote it was answered with, who can read it, the way back', async () => {
    seedJournal([ENTRY]);
    const view = await openEntry();
    expect(screen.getByText('Hôm nay')).toBeTruthy();
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(BODY.length).toBeGreaterThan(80);
    expect(screen.getByText(`“${quote?.text}”`)).toBeTruthy();
    expect(screen.getByText('Chỉ bạn xem được')).toBeTruthy();
    expect(screen.getByText('Nhật ký không được chia sẻ')).toBeTruthy();
    // read only: no edit, delete or share anywhere
    expect(screen.queryByRole('button', { name: /chia sẻ|sửa|xóa|xoá|share/i })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/journal/${ENTRY.id}`))).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: 'Về những trang đã viết' }));
    expect(await screen.findByRole('header', { name: 'Những trang đã viết' })).toBeTruthy();
    view.unmount();
  });

  test('Back also returns to the list', async () => {
    seedJournal([ENTRY]);
    const view = await openEntry();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Những trang đã viết' })).toBeTruthy();
    view.unmount();
  });

  test('a page that is not there (another account\'s or deleted): calm words and the way back, not an error screen', async () => {
    const view = await openList();
    act(() => navigations.JournalList.navigate('JournalEntry', { id: '00000000-0000-4000-8000-0000000000ff' }));
    expect(await screen.findByText('Trang này không còn ở đây nữa.')).toBeTruthy();
    expect(screen.queryByText('Chưa tải được dữ liệu')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Về những trang đã viết' }));
    expect(await screen.findByRole('header', { name: 'Những trang đã viết' })).toBeTruthy();
    view.unmount();
  });

  test('a page the server cannot open: the failure with "Thử lại"; the retry asks again', async () => {
    seedJournal([{ ...ENTRY, corrupt: true }, { ...ENTRY, id: '00000000-0000-4000-8000-0000000000e2', body: 'Một trang còn đọc được.', createdAt: new Date(Date.now() - 120_000).toISOString() }]);
    const view = await openList();
    act(() => navigations.JournalList.navigate('JournalEntry', { id: ENTRY.id }));
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    expect(screen.getByText('Chưa mở được trang này. Bạn thử lại nhé.')).toBeTruthy();
    const before = fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/journal/${ENTRY.id}`)).length;
    world.journal.rows = world.journal.rows.map(row => ({ ...row, corrupt: false }));
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(BODY)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/journal/${ENTRY.id}`)).length).toBe(before + 1);
    view.unmount();
  });

  test('the text is read from the server for this screen only: nothing of it is kept on the device', async () => {
    seedJournal([ENTRY]);
    const view = await openEntry();
    expect(await everythingOnDisk()).not.toContain('Mình rời bàn làm việc');
    view.unmount();
  });
});
