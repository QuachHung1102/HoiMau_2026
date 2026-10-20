import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { healthVi } from '../../shared/i18n/vi/health';
import * as vi from '../../shared/i18n/vi/journal';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card, ListRow } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { Screen } from '../../shared/ui/Screen';
import { Reveal } from './Reveal';

/**
 * S33 and its variants. Always: "Đã lưu", the quote, "+N XP" only when XP was paid. By `ticket.outcome` (S77): GRANTED shows the
 * ticket card, AT_CAP says the week's ticket was not added, ALREADY_DECIDED says nothing about tickets. When the device's crisis
 * check matched (`crisis`, a navigation param: memory only) the support block stands beside all of that, never instead of it.
 */
export function JournalFeedbackScreen({ route, navigation }: ScreenProps<'JournalFeedback'>) {
  const palette = useTheme();
  const { result, crisis } = route.params;
  const { quote, xpAwarded, ticket } = result;
  const toToday = () => {
    // the Profile stack goes back to its root, so the tab does not keep this page (and the words of the quote) behind it
    navigation.popToTop();
    navigation.navigate('Today');
  };
  return (
    <Screen title={vi.feedbackTitle} subtitle={vi.feedbackSubtitle} onBack={navigation.canGoBack() ? navigation.goBack : undefined}>
      {/* motion: quote-reveal (tier 2, static: the whole quote is there at once) */}
      <Card tone="soft">
        <Icon name="Leaf" size={32} />
        <AppText variant="title">{`“${quote.text}”`}</AppText>
        {quote.author ? <AppText variant="caption">{quote.author}</AppText> : null}
        <AppText variant="secondary">{vi.thanks}</AppText>
      </Card>
      {/* motion: journal-saved (tier 1: the saved line appears at once, the page stays as it was) */}
      <Reveal>
        <View style={[styles.chips, styles.section]}>
          <View style={[styles.chip, { backgroundColor: palette.soft }]}>
            <Icon name="Check" size={16} />
            <AppText variant="caption" weight="semibold" color="primary">
              {vi.savedLine}
            </AppText>
          </View>
          {xpAwarded > 0 ? (
            <View style={[styles.chip, { backgroundColor: palette.soft }]}>
              <AppText variant="caption" weight="semibold" color="primary">
                {vi.xpChip(xpAwarded)}
              </AppText>
            </View>
          ) : null}
        </View>
      </Reveal>
      {ticket.outcome === 'GRANTED' ? (
        // motion: ticket-granted (tier 1: the card and its "+1 vé" label appear and stay)
        <Reveal delayMs={120}>
          <Card testID="ticket-card" style={[styles.ticket, styles.section, { borderColor: palette.primary }]}>
            <View style={styles.ticketHead}>
              <Icon name="Ticket" size={28} />
              <View style={styles.ticketText}>
                <AppText variant="title">{vi.ticketGranted}</AppText>
                <AppText variant="caption">{vi.ticketHave(ticket.available, ticket.cap)}</AppText>
              </View>
            </View>
            <ListRow title={vi.seeTicket} description={vi.seeTicketHint} onPress={() => navigation.navigate('Tickets')} />
          </Card>
        </Reveal>
      ) : ticket.outcome === 'AT_CAP' ? (
        <AppText style={styles.section}>{vi.ticketAtCap(ticket.cap)}</AppText>
      ) : null}
      {crisis ? (
        <Card tone="soft" style={styles.section}>
          <Icon name="HeartHandshake" size={32} />
          <AppText variant="title" accessibilityRole="header">
            {healthVi.support.title}
          </AppText>
          <AppText variant="secondary">{healthVi.support.body}</AppText>
          <Button label={healthVi.support.seeSources} onPress={() => navigation.navigate('Support')} />
        </Card>
      ) : null}
      <Button label={vi.toToday} onPress={toToday} style={styles.section} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  ticket: { borderWidth: 2, borderStyle: 'dashed' },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ticketText: { flex: 1, gap: 2 },
});
