import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { answer, fetchMock, mount, pendingRequest, queryClient, refuse, respond, sent, installAuthTestEnv, watchFocus } from './authTestKit';

installAuthTestEnv();

const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const fill = ({ code = '12345678', password = 'mat-khau-moi-1', repeat = password }: { code?: string; password?: string; repeat?: string } = {}) => {
  type('Mã 8 chữ số', code);
  type('Mật khẩu mới', password);
  type('Nhập lại mật khẩu', repeat);
};
const save = () => press('Lưu mật khẩu mới');
const resend = () => press('Gửi lại mã');
const open = (email = 'an@example.vn') => mount('NewPassword', { email });
const ready = () => screen.findByRole('header', { name: 'Đặt mật khẩu mới' });
const resets = () => sent().filter(r => r.path === '/auth/password/reset');
const forgots = () => sent().filter(r => r.path === '/auth/password/forgot');
const NEUTRAL = 'Nếu email đã đăng ký, bạn sẽ nhận được mã trong ít phút.';
const CODE_INVALID = 'Mã chưa đúng hoặc đã hết hạn. Bạn có thể gửi lại mã.';

test('S55 shows the code field (8 digits), the two password fields and both actions; the subtitle says the code came by email', async () => {
  open();
  expect(await ready()).toBeTruthy();
  expect(screen.getByText('Nhập mã chúng tôi đã gửi qua email của bạn.')).toBeTruthy();
  expect(screen.queryByText(/liên kết/)).toBeNull();
  for (const label of ['Mã 8 chữ số', 'Mật khẩu mới', 'Nhập lại mật khẩu']) expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.getByText('Ít nhất 8 ký tự')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Lưu mật khẩu mới' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Gửi lại mã' })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the keyboard: a number pad for the code, new-password hints for the passwords', async () => {
  open();
  await ready();
  expect(screen.getByLabelText('Mã 8 chữ số').props).toMatchObject({
    keyboardType: 'number-pad',
    maxLength: 8,
    autoComplete: 'one-time-code',
    textContentType: 'oneTimeCode',
    returnKeyType: 'next',
  });
  for (const label of ['Mật khẩu mới', 'Nhập lại mật khẩu']) {
    expect(screen.getByLabelText(label).props).toMatchObject({ autoComplete: 'new-password', secureTextEntry: true, autoCapitalize: 'none' });
  }
  expect(screen.getByLabelText('Nhập lại mật khẩu').props.returnKeyType).toBe('go');
});

test('"next" walks code, new password, repeat; "go" on the repeat submits', async () => {
  answer('/auth/password/reset', respond(204));
  open();
  await ready();
  fill();
  const [focusPassword, focusRepeat] = [watchFocus('Mật khẩu mới'), watchFocus('Nhập lại mật khẩu')];
  fireEvent(screen.getByLabelText('Mã 8 chữ số'), 'submitEditing');
  expect(focusPassword).toHaveBeenCalledTimes(1);
  fireEvent(screen.getByLabelText('Mật khẩu mới'), 'submitEditing');
  expect(focusRepeat).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent(screen.getByLabelText('Nhập lại mật khẩu'), 'submitEditing');
  await waitFor(() => expect(resets()).toHaveLength(1));
});

test('happy path: POST /auth/password/reset with the email of the route, the code and the password as typed, no Idempotency-Key; then a message and S02', async () => {
  mount('Welcome');
  fireEvent.press(await screen.findByRole('button', { name: 'Tôi đã có tài khoản' }));
  await screen.findByRole('header', { name: 'Chào bạn trở lại' });
  answer('/auth/password/forgot', respond(202, {}));
  fireEvent.press(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
  await screen.findByRole('header', { name: 'Lấy lại mật khẩu' });
  type('Email', ' An@Example.VN ');
  press('Gửi mã');
  await screen.findByText(NEUTRAL);
  press('Nhập mã');
  await ready();
  answer('/auth/password/reset', respond(204));
  fill({ code: '87654321', password: ' mật khẩu mới có khoảng trắng ' });
  save();
  expect(await screen.findByText('Mật khẩu đã được đổi. Bạn đăng nhập lại nhé.')).toBeTruthy();
  expect(await screen.findByRole('header', { name: 'Chào bạn trở lại' })).toBeTruthy();
  const [request] = resets();
  expect(request).toMatchObject({ method: 'POST', path: '/auth/password/reset', body: { email: 'an@example.vn', code: '87654321', newPassword: ' mật khẩu mới có khoảng trắng ' } });
  expect(Object.keys(request.body ?? {}).sort()).toEqual(['code', 'email', 'newPassword']);
  expect(Object.keys(request.headers).map(h => h.toLowerCase())).not.toContain('idempotency-key');
  await waitFor(() => expect(queryClient().getMutationCache().getAll()).toEqual([]));
  // S02 was reached by going back to the one underneath, not by stacking another: Back is Welcome
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByRole('header', { name: 'Hồi Máu' })).toBeTruthy();
});

