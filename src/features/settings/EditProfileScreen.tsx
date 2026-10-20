import { useIsFocused } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ACTIVITY_FACTOR } from '../../../domain/energy.ts';
import type { ActivityLevel, Archetype } from '../../../domain/types.ts';
import { allowedArchetypes, LIMITS } from '../../../domain/validation.ts';
import type { BiometricsRequest, MePatch, PrescriptionResponse } from '../../../domain/contract/core.ts';
import type { ScreenProps } from '../../app/routes';
import { ApiError, isValidationDetails } from '../../shared/api/client';
import * as authVi from '../../shared/i18n/vi/auth';
import * as common from '../../shared/i18n/vi/common';
import * as onbVi from '../../shared/i18n/vi/onboarding';
import * as vi from '../../shared/i18n/vi/settings';
import { failureText } from '../../shared/i18n/vi/sync';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { InlineError, DisabledReason } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { SelectField } from '../../shared/ui/SelectField';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { useMe } from '../auth/api';
import { displayNameProblem, focusFirstInvalid, noErrors, type FormErrors } from '../auth/form';
import { prescriptionKey, usePrescription } from '../onboarding/api';
import { BiometricsFields, checkBiometrics, fieldMessage, parseDecimal, parseYear, TimezoneField, timezoneProblem, useTimezoneChoice, type BiometricsText } from '../onboarding/BiometricsFields';
import { SafetySheet } from '../onboarding/SafetySheet';
import { TargetsView } from '../onboarding/TargetsView';
import { useQueryClient } from '@tanstack/react-query';
import { ArchetypeChange } from './ArchetypeChange';
import { useAddBiometrics, usePatchMe } from './api';

const FIELDS = ['displayName', 'birthYear', 'heightCm', 'weightKg', 'sex', 'activityLevel', 'timezone'] as const;
type Field = (typeof FIELDS)[number];
type Draft = BiometricsText & { displayName: string; activityLevel: ActivityLevel; timezone: string };
const LEVELS = Object.keys(ACTIVITY_FACTOR) as ActivityLevel[];
const LEVEL_OPTIONS = LEVELS.map(value => ({ value, label: onbVi.activityLevels[value].label }));

type Loaded = { user: NonNullable<ReturnType<typeof useMe>['data']>['user']; prescription: PrescriptionResponse };

const draftOf = ({ user, prescription }: Loaded): Draft => {
  const { birthYear, heightCm, weightKg, sex, activityLevel } = prescription.biometrics;
  return { displayName: user.displayName, birthYear: String(birthYear), heightCm: String(heightCm), weightKg: String(weightKg), sex, activityLevel, timezone: user.timezone };
};

/** The words of a server refusal of `PATCH /me`: the name and the zone are the only members. */
function meFailure(code: string, details: unknown): FormErrors<Field> {
  if (code === 'NAME_NOT_ALLOWED') return { fields: { displayName: authVi.nameNotAllowed } };
  if (code === 'VALIDATION_FAILED' && isValidationDetails(details)) {
    const fields: FormErrors<Field>['fields'] = {};
    for (const { field, rule } of details.fields) {
      if (field === 'displayName') fields.displayName ??= rule === 'required' ? authVi.displayNameRequired : authVi.displayNameInvalid(LIMITS.displayName.max);
      else if (field === 'timezone') fields.timezone ??= onbVi.timezoneInvalid;
      else return { fields: {}, form: vi.profileNotSaved(common.unknownError) };
    }
    if (Object.keys(fields).length > 0) return { fields };
  }
  return { fields: {}, form: vi.profileNotSaved(failureText(code)) };
}

