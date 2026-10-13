import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { calculatePrescription } from '../../../domain/energy.ts';
import { isValidTimeZone } from '../../../domain/logicalDate.ts';
import { ageFrom } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError, isValidationDetails } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as common from '../../shared/i18n/vi/common';
import { healthVi } from '../../shared/i18n/vi/health';
import * as vi from '../../shared/i18n/vi/onboarding';
import { writeCache } from '../../shared/storage/cache';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { meKey } from '../auth/api';
import { failure, useSingleFlight, type FormErrors } from '../auth/form';
import { DEFAULT_TIMEZONE, usePrescription, useSubmitOnboarding } from './api';
import { fieldMessage } from './BiometricsFields';
import { ONBOARDING_FIELDS, requestOf, STEP_OF, useOnboarding, type OnboardingField } from './OnboardingProvider';
import { StepScreen } from './StepScreen';
import { TargetsView } from './TargetsView';

const isField = (name: string): name is OnboardingField => ONBOARDING_FIELDS.some(field => field === name);

/** S08 / S62 at the end of onboarding: the estimates for what was entered, then "Hoàn tất" sends it once. */
export function OnbTargetsScreen({ navigation }: ScreenProps<'OnbTargets'>) {
  const { draft, edit, fail, setBlock, attemptKey, reset } = useOnboarding();
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const send = useSubmitOnboarding();
  const run = useSingleFlight();
  const [formError, setFormError] = useState<string>();

  const request = useMemo(() => requestOf(draft), [draft]);
  // The preview is the domain's own calculation; the server computes the same and is the one that counts.
  const preview = useMemo(() => {
    if (!request) return null;
    const zone = isValidTimeZone(request.timezone) ? request.timezone : DEFAULT_TIMEZONE;
    return calculatePrescription({ ...request, ageYears: ageFrom(request.birthYear, Date.now(), zone) });
  }, [request]);

  // The measurements are forgotten when this screen goes away after a finished onboarding (the root gate has then
  // moved on to the main app); clearing them earlier would blank the numbers while they are still on screen.
  const finished = useRef(false);
  useEffect(
    () => () => {
      if (finished.current) reset();
    },
    [reset],
  );

  // A refusal goes back to the step that owns it, with its message.
  const refused = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'AGE_NOT_ALLOWED') {
        setBlock('age');
        return navigation.navigate('OnbProfile', undefined, { pop: true });
      }
      if (error.code === 'ARCHETYPE_NOT_ALLOWED') {
        edit({ archetype: null });
        setBlock('archetype');
        return navigation.navigate('OnbArchetype', undefined, { pop: true });
      }
      if (error.code === 'VALIDATION_FAILED' && isValidationDetails(error.details)) {
        const errors: FormErrors<OnboardingField> = { fields: {} };
        for (const { field, rule } of error.details.fields) {
          if (isField(field)) errors.fields[field] ??= fieldMessage(field, rule);
          // a field these screens do not have must not vanish silently
          else errors.form = common.unknownError;
        }
        const first = ONBOARDING_FIELDS.find(field => errors.fields[field]);
        if (first) {
          fail(errors);
          return navigation.navigate(STEP_OF[first], undefined, { pop: true });
        }
      }
    }
    setFormError(failure(error, { known: [] }).form);
  };

  const submit = async () => {
    if (!request) return;
    setFormError(undefined);
    try {
      await run(async signal => {
        // reset(): the variables hold the measurements, so they go as soon as the request has settled
        const me = await send.mutateAsync({ body: request, idempotencyKey: attemptKey(), signal }).finally(() => send.reset());
        // The screen has gone (signed out meanwhile): this answer belongs to nobody on screen and must not reach
        // the cache, where it would let the next person past onboarding.
        if (signal.aborted) return;
        finished.current = true;
        // `Me` holds no measurement; the disk copy must agree with the gate, or an offline start would ask again.
        if (userId) writeCache(userId, 'me', me);
        // The root gate reads this and switches to the main app by itself.
        queryClient.setQueryData(meKey, me);
      });
    } catch (error) {
      refused(error);
    }
  };

  if (!request || !preview) return <Screen />;
  return (
    <StepScreen title={vi.targetsTitle} subtitle={vi.targetsSubtitle} onBack={navigation.goBack}>
      <TargetsView archetype={request.archetype} prescription={preview}>
        <AppText variant="caption">{healthVi.disclaimer}</AppText>
        {formError ? <InlineError message={formError} action={{ label: common.retry, onPress: submit }} /> : null}
        <View style={styles.actions}>
          <Button label={vi.finish} loading={send.isPending} onPress={submit} />
          <Button variant="secondary" label={vi.editProfile} onPress={() => navigation.navigate('OnbProfile', undefined, { pop: true })} />
        </View>
      </TargetsView>
    </StepScreen>
  );
}

/** The current targets, opened later from the plan: the server's numbers, the same explanations, nothing to submit. */
export function TargetsScreen({ navigation }: ScreenProps<'Targets'>) {
  const focused = useIsFocused();
  const { data, error, isError, refetch } = usePrescription();
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <Screen title={vi.targetsDetailTitle} subtitle={vi.targetsSubtitle} onBack={navigation.goBack}>
      {data ? (
        // a failed refresh keeps what is already on screen
        <TargetsView archetype={data.archetype} prescription={data}>
          <Button variant="secondary" label={vi.editProfile} onPress={() => navigation.navigate('EditProfile')} style={styles.edit} />
        </TargetsView>
      ) : (
        <View style={styles.state}>
          {isError ? (
            <ErrorState
              message={code === 'NETWORK' || code === 'TIMEOUT' ? common.errorText[code] : common.unknownError}
              onRetry={() => refetch()}
            />
          ) : (
            <LoadingState blocks={2} active={focused} />
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.section, marginTop: 8 },
  edit: { marginTop: 8 },
  state: { marginTop: spacing.section - 8 },
});
