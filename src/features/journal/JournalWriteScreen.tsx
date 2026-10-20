import { useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/journal';
import { matchesCrisis } from '../../shared/i18n/vi/crisisMatch';
import { failureText } from '../../shared/i18n/vi/sync';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { TextField } from '../../shared/ui/TextField';
import { useSaveJournal } from './api';
import { SupportBlock } from './SupportBlock';

const journalImage: ImageSourcePropType = require('../../assets/journal/pXS2P.png');

/**
 * S32: one field, one save. The draft lives in this component's state and nowhere else (no storage, no log, no cache); a save
 * that fails leaves it exactly as it was. The save needs the network and goes out once per press. The crisis check runs on the
 * device over the text, once, when the save starts. If the save is confirmed its answer travels to S33 as a navigation param; if
 * the save fails it is kept in this component's state until the next save starts, and the support block stands under the error
 * (never instead of it; editing the text does not take it away). It is memory only: never part of a request, a log, a store or an analytics event.
 */
export function JournalWriteScreen({ navigation }: ScreenProps<'JournalWrite'>) {
  const [text, setText] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [save, saving] = useSaveJournal();
  const trimmed = text.trim();
  const count = [...trimmed].length;
  const over = count > vi.MAX_CHARS;
  const blocked = count === 0 ? vi.needText : null;

  const submit = async () => {
    if (blocked || over) return;
    setFailed(null);
    setCrisis(false);
    const crisisMatch = matchesCrisis(trimmed);
    const outcome = await save(trimmed);
    if (!outcome) return;
    if (outcome.state === 'failed') {
      setFailed(outcome.code);
      setCrisis(crisisMatch);
      return;
    }
    // replace: Back from S33 does not return to a form that still holds the words that were just saved
    navigation.replace('JournalFeedback', { result: outcome.result, crisis: crisisMatch });
  };

  return (
    <Screen title={vi.writeTitle} subtitle={vi.writeSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined} hasInputs>
      <Image source={journalImage} accessible={false} style={styles.image} />
      <TextField
        label={vi.fieldLabel}
        value={text}
        onChangeText={next => {
          setText(next);
          setFailed(null);
        }}
        placeholder={vi.fieldPlaceholder}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        error={over ? vi.tooLong : undefined}
      />
      <AppText variant="caption" style={styles.counter}>
        {vi.counter(count)}
      </AppText>
      <View style={styles.private}>
        <Icon name="Lock" />
        <View style={styles.privateText}>
          <AppText weight="semibold">{vi.privateTitle}</AppText>
          <AppText variant="caption">{vi.privateBody}</AppText>
        </View>
      </View>
      {failed ? <InlineError message={vi.saveFailed(failureText(failed))} action={{ label: retry, onPress: submit }} /> : null}
      {crisis ? <SupportBlock onSeeSources={() => navigation.navigate('Support')} /> : null}
      <Button label={vi.save} loading={saving} disabled={blocked !== null || over} onPress={submit} />
      {blocked ? <DisabledReason reason={blocked} /> : null}
      <Button variant="secondary" label={vi.pastPages} onPress={() => navigation.navigate('JournalList')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%', aspectRatio: 692 / 320, borderRadius: 20 },
  counter: { alignSelf: 'flex-end' },
  private: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  privateText: { flex: 1, gap: 2 },
});
