import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LIMITS, normalizeEmail } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/auth';
import { legalVi } from '../../shared/i18n/vi/legal';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { Checkbox } from '../../shared/ui/Toggles';
import { useRegister } from './api';
import { displayNameProblem, emailProblem, failure, focusFirstInvalid, newPasswordProblem, noErrors, useSingleFlight, type FormErrors } from './form';
import { Actions } from './Actions';
import { TextLink } from './TextLink';

type Field = 'displayName' | 'email' | 'password' | 'terms';
const FIELDS = ['displayName', 'email', 'password', 'terms'] as const;
// The terms are a checkbox, not an input: its error is read out by InlineError, focus stays where it is.
const INPUT_FIELDS = ['displayName', 'email', 'password'] as const;

/** S03: create an account. On success the session starts and the root gate moves on to onboarding. */
export function SignUpScreen({ navigation }: ScreenProps<'SignUp'>) {
  const { signIn } = useSession();
  const register = useRegister();
  const run = useSingleFlight();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [errors, setErrors] = useState<FormErrors<Field>>(noErrors);
  const inputs = { displayName: useRef<TextFieldInput>(null), email: useRef<TextFieldInput>(null), password: useRef<TextFieldInput>(null) };

  const show = (next: FormErrors<Field>) => {
    setErrors(next);
    focusFirstInvalid(FIELDS, next.fields, inputs);
  };
  const edit = (field: Field) => setErrors(e => ({ ...e, fields: { ...e.fields, [field]: undefined } }));

  const submit = async () => {
    const fields: FormErrors<Field>['fields'] = {
      displayName: displayNameProblem(displayName),
      email: emailProblem(email),
      password: newPasswordProblem(password),
      terms: agreed ? undefined : vi.termsRequired,
    };
    if (FIELDS.some(field => fields[field])) return show({ fields });
    setErrors(noErrors);
    try {
      await run(async signal => {
        // reset(): the variables hold the password, so they go as soon as the request has settled
        const session = await register
          .mutateAsync({ body: { email: normalizeEmail(email), password, displayName: displayName.trim(), acceptedTerms: true }, signal })
          .finally(() => register.reset());
        // The root gate unmounts the auth screens once signed in, so this runs only while signed out, and once.
        try {
          await signIn(session.token, session.userId);
        } catch {
          // The account exists now: a retry of this form would be refused, so say so.
          return show({ fields: {}, form: vi.accountCreatedNotSignedIn });
        }
        // Cleared only now: if the keychain write failed, the person keeps what they typed.
        setPassword('');
      });
    } catch (error) {
      show(failure(error, { own: { REGISTRATION_UNAVAILABLE: 'email', NAME_NOT_ALLOWED: 'displayName' }, known: INPUT_FIELDS }));
    }
  };

  return (
    <Screen title={vi.signUpTitle} subtitle={vi.signUpSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <TextField
        ref={inputs.displayName}
        label={vi.displayNameLabel}
        placeholder={vi.displayNamePlaceholder}
        value={displayName}
        onChangeText={text => {
          setDisplayName(text);
          edit('displayName');
        }}
        error={errors.fields.displayName}
        autoComplete="name"
        textContentType="nickname"
        returnKeyType="next"
        onSubmitEditing={() => inputs.email.current?.focus()}
      />
      <TextField
        ref={inputs.email}
        label={vi.emailLabel}
        placeholder={vi.emailPlaceholder}
        value={email}
        onChangeText={text => {
          setEmail(text);
          edit('email');
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
        placeholder={vi.passwordPlaceholder}
        secure
        helper={vi.passwordHelper(LIMITS.password.min)}
        value={password}
        onChangeText={text => {
          setPassword(text);
          edit('password');
        }}
        error={errors.fields.password}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Checkbox
        label={vi.termsLabel}
        checked={agreed}
        onChange={checked => {
          setAgreed(checked);
          edit('terms');
        }}
      />
      <View style={styles.termsLink}>
        <TextLink small label={vi.termsLink} onPress={() => setTermsOpen(true)} />
      </View>
      {errors.fields.terms ? <InlineError message={errors.fields.terms} /> : null}
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Actions>
        <Button label={vi.signUpAction} loading={register.isPending} onPress={submit} />
        <Button variant="secondary" label={vi.haveAccountLink} onPress={() => navigation.navigate('SignIn', undefined, { pop: true })} />
      </Actions>
      {termsOpen ? (
        <BottomSheet title={legalVi.title} onDismiss={() => setTermsOpen(false)}>
          <AppText variant="secondary">{legalVi.intro}</AppText>
          {legalVi.sections.map(section => (
            <View key={section.heading} style={styles.section}>
              <AppText weight="semibold">{section.heading}</AppText>
              <AppText variant="secondary">{section.body}</AppText>
            </View>
          ))}
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // lines up with the checkbox label (24 dp box + 16 dp gap)
  termsLink: { marginLeft: 40, alignItems: 'flex-start' },
  section: { marginTop: 12, gap: 2 },
});
