import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import { answer, fetchMock, mount, onboardingOpened, pendingRequest, queryClient, refuse, respond, sent, session, TOKEN, USER, installAuthTestEnv, watchFocus } from './authTestKit';

installAuthTestEnv();

const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const fill = (email = 'an@example.vn', password = 'mat-khau-dung') => {
  type('Email', email);
  type('Mật khẩu', password);
};
const signIn = () => press('Đăng nhập');
const wrongPassword = () => answer('/auth/login', refuse(401, 'INVALID_CREDENTIALS'));
const liveRegionOf = (text: string) => {
  let node = screen.getByText(text).parent;
  while (node && !node.props.accessibilityLiveRegion) node = node.parent;
  return node?.props.accessibilityLiveRegion;
};
const ready = () => screen.findByRole('header', { name: 'Chào bạn trở lại' });
const SESSION_ENDED = 'Phiên đăng nhập đã hết hạn. Bạn đăng nhập lại nhé.';
const EMAIL_INVALID = 'Email chưa đúng định dạng, ví dụ ban@example.com.';

test('S02 shows the two fields, the primary action and the ways to other screens', async () => {
  mount('SignIn');
  expect(await ready()).toBeTruthy();
  expect(screen.getByText('Đăng nhập để tiếp tục hành trình.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quên mật khẩu?' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Chưa có tài khoản? Tạo tài khoản' })).toBeTruthy();
  expect(screen.getByText('Thông tin tài khoản được bảo vệ.')).toBeTruthy();
  // nothing about a session ending when there was none
  expect(screen.queryByText(SESSION_ENDED)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the keyboard is set up for email and password', async () => {
  mount('SignIn');
  await ready();
  expect(screen.getByLabelText('Email').props).toMatchObject({
    keyboardType: 'email-address',
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'email',
    returnKeyType: 'next',
  });
  expect(screen.getByLabelText('Mật khẩu').props).toMatchObject({ autoComplete: 'password', secureTextEntry: true, autoCapitalize: 'none', returnKeyType: 'go' });
});

test('"next" on the email moves to the password; "go" on the password submits', async () => {
  answer('/auth/login', respond(200, session));
  mount('SignIn');
  await ready();
  fill();
  const focusPassword = watchFocus('Mật khẩu');
  fireEvent(screen.getByLabelText('Email'), 'submitEditing');
  expect(focusPassword).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent(screen.getByLabelText('Mật khẩu'), 'submitEditing');
  await waitFor(() => expect(sent().map(r => r.path)).toContain('/auth/login'));
  await onboardingOpened();
});

test('happy path: POST /auth/login with the normalised email and the password as typed, no Idempotency-Key, one sign-in', async () => {
  answer('/auth/login', respond(200, session));
  mount('SignIn');
  await ready();
  fill('  An@Example.VN ', ' mật khẩu có khoảng trắng ');
  signIn();
  // the root gate moves on by itself: the new account has no profile yet
  expect(await onboardingOpened()).toBeTruthy();
  const [login] = sent();
  expect(login).toMatchObject({ method: 'POST', path: '/auth/login', body: { email: 'an@example.vn', password: ' mật khẩu có khoảng trắng ' } });
  const headers = Object.keys(login.headers).map(h => h.toLowerCase());
  expect(headers).not.toContain('idempotency-key');
  expect(headers).not.toContain('authorization');
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(USER, TOKEN);
  // GET /me then carries the new token
  expect(sent().find(r => r.path === '/me')?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
});

test('the password stays in the field until the sign-in has succeeded, and the mutation cache never keeps it', async () => {
  answer('/auth/login', respond(200, session));
  let finishKeychain!: () => void;
  jest.mocked(Keychain.setGenericPassword).mockImplementationOnce(() => new Promise(resolve => (finishKeychain = () => resolve({ service: 'x', storage: 'x' } as never))));
  mount('SignIn');
  await ready();
  fill();
  signIn();
  // the request has succeeded and the keychain is still writing: the screen is still here
  await waitFor(() => expect(Keychain.setGenericPassword).toHaveBeenCalled());
  // not cleared before signIn resolved: a failing keychain write must not make the person retype it
  expect(screen.getByLabelText('Mật khẩu').props.value).toBe('mat-khau-dung');
  // but the request is over, so the variables that held it are gone from the query client
  await waitFor(() => expect(queryClient().getMutationCache().getAll()).toEqual([]));
  await act(async () => finishKeychain());
  await onboardingOpened();
});

describe('client validation blocks the request and names the field', () => {
  test('a bad email: its error, focus on it, nothing sent', async () => {
    mount('SignIn');
    await ready();
    fill('an@', 'mat-khau');
    const focusEmail = watchFocus('Email');
    signIn();
    expect(await screen.findByText(EMAIL_INVALID)).toBeTruthy();
    expect(screen.getByLabelText(`Email, lỗi: ${EMAIL_INVALID}`)).toBeTruthy();
    expect(focusEmail).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an empty email and an empty password: both named, the first one gets focus', async () => {
    mount('SignIn');
    await ready();
    const focusEmail = watchFocus('Email');
    const focusPassword = watchFocus('Mật khẩu');
    signIn();
    expect(await screen.findByText('Bạn nhập email nhé.')).toBeTruthy();
    expect(screen.getByText('Bạn nhập mật khẩu nhé.')).toBeTruthy();
    expect(focusEmail).toHaveBeenCalledTimes(1);
    expect(focusPassword).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a look-alike email (fullwidth @) is refused by the domain rule, not sent', async () => {
    mount('SignIn');
    await ready();
    fill('an＠example.vn', 'mat-khau');
    signIn();
    expect(await screen.findByText(EMAIL_INVALID)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('typing in a field clears its error', async () => {
    mount('SignIn');
    await ready();
    signIn();
    await screen.findByText('Bạn nhập email nhé.');
    type('Email, lỗi: Bạn nhập email nhé.', 'a');
    expect(screen.queryByText('Bạn nhập email nhé.')).toBeNull();
    expect(screen.getByText('Bạn nhập mật khẩu nhé.')).toBeTruthy();
  });
});

describe('failed requests', () => {
  test('wrong credentials: the INVALID_CREDENTIALS copy, announced, on the password field, which is focused again', async () => {
    wrongPassword();
    mount('SignIn');
    await ready();
    fill();
    const focusPassword = watchFocus('Mật khẩu');
    signIn();
    expect(await screen.findByText('Email hoặc mật khẩu chưa đúng.')).toBeTruthy();
    // the announcement is the TextField / InlineError path: a polite live region and the field's own label
    expect(liveRegionOf('Email hoặc mật khẩu chưa đúng.')).toBe('polite');
    expect(screen.getByLabelText('Mật khẩu, lỗi: Email hoặc mật khẩu chưa đúng.')).toBeTruthy();
    expect(focusPassword).toHaveBeenCalledTimes(1);
    // the server's diagnostic text is never shown, and the form is usable again
    expect(screen.queryByText(/diagnostic/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Đăng nhập' }).props.accessibilityState).toMatchObject({ busy: false });
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    await waitFor(() => expect(queryClient().getMutationCache().getAll()).toEqual([]));
  });

  test('every credential failure reads the same, so an email is never confirmed or denied', async () => {
    // the contract gives one code for unknown email, wrong password, locked and deleted accounts alike
    const labels: string[] = [];
    for (const email of ['co-tai-khoan@example.vn', 'khong-co@example.vn']) {
      wrongPassword();
      const view = mount('SignIn');
      await ready();
      fill(email);
      signIn();
      labels.push(String((await screen.findByLabelText(/^Mật khẩu, lỗi: /)).props.accessibilityLabel));
      view.unmount();
    }
    expect(labels).toEqual(['Mật khẩu, lỗi: Email hoặc mật khẩu chưa đúng.', 'Mật khẩu, lỗi: Email hoặc mật khẩu chưa đúng.']);
  });

  test.each([
    ['RATE_LIMITED', 429, 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.'],
    ['INTERNAL', 500, 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.'],
    ['BAD_JSON', 400, 'Có lỗi xảy ra. Bạn thử lại nhé.'],
  ])('%s: its generic copy above the button, no field blamed, no focus moved', async (code, status, copy) => {
    answer('/auth/login', refuse(status, code));
    mount('SignIn');
    await ready();
    fill();
    const focused = [watchFocus('Email'), watchFocus('Mật khẩu')];
    signIn();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.getByLabelText('Mật khẩu')).toBeTruthy();
    for (const focus of focused) expect(focus).not.toHaveBeenCalled();
  });

  test('no connection: the NETWORK copy', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    mount('SignIn');
    await ready();
    fill();
    signIn();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
  });

  test('no answer for 10 s: the TIMEOUT copy', async () => {
    jest.useFakeTimers();
    pendingRequest('/auth/login');
    mount('SignIn');
    await ready();
    fill();
    signIn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled()); // the request, and with it its 10 s timer, has started
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(await screen.findByText('Kết nối hơi chậm. Bạn thử lại nhé.')).toBeTruthy();
  });

  test('VALIDATION_FAILED from the server lands on the field it names', async () => {
    answer('/auth/login', refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'email', rule: 'format' }] }));
    mount('SignIn');
    await ready();
    fill();
    const focusEmail = watchFocus('Email');
    signIn();
    expect(await screen.findByLabelText(`Email, lỗi: ${EMAIL_INVALID}`)).toBeTruthy();
    expect(focusEmail).toHaveBeenCalledTimes(1);
  });

  test('a 401 here is an ordinary error: it does not sign anyone out or show the expired notice', async () => {
    wrongPassword();
    mount('SignIn');
    await ready();
    fill();
    signIn();
    await screen.findByText('Email hoặc mật khẩu chưa đúng.');
    expect(screen.queryByText(SESSION_ENDED)).toBeNull();
  });

  test('the keychain failing after a good answer reports a generic error and signs nobody in', async () => {
    answer('/auth/login', respond(200, session));
    jest.mocked(Keychain.setGenericPassword).mockRejectedValueOnce(new Error('keystore unavailable'));
    mount('SignIn');
    await ready();
    fill();
    signIn();
    expect(await screen.findByText('Có lỗi xảy ra. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.queryByText('Bắt đầu từ bạn')).toBeNull();
    // the form keeps what was typed
    expect(screen.getByLabelText('Mật khẩu').props.value).toBe('mat-khau-dung');
    expect(screen.getByLabelText('Email').props.value).toBe('an@example.vn');
  });

  test('offline with an online manager wired: the press still reaches fetch and fails fast with NETWORK', async () => {
    onlineManager.setOnline(false);
    try {
      fetchMock.mockRejectedValue(new TypeError('Network request failed'));
      mount('SignIn');
      await ready();
      fill();
      signIn();
      expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Đăng nhập' }).props.accessibilityState).toMatchObject({ busy: false });
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('one request at a time', () => {
  test('two presses inside one act() send one request', async () => {
    const request = pendingRequest('/auth/login');
    mount('SignIn');
    await ready();
    fill();
    const button = screen.getByRole('button', { name: 'Đăng nhập' });
    // both presses reach the handler of the same render: only the guard can tell them apart
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(sent().filter(r => r.path === '/auth/login')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Đăng nhập' }).props.accessibilityState).toMatchObject({ busy: true });
    // a press after the button re-rendered as loading is swallowed too
    fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(sent().filter(r => r.path === '/auth/login')).toHaveLength(1);
    await act(async () => request.finish(respond(200, session)));
    await onboardingOpened();
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  });

  test('after a failure the next press sends again', async () => {
    wrongPassword();
    mount('SignIn');
    await ready();
    fill();
    signIn();
    await screen.findByText('Email hoặc mật khẩu chưa đúng.');
    signIn();
    await waitFor(() => expect(sent().filter(r => r.path === '/auth/login')).toHaveLength(2));
  });

  test('leaving the screen cancels the request and signs nobody in', async () => {
    pendingRequest('/auth/login');
    const view = mount('SignIn');
    await ready();
    fill();
    signIn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const signal = fetchMock.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => undefined);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  });
});

describe('navigation', () => {
  test('"Quên mật khẩu?" opens S04', async () => {
    mount('SignIn');
    await ready();
    fireEvent.press(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
    expect(await screen.findByRole('header', { name: 'Lấy lại mật khẩu' })).toBeTruthy();
  });

  test('the sign-up link opens S03', async () => {
    mount('SignIn');
    await ready();
    fireEvent.press(screen.getByRole('link', { name: 'Chưa có tài khoản? Tạo tài khoản' }));
    expect(await screen.findByRole('header', { name: 'Tạo tài khoản' })).toBeTruthy();
  });

  test('no Back arrow with nothing to go back to; with Welcome underneath, Back returns to it', async () => {
    mount('SignIn');
    await ready();
    expect(screen.queryByRole('button', { name: 'Quay lại' })).toBeNull();
    screen.unmount();
    mount('Welcome');
    fireEvent.press(await screen.findByRole('button', { name: 'Tôi đã có tài khoản' }));
    await ready();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Hồi Máu' })).toBeTruthy();
  });
});

describe('the session ended on the server', () => {
  test('S02 says so as a polite notice above the form, and it is gone after signing in again', async () => {
    await Keychain.setGenericPassword(USER, 'tok-old');
    jest.mocked(Keychain.setGenericPassword).mockClear();
    answer('/auth/login', respond(200, session));
    fetchMock.mockResolvedValueOnce(refuse(401, 'SESSION_INVALID')); // the restored session's GET /me
    mount('Welcome');
    expect(await screen.findByText(SESSION_ENDED)).toBeTruthy();
    expect(await ready()).toBeTruthy();
    expect(liveRegionOf(SESSION_ENDED)).toBe('polite');
    fill();
    signIn();
    await onboardingOpened();
    expect(screen.queryByText(SESSION_ENDED)).toBeNull();
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  });
});

// e + combining circumflex + combining acute: three code points that NFC joins into U+1EBF.
const ECIRC_ACUTE_NFD = String.fromCodePoint(0x65, 0x302, 0x301);
const ECIRC_ACUTE_NFC = String.fromCodePoint(0x1ebf);

test('the password typed decomposed is sent in NFC (normalizePassword), nothing else changed', async () => {
  answer('/auth/login', respond(200, session));
  mount('SignIn');
  await ready();
  fill('an@example.vn', `${ECIRC_ACUTE_NFD}abcdefg `);
  signIn();
  expect(await onboardingOpened()).toBeTruthy();
  const [login] = sent();
  expect(login.body?.password).toBe(`${ECIRC_ACUTE_NFC}abcdefg `); // not trimmed
});
