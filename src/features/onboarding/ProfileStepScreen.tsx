import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { useSession } from '../../shared/api/session';
import * as authVi from '../../shared/i18n/vi/auth';
import * as common from '../../shared/i18n/vi/common';
import { healthVi } from '../../shared/i18n/vi/health';
import * as vi from '../../shared/i18n/vi/onboarding';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { BottomSheet } from '../../shared/ui/BottomSheet';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Mam } from '../../shared/ui/mam/Mam';
import { InlineError } from '../../shared/ui/Notices';
import type { TextFieldInput } from '../../shared/ui/TextField';
import { focusFirstInvalid } from '../auth/form';
import { TextLink } from '../auth/TextLink';
import { BiometricsFields, checkBiometrics, TimezoneField, timezoneProblem, useTimezoneChoice } from './BiometricsFields';
import { ONBOARDING_FIELDS, useOnboarding } from './OnboardingProvider';
import { StepScreen } from './StepScreen';

const STEPS = 3;

/** S61: the app is for people from 16. Calm, nobody is blamed, and the way back keeps everything that was typed. */
function UnderSixteen({ onCheck }: { onCheck: () => void }) {
  const focused = useIsFocused();
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => {
    // Hardware Back (Android only) leaves this state, not the app.
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCheck();
      return true;
    });
    return () => subscription.remove();
  }, [onCheck]);
  return (
    <StepScreen title={healthVi.under16.title} onBack={onCheck}>
      <Card tone="soft" style={styles.hero}>
        <Mam stage="HATCHLING" mood="NEUTRAL" size={128} animation="idle" active={focused} decorative />
      </Card>
      <AppText variant="secondary">{healthVi.under16.body}</AppText>
      <View style={styles.actions}>
        <Button label={vi.checkBirthYear} onPress={onCheck} />
        <Button variant="secondary" label={vi.learnMore} onPress={() => setInfoOpen(true)} />
      </View>
      {infoOpen ? (
        <BottomSheet title={healthVi.info.title} onDismiss={() => setInfoOpen(false)}>
          {healthVi.info.paragraphs.map(paragraph => (
            <View key={paragraph.title} style={styles.paragraph}>
              <AppText weight="semibold">{paragraph.title}</AppText>
              <AppText variant="secondary">{paragraph.body}</AppText>
            </View>
          ))}
        </BottomSheet>
      ) : null}
    </StepScreen>
  );
}

/** S05 (with S60 and S61 as states): measurements, the sex used by the formula, the time zone. */
export function ProfileStepScreen({ navigation }: ScreenProps<'OnbProfile'>) {
  const { draft, errors, block, focusRequest, edit, fail, setBlock } = useOnboarding();
  const focused = useIsFocused();
  const { signOut } = useSession();
  const { zone, zones } = useTimezoneChoice(draft.timezone);
  const birthYear = useRef<TextFieldInput>(null);
  const heightCm = useRef<TextFieldInput>(null);
  const weightKg = useRef<TextFieldInput>(null);
  // "Check the birth year again" puts the cursor back in that field once the form is on screen again.
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    // Runs when errors were just shown (`fail` bumps the request together with them), also when a refusal from the
    // server brought the person back to this step. Not on every edit: focus must not jump while someone is typing.
    if (focused && focusRequest > 0) focusFirstInvalid(ONBOARDING_FIELDS, errors.fields, { birthYear, heightCm, weightKg });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, focusRequest]);
  useEffect(() => {
    if (returning && block !== 'age') {
      birthYear.current?.focus();
      setReturning(false);
    }
  }, [returning, block]);

  if (block === 'age') {
    return (
      <UnderSixteen
        onCheck={() => {
          setReturning(true);
          setBlock(null);
        }}
      />
    );
  }

  const next = () => {
    const result = checkBiometrics(draft, { nowMs: Date.now(), timeZone: zone, activityLevel: draft.activityLevel ?? undefined });
    const fields = { ...(!result.ok && result.code === 'VALIDATION_FAILED' ? result.fields : null), timezone: timezoneProblem(zone, zones) };
    if (ONBOARDING_FIELDS.some(field => fields[field as keyof typeof fields])) return fail({ fields });
    // Under 16: nothing has been sent, and nothing will be.
    if (!result.ok) return setBlock('age');
    edit({ timezone: zone });
    navigation.navigate('OnbActivity');
  };

  return (
    <StepScreen
      title={vi.profileTitle}
      subtitle={vi.stepOf(vi.profileStep, 1, STEPS)}
      onBack={navigation.canGoBack() ? navigation.goBack : undefined}
      hasInputs
    >
      <BiometricsFields values={draft} onChange={edit} errors={errors.fields} inputs={{ birthYear, heightCm, weightKg }} />
      <TimezoneField value={draft.timezone} onChange={timezone => edit({ timezone })} error={errors.fields.timezone} />
      <Card tone="soft" style={styles.privacy}>
        <AppText weight="semibold" color="primary">
          {vi.privacyTitle}
        </AppText>
        <AppText variant="caption">{vi.privacyBody}</AppText>
      </Card>
      {errors.form ? <InlineError message={errors.form} /> : null}
      <Button label={common.next} onPress={next} style={styles.next} />
      {/* The only step with a way out of the account (wrong account, shared phone); the session makes it one flight. */}
      <View style={styles.signOut}>
        <TextLink label={authVi.signOut} onPress={() => signOut()} />
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 180, alignItems: 'center', justifyContent: 'center', marginTop: spacing.section - 8, marginBottom: 8 },
  actions: { gap: spacing.section, marginTop: spacing.section - 8 },
  paragraph: { marginTop: 12, gap: 2 },
  privacy: { gap: 4, marginTop: spacing.section - 8 },
  next: { marginTop: spacing.section - 8 },
  signOut: { alignItems: 'center', marginTop: 8 },
});
