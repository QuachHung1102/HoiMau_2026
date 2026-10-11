import { useRef, useState } from 'react';
import { LIMITS, normalizeEmail } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import * as vi from '../../shared/i18n/vi/auth';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { useSnackbar } from '../../shared/ui/Snackbar';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { useForgotPassword, useResetPassword } from './api';
import { Actions } from './Actions';
import { failure, focusFirstInvalid, isResetCode, newPasswordProblem, noErrors, useSingleFlight, type FormErrors } from './form';

type Field = 'code' | 'newPassword' | 'repeat';
const FIELDS = ['code', 'newPassword', 'repeat'] as const;
const API_FIELDS = ['code', 'newPassword'] as const;

/** S55: the code from the email, then the new password. */
export function NewPasswordScreen({ navigation, route }: ScreenProps<'NewPassword'>) {
  const email = normalizeEmail(route.params.email);
  const reset = useResetPassword();
  const resend = useForgotPassword();
  const snackbar = useSnackbar();
  const run = useSingleFlight();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<FormErrors<Field>>(noErrors);
  const inputs = { code: useRef<TextFieldInput>(null), newPassword: useRef<TextFieldInput>(null), repeat: useRef<TextFieldInput>(null) };

  const show = (next: FormErrors<Field>) => {
    setErrors(next);
    focusFirstInvalid(FIELDS, next.fields, inputs);
  };
  const edit = (field: Field) => setErrors(e => ({ ...e, fields: { ...e.fields, [field]: undefined } }));

  const submit = async () => {
    const trimmed = code.trim();
    const fields: FormErrors<Field>['fields'] = {
      code: isResetCode(trimmed) ? undefined : vi.codeInvalid(LIMITS.resetCode.length),
      newPassword: newPasswordProblem(newPassword),
      repeat: repeat === '' ? vi.repeatRequired : repeat === newPassword ? undefined : vi.repeatMismatch,
    };
    if (FIELDS.some(field => fields[field])) return show({ fields });
    setErrors(noErrors);
    try {
      await run(async signal => {
        // reset(): the variables hold the new password, so they go as soon as the request has settled
        await reset.mutateAsync({ body: { email, code: trimmed, newPassword }, signal }).finally(() => reset.reset());
        setNewPassword('');
        setRepeat('');
        snackbar.show({ message: vi.newPasswordSaved });
        navigation.navigate('SignIn', undefined, { pop: true });
      });
    } catch (error) {
      show(failure(error, { own: { RESET_CODE_INVALID: 'code' }, known: API_FIELDS }));
    }
  };

  const sendAgain = async () => {
    setErrors(noErrors);
    try {
      await run(async signal => {
        await resend.mutateAsync({ body: { email }, signal }).finally(() => resend.reset());
        snackbar.show({ message: vi.forgotSent });
      });
    } catch (error) {
      show(failure(error, { known: [] }));
    }
  };

  return (
    <Screen title={vi.newPasswordTitle} subtitle={vi.newPasswordSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <TextField
        ref={inputs.code}
        label={vi.codeLabel(LIMITS.resetCode.length)}
        value={code}
        onChangeText={text => {
          setCode(text);
          edit('code');
        }}
        error={errors.fields.code}
        keyboardType="number-pad"
        maxLength={LIMITS.resetCode.length}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        returnKeyType="next"
        onSubmitEditing={() => inputs.newPassword.current?.focus()}
      />
      <TextField
        ref={inputs.newPassword}
        label={vi.newPasswordLabel}
        placeholder={vi.passwordPlaceholder}
        secure
        helper={vi.passwordHelper(LIMITS.password.min)}
        value={newPassword}
        onChangeText={text => {
          setNewPassword(text);
          edit('newPassword');
        }}
        error={errors.fields.newPassword}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => inputs.repeat.current?.focus()}
      />
      <TextField
        ref={inputs.repeat}
        label={vi.repeatPasswordLabel}
        placeholder={vi.repeatPasswordPlaceholder}
        secure
        value={repeat}
        onChangeText={text => {
          setRepeat(text);
          edit('repeat');
        }}
        error={errors.fields.repeat}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Actions>
        <Button label={vi.newPasswordAction} loading={reset.isPending} onPress={submit} />
        <AppText variant="secondary">{vi.resendHint}</AppText>
        <Button variant="secondary" label={vi.resendAction} loading={resend.isPending} onPress={sendAgain} />
      </Actions>
    </Screen>
  );
}
