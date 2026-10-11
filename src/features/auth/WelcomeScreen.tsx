import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import * as vi from '../../shared/i18n/vi/auth';
import { spacing } from '../../shared/theme/tokens';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Mam } from '../../shared/ui/mam/Mam';
import { Screen } from '../../shared/ui/Screen';

/** S01: what Hồi Máu is, and the two ways in. */
export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const focused = useIsFocused();
  return (
    <Screen title={vi.productName} subtitle={vi.tagline}>
      <Card tone="soft" style={styles.hero}>
        <Mam
          // motion: mam-idle (the only movement here; it stops while another screen covers this one)
          // motion: mam-wave (tier 2, static: the mascot is drawn already waving)
          // motion: welcome-sprout (tier 2, static: the mascot and its two leaves are simply there)
          stage="HATCHLING"
          mood="NEUTRAL"
          size={128}
          animation="idle"
          active={focused}
          decorative
        />
      </Card>
      <AppText variant="headline" style={styles.statement}>
        {vi.welcomeHeadline.join('\n')}
      </AppText>
      <AppText variant="secondary">{vi.welcomeBody}</AppText>
      <View style={styles.actions}>
        <Button label={vi.createAccount} onPress={() => navigation.navigate('SignUp')} />
        <Button variant="secondary" label={vi.haveAccount} onPress={() => navigation.navigate('SignIn')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 250, alignItems: 'center', justifyContent: 'center', marginTop: spacing.section, marginBottom: spacing.section - 8 },
  // Larger than the screen title: read off the S01 frame, there is no token for it.
  statement: { fontSize: 34, lineHeight: 44, marginBottom: 8 },
  actions: { gap: spacing.section, marginTop: spacing.section - 8 },
});
