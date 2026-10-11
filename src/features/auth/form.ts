// What the four auth forms share: the client-side rules, the mapping of a failed request to copy, "one request at a
// time", and moving focus to the first invalid field. Copy is in vi/auth.ts and vi/common.ts; nothing here knows
// whether an account exists (S02 / S04 must never reveal it).
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { TextFieldInput } from '../../shared/ui/TextField';
import type { ErrorCode } from '../../../domain/contract/common.ts';
import { isDisplayName, isEmail, LIMITS, normalizeEmail } from '../../../domain/validation.ts';
import { ApiError, isValidationDetails } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/auth';
import * as common from '../../shared/i18n/vi/common';

export type FormErrors<F extends string> = {
  /** Shown under the field, in form order; the first one receives focus. */
  fields: Partial<Record<F, string>>;
  /** Not about one field (network, rate limit, anything unexpected): shown above the button. */
  form?: string;
};
export const noErrors = { fields: {} } as const;

const length = (text: string) => [...text].length;

// ---- client-side rules (the same limits as the server: domain/validation.ts) ----

/** Returns the message, or undefined when the value is fine. Judges the normalised email, as it will be sent. */
export function emailProblem(raw: string): string | undefined {
  const email = normalizeEmail(raw);
  if (email === '') return vi.emailRequired;
  return isEmail(email) ? undefined : vi.emailInvalid;
}

/** A new password: the minimum and maximum of LIMITS, nothing else. Never trimmed. */
export function newPasswordProblem(password: string): string | undefined {
  if (password === '') return vi.passwordRequired;
  if (length(password) < LIMITS.password.min) return vi.passwordTooShort(LIMITS.password.min);
  return length(password) > LIMITS.password.max ? vi.passwordTooLong(LIMITS.password.max) : undefined;
}

export function displayNameProblem(raw: string): string | undefined {
  const name = raw.trim();
  if (name === '') return vi.displayNameRequired;
  return isDisplayName(name) ? undefined : vi.displayNameInvalid(LIMITS.displayName.max);
}

export const isResetCode = (code: string) => new RegExp(`^[0-9]{${LIMITS.resetCode.length}}$`).test(code);

// ---- failed requests ----

const codeCopy: Partial<Record<ApiError['code'], string>> = {
  INVALID_CREDENTIALS: vi.invalidCredentials,
  REGISTRATION_UNAVAILABLE: vi.registrationUnavailable,
  RESET_CODE_INVALID: vi.resetCodeInvalid,
  NAME_NOT_ALLOWED: vi.nameNotAllowed,
  RATE_LIMITED: common.errorText.RATE_LIMITED,
  NETWORK: common.errorText.NETWORK,
  TIMEOUT: common.errorText.TIMEOUT,
  INTERNAL: common.errorText.INTERNAL,
};

/** The copy of a server `VALIDATION_FAILED` for one field, or undefined for a field the forms do not know. */
function fieldCopy(field: string, rule: string): string | undefined {
  switch (field) {
    case 'email':
      return rule === 'required' ? vi.emailRequired : vi.emailInvalid;
    case 'password':
    case 'newPassword':
      if (rule === 'required') return vi.passwordRequired;
      return rule === 'max' ? vi.passwordTooLong(LIMITS.password.max) : vi.passwordTooShort(LIMITS.password.min);
    case 'displayName':
      return rule === 'required' ? vi.displayNameRequired : vi.displayNameInvalid(LIMITS.displayName.max);
    case 'code':
      return vi.codeInvalid(LIMITS.resetCode.length);
    default:
      return undefined;
  }
}

/**
 * Turns whatever a request threw into what the screen shows.
 * `own` names the field that carries the copy of a code about one field (`INVALID_CREDENTIALS` on S02 belongs
 * under the password); `known` is the list of fields this form has, for `VALIDATION_FAILED`.
 */
export function failure<F extends string>(
  error: unknown,
  { own = {}, known }: { own?: Partial<Record<ErrorCode, F>>; known: readonly F[] },
): FormErrors<F> {
  if (!(error instanceof ApiError)) return { fields: {}, form: common.unknownError };
  const field = own[error.code as ErrorCode];
  const copy = codeCopy[error.code];
  if (field && copy) return { fields: { [field]: copy } as Partial<Record<F, string>> };
  if (error.code === 'VALIDATION_FAILED' && isValidationDetails(error.details)) {
    const fields: Partial<Record<F, string>> = {};
    let dropped = false;
    for (const item of error.details.fields) {
      const message = known.includes(item.field as F) ? fieldCopy(item.field, item.rule) : undefined;
      if (message) fields[item.field as F] ??= message;
      else dropped = true;
    }
    // A field this form has no place for must not vanish silently: say something is wrong beyond the marked fields.
    if (Object.keys(fields).length > 0) return dropped ? { fields, form: common.unknownError } : { fields };
  }
  return { fields: {}, form: copy ?? common.unknownError };
}

// ---- one request at a time ----

/**
 * `run(work)` starts `work` unless one is already running and answers undefined in that case. The flag is a ref
 * on purpose: two presses inside one batch of updates both see the same render, so a `loading` state cannot stop
 * the second. The request is aborted when the screen goes away (its answer would sign someone in from nowhere).
 */
export function useSingleFlight() {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  return useCallback(async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    if (current.current) return undefined;
    const controller = new AbortController();
    current.current = controller;
    try {
      return await work(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return undefined; // the screen left; nobody is waiting for this
      throw error;
    } finally {
      current.current = null;
    }
  }, []);
}

/** Focus goes to the first field, in form order, that has an error; the error itself is announced by TextField. */
export function focusFirstInvalid<F extends string>(
  order: readonly F[],
  fields: Partial<Record<F, string>>,
  inputs: Partial<Record<F, RefObject<TextFieldInput | null>>>,
) {
  const first = order.find(field => fields[field]);
  if (first) inputs[first]?.current?.focus();
}
