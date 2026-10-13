import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { PendingBanner } from '../../../src/features/sync/PendingBanner';
import { RejectedNotice } from '../../../src/features/sync/RejectedNotice';
import { api } from '../../../src/shared/api/client';
import { useSession } from '../../../src/shared/api/session';
import { queued } from '../../../src/shared/i18n/vi/common';
import { tabLabel } from '../../../src/shared/i18n/vi/nav';
import { recordLabel } from '../../../src/shared/i18n/vi/sync';
import { usePendingActions, useWaitingCount } from '../../../src/shared/storage/pendingActions';
import { OfflineBadge } from '../../../src/shared/ui/Badges';
import { ListRow } from '../../../src/shared/ui/Card';
import { Screen } from '../../../src/shared/ui/Screen';
import { withApp, type Entries } from '../harness';

const USER = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';
const me = {
  user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: 'TANKER', archetypeChangeAvailableAt: null, onboarded: true },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
};
// Signed in with a profile in the cache and no fetch stub: every request fails as it does without a network.
const signedIn = { session: { userId: USER }, queries: [[['me'], me]] as [readonly unknown[], unknown][] };

const action = (id: string, path: string, body: Record<string, unknown>) => ({
  id,
  userId: USER,
  method: 'POST',
  path,
  body,
  createdAt: new Date().toISOString(),
  attempts: 0,
  status: 'queued',
});

/** Puts what an earlier run of the app would have left on disk, then mounts the app. */
function Seeded({ storage, children }: { storage: Record<string, unknown>; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const entries = Object.fromEntries(Object.entries(storage).map(([key, value]) => [key, JSON.stringify(value)]));
    AsyncStorage.setMany(entries).then(() => setReady(true));
  }, [storage]);
  return ready ? <>{children}</> : null;
}

/** One request, as a screen would make on opening: without a network it is what tells the app it is offline. */
function Ping() {
  useEffect(() => {
    api.get('/day').catch(() => undefined);
  }, []);
  return null;
}

/** How a screen reads the queue (Task 25 does this on Hôm nay): the badge and one row per waiting record. */
function WaitingRecords() {
  const { userId } = useSession();
  const pending = usePendingActions(userId);
  const waiting = useWaitingCount(userId);
  return (
    <Screen title={tabLabel.Today}>
      <OfflineBadge count={waiting} />
      {pending.map(item => (
        <ListRow key={item.id} icon="Clock" title={recordLabel(item.path) ?? item.path} description={queued} />
      ))}
    </Screen>
  );
}

/** The app as App.tsx lays it out: the S38 row above the screens, the notice over them. */
const frame = (storage: Record<string, unknown>, extra?: ReactNode) =>
  withApp(
    <Seeded storage={storage}>
      <View style={styles.fill}>
        <PendingBanner />
        <WaitingRecords />
      </View>
      <RejectedNotice />
      {extra}
    </Seeded>,
    signedIn,
  );

export const entries: Entries = {
  's38-offline-banner': () => frame({}, <Ping />),
  's38-pending-actions': () =>
    frame({
      [`pending:v1:${USER}`]: [
        action('8a3f6c1e-2b47-4d19-9c05-71e2a4b6d801', '/day/quests/WATER/progress', { amount: 1 }),
        action('8a3f6c1e-2b47-4d19-9c05-71e2a4b6d802', '/nutrition/log', { mealSlot: 'LUNCH' }),
      ],
    }),
  's38-rejected-day-closed': () =>
    frame({
      [`rejected:v1:${USER}`]: [{ id: '8a3f6c1e-2b47-4d19-9c05-71e2a4b6d803', path: '/nutrition/log', code: 'DAY_CLOSED', at: new Date().toISOString() }],
    }),
};

const styles = StyleSheet.create({ fill: { flex: 1 } });
