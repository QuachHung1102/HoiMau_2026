import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { normalizeEmail, normalizePassword } from '../../../domain/validation.ts';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/auth';
import { errorText } from '../../shared/i18n/vi/common';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { useLogin } from './api';
import { emailProblem, failure, focusFirstInvalid, noErrors, useSingleFlight, type FormErrors } from './form';
import { Actions } from './Actions';
import { Notice } from './Notice';
import { TextLink } from './TextLink';

type Field = 'email' | 'password';
const FIELDS = ['email', 'password'] as const;

/** S02: sign in. Every credential failure reads the same: it never says whether the email has an account. */
export function SignInScreen({ navigation }: ScreenProps<'SignIn'>) {
  const { expired, signIn } = useSession();
  const login = useLogin();
  const run = useSingleFlight();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors<Field>>(noErrors);
  const inputs = { email: useRef<TextFieldInput>(null), password: useRef<TextFieldInput>(null) };

  const show = (next: FormErrors<Field>) => {
    setErrors(next);
    focusFirstInvalid(FIELDS, next.fields, inputs);
  };

  const submit = async () => {
    const fields = { email: emailProblem(email), password: password === '' ? vi.passwordRequired : undefined };
    if (fields.email || fields.password) return show({ fields });
    setErrors(noErrors);
    try {
      await run(async signal => {
        // reset(): the variables hold the password, so they go as soon as the request has settled
        const session = await login.mutateAsync({ body: { email: normalizeEmail(email), password: normalizePassword(password) }, signal }).finally(() => login.reset());
        // The root gate unmounts the auth screens once signed in, so this runs only while signed out, and once.
        await signIn(session.token, session.userId);
        // Cleared only now: if the keychain write failed, the person keeps what they typed.
        setPassword('');
      });
    } catch (error) {
      show(failure(error, { own: { INVALID_CREDENTIALS: 'password' }, known: FIELDS }));
    }
  };

  return (
    <Screen title={vi.signInTitle} subtitle={vi.signInSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      {expired ? <Notice icon="Info" message={errorText.SESSION_INVALID} /> : null}
      <TextField
        ref={inputs.email}
        label={vi.emailLabel}
        placeholder={vi.emailPlaceholder}
        value={email}
        onChangeText={text => {
          setEmail(text);
          setErrors(e => ({ ...e, fields: { ...e.fields, email: undefined } }));
        }}
        error={errors.fields.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => inputs.password.current?.focus()}
      />
      <TextField
        ref={inputs.password}
        label={vi.passwordLabel}
        secure
        value={password}
        onChangeText={text => {
          setPassword(text);
          setErrors(e => ({ ...e, fields: { ...e.fields, password: undefined } }));
        }}
        error={errors.fields.password}
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Actions>
        <Button label={vi.signInAction} loading={login.isPending} onPress={submit} />
        <Button variant="secondary" label={vi.forgotLink} onPress={() => navigation.navigate('ForgotPassword')} />
        <View style={styles.link}>
          <TextLink label={vi.noAccountLink} onPress={() => navigation.navigate('SignUp', undefined, { pop: true })} />
        </View>
        <AppText variant="caption">{vi.accountProtected}</AppText>
      </Actions>
    </Screen>
  );
}

// The link is a 48 dp row; pulled into the 24 dp gaps around it (never over a control) it sits 24 dp from its neighbours, as in the frame.
const styles = StyleSheet.create({ link: { marginVertical: -12 } });
