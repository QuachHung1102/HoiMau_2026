import { useState } from 'react';
import type { ScreenProps } from '../../app/routes';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/guild';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField } from '../../shared/ui/TextField';
import { useJoinGuild, useReadGuildAgain } from './api';

/** The code as the person types it: capitals, no spaces. */
const typed = (text: string) => text.replace(/\s/g, '').toUpperCase();

/** The words of the refusals said above the button; INVITE_CODE_INVALID is said at the field instead. */
function refusalText(code: string) {
  switch (code) {
    case 'GUILD_FULL':
      return vi.guildFull;
    case 'ALREADY_IN_GUILD':
      return vi.alreadyInGuild;
    default:
      return failureText(code);
  }
}

/** S26: one field, the invite code. The server decides whether it is right, whether there is room and whether the person is free to join. */
export function GuildJoinScreen({ navigation }: ScreenProps<'GuildJoin'>) {
  const [code, setCode] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [join, joining] = useJoinGuild();
  const readAgain = useReadGuildAgain();
  const submit = async () => {
    setRefused(null);
    // A code of another length cannot be a guild's: no request for it.
    if ([...code].length !== vi.codeLength) {
      setRefused('INVITE_CODE_INVALID');
      return;
    }
    const outcome = await join(code);
    if (!outcome) return;
    if (outcome.state === 'done') {
      navigation.navigate('Guild');
      return;
    }
    setRefused(outcome.code);
    // The person is in a guild already: the tab must show it.
    if (outcome.code === 'ALREADY_IN_GUILD') readAgain();
  };
  const offline = refused === 'NETWORK' || refused === 'TIMEOUT';
  const onField = refused === 'INVITE_CODE_INVALID';
  return (
    <Screen title={vi.joinTitle} subtitle={vi.joinSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <TextField
        label={vi.codeLabel}
        value={code}
        onChangeText={text => {
          setCode(typed(text).slice(0, vi.codeLength));
          setRefused(null);
        }}
        error={onField ? vi.inviteCodeInvalid : undefined}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        maxLength={vi.codeLength}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Card tone="soft">
        <Icon name="Users" />
        <AppText variant="secondary">{vi.joinCardLine}</AppText>
      </Card>
      {refused && !onField ? <InlineError message={refusalText(refused)} action={offline ? { label: retry, onPress: submit } : undefined} /> : null}
      <Button label={vi.joinAction} loading={joining} onPress={submit} />
      <AppText variant="secondary">{vi.joinFooter}</AppText>
    </Screen>
  );
}
