import * as vi from '../../../src/shared/i18n/vi/settings';
import type { Entries } from '../harness';
import { byText, PressWhen } from './guild';
import { ScrollToEnd, Type } from './settings';
import { app, pathOf, respond } from './today';

// Privacy and the deletion of the account, frames S44 and S52 (with the states the brief names). The data is in the query cache and
// the server of the preview answers as the real routes do (the Idempotency-Key first, then the account's password).

/** `GET /me/export` that never answers: the copy is being prepared. */
const exportOnTheWay = (url: string) => (pathOf(url) === '/me/export' ? new Promise<never>(() => undefined) : respond(404));
/** `POST /me/delete` of an account whose password is not the one typed (401 INVALID_CREDENTIALS, the key first as in app.ts). */
const refusesPassword = (url: string, init?: RequestInit) => {
  const sentKey = (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'];
  if (init?.method === 'POST' && pathOf(url) === '/me/delete') {
    return sentKey ? respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'preview' } }) : respond(400, { error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'preview' } });
  }
  return respond(404);
};

/** The button once the password is typed (it is off until then): a click on an off button would be lost. */
const whenEnabled = (text: string) => () => {
  const button = byText('button', text)();
  return button && button.getAttribute('aria-disabled') !== 'true' ? button : null;
};

export const entries: Entries = {
  's44-privacy': () => app({ route: 'Privacy' }),
  // "Tải dữ liệu của tôi" pressed: the request is on its way, the row is busy and the words say what is going on.
  's44-privacy-exporting': () => app({ route: 'Privacy', fetchStub: exportOnTheWay, extra: <PressWhen find={byText('button', vi.exportRow.title)} /> }),
  's52-delete-account': () => app({ route: 'DeleteAccount' }),
  // The foot of the screen: the field, the safe button first and the one that deletes, both of one size (off until a password is typed).
  's52-delete-account-bottom': () => app({ route: 'DeleteAccount', extra: <ScrollToEnd /> }),
  // A password that the server does not take: said at the field, the account stays, what was typed stays to be corrected.
  's52-delete-account-wrong-password': () =>
    app({
      route: 'DeleteAccount',
      fetchStub: refusesPassword,
      extra: (
        <>
          <ScrollToEnd />
          <Type label={vi.passwordLabel} text="mat-khau-sai-9" />
          <PressWhen find={whenEnabled(vi.deleteAction)} />
        </>
      ),
    }),
};
