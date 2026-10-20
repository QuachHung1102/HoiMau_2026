import { useIsFocused } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScreenProps } from '../../app/routes';
import { ApiError } from '../../shared/api/client';
import { retry } from '../../shared/i18n/vi/common';
import * as vi from '../../shared/i18n/vi/journal';
import { failureText } from '../../shared/i18n/vi/sync';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { AppText } from '../../shared/ui/AppText';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Icon } from '../../shared/ui/Icon';
import { DisabledReason, InlineError } from '../../shared/ui/Notices';
import { Screen } from '../../shared/ui/Screen';
import { ErrorState, LoadingState } from '../../shared/ui/States';
import { useTickets, useUseTicket } from './api';
import { blockOf } from './ticketRules';
import { dateText, hoursLeft } from './time';

/** The refusals of `POST /freeze-tickets/use` that mean "not this date, not now": explained in place, calmly. */
const REFUSALS = ['NO_TICKET', 'TICKET_DATE_NOT_ELIGIBLE', 'TICKET_ALREADY_USED_FOR_DATE', 'TICKET_NOT_NEEDED'];

/**
 * S78: what happens to the streak with and without a ticket for one date, from the server's own numbers. "Dùng vé cho ngày này"
 * sends one request and nothing on this screen changes until the server has answered; a confirmed use goes back to S34, which says
 * "Đã dùng vé". A refusal is explained here, in place, and the tickets are read again.
 */
export function TicketPreviewScreen({ route, navigation }: ScreenProps<'TicketPreview'>) {
  const palette = useTheme();
  const focused = useIsFocused();
  const { date } = route.params;
  const query = useTickets();
  const [spend, using] = useUseTicket();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; again?: () => void } | null>(null);
  const header = { onBack: navigation.canGoBack() ? navigation.goBack : undefined };
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
  const entry = tickets.eligible.find(item => item.date === date);
  const block = refusal ?? (entry ? blockOf(entry, tickets.available) : 'TICKET_DATE_NOT_ELIGIBLE');

  const submit = async () => {
    setProblem(null);
    const outcome = await spend(date);
    if (!outcome) return;
    if (outcome.state === 'done') {
      navigation.popTo('Tickets', { usedDate: date });
    } else if (REFUSALS.includes(outcome.code)) {
      setRefusal(outcome.code);
      query.refetch();
    } else {
      setProblem({ text: failureText(outcome.code), again: outcome.code === 'NETWORK' || outcome.code === 'TIMEOUT' ? submit : undefined });
    }
  };

  return (
    <Screen {...header} title={vi.previewTitle(entry?.target ?? 'TODAY')}>
      <View style={[styles.chip, { backgroundColor: palette.soft }]}>
        <Icon name="Calendar" size={16} />
        <AppText variant="caption" weight="semibold" color="primary">
          {vi.previewDate(dateText(date), entry ? hoursLeft(entry.deadline, tickets.serverTime) : null)}
        </AppText>
      </View>
      {entry ? (
        <Card>
          <View style={styles.line}>
            <Icon name="Ban" color={palette.muted} />
            <AppText color="muted">{vi.without(entry.withoutTicket)}</AppText>
          </View>
          <View style={styles.line}>
            <Icon name="Snowflake" color={palette.frost} />
            <AppText weight="bold">{vi.withTicket(entry.withTicket)}</AppText>
          </View>
        </Card>
      ) : null}
      <AppText variant="secondary">{vi.afterUse(Math.max(0, tickets.available - 1))}</AppText>
      {block ? (
        <Card tone="soft" accessibilityLiveRegion="polite">
          <DisabledReason reason={vi.reason[block]} />
        </Card>
      ) : null}
      {problem ? <InlineError message={problem.text} action={problem.again ? { label: retry, onPress: problem.again } : undefined} /> : null}
      <Button label={vi.useTicket} loading={using} disabled={block !== null} onPress={submit} />
      <Button variant="secondary" label={vi.later} onPress={navigation.goBack} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
