import { act, everythingOnDisk, fetchMock, field, fireEvent, hold, installTodayTestEnv, landed, openWrite, refuse, saveButton, saves, screen, type, world } from './journalTestKit';

// The real registry: S32 is opened from the profile tab, as a person does.
installTodayTestEnv();

const TEXT = 'Hôm nay mình đã chậm lại một chút và đi bộ quanh nhà.';
const retryButton = () => screen.getByRole('button', { name: 'Thử lại' });
const refusePosts = (status: number, code: string) => {
  world.answer = request => (request === 'POST /journal' ? refuse(status, code) : undefined);
};

describe('S32', () => {
  test('from the profile tab: the words of the frame, a labelled field, "Chỉ mình bạn đọc được", the counter at 0, save disabled with its reason, the link to the pages', async () => {
    const view = await openWrite();
    expect(screen.getByRole('header', { name: 'Góc giải tỏa' })).toBeTruthy();
    expect(screen.getByText('Không cần viết hay. Chỉ cần là bạn.')).toBeTruthy();
    expect(field()).toHaveProp('multiline', true);
    expect(field()).toHaveProp('placeholder', 'Hôm nay có điều gì khiến bạn bận lòng?');
    expect(screen.getByText('Chỉ mình bạn đọc được')).toBeTruthy();
    expect(screen.getByText('Không chia sẻ vào tổ đội')).toBeTruthy();
    expect(screen.getByText('0 / 5000')).toBeTruthy();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('Viết vài dòng rồi lưu nhé.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Những trang đã viết' })).toBeTruthy();
    // no share button anywhere in this feature
    expect(screen.queryByRole('button', { name: /chia sẻ/i })).toBeNull();
    expect(saves()).toEqual([]);
    view.unmount();
  });

  test('"Những trang đã viết" opens the list; Back returns to the form', async () => {
    const view = await openWrite();
    fireEvent.press(screen.getByRole('button', { name: 'Những trang đã viết' }));
    expect(await screen.findByRole('header', { name: 'Những trang đã viết' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Góc giải tỏa' })).toBeTruthy();
    view.unmount();
  });
});

describe('saving', () => {
  test('sends the trimmed body once, with one idempotency key; the feedback screen replaces the form (Back goes to the profile, with no draft)', async () => {
    const view = await openWrite();
    type(`  ${TEXT}\n  `);
    expect(screen.getByText(`${[...TEXT].length} / 5000`)).toBeTruthy();
    fireEvent.press(saveButton());
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    await landed();
    expect(saves()).toHaveLength(1);
    expect(saves()[0].body).toEqual({ body: TEXT });
    expect(saves()[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(world.journal.rows.map(row => row.body)).toEqual([TEXT]);
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Cá nhân' })).toBeTruthy();
    expect(screen.queryByLabelText('Điều bạn muốn viết')).toBeNull();
    view.unmount();
  });

  test('an empty or blank draft cannot be saved: the button is disabled and nothing is sent', async () => {
    const view = await openWrite();
    for (const blank of ['', '   ', ' \n\t ']) {
      type(blank);
      expect(saveButton()).toBeDisabled();
      fireEvent.press(saveButton());
    }
    await landed();
    expect(saves()).toEqual([]);
    view.unmount();
  });

  test('5000 characters can be saved, 5001 cannot: the counter and the field say so, the button is disabled and nothing is sent', async () => {
    const view = await openWrite();
    type('a'.repeat(5001));
    expect(screen.getByText('5001 / 5000')).toBeTruthy();
    expect(screen.getByText(/dài hơn 5000 ký tự/)).toBeTruthy();
    expect(saveButton()).toBeDisabled();
    fireEvent.press(saveButton());
    await landed();
    expect(saves()).toEqual([]);
    // the length is the server's: trimmed, in code points (an emoji is one)
    type(`  ${'😀'.repeat(5000)}  `);
    expect(screen.getByText('5000 / 5000')).toBeTruthy();
    expect(saveButton()).not.toBeDisabled();
    fireEvent.press(saveButton());
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    expect(saves()).toHaveLength(1);
    await landed();
    view.unmount();
  });

  test('a press while the save is out sends nothing more (one request per press)', async () => {
    const view = await openWrite();
    const gate = hold('POST /journal');
    type(TEXT);
    fireEvent.press(saveButton());
    await landed();
    expect(saveButton()).toHaveProp('accessibilityState', expect.objectContaining({ busy: true }));
    fireEvent.press(saveButton());
    fireEvent.press(saveButton());
    await landed();
    expect(saves()).toHaveLength(1);
    await act(async () => gate.release());
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    expect(saves()).toHaveLength(1);
    await landed();
    view.unmount();
  });
});

describe('a save that does not go through', () => {
  test('no connection: the text stays, the reason and "Thử lại" show; the retry repeats the same key (so the page is written once) and succeeds', async () => {
    const view = await openWrite();
    type(TEXT);
    world.down = true;
    fireEvent.press(saveButton());
    expect(await screen.findByText(/Không kết nối được mạng\. Bạn kiểm tra kết nối rồi thử lại nhé\. Điều bạn viết vẫn còn ở đây\./)).toBeTruthy();
    expect(field()).toHaveDisplayValue(TEXT);
    expect(saves()).toHaveLength(1);
    world.down = false;
    fireEvent.press(retryButton());
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    await landed();
    expect(saves()).toHaveLength(2);
    expect(saves()[1].id).toBe(saves()[0].id);
    expect(saves()[1].body).toEqual(saves()[0].body);
    expect(world.journal.rows).toHaveLength(1);
    view.unmount();
  });

  test('a server answer ends the attempt: the text stays with the reason and "Thử lại", and the next press uses a new key', async () => {
    const view = await openWrite();
    type(TEXT);
    refusePosts(429, 'RATE_LIMITED');
    fireEvent.press(saveButton());
    expect(await screen.findByText(/Bạn thao tác hơi nhanh\./)).toBeTruthy();
    expect(field()).toHaveDisplayValue(TEXT);
    world.answer = undefined;
    fireEvent.press(retryButton());
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    await landed();
    expect(saves()).toHaveLength(2);
    expect(saves()[1].id).not.toBe(saves()[0].id);
    view.unmount();
  });

  test('any other failure is shown the same way: the generic words, the draft kept', async () => {
    const view = await openWrite();
    type(TEXT);
    refusePosts(500, 'INTERNAL');
    fireEvent.press(saveButton());
    expect(await screen.findByText(/Hệ thống đang gặp sự cố\./)).toBeTruthy();
    expect(field()).toHaveDisplayValue(TEXT);
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    view.unmount();
  });

  test('editing the text after a failure clears the message; the changed text is another request, so another key', async () => {
    const view = await openWrite();
    type(TEXT);
    world.down = true;
    fireEvent.press(saveButton());
    await screen.findByText(/Điều bạn viết vẫn còn ở đây\./);
    type(`${TEXT} Thêm một dòng.`);
    expect(screen.queryByText(/Điều bạn viết vẫn còn ở đây\./)).toBeNull();
    world.down = false;
    fireEvent.press(saveButton());
    expect(await screen.findByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    await landed();
    expect(saves()[1].id).not.toBe(saves()[0].id);
    view.unmount();
  });
});

describe('the draft is memory only', () => {
  test('nothing of it reaches the device storage while it is written, when a save fails, or after it is saved', async () => {
    const SECRET = 'Điều rất riêng tư mà không ai được đọc.';
    const view = await openWrite();
    type(SECRET);
    world.down = true;
    fireEvent.press(saveButton());
    await screen.findByText(/Điều bạn viết vẫn còn ở đây\./);
    expect(await everythingOnDisk()).not.toContain('riêng tư');
    world.down = false;
    fireEvent.press(retryButton());
    await screen.findByRole('header', { name: 'Một khoảng nghỉ' });
    await landed();
    expect(await everythingOnDisk()).not.toContain('riêng tư');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('riêng'))).toEqual([]);
    view.unmount();
  });
});