describe('client validation blocks the request and names the field', () => {
  test.each([
    ['a 7-digit code', '1234567'],
    ['a 9-digit code', '123456789'],
    ['letters in the code', '1234567a'],
    ['a code with a space', '1234 567'],
    ['no code', ''],
  ])('%s', async (_what, code) => {
    open();
    await ready();
    fill({ code });
    const focusCode = watchFocus('Mã 8 chữ số');
    save();
    expect(await screen.findByText('Mã gồm 8 chữ số.')).toBeTruthy();
    expect(screen.getByLabelText('Mã 8 chữ số, lỗi: Mã gồm 8 chữ số.')).toBeTruthy();
    expect(focusCode).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('exactly 8 digits pass', async () => {
    answer('/auth/password/reset', respond(204));
    open();
    await ready();
    fill({ code: '00000000' });
    save();
    await waitFor(() => expect(resets()).toHaveLength(1));
    expect(resets()[0].body?.code).toBe('00000000');
  });

  test('a short new password: named, focused, nothing sent', async () => {
    open();
    await ready();
    fill({ password: '1234567' });
    const focusPassword = watchFocus('Mật khẩu mới');
    save();
    expect(await screen.findByText('Mật khẩu cần ít nhất 8 ký tự.')).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu mới, lỗi: Mật khẩu cần ít nhất 8 ký tự.')).toBeTruthy();
    expect(focusPassword).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a mismatched repeat: named on the repeat field, which is focused', async () => {
    open();
    await ready();
    fill({ password: 'mat-khau-moi-1', repeat: 'mat-khau-moi-2' });
    const focusRepeat = watchFocus('Nhập lại mật khẩu');
    save();
    expect(await screen.findByText('Hai mật khẩu chưa giống nhau.')).toBeTruthy();
    expect(screen.getByLabelText('Nhập lại mật khẩu, lỗi: Hai mật khẩu chưa giống nhau.')).toBeTruthy();
    expect(focusRepeat).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a repeat that differs only by a trailing space is a mismatch: passwords are never trimmed', async () => {
    open();
    await ready();
    fill({ password: 'mat-khau-moi-1', repeat: 'mat-khau-moi-1 ' });
    save();
    expect(await screen.findByText('Hai mật khẩu chưa giống nhau.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an empty repeat is asked for', async () => {
    open();
    await ready();
    fill({ repeat: '' });
    save();
    expect(await screen.findByText('Bạn nhập lại mật khẩu để xác nhận.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('everything wrong: the code, first in form order, takes focus', async () => {
    open();
    await ready();
    fill({ code: '1', password: '1', repeat: '2' });
    const focus = [watchFocus('Mã 8 chữ số'), watchFocus('Mật khẩu mới'), watchFocus('Nhập lại mật khẩu')];
    save();
    await screen.findByText('Mã gồm 8 chữ số.');
    expect(focus.map(f => f.mock.calls.length)).toEqual([1, 0, 0]);
  });
});

describe('failed requests', () => {
  test('RESET_CODE_INVALID: its copy under the code, announced, the code focused again', async () => {
    answer('/auth/password/reset', refuse(400, 'RESET_CODE_INVALID'));
    open();
    await ready();
    fill();
    const focusCode = watchFocus('Mã 8 chữ số');
    save();
    expect(await screen.findByText(CODE_INVALID)).toBeTruthy();
    expect(screen.getByLabelText(`Mã 8 chữ số, lỗi: ${CODE_INVALID}`)).toBeTruthy();
    expect(focusCode).toHaveBeenCalledTimes(1);
    let node = screen.getByText(CODE_INVALID).parent;
    while (node && !node.props.accessibilityLiveRegion) node = node.parent;
    expect(node?.props.accessibilityLiveRegion).toBe('polite');
    // still on S55, still usable, and the server's text is not shown
    expect(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }).props.accessibilityState).toMatchObject({ busy: false });
    expect(screen.queryByText(/diagnostic/)).toBeNull();
    await waitFor(() => expect(queryClient().getMutationCache().getAll()).toEqual([]));
  });

  test('VALIDATION_FAILED maps details.fields to the code and the new password', async () => {
    answer(
      '/auth/password/reset',
      refuse(422, 'VALIDATION_FAILED', {
        fields: [
          { field: 'newPassword', rule: 'max' },
          { field: 'code', rule: 'format' },
        ],
      }),
    );
    open();
    await ready();
    fill();
    const [focusCode, focusPassword] = [watchFocus('Mã 8 chữ số'), watchFocus('Mật khẩu mới')];
    save();
    expect(await screen.findByLabelText('Mã 8 chữ số, lỗi: Mã gồm 8 chữ số.')).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu mới, lỗi: Mật khẩu tối đa 128 ký tự.')).toBeTruthy();
    expect(focusCode).toHaveBeenCalledTimes(1);
    expect(focusPassword).not.toHaveBeenCalled();
  });

  test.each([
    ['RATE_LIMITED', 429, 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.'],
    ['INTERNAL', 500, 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.'],
    ['BAD_JSON', 400, 'Có lỗi xảy ra. Bạn thử lại nhé.'],
  ])('%s: its generic copy, no field blamed', async (code, status, copy) => {
    answer('/auth/password/reset', refuse(status, code));
    open();
    await ready();
    fill();
    save();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText(CODE_INVALID)).toBeNull();
  });

  test('no connection: the NETWORK copy', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    open();
    await ready();
    fill();
    save();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
  });

  test('no answer for 10 s: the TIMEOUT copy', async () => {
    jest.useFakeTimers();
    pendingRequest('/auth/password/reset');
    open();
    await ready();
    fill();
    save();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(await screen.findByText('Kết nối hơi chậm. Bạn thử lại nhé.')).toBeTruthy();
  });
});

describe('"Gửi lại mã"', () => {
  test('asks for a new code for the email of the route and confirms with the same neutral sentence as S04', async () => {
    answer('/auth/password/forgot', respond(202, {}));
    open(' An@Example.VN ');
    await ready();
    resend();
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    const [request] = sent();
    expect(request).toMatchObject({ method: 'POST', path: '/auth/password/forgot', body: { email: 'an@example.vn' } });
    expect(Object.keys(request.headers).map(h => h.toLowerCase())).not.toContain('idempotency-key');
    // it neither needs nor touches the code and password fields
    expect(screen.queryByText('Mã gồm 8 chữ số.')).toBeNull();
  });

  test('the confirmation is the same for any email', async () => {
    const shown: string[] = [];
    for (const email of ['co-tai-khoan@example.vn', 'khong-co-gi@example.vn']) {
      answer('/auth/password/forgot', respond(202, {}));
      const view = open(email);
      await ready();
      resend();
      await screen.findByText(NEUTRAL);
      shown.push(JSON.stringify(screen.toJSON()).replace(/"screenId":"[^"]*"/g, '"screenId":"-"'));
      view.unmount();
    }
    expect(shown[0]).toBe(shown[1]);
  });

  test('RATE_LIMITED and NETWORK show their own generic copy, never the confirmation', async () => {
    answer('/auth/password/forgot', refuse(429, 'RATE_LIMITED'));
    open();
    await ready();
    resend();
    expect(await screen.findByText('Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.')).toBeTruthy();
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    resend();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText(NEUTRAL)).toBeNull();
  });

  test('while a request is open, a press on the other button sends nothing', async () => {
    const request = pendingRequest('/auth/password/reset');
    open();
    await ready();
    fill();
    save();
    await waitFor(() => expect(resets()).toHaveLength(1));
    fireEvent.press(screen.getByRole('button', { name: 'Gửi lại mã' }));
    expect(forgots()).toHaveLength(0);
    await act(async () => request.finish(respond(204)));
  });
});

describe('one request at a time', () => {
  test('two presses inside one act() send one request', async () => {
    const request = pendingRequest('/auth/password/reset');
    open();
    await ready();
    fill();
    const button = screen.getByRole('button', { name: 'Lưu mật khẩu mới' });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(resets()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }).props.accessibilityState).toMatchObject({ busy: true });
    fireEvent.press(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }));
    expect(resets()).toHaveLength(1);
    await act(async () => request.finish(respond(204)));
  });

  test('two presses of "Gửi lại mã" inside one act() send one request', async () => {
    const request = pendingRequest('/auth/password/forgot');
    open();
    await ready();
    const button = screen.getByRole('button', { name: 'Gửi lại mã' });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(forgots()).toHaveLength(1);
    await act(async () => request.finish(respond(202, {})));
    await screen.findByText(NEUTRAL);
  });

  test('leaving the screen cancels the request', async () => {
    pendingRequest('/auth/password/reset');
    const view = open();
    await ready();
    fill();
    save();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const signal = fetchMock.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
