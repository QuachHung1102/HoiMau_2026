// The measurement fields of S05 (and of the profile editor, Task 47), with the rules that read what was typed.
// Every limit and the age rule come from domain/validation.ts; nothing here judges a value beyond "inside the range".
import type { RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { isValidTimeZone } from '../../../domain/logicalDate.ts';
import type { ActivityLevel, Sex } from '../../../domain/types.ts';
import { LIMITS, validateBiometrics, type FieldError } from '../../../domain/validation.ts';
import * as common from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/onboarding';
import { InlineError } from '../../shared/ui/Notices';
import { SelectField } from '../../shared/ui/SelectField';
import { TextField, type TextFieldInput } from '../../shared/ui/TextField';
import { DEFAULT_TIMEZONE, defaultTimezone, deviceTimeZone, useTimezones } from './api';

/** The four values of this group; the numbers are kept as typed. */
export type BiometricsText = { birthYear: string; heightCm: string; weightKg: string; sex: Sex | null };
export type BiometricsField = keyof BiometricsText;
export type BiometricsErrors = Partial<Record<BiometricsField, string>>;

/** "165", "165,5" or "165.5" -> the number; anything else (two separators, a sign, a space, an exponent) -> null. */
export function parseDecimal(text: string): number | null {
  if (!/^[0-9]+(?:[.,][0-9]+)?$/.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Digits only. Whether the year is acceptable is the age rule's business. */
export function parseYear(text: string): number | null {
  return /^[0-9]+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
}

/** The copy for one field of the API contract and the rule it broke; undefined for a field these screens do not have. */
export function fieldMessage(field: string, rule: FieldError['rule']): string | undefined {
  const { heightCm, weightKg, age } = LIMITS;
  switch (field) {
    case 'birthYear':
      if (rule === 'required') return vi.birthYearRequired;
      return rule === 'format' ? vi.birthYearFormat : vi.ageRange(age.min, age.max);
    case 'heightCm':
      if (rule === 'required') return vi.heightRequired;
      return rule === 'format' ? vi.heightFormat(heightCm.min, heightCm.max) : vi.heightRange(heightCm.min, heightCm.max);
    case 'weightKg':
      if (rule === 'required') return vi.weightRequired;
      return rule === 'format' ? vi.weightFormat(weightKg.min, weightKg.max) : vi.weightRange(weightKg.min, weightKg.max);
    case 'sex':
      return vi.sexRequired;
    case 'timezone':
      return vi.timezoneInvalid;
    case 'activityLevel':
      return vi.activityRequired;
    case 'archetype':
      return vi.archetypeRequired;
    default:
      return undefined;
  }
}

export type BiometricsCheck =
  | { ok: true; biometrics: { heightCm: number; weightKg: number; birthYear: number; sex: Sex }; ageYears: number }
  | { ok: false; code: 'VALIDATION_FAILED'; fields: BiometricsErrors }
  | { ok: false; code: 'AGE_NOT_ALLOWED' };

/**
 * Reads the typed values and applies `validateBiometrics`: field errors first, the age rule only once every field
 * is valid (so someone under 16 with another invalid field sees the field errors first). Never throws: a zone the
 * domain cannot read is replaced for the age calculation (the zone field reports its own error).
 */
export function checkBiometrics(values: BiometricsText, at: { nowMs: number; timeZone: string; activityLevel?: ActivityLevel }): BiometricsCheck {
  const typed = { heightCm: values.heightCm, weightKg: values.weightKg, birthYear: values.birthYear };
  const parsed = {
    heightCm: parseDecimal(values.heightCm),
    weightKg: parseDecimal(values.weightKg),
    birthYear: parseYear(values.birthYear),
  };
  const result = validateBiometrics(
    {
      heightCm: parsed.heightCm ?? NaN,
      weightKg: parsed.weightKg ?? NaN,
      birthYear: parsed.birthYear ?? NaN,
      sex: values.sex as Sex,
      // The level is chosen on a later step and plays no part in the rules checked here.
      activityLevel: at.activityLevel ?? 'SEDENTARY',
    },
    at.nowMs,
    isValidTimeZone(at.timeZone) ? at.timeZone : DEFAULT_TIMEZONE,
  );
  if (result.ok) {
    const { heightCm, weightKg, birthYear } = parsed as { heightCm: number; weightKg: number; birthYear: number };
    return { ok: true, biometrics: { heightCm, weightKg, birthYear, sex: values.sex as Sex }, ageYears: result.ageYears };
  }
  if (result.code === 'AGE_NOT_ALLOWED') return { ok: false, code: 'AGE_NOT_ALLOWED' };
  const fields: BiometricsErrors = {};
  for (const { field, rule } of result.fields) {
    const name = field as BiometricsField;
    // Something was typed but it is not a number: say how to write it instead of "enter a value".
    const unreadable = name !== 'sex' && typed[name] !== '' && parsed[name] === null;
    fields[name] = fieldMessage(field, unreadable ? 'format' : rule);
  }
  return { ok: false, code: 'VALIDATION_FAILED', fields };
}

const SEX_OPTIONS = (['MALE', 'FEMALE'] as const).map(value => ({ value, label: vi.sexName[value] }));

type Props = {
  values: BiometricsText;
  onChange: (patch: Partial<BiometricsText>) => void;
  errors?: BiometricsErrors;
  /** The three inputs, for moving focus to the first invalid one (`focusFirstInvalid`). */
  inputs?: Partial<Record<'birthYear' | 'heightCm' | 'weightKg', RefObject<TextFieldInput | null>>>;
};

/** Birth year, height and weight (decimal pad; comma or dot), and the sex used by the formula. */
export function BiometricsFields({ values, onChange, errors = {}, inputs = {} }: Props) {
  return (
    <>
      <TextField
        ref={inputs.birthYear}
        label={vi.birthYearLabel}
        value={values.birthYear}
        onChangeText={birthYear => onChange({ birthYear })}
        error={errors.birthYear}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        autoComplete="birthdate-year"
        returnKeyType="next"
        onSubmitEditing={() => inputs.heightCm?.current?.focus()}
      />
      <View style={styles.pair}>
        <View style={styles.half}>
          <TextField
            ref={inputs.heightCm}
            label={vi.heightLabel}
            value={values.heightCm}
            onChangeText={heightCm => onChange({ heightCm })}
            error={errors.heightCm}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={6}
            returnKeyType="next"
            onSubmitEditing={() => inputs.weightKg?.current?.focus()}
          />
        </View>
        <View style={styles.half}>
          <TextField
            ref={inputs.weightKg}
            label={vi.weightLabel}
            value={values.weightKg}
            onChangeText={weightKg => onChange({ weightKg })}
            error={errors.weightKg}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={6}
            returnKeyType="done"
          />
        </View>
      </View>
      <SelectField
        label={vi.sexLabel}
        value={values.sex ?? undefined}
        options={SEX_OPTIONS}
        onChange={sex => onChange({ sex: sex as Sex })}
        error={errors.sex}
      />
    </>
  );
}

/** The message for a zone the server would refuse, or undefined. `zones` is the fetched list, when there is one. */
export function timezoneProblem(value: string, zones: readonly string[] | undefined): string | undefined {
  return isValidTimeZone(value) && (zones?.includes(value) ?? true) ? undefined : vi.timezoneInvalid;
}

type ZoneProps = {
  /** The chosen zone; null shows the default (the device's zone when the server has it, else Việt Nam). */
  value: string | null;
  onChange: (zone: string) => void;
  error?: string;
};

/** What the zone field shows and offers for a chosen value: the screen validates and sends `zone`. */
export function useTimezoneChoice(value: string | null) {
  const list = useTimezones();
  return { zone: value ?? defaultTimezone(list.data, deviceTimeZone()), zones: list.data, failed: list.isError, retry: list.refetch };
}

/**
 * Searchable zone picker; its options are exactly the server's list. While the list is on its way, or could not
 * be loaded, the field shows the default and stays usable; a failed load offers a retry.
 */
export function TimezoneField({ value, onChange, error }: ZoneProps) {
  const { zone, zones, failed, retry } = useTimezoneChoice(value);
  const options = (zones ?? [zone]).map(name => ({ value: name, label: name }));
  return (
    <>
      <SelectField label={vi.timezoneLabel} value={zone} options={options} onChange={onChange} error={error} searchable />
      {failed && !zones ? <InlineError message={vi.timezonesNotLoaded} action={{ label: common.retry, onPress: () => retry() }} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