/** The words of a server refusal of `POST /me/biometrics`; the direction is dealt with by the caller (`ARCHETYPE_NOT_ALLOWED`). */
function biometricsFailure(code: string, details: unknown): FormErrors<Field> {
  if (code === 'AGE_NOT_ALLOWED') return { fields: { birthYear: fieldMessage('birthYear', 'min') } };
  if (code === 'VALIDATION_FAILED' && isValidationDetails(details)) {
    const fields: FormErrors<Field>['fields'] = {};
    for (const { field, rule } of details.fields) {
      const message = (FIELDS as readonly string[]).includes(field) ? fieldMessage(field, rule as 'required') : undefined;
      if (message) fields[field as Field] ??= message;
      else return { fields: {}, form: vi.profileNotSaved(common.unknownError) };
    }
    if (Object.keys(fields).length > 0) return { fields };
  }
  return { fields: {}, form: vi.profileNotSaved(failureText(code)) };
}

/**
 * S37: the name, the measurements, the level of activity, the zone and the direction. "Lưu hồ sơ" sends only what changed: `PATCH /me`
 * for the name or the zone, `POST /me/biometrics` for a measurement or the activity level (one more entry in the history, new targets),
 * then shows the targets the server worked out. The measurements are in this screen's state and in the query cache, never on disk.
 */
