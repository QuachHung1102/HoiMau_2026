import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { answer, fetchMock, mount, pendingRequest, refuse, respond, sent, installAuthTestEnv, watchFocus } from './authTestKit';

installAuthTestEnv();

const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const send = () => fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
const ready = () => screen.findByRole('header', { name: 'Lấy lại mật khẩu' });
const forgots = () => sent().filter(r => r.path === '/auth/password/forgot');
const CONFIRMATION = 'Nếu email đã đăng ký, bạn sẽ nhận được mã trong ít phút.';
const EMAIL_INVALID = 'Email chưa đúng định dạng, ví dụ ban@example.com.';
const accepted = () => answer('/auth/password/forgot', respond(202, {}));

test('S04 asks for the email and offers one action; the subtitle speaks of a code, not a link', async () => {
  mount('ForgotPassword');
  expect(await ready()).toBeTruthy();
  expect(screen.getByText('Mình sẽ gửi mã đến email của bạn.')).toBeTruthy();
  expect(screen.getByLabelText('Email').props).toMatchObject({ keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email', returnKeyType: 'send' });
  expect(screen.getByRole('button', { name: 'Gửi mã' })).toBeTruthy();
  expect(screen.queryByText(CONFIRMATION)).toBeNull();
  expect(screen.queryByText(/liên kết/)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('happy path: POST /auth/password/forgot with the normalised email and no Idempotency-Key; the confirmation appears', async () => {
  accepted();
  mount('ForgotPassword');
  await ready();
  type('Email', '  An@Example.VN ');
  send();
  expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
  expect(screen.getByText('Kiểm tra hộp thư')).toBeTruthy();
  expect(screen.getByText('Bạn có thể quay lại để sửa địa chỉ.')).toBeTruthy();
  const [request] = sent();
  expect(request).toMatchObject({ method: 'POST', path: '/auth/password/forgot', body: { email: 'an@example.vn' } });
  expect(Object.keys(request.body ?? {})).toEqual(['email']);
  const headers = Object.keys(request.headers).map(h => h.toLowerCase());
  expect(headers).not.toContain('idempotency-key');
  expect(headers).not.toContain('authorization');
});

test('the confirmation is announced as a polite live region', async () => {
  accepted();
  mount('ForgotPassword');
  await ready();
  type('Email', 'an@example.vn');
  send();
  let node = (await screen.findByText(CONFIRMATION)).parent;
  while (node && !node.props.accessibilityLiveRegion) node = node.parent;
  expect(node?.props.accessibilityLiveRegion).toBe('polite');
});

test('every accepted request gets the identical confirmation, whatever the email', async () => {
  const shown: string[] = [];
  for (const email of ['co-tai-khoan@example.vn', 'khong-co-gi@example.vn']) {
    accepted();
    const view = mount('ForgotPassword');
    await ready();
    type('Email', email);
    send();
    await screen.findByText(CONFIRMATION);
    // the whole screen, with only the typed address and the navigator's random ids masked: nothing else differs
    shown.push(JSON.stringify(screen.toJSON()).split(email).join('<email>').replace(/"screenId":"[^"]*"/g, '"screenId":"-"'));
    view.unmount();
  }
  expect(shown[0]).toBe(shown[1]);
  // and nothing was asked of the server except the one request
  expect(forgots()).toHaveLength(2);
  expect(sent()).toHaveLength(2);
});

test('the confirmation then leads to S55 with the email; S55 sends it with the code', async () => {
  accepted();
  mount('ForgotPassword');
  await ready();
  type('Email', 'An@Example.VN');
  send();
  await screen.findByText(CONFIRMATION);
  fireEvent.press(screen.getByRole('button', { name: 'Nhập mã' }));
  expect(await screen.findByRole('header', { name: 'Đặt mật khẩu mới' })).toBeTruthy();
  answer('/auth/password/reset', respond(204));
  fireEvent.changeText(screen.getByLabelText('Mã 8 chữ số'), '12345678');
  fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), 'mat-khau-moi-1');
  fireEvent.changeText(screen.getByLabelText('Nhập lại mật khẩu'), 'mat-khau-moi-1');
  fireEvent.press(screen.getByRole('button', { name: 'Lưu mật khẩu mới' }));
  await waitFor(() => expect(sent().some(r => r.path === '/auth/password/reset')).toBe(true));
  expect(sent().find(r => r.path === '/auth/password/reset')?.body).toEqual({ email: 'an@example.vn', code: '12345678', newPassword: 'mat-khau-moi-1' });
});

test('editing the address takes the confirmation away: it only ever speaks of the address that was sent', async () => {
  accepted();
  mount('ForgotPassword');
  await ready();
  type('Email', 'an@example.vn');
  send();
  await screen.findByText(CONFIRMATION);
  type('Email', 'binh@example.vn');
  expect(screen.queryByText(CONFIRMATION)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nhập mã' })).toBeNull();
});

describe('client validation blocks the request and names the field', () => {
  test.each([
    ['an empty email', '', 'Bạn nhập email nhé.'],
    ['an email without a domain', 'an@', EMAIL_INVALID],
    ['an email with a space inside', 'an b@example.vn', EMAIL_INVALID],
  ])('%s', async (_what, email, copy) => {
    mount('ForgotPassword');
    await ready();
    type('Email', email);
    const focusEmail = watchFocus('Email');
    send();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.getByLabelText(`Email, lỗi: ${copy}`)).toBeTruthy();
    expect(focusEmail).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });
});

describe('failed requests say nothing about the account and never show the confirmation', () => {
  test.each([
    ['RATE_LIMITED', 429, 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.'],
    ['INTERNAL', 500, 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.'],
    ['BAD_JSON', 400, 'Có lỗi xảy ra. Bạn thử lại nhé.'],
  ])('%s', async (code, status, copy) => {
    answer('/auth/password/forgot', refuse(status, code));
    mount('ForgotPassword');
    await ready();
    type('Email', 'an@example.vn');
    send();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
    expect(screen.queryByText(/diagnostic/)).toBeNull();
  });

  test('no connection: the NETWORK copy', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    mount('ForgotPassword');
    await ready();
    type('Email', 'an@example.vn');
    send();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });

  test('no answer for 10 s: the TIMEOUT copy', async () => {
    jest.useFakeTimers();
    pendingRequest('/auth/password/forgot');
    mount('ForgotPassword');
    await ready();
    type('Email', 'an@example.vn');
    send();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(await screen.findByText('Kết nối hơi chậm. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });

  test('VALIDATION_FAILED from the server lands on the email field', async () => {
    answer('/auth/password/forgot', refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'email', rule: 'format' }] }));
    mount('ForgotPassword');
    await ready();
    type('Email', 'an@example.vn');
    const focusEmail = watchFocus('Email');
    send();
    expect(await screen.findByLabelText(`Email, lỗi: ${EMAIL_INVALID}`)).toBeTruthy();
    expect(focusEmail).toHaveBeenCalledTimes(1);
  });

  test('a failure after a success takes the old confirmation away', async () => {
    accepted();
    mount('ForgotPassword');
    await ready();
    type('Email', 'an@example.vn');
    send();
    await screen.findByText(CONFIRMATION);
    answer('/auth/password/forgot', refuse(429, 'RATE_LIMITED'));
    send();
    await screen.findByText('Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.');
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });
});

test('two presses inside one act() send one request', async () => {
  const request = pendingRequest('/auth/password/forgot');
  mount('ForgotPassword');
  await ready();
  type('Email', 'an@example.vn');
  const button = screen.getByRole('button', { name: 'Gửi mã' });
  await act(async () => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(forgots()).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Gửi mã' }).props.accessibilityState).toMatchObject({ busy: true });
  fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
  expect(forgots()).toHaveLength(1);
  await act(async () => request.finish(respond(202, {})));
  expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Gửi mã' }).props.accessibilityState).toMatchObject({ busy: false });
});

test('leaving the screen cancels the request', async () => {
  pendingRequest('/auth/password/forgot');
  const view = mount('ForgotPassword');
  await ready();
  type('Email', 'an@example.vn');
  send();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const signal = fetchMock.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

test('Back returns to S02', async () => {
  mount('Welcome');
  fireEvent.press(await screen.findByRole('button', { name: 'Tôi đã có tài khoản' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Quên mật khẩu?' }));
  await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByRole('header', { name: 'Chào bạn trở lại' })).toBeTruthy();
});
