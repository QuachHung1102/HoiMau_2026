import { useRef, useState } from 'react';
import { normalizeEmail } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import * as vi from '../../shared/i18n/vi/auth';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { useForgotPassword } from './api';
import { emailProblem, failure, focusFirstInvalid, noErrors, useSingleFlight, type FormErrors } from './form';
import { Actions } from './Actions';
import { Notice } from './Notice';

type Field = 'email';
const FIELDS = ['email'] as const;

/** S04: ask for a reset code. Every accepted request gets the same confirmation, whatever the email. */
export function ForgotPasswordScreen({ navigation }: ScreenProps<'ForgotPassword'>) {
  const forgot = useForgotPassword();
  const run = useSingleFlight();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<FormErrors<Field>>(noErrors);
  const inputs = { email: useRef<TextFieldInput>(null) };

  const show = (next: FormErrors<Field>) => {
    setErrors(next);
    focusFirstInvalid(FIELDS, next.fields, inputs);
  };

  const submit = async () => {
    const problem = emailProblem(email);
    if (problem) return show({ fields: { email: problem } });
    setErrors(noErrors);
    try {
      await run(async signal => {
        await forgot.mutateAsync({ body: { email: normalizeEmail(email) }, signal }).finally(() => forgot.reset());
        setSent(true);
      });
    } catch (error) {
      setSent(false);
      show(failure(error, { known: FIELDS }));
    }
  };

  return (
    <Screen title={vi.forgotTitle} subtitle={vi.forgotSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <TextField
        ref={inputs.email}
        label={vi.emailLabel}
        placeholder={vi.emailPlaceholder}
        value={email}
        onChangeText={text => {
          setEmail(text);
          setSent(false);
          setErrors(noErrors);
        }}
        error={errors.fields.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Actions>
        <Button label={vi.forgotAction} loading={forgot.isPending} onPress={submit} />
        {sent ? (
          <>
            <Notice icon="Mail" title={vi.forgotSentTitle} message={vi.forgotSent} note={vi.forgotSentHint} />
            <Button variant="secondary" label={vi.haveCodeAction} onPress={() => navigation.navigate('NewPassword', { email: normalizeEmail(email) })} />
          </>
        ) : null}
      </Actions>
    </Screen>
  );
}
