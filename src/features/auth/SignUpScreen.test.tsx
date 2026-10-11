import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { legalVi } from '../../shared/i18n/vi/legal';
import { answer, fetchMock, mount, pendingRequest, queryClient, refuse, respond, sent, session, TOKEN, USER, installAuthTestEnv, watchFocus } from './authTestKit';

installAuthTestEnv();

const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const agree = () => fireEvent.press(screen.getByRole('checkbox', { name: 'Tôi đồng ý điều khoản' }));
const fill = ({ name = 'An', email = 'an@example.vn', password = 'mat-khau-dung', terms = true } = {}) => {
  type('Tên hiển thị', name);
  type('Email', email);
  type('Mật khẩu', password);
  if (terms) agree();
};
const create = () => press('Tạo tài khoản');
const ready = () => screen.findByRole('header', { name: 'Tạo tài khoản' });
const registers = () => sent().filter(r => r.path === '/auth/register');
const EMAIL_INVALID = 'Email chưa đúng định dạng, ví dụ ban@example.com.';

test('S03 shows the three fields with the password helper, the terms checkbox and both actions', async () => {
  mount('SignUp');
  expect(await ready()).toBeTruthy();
  expect(screen.getByText('Một nơi riêng cho hành trình của bạn.')).toBeTruthy();
  for (const label of ['Tên hiển thị', 'Email', 'Mật khẩu']) expect(screen.getByLabelText(label)).toBeTruthy();
  // the helper states the minimum from LIMITS, and is also the input's hint
  expect(screen.getByText('Ít nhất 8 ký tự')).toBeTruthy();
  expect(screen.getByLabelText('Mật khẩu').props.accessibilityHint).toBe('Ít nhất 8 ký tự');
  expect(screen.getByRole('button', { name: 'Hiện mật khẩu' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Tôi đồng ý điều khoản' }).props.accessibilityState).toMatchObject({ checked: false });
  expect(screen.getByRole('link', { name: 'Đọc điều khoản và chính sách riêng tư' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tạo tài khoản' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đã có tài khoản? Đăng nhập' })).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the keyboard is set up for each field', async () => {
  mount('SignUp');
  await ready();
  expect(screen.getByLabelText('Tên hiển thị').props).toMatchObject({ autoComplete: 'name', returnKeyType: 'next' });
  expect(screen.getByLabelText('Email').props).toMatchObject({ keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email', returnKeyType: 'next' });
  expect(screen.getByLabelText('Mật khẩu').props).toMatchObject({ autoComplete: 'new-password', secureTextEntry: true, returnKeyType: 'go' });
});

test('"next" walks name, email, password; "go" on the password submits', async () => {
  answer('/auth/register', respond(201, session));
  mount('SignUp');
  await ready();
  fill();
  const [focusEmail, focusPassword] = [watchFocus('Email'), watchFocus('Mật khẩu')];
  fireEvent(screen.getByLabelText('Tên hiển thị'), 'submitEditing');
  expect(focusEmail).toHaveBeenCalledTimes(1);
  fireEvent(screen.getByLabelText('Email'), 'submitEditing');
  expect(focusPassword).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent(screen.getByLabelText('Mật khẩu'), 'submitEditing');
  await screen.findByText('Phần này đang được hoàn thiện');
});

test('happy path: POST /auth/register with the contract body and no Idempotency-Key, one sign-in, then the gate moves on', async () => {
  answer('/auth/register', respond(201, session));
  mount('SignUp');
  await ready();
  fill({ name: '  Nguyễn Thị An  ', email: ' An@Example.VN ', password: ' mật khẩu có khoảng trắng ' });
  create();
  expect(await screen.findByText('Phần này đang được hoàn thiện')).toBeTruthy();
  const [register] = sent();
  expect(register).toMatchObject({
    method: 'POST',
    path: '/auth/register',
    // trimmed name, normalised email, the password exactly as typed
    body: { displayName: 'Nguyễn Thị An', email: 'an@example.vn', password: ' mật khẩu có khoảng trắng ', acceptedTerms: true },
  });
  expect(Object.keys(register.body ?? {}).sort()).toEqual(['acceptedTerms', 'displayName', 'email', 'password']);
  expect(Object.keys(register.headers).map(h => h.toLowerCase())).not.toContain('idempotency-key');
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(USER, TOKEN);
});

test('the password stays in the field until the sign-in has succeeded, and the mutation cache never keeps it', async () => {
  answer('/auth/register', respond(201, session));
  let finishKeychain!: () => void;
  jest.mocked(Keychain.setGenericPassword).mockImplementationOnce(() => new Promise(resolve => (finishKeychain = () => resolve({ service: 'x', storage: 'x' } as never))));
  mount('SignUp');
  await ready();
  fill();
  create();
  await waitFor(() => expect(Keychain.setGenericPassword).toHaveBeenCalled());
  // not cleared before signIn resolved: a failing keychain write must not make the person retype it
  expect(screen.getByLabelText('Mật khẩu').props.value).toBe('mat-khau-dung');
  await waitFor(() => expect(queryClient().getMutationCache().getAll()).toEqual([]));
  await act(async () => finishKeychain());
  await screen.findByText('Phần này đang được hoàn thiện');
});

test('the keychain failing after the account was created: the form keeps its values and says the account exists', async () => {
  answer('/auth/register', respond(201, session));
  jest.mocked(Keychain.setGenericPassword).mockRejectedValueOnce(new Error('keystore unavailable'));
  mount('SignUp');
  await ready();
  fill();
  create();
  expect(await screen.findByText('Tài khoản đã được tạo nhưng chưa đăng nhập được. Bạn thử đăng nhập bằng email vừa dùng nhé.')).toBeTruthy();
  expect(screen.queryByText('Phần này đang được hoàn thiện')).toBeNull();
  expect(screen.getByLabelText('Mật khẩu').props.value).toBe('mat-khau-dung');
  expect(screen.getByLabelText('Email').props.value).toBe('an@example.vn');
  expect(screen.getByLabelText('Tên hiển thị').props.value).toBe('An');
});

describe('the terms', () => {
  test('the link is a 48 dp row of its own, with no negative margin pulling it into the checkbox row', async () => {
    mount('SignUp');
    await ready();
    const link = screen.getByRole('link', { name: 'Đọc điều khoản và chính sách riêng tư' });
    expect(StyleSheet.flatten(link.props.style)).toMatchObject({ minHeight: 48 });
    const margins: unknown[] = [];
    for (let node = link.parent; node; node = node.parent) margins.push(StyleSheet.flatten(node.props.style)?.marginTop);
    expect(margins.filter(m => typeof m === 'number' && m < 0)).toEqual([]);
  });

  test('the link opens a sheet with the plain-language summary, and closing it keeps the form as it was', async () => {
    mount('SignUp');
    await ready();
    fill({ terms: false });
    // mounted only while open
    expect(screen.queryByText(legalVi.title)).toBeNull();
    fireEvent.press(screen.getByRole('link', { name: 'Đọc điều khoản và chính sách riêng tư' }));
    expect(await screen.findByText(legalVi.title)).toBeTruthy();
    for (const section of legalVi.sections) {
      expect(screen.getByText(section.heading)).toBeTruthy();
      expect(screen.getByText(section.body)).toBeTruthy();
    }
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByText(legalVi.title)).toBeNull());
    expect(screen.getByLabelText('Tên hiển thị').props.value).toBe('An');
    // reading the terms is not agreeing to them
    expect(screen.getByRole('checkbox', { name: 'Tôi đồng ý điều khoản' }).props.accessibilityState).toMatchObject({ checked: false });
  });

  test('unchecked: the request is blocked and the terms error is shown; ticking the box clears it', async () => {
    mount('SignUp');
    await ready();
    fill({ terms: false });
    create();
    expect(await screen.findByText('Bạn cần đồng ý điều khoản để tạo tài khoản.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    agree();
    expect(screen.queryByText('Bạn cần đồng ý điều khoản để tạo tài khoản.')).toBeNull();
  });
});

describe('client validation blocks the request and names the field', () => {
  test('everything wrong at once: each field is named and the first one, in form order, gets focus', async () => {
    mount('SignUp');
    await ready();
    type('Email', 'an@');
    type('Mật khẩu', '1234567');
    const focus = { name: watchFocus('Tên hiển thị'), email: watchFocus('Email'), password: watchFocus('Mật khẩu') };
    create();
    expect(await screen.findByText('Bạn nhập tên hiển thị nhé.')).toBeTruthy();
    expect(screen.getByText(EMAIL_INVALID)).toBeTruthy();
    expect(screen.getByText('Mật khẩu cần ít nhất 8 ký tự.')).toBeTruthy();
    expect(screen.getByText('Bạn cần đồng ý điều khoản để tạo tài khoản.')).toBeTruthy();
    expect(focus.name).toHaveBeenCalledTimes(1);
    expect(focus.email).not.toHaveBeenCalled();
    expect(focus.password).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a 7-character password is refused and an 8-character one is not; the field takes focus', async () => {
    mount('SignUp');
    await ready();
    fill({ password: '1234567' });
    const focusPassword = watchFocus('Mật khẩu');
    create();
    expect(await screen.findByText('Mật khẩu cần ít nhất 8 ký tự.')).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu, lỗi: Mật khẩu cần ít nhất 8 ký tự.')).toBeTruthy();
    expect(focusPassword).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    answer('/auth/register', respond(201, session));
    type('Mật khẩu, lỗi: Mật khẩu cần ít nhất 8 ký tự.', '12345678');
    create();
    await waitFor(() => expect(registers()).toHaveLength(1));
    await screen.findByText('Phần này đang được hoàn thiện');
  });

  test('a password over the limit is refused', async () => {
    mount('SignUp');
    await ready();
    fill({ password: 'a'.repeat(129) });
    create();
    expect(await screen.findByText('Mật khẩu tối đa 128 ký tự.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['an empty name', '   ', 'Bạn nhập tên hiển thị nhé.'],
    ['a name over 40 characters', 'a'.repeat(41), 'Tên hiển thị tối đa 40 ký tự và không có ký tự ẩn.'],
    ['a name with a zero-width character', 'An​Nguyen', 'Tên hiển thị tối đa 40 ký tự và không có ký tự ẩn.'],
  ])('%s is refused by the domain rule', async (_what, name, copy) => {
    mount('SignUp');
    await ready();
    fill({ name });
    create();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a look-alike email is refused', async () => {
    mount('SignUp');
    await ready();
    fill({ email: 'an＠example.vn' });
    create();
    expect(await screen.findByText(EMAIL_INVALID)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failed requests', () => {
  test('REGISTRATION_UNAVAILABLE: its copy under the email, announced, email focused', async () => {
    answer('/auth/register', refuse(409, 'REGISTRATION_UNAVAILABLE'));
    mount('SignUp');
    await ready();
    fill();
    const focusEmail = watchFocus('Email');
    create();
    const copy = 'Không thể tạo tài khoản với email này. Bạn thử đăng nhập hoặc lấy lại mật khẩu nhé.';
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.getByLabelText(`Email, lỗi: ${copy}`)).toBeTruthy();
    expect(focusEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/diagnostic/)).toBeNull();
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    await waitFor(() => expect(queryClient().getMutationCache().getAll()).toEqual([]));
  });

  test('NAME_NOT_ALLOWED: its copy under the name, name focused', async () => {
    answer('/auth/register', refuse(422, 'NAME_NOT_ALLOWED'));
    mount('SignUp');
    await ready();
    fill();
    const focusName = watchFocus('Tên hiển thị');
    create();
    expect(await screen.findByLabelText('Tên hiển thị, lỗi: Tên này chưa phù hợp, bạn chọn tên khác nhé.')).toBeTruthy();
    expect(focusName).toHaveBeenCalledTimes(1);
  });

  test('VALIDATION_FAILED maps details.fields to the matching fields; the first in form order is focused', async () => {
    answer(
      '/auth/register',
      refuse(422, 'VALIDATION_FAILED', {
        fields: [
          { field: 'password', rule: 'min' },
          { field: 'email', rule: 'format' },
          { field: 'displayName', rule: 'max' },
          { field: 'acceptedTerms', rule: 'enum' },
        ],
      }),
    );
    mount('SignUp');
    await ready();
    fill();
    const focus = { name: watchFocus('Tên hiển thị'), email: watchFocus('Email'), password: watchFocus('Mật khẩu') };
    create();
    expect(await screen.findByLabelText('Tên hiển thị, lỗi: Tên hiển thị tối đa 40 ký tự và không có ký tự ẩn.')).toBeTruthy();
    expect(screen.getByLabelText(`Email, lỗi: ${EMAIL_INVALID}`)).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu, lỗi: Mật khẩu cần ít nhất 8 ký tự.')).toBeTruthy();
    expect(focus.name).toHaveBeenCalledTimes(1);
    expect(focus.email).not.toHaveBeenCalled();
    expect(focus.password).not.toHaveBeenCalled();
  });

  test('a VALIDATION_FAILED that names no field of this form falls back to a generic message', async () => {
    answer('/auth/register', refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'acceptedTerms', rule: 'enum' }] }));
    mount('SignUp');
    await ready();
    fill();
    create();
    expect(await screen.findByText('Có lỗi xảy ra. Bạn thử lại nhé.')).toBeTruthy();
  });

  test.each([
    ['RATE_LIMITED', 429, 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.'],
    ['INTERNAL', 500, 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.'],
    ['PAYLOAD_TOO_LARGE', 413, 'Có lỗi xảy ra. Bạn thử lại nhé.'],
  ])('%s: its generic copy above the button, no field blamed', async (code, status, copy) => {
    answer('/auth/register', refuse(status, code));
    mount('SignUp');
    await ready();
    fill();
    create();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu')).toBeTruthy();
  });

  test('no connection: the NETWORK copy', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    mount('SignUp');
    await ready();
    fill();
    create();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
  });

  test('no answer for 10 s: the TIMEOUT copy', async () => {
    jest.useFakeTimers();
    pendingRequest('/auth/register');
    mount('SignUp');
    await ready();
    fill();
    create();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(await screen.findByText('Kết nối hơi chậm. Bạn thử lại nhé.')).toBeTruthy();
  });
});

describe('one request at a time', () => {
  test('two presses inside one act() send one request', async () => {
    const request = pendingRequest('/auth/register');
    mount('SignUp');
    await ready();
    fill();
    const button = screen.getByRole('button', { name: 'Tạo tài khoản' });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(registers()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Tạo tài khoản' }).props.accessibilityState).toMatchObject({ busy: true });
    fireEvent.press(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(registers()).toHaveLength(1);
    await act(async () => request.finish(respond(201, session)));
    await screen.findByText('Phần này đang được hoàn thiện');
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  });

  test('leaving the screen cancels the request and signs nobody in', async () => {
    pendingRequest('/auth/register');
    const view = mount('SignUp');
    await ready();
    fill();
    create();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const signal = fetchMock.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => undefined);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  });
});

describe('navigation', () => {
  test('"Đã có tài khoản? Đăng nhập" opens S02, and its link comes back to this S03 instead of stacking another', async () => {
    mount('Welcome');
    fireEvent.press(await screen.findByRole('button', { name: 'Bắt đầu hành trình' }));
    await ready();
    press('Đã có tài khoản? Đăng nhập');
    await screen.findByRole('header', { name: 'Chào bạn trở lại' });
    fireEvent.press(screen.getByRole('link', { name: 'Chưa có tài khoản? Tạo tài khoản' }));
    await ready();
    // one S03 in the stack: Back goes to Welcome, not to the S02 that was passed
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Hồi Máu' })).toBeTruthy();
  });

  test('the eye button reveals the password without changing it', async () => {
    mount('SignUp');
    await ready();
    type('Mật khẩu', 'mat-khau-dung');
    fireEvent.press(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(screen.getByLabelText('Mật khẩu').props).toMatchObject({ secureTextEntry: false, value: 'mat-khau-dung' });
  });
});
