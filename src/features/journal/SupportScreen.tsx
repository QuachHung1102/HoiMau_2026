import { useState } from 'react';
import { Linking } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { CRISIS_LINES, healthVi } from '../../shared/i18n/vi/health';
import * as vi from '../../shared/i18n/vi/journal';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { ListRow } from '../../shared/ui/Card';
import { InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';

/**
 * S56: the two public numbers of Vietnam, each a row that opens the phone's dialer (`tel:`), the approved words, and the way
 * back. No other number, no diagnosis, no claim that anything is watching. Nothing here is told whether the crisis check matched.
 */
export function SupportScreen({ navigation }: ScreenProps<'Support'>) {
  const [failed, setFailed] = useState(false);
  const call = (number: string) => {
    setFailed(false);
    Linking.openURL(`tel:${number}`).catch(() => setFailed(true));
  };
  const { support } = healthVi;
  return (
    <Screen title={support.sourcesTitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      <AppText variant="secondary">{support.sourcesIntro}</AppText>
      {CRISIS_LINES.map(line => (
        <ListRow key={line.number} icon="Phone" title={vi.sourcesCall(line.number, line.label)} onPress={() => call(line.number)} />
      ))}
      {failed ? <InlineError message={vi.callFailed} /> : null}
      <AppText>{support.urgent}</AppText>
      <Button variant="secondary" label={support.backToJournal} onPress={navigation.goBack} />
      <AppText variant="secondary">{support.footer}</AppText>
    </Screen>
  );
}
