import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalVi } from '../../shared/i18n/vi/legal';
import * as native from '../../shared/native/hoiMauNative';
import { ACCOUNT_PURGE_DAYS } from './rules';
import { act, app, fetchMock, fireEvent, hold, installTodayTestEnv, openPrivacy, queryClient, reads, screen, settle, waitFor, world } from './settingsTestKit';

// The wrapper of Task 35 is the boundary: what it is given is asserted, the system's share box is not opened.
jest.mock('../../shared/native/hoiMauNative', () => ({ ...jest.requireActual('../../shared/native/hoiMauNative'), shareTextFile: jest.fn() }));
const share = jest.mocked(native.shareTextFile);

installTodayTestEnv();
beforeEach(() => {
  share.mockReset();
  share.mockResolvedValue(undefined);
});

const MARKER = 'MARKER-NHAT-KY';
const exportRow = () => screen.getByRole('button', { name: /^Tải dữ liệu của tôi\./ });
const pressExport = () => fireEvent.press(exportRow());
const exported = () => reads('/me/export');
const exportedAt = (instant: string) => {
  world.privacy.document = { ...world.privacy.document, exportedAt: instant };
};
/** What every output of the app carried: the arguments of every console method. */
const consoleCarried = (needle: string) =>
  (['log', 'info', 'warn', 'error', 'debug'] as const).filter(method => JSON.stringify(jest.mocked(console[method]).mock?.calls ?? []).includes(needle));

describe('S44: the screen', () => {
  test('the frame: the title, the two rows, the card of the deletion in words, and the policy button', async () => {
    const view = await openPrivacy();
    expect(screen.getByRole('header', { name: 'Dữ liệu & quyền riêng tư' })).toBeTruthy();
    expect(screen.getByText('Bạn kiểm soát những gì mình chia sẻ.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dữ liệu riêng của bạn. Số đo, mục tiêu và nhật ký' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tải dữ liệu của tôi. Xuất bản sao dưới dạng JSON' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Xóa tài khoản' })).toBeTruthy();
    expect(screen.getByText('Tài khoản sẽ bị vô hiệu hóa. Dữ liệu được xóa theo thời hạn trong chính sách riêng tư.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem & xác nhận xóa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đọc chính sách riêng tư' })).toBeTruthy();
    view.unmount();
  });

  test('"Dữ liệu riêng của bạn": the sheet says who sees what, and closes', async () => {
    const view = await openPrivacy();
    fireEvent.press(screen.getByRole('button', { name: /^Dữ liệu riêng của bạn\./ }));
    expect(await screen.findByText('Số đo, mục tiêu và nhật ký chỉ mình bạn xem được.')).toBeTruthy();
    expect(screen.getByText('Thành viên tổ đội chỉ thấy tên hiển thị, cấp độ và việc bạn đã hoàn thành.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByText('Số đo, mục tiêu và nhật ký chỉ mình bạn xem được.')).toBeNull();
    view.unmount();
  });

  test('"Đọc chính sách riêng tư": the sheet holds the whole of legalVi', async () => {
    const view = await openPrivacy();
    fireEvent.press(screen.getByRole('button', { name: 'Đọc chính sách riêng tư' }));
    expect(await screen.findByRole('header', { name: legalVi.title })).toBeTruthy();
    expect(screen.getByText(legalVi.intro)).toBeTruthy();
    for (const { heading, body } of legalVi.sections) {
      expect(screen.getByText(heading)).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
    }
    view.unmount();
  });

  test('the card of the deletion opens S52, and nothing is sent by that', async () => {
    const view = await openPrivacy();
    const before = fetchMock.mock.calls.length;
    fireEvent.press(screen.getByRole('button', { name: 'Xem & xác nhận xóa' }));
    expect(await screen.findByRole('header', { name: 'Xóa tài khoản?' })).toBeTruthy();
    expect(fetchMock.mock.calls.slice(before).filter(([, init]) => init.method !== 'GET')).toEqual([]);
    view.unmount();
  });

  test('the number of days after which the data is erased is the server\'s (61-privacy.sql)', () => {
    const sql = readFileSync(join(__dirname, '../../../server/sql/61-privacy.sql'), 'utf8');
    expect(/purge_after = app\.now\(\) \+ interval '(\d+) days'/.exec(sql)?.[1]).toBe(String(ACCOUNT_PURGE_DAYS));
  });
});

