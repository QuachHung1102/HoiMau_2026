import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import * as vi from '../../shared/i18n/vi/journal';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { FrostDot } from '../../shared/ui/Badges';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { SelectField } from '../../shared/ui/SelectField';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useTickets } from './api';
import { Reveal } from './Reveal';
import { blockOf, type Eligible } from './ticketRules';
import { dateText, hoursLeft } from './time';

/** One glyph per place for a ticket: filled when it is in hand, an outline when the place is free. The words say the same. */
function Glyphs({ available, cap }: { available: number; cap: number }) {
  const palette = useTheme();
  return (
    <View style={styles.glyphs}>
      {Array.from({ length: cap }, (_, place) => (
        <View key={place} testID={place < available ? 'ticket-held' : 'ticket-free'} style={[styles.glyph, place < available ? { backgroundColor: palette.primary } : [styles.outline, { borderColor: palette.primary }]]}>
          <Icon name="Ticket" size={22} color={place < available ? palette.white : palette.primary} />
        </View>
      ))}
    </View>
  );
}

/**
 * S34: the tickets in hand, what one does, and the date to use one for. The dates come from the server (`eligible`) and so do
 * the reasons a date cannot be used (already used, nothing to protect); no ticket says how a ticket is earned. Between 03:00 and
 * the close of the day, "Hôm qua" and "Hôm nay" can both be listed: when yesterday needs the ticket it is the one chosen at first
 * and one calm line says it closes first. After a use (`usedDate`, from S78) the day is shown kept, with the words.
 */
export function TicketsScreen({ route, navigation }: ScreenProps<'Tickets'>) {
  const focused = useIsFocused();
  const query = useTickets();
  const [chosen, setChosen] = useState<string | null>(null);
  const usedDate = route.params?.usedDate;
  const header = { title: vi.ticketsTitle, subtitle: vi.ticketsSubtitle, onBack: navigation.canGoBack() ? navigation.goBack : undefined };
  const tickets = query.data;
  if (!tickets) {
    return (
      <Screen {...header}>
        {query.isError && !query.isFetching ? (
          <ErrorState message={query.error instanceof ApiError && query.error.code !== 'INTERNAL' ? failureText(query.error.code) : vi.loadFailed} onRetry={() => query.refetch()} />
        ) : (
          <LoadingState active={focused} />
        )}
      </Screen>
    );
  }
  const { available, cap, eligible, serverTime } = tickets;
  const yesterday = eligible.find(entry => entry.target === 'YESTERDAY');
  const yesterdayFirst = yesterday !== undefined && available > 0 && yesterday.needed && !yesterday.alreadyUsed;
  const selected: Eligible | undefined = eligible.find(entry => entry.date === chosen) ?? (yesterdayFirst ? yesterday : eligible[0]);
  const block = selected ? blockOf(selected, available) : null;
  const label = (entry: Eligible) => {
    const text = entry.target === 'YESTERDAY' ? vi.yesterdayOption(hoursLeft(entry.deadline, serverTime)) : vi.todayWord;
    return entry.alreadyUsed ? vi.usedOption(text) : text;
  };
  return (
    <Screen {...header}>
      {usedDate ? (
        // motion: ticket-freeze (tier 1, through Reveal: fade and 8 dp rise once the server said the ticket was used; reduced motion: simply there)
        <Reveal>
          <Card tone="soft">
            <FrostDot />
            <AppText>{vi.usedBody(dateText(usedDate))}</AppText>
          </Card>
        </Reveal>
      ) : null}
      <Card tone="soft">
        <Icon name="Ticket" size={32} />
        <AppText variant="title">{vi.ticketsCardTitle}</AppText>
        <AppText variant="secondary">{vi.ticketsCardBody}</AppText>
      </Card>
      <View accessible accessibilityLabel={vi.ticketsHave(available, cap)} style={styles.have}>
        <Glyphs available={available} cap={cap} />
        <AppText weight="semibold" style={styles.haveText}>
          {vi.ticketsHave(available, cap)}
        </AppText>
      </View>
      {available === 0 ? (
        <Card>
          <AppText weight="semibold">{vi.earnTitle}</AppText>
          <AppText variant="secondary">{vi.earnBody}</AppText>
        </Card>
      ) : null}
      {yesterdayFirst && chosen === null ? <AppText variant="secondary">{vi.yesterdayFirst}</AppText> : null}
      <SelectField
        label={vi.dateField}
        value={selected?.date}
        options={eligible.map(entry => ({ value: entry.date, label: label(entry) }))}
        onChange={setChosen}
        placeholder={vi.datePlaceholder}
      />
      {block ? <DisabledReason reason={vi.reason[block]} /> : null}
      <Button label={vi.previewAction} disabled={!selected || block !== null} onPress={() => selected && navigation.navigate('TicketPreview', { date: selected.date })} />
      <AppText variant="secondary">{vi.ticketsFooter}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  glyphs: { flexDirection: 'row', gap: 8 },
  glyph: { width: 48, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 2 },
  have: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  haveText: { flex: 1 },
});