function ProfileForm({ loaded, goBack }: { loaded: Loaded; goBack?: () => void }) {
  const { user, prescription } = loaded;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(loaded));
  const [errors, setErrors] = useState<FormErrors<Field>>(noErrors);
  const [saved, setSaved] = useState(false);
  const [unsafe, setUnsafe] = useState<readonly Archetype[] | null>(null);
  const [patchMe, patching] = usePatchMe();
  const [addBiometrics, adding] = useAddBiometrics();
  const { zones } = useTimezoneChoice(draft.timezone);
  const name = useRef<TextFieldInput>(null);
  const birthYear = useRef<TextFieldInput>(null);
  const heightCm = useRef<TextFieldInput>(null);
  const weightKg = useRef<TextFieldInput>(null);

  const edit = (patch: Partial<Draft>) => {
    setDraft(current => ({ ...current, ...patch }));
    // a real edit takes back what was said about the fields it changes, and the "saved" screen
    setErrors(current => ({ fields: Object.fromEntries(Object.entries(current.fields).filter(([field]) => !(field in patch))) }));
    setSaved(false);
  };

  // What differs from what the server holds now: after a write has been accepted the cache moves, and so does this.
  const known = prescription.biometrics;
  const nameChanged = draft.displayName.trim() !== user.displayName;
  const zoneChanged = draft.timezone !== user.timezone;
  const measuresChanged =
    parseYear(draft.birthYear) !== known.birthYear ||
    parseDecimal(draft.heightCm) !== known.heightCm ||
    parseDecimal(draft.weightKg) !== known.weightKg ||
    draft.sex !== known.sex ||
    draft.activityLevel !== known.activityLevel;
  const changed = nameChanged || zoneChanged || measuresChanged;

  const save = async (replacement?: Archetype) => {
    // the rules the server applies, so that nothing is sent that it would refuse (S60); the first problem gets focus
    const checked = checkBiometrics(draft, { nowMs: Date.now(), timeZone: draft.timezone, activityLevel: draft.activityLevel });
    const problems: FormErrors<Field>['fields'] = {
      displayName: displayNameProblem(draft.displayName),
      timezone: timezoneProblem(draft.timezone, zones),
      ...(!checked.ok && checked.code === 'VALIDATION_FAILED' ? checked.fields : null),
      ...(!checked.ok && checked.code === 'AGE_NOT_ALLOWED' ? { birthYear: fieldMessage('birthYear', 'min') } : null),
    };
    if (FIELDS.some(field => problems[field])) {
      setErrors({ fields: problems });
      focusFirstInvalid(FIELDS, problems, { displayName: name, birthYear, heightCm, weightKg });
      return;
    }
    setErrors(noErrors);
    if (nameChanged || zoneChanged) {
      const change: MePatch = { ...(nameChanged ? { displayName: draft.displayName.trim() } : null), ...(zoneChanged ? { timezone: draft.timezone } : null) };
      const outcome = await patchMe(change);
      if (!outcome) return;
      if (outcome.state === 'failed') return setErrors(meFailure(outcome.code, outcome.details));
    }
    if (measuresChanged && checked.ok) {
      const request: BiometricsRequest = { ...checked.biometrics, activityLevel: draft.activityLevel, ...(replacement ? { archetype: replacement } : null) };
      const outcome = await addBiometrics(request);
      if (!outcome) return;
      if (outcome.state === 'failed') {
        // The numbers rule the direction in effect out: the sheet offers the ones that are allowed, and the choice goes along with the numbers.
        if (outcome.code === 'ARCHETYPE_NOT_ALLOWED') {
          const allowed = (outcome.details as { allowed?: Archetype[] } | undefined)?.allowed;
          return setUnsafe(allowed ?? allowedArchetypes(checked.biometrics.heightCm, checked.biometrics.weightKg));
        }
        return setErrors(biometricsFailure(outcome.code, outcome.details));
      }
    }
    setSaved(true);
  };

  const header = { onBack: goBack };
  if (saved) {
    // the targets of the server: the answer of the last write, or the ones read when this screen opened
    const targets = queryClient.getQueryData<PrescriptionResponse>(prescriptionKey) ?? prescription;
    return (
      <Screen title={vi.profileSavedTitle} subtitle={vi.profileSavedSubtitle} {...header}>
        <TargetsView archetype={targets.archetype} prescription={targets}>
          <Button label={vi.done} onPress={goBack} />
        </TargetsView>
      </Screen>
    );
  }
  return (
    <Screen title={vi.profileTitle} subtitle={vi.profileSubtitle} hasInputs {...header}>
      <TextField
        ref={name}
        label={authVi.displayNameLabel}
        value={draft.displayName}
        onChangeText={displayName => edit({ displayName })}
        error={errors.fields.displayName}
        autoComplete="name"
        returnKeyType="next"
        onSubmitEditing={() => birthYear.current?.focus()}
      />
      <BiometricsFields values={draft} onChange={edit} errors={errors.fields} inputs={{ birthYear, heightCm, weightKg }} />
      <SelectField label={vi.activityLabel} value={draft.activityLevel} options={LEVEL_OPTIONS} onChange={level => edit({ activityLevel: level as ActivityLevel })} error={errors.fields.activityLevel} />
      <TimezoneField value={draft.timezone} onChange={timezone => edit({ timezone })} error={errors.fields.timezone} />
      <ArchetypeChange user={user} biometrics={known} />
      <AppText variant="secondary">{vi.profileNote}</AppText>
      {errors.form ? <InlineError message={errors.form} action={{ label: common.retry, onPress: () => save() }} /> : null}
      <View style={styles.actions}>
        <Button label={vi.saveProfile} loading={patching || adding} disabled={!changed} onPress={() => save()} />
        {changed ? null : <DisabledReason reason={vi.nothingToSave} />}
      </View>
      {unsafe ? (
        <SafetySheet
          allowed={unsafe}
          onChoose={archetype => {
            setUnsafe(null);
            save(archetype);
          }}
          onReviewProfile={() => setUnsafe(null)}
          onDismiss={() => setUnsafe(null)}
        />
      ) : null}
    </Screen>
  );
}

/** S37: loads the profile and the latest measurements, then hands them to the form (which keeps what is typed). */
export function EditProfileScreen({ navigation }: ScreenProps<'EditProfile'>) {
  const focused = useIsFocused();
  const me = useMe();
  const prescription = usePrescription();
  const goBack = navigation.canGoBack() ? navigation.goBack : undefined;
  if (me.data && prescription.data) return <ProfileForm loaded={{ user: me.data.user, prescription: prescription.data }} goBack={goBack} />;
  const failed = (me.isError && !me.data) || (prescription.isError && !prescription.data);
  const error = prescription.error ?? me.error;
  return (
    <Screen title={vi.profileTitle} subtitle={vi.profileSubtitle} onBack={goBack}>
      <View style={styles.state}>
        {failed ? (
          <ErrorState
            message={error instanceof ApiError ? failureText(error.code) : vi.profileLoadFailed}
            onRetry={() => {
              if (!me.data) me.refetch();
              if (!prescription.data) prescription.refetch();
            }}
          />
        ) : (
          <LoadingState active={focused} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 12, marginTop: 8 },
  state: { marginTop: spacing.section - 8 },
});