describe('S44: the copy of the data', () => {
  test('one request, then the share call once with a .json name and the document as text that reads back as what the server sent', async () => {
    const view = await openPrivacy();
    pressExport();
    expect(await screen.findByText('Đã tạo bản sao')).toBeTruthy();
    expect(exported()).toBe(1);
    expect(share).toHaveBeenCalledTimes(1);
    const [name, mime, text] = share.mock.calls[0];
    expect(name).toBe('hoi-mau-du-lieu-2026-10-14.json');
    expect(mime).toBe('application/json');
    expect(JSON.parse(text)).toEqual(world.privacy.document);
    expect(text).toBe(JSON.stringify(world.privacy.document, null, 2));
    view.unmount();
  });

  test('the date of the name is the one of the person\'s own zone, not of the clock of the server', async () => {
    exportedAt('2026-10-14T20:30:00.000Z'); // 03:30 on the 15th in Asia/Ho_Chi_Minh
    const view = await openPrivacy();
    pressExport();
    await screen.findByText('Đã tạo bản sao');
    expect(share.mock.calls[0][0]).toBe('hoi-mau-du-lieu-2026-10-15.json');
    view.unmount();
  });

  test('while the copy is prepared: the words, the row is busy and disabled, a second press sends nothing, and the share box is not reached before the answer', async () => {
    const gate = hold('GET /me/export');
    const view = await openPrivacy();
    pressExport();
    expect(await screen.findByText('Đang chuẩn bị bản sao…')).toBeTruthy();
    expect(exportRow().props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    fireEvent.press(exportRow());
    fireEvent.press(exportRow());
    await settle();
    expect(exported()).toBe(1);
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByText('Đã tạo bản sao')).toBeNull();
    await act(async () => gate.release());
    expect(await screen.findByText('Đã tạo bản sao')).toBeTruthy();
    expect(screen.queryByText('Đang chuẩn bị bản sao…')).toBeNull();
    expect(exportRow().props.accessibilityState).toMatchObject({ busy: false });
    expect(share).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('two presses before the screen has re-rendered (a stale handler) are still one request', async () => {
    const view = await openPrivacy();
    act(() => {
      pressExport();
      pressExport();
    });
    await screen.findByText('Đã tạo bản sao');
    expect(exported()).toBe(1);
    expect(share).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('the row stays disabled while the share call itself is open (each share replaces the file of the one before)', async () => {
    let finish!: () => void;
    share.mockReturnValue(new Promise<void>(resolve => (finish = resolve)));
    const view = await openPrivacy();
    pressExport();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Đang chuẩn bị bản sao…')).toBeTruthy();
    fireEvent.press(exportRow());
    await settle();
    expect(share).toHaveBeenCalledTimes(1);
    expect(exported()).toBe(1);
    // nothing says it worked before the share call has returned
    expect(screen.queryByText('Đã tạo bản sao')).toBeNull();
    await act(async () => finish());
    expect(await screen.findByText('Đã tạo bản sao')).toBeTruthy();
    view.unmount();
  });

  test('what it says afterwards claims no more than was done: a copy was made, and the way to ask for the share box again; not "saved", not "sent"', async () => {
    const view = await openPrivacy();
    pressExport();
    await screen.findByText('Đã tạo bản sao');
    expect(screen.getByText(/Nếu hộp chia sẻ không hiện ra, bạn bấm lại "Tải dữ liệu của tôi"\./)).toBeTruthy();
    expect(screen.queryByText(/đã lưu|đã gửi|đã chia sẻ/i)).toBeNull();
    // asking again is a new request and a new share, and the first notice is gone while it runs
    pressExport();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(exported()).toBe(2);
    view.unmount();
  });

  test('the document is not kept: no query, nothing on disk, no console output carries it', async () => {
    const stored = jest.spyOn(AsyncStorage, 'setItem');
    const storedMany = jest.spyOn(AsyncStorage, 'setMany');
    const logged = (['log', 'info', 'warn', 'debug'] as const).map(method => jest.spyOn(console, method));
    const view = await openPrivacy();
    pressExport();
    await screen.findByText('Đã tạo bản sao');
    await settle();
    expect(share.mock.calls[0][2]).toContain(MARKER);
    expect(JSON.stringify(queryClient().getQueryCache().getAll().map(query => [query.queryKey, query.state.data]))).not.toContain(MARKER);
    expect(JSON.stringify([...stored.mock.calls, ...storedMany.mock.calls])).not.toContain(MARKER);
    const keys = await AsyncStorage.getAllKeys();
    expect(JSON.stringify(await AsyncStorage.getMany(keys))).not.toContain(MARKER);
    expect(logged.flatMap(spy => spy.mock.calls)).toEqual([]);
    expect(consoleCarried(MARKER)).toEqual([]);
    expect(screen.queryByText(new RegExp(MARKER))).toBeNull();
    view.unmount();
  });

  test('a document too large for this phone: the words of the brief, and no retry (it would be the same)', async () => {
    share.mockRejectedValue(new native.ShareUnavailableError('too long'));
    const view = await openPrivacy();
    pressExport();
    expect(await screen.findByText('Bản sao quá lớn để chia sẻ trên máy này')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(screen.queryByText('Đã tạo bản sao')).toBeNull();
    expect(exportRow().props.accessibilityState).toMatchObject({ busy: false });
    view.unmount();
  });

  test('the share box could not be opened: said so, with a retry that makes a new copy', async () => {
    share.mockRejectedValueOnce(new Error('no activity'));
    const view = await openPrivacy();
    pressExport();
    expect(await screen.findByText('Chưa mở được hộp chia sẻ. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Đã tạo bản sao')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã tạo bản sao')).toBeTruthy();
    expect(screen.queryByText('Chưa mở được hộp chia sẻ. Bạn thử lại nhé.')).toBeNull();
    expect(exported()).toBe(2);
    view.unmount();
  });

  test('the sixth copy within an hour: the server says 429 and the screen explains it calmly, with a retry; nothing is shared for it', async () => {
    const view = await openPrivacy();
    for (let n = 1; n <= 5; n += 1) {
      pressExport();
      await waitFor(() => expect(share).toHaveBeenCalledTimes(n));
      await settle();
    }
    pressExport();
    expect(await screen.findByText('Bạn đã tải bản sao nhiều lần trong một giờ qua. Chờ một lúc rồi thử lại nhé, dữ liệu của bạn vẫn nguyên.')).toBeTruthy();
    expect(share).toHaveBeenCalledTimes(5);
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByText(/lỗi|thất bại/i)).toBeNull();
    view.unmount();
  });

  test('no connection: said so with a retry; once the connection is back, the retry makes the copy', async () => {
    const view = await openPrivacy();
    world.down = true;
    pressExport();
    expect(await screen.findByText(/^Chưa tạo được bản sao\. Không kết nối được mạng\./)).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã tạo bản sao')).toBeTruthy();
    expect(screen.queryByText(/^Chưa tạo được bản sao\./)).toBeNull();
    view.unmount();
  });

  test('a person who signed out while the copy was on its way gets nothing shared', async () => {
    const gate = hold('GET /me/export');
    const view = await openPrivacy();
    pressExport();
    await screen.findByText('Đang chuẩn bị bản sao…');
    await act(() => app.session.signOut());
    await act(async () => gate.release());
    await settle();
    expect(share).not.toHaveBeenCalled();
    view.unmount();
  });
});
