import { useEffect } from 'react';
import { beginDrive, withApp, type Entries } from '../harness';

const session = { userId: '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10' };
// The gate decides before any route shows, so the route named here only matters once a tab root exists.
const gate = { session, route: { name: 'Today' } } as const;

const answer = (status: number, body?: unknown) => async () => ({
  ok: status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
const refuse = (status: number, code: string) => answer(status, { error: { code, message: 'preview' } });

/**
 * The error and confirmation states of the auth screens only exist after the person has typed and pressed, so
 * these entries type and press for them (in the browser, and in the Jest a11y sweep through its document shim).
 * `fill` maps an input's accessibility label to its text, `press` is the name of the button to press.
 */
function Drive({ fill, press }: { fill: Record<string, string>; press: string }) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const done = beginDrive();
    const timer = setTimeout(() => {
      for (const [label, text] of Object.entries(fill)) {
        const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
        // React tracks the value itself: go through the native setter so the change event is seen.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
        input?.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setTimeout(() => {
        const button = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(item => item.textContent === press);
        // not found: the drive stays open, so the sweep reports the entry instead of checking the state before it
        if (!button) return;
        button.click();
        done();
      }, 100);
    }, 400);
    return () => {
      clearTimeout(timer);
      done();
    };
  }, [fill, press]);
  return null;
}

const signedOut = { session: null } as const;
const code = '12345678';

export const entries: Entries = {
  's01-welcome': () => withApp(null, { ...signedOut, route: { name: 'Welcome' } }),
  // GET /me never answers (it only ends when the query is cancelled): the session gate stays on its loading state.
  's39-loading': () =>
    withApp(null, {
      ...gate,
      fetchStub: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    }),
  // No fetch stub = no network, and nothing is cached: the gate shows the load error with both ways forward.
  's39-error': () => withApp(null, gate),

  's02-sign-in': () => withApp(null, { ...signedOut, route: { name: 'SignIn' } }),
  's02-sign-in-error': () =>
    withApp(<Drive fill={{ Email: 'ban@example.com', 'Mật khẩu': 'sai-mat-khau' }} press="Đăng nhập" />, {
      ...signedOut,
      route: { name: 'SignIn' },
      fetchStub: refuse(401, 'INVALID_CREDENTIALS'),
    }),
  's03-sign-up': () => withApp(null, { ...signedOut, route: { name: 'SignUp' } }),
  // Name left empty, a half-typed email, a short password and the terms unchecked.
  's03-sign-up-field-errors': () =>
    withApp(<Drive fill={{ Email: 'ban@', 'Mật khẩu': '1234' }} press="Tạo tài khoản" />, { ...signedOut, route: { name: 'SignUp' } }),
  's04-forgot': () => withApp(null, { ...signedOut, route: { name: 'ForgotPassword' } }),
  's04-forgot-sent': () =>
    withApp(<Drive fill={{ Email: 'ban@example.com' }} press="Gửi mã" />, {
      ...signedOut,
      route: { name: 'ForgotPassword' },
      fetchStub: answer(202, {}),
    }),
  's55-new-password': () => withApp(null, { ...signedOut, route: { name: 'NewPassword', params: { email: 'ban@example.com' } } }),
  's55-new-password-code-invalid': () =>
    withApp(<Drive fill={{ 'Mã 8 chữ số': code, 'Mật khẩu mới': 'mat-khau-moi-1', 'Nhập lại mật khẩu': 'mat-khau-moi-1' }} press="Lưu mật khẩu mới" />, {
      ...signedOut,
      route: { name: 'NewPassword', params: { email: 'ban@example.com' } },
      fetchStub: refuse(400, 'RESET_CODE_INVALID'),
    }),
};
