import { useState } from 'react';
import { isDisplayName, LIMITS, stripUnseen } from '../../../domain/validation.ts';
import type { ScreenProps } from '../../app/routes';
import { isValidationDetails } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/guild';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField } from '../../shared/ui/TextField';
import { useCreateGuild, useReadGuildAgain } from './api';

type Errors = { name?: string; motto?: string; form?: string; offline?: boolean };

const length = (text: string) => [...text].length;

/** The rules of the server's route, on the text as it will be sent (NFC, trimmed). */
function problems(name: string, motto: string): Errors {
  const errors: Errors = {};
  if (length(name) < LIMITS.guildName.min || length(name) > LIMITS.guildName.max) errors.name = vi.nameLength;
  else if (!isDisplayName(name)) errors.name = vi.nameFormat;
  if (stripUnseen(motto) !== motto) errors.motto = vi.mottoFormat;
  else if (length(motto) > LIMITS.guildMotto.max) errors.motto = vi.mottoTooLong;
  return errors;
}

/** What the server refused, said at the field it is about (or above the button). */
function refusal(code: string, details?: Record<string, unknown>): Errors {
  switch (code) {
    case 'GUILD_NAME_TAKEN':
      return { name: vi.nameTaken };
    case 'NAME_NOT_ALLOWED':
      return { form: vi.nameNotAllowed };
    case 'ALREADY_IN_GUILD':
      return { form: vi.alreadyInGuild };
    case 'VALIDATION_FAILED': {
      const errors: Errors = {};
      if (isValidationDetails(details)) {
        for (const { field, rule } of details.fields) {
          if (field === 'name') errors.name ??= rule === 'format' ? vi.nameFormat : vi.nameLength;
          if (field === 'motto') errors.motto ??= rule === 'max' ? vi.mottoTooLong : vi.mottoFormat;
        }
      }
      return errors.name || errors.motto ? errors : { form: failureText(code) };
    }
    default:
      return { form: failureText(code), offline: code === 'NETWORK' || code === 'TIMEOUT' };
  }
}

/** S42: a name (3 to 30) and an optional motto (80 at most); the server judges the uniqueness and the words. */
export function GuildCreateScreen({ navigation }: ScreenProps<'GuildCreate'>) {
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [create, creating] = useCreateGuild();
  const readAgain = useReadGuildAgain();
  const submit = async () => {
    const sent = { name: name.normalize('NFC').trim(), motto: motto.normalize('NFC').trim() };
    const wrong = problems(sent.name, sent.motto);
    setErrors(wrong);
    if (wrong.name || wrong.motto) return;
    const outcome = await create(sent.name, sent.motto);
    if (!outcome) return;
    if (outcome.state === 'done') {
      navigation.navigate('Guild');
      return;
    }
    setErrors(refusal(outcome.code, outcome.details));
    if (outcome.code === 'ALREADY_IN_GUILD') readAgain();
  };
  return (
    <Screen title={vi.createTitle} subtitle={vi.createSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <TextField
        label={vi.nameLabel}
        value={name}
        onChangeText={text => {
          setName(text);
          setErrors(before => ({ ...before, name: undefined }));
        }}
        error={errors.name}
        helper={vi.nameHelper}
        autoCorrect={false}
        returnKeyType="next"
      />
      <TextField
        label={vi.mottoLabel}
        value={motto}
        onChangeText={text => {
          setMotto(text);
          setErrors(before => ({ ...before, motto: undefined }));
        }}
        error={errors.motto}
        helper={vi.mottoHelper}
        returnKeyType="done"
      />
      <AppText variant="secondary">{vi.createNote}</AppText>
      {errors.form ? <InlineError message={errors.form} action={errors.offline ? { label: retry, onPress: submit } : undefined} /> : null}
      <Button label={vi.createAction} loading={creating} onPress={submit} />
      <Button variant="secondary" label={vi.haveCode} onPress={() => navigation.navigate('GuildJoin')} />
    </Screen>
  );
}
