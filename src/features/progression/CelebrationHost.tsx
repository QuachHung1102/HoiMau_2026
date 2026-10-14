import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TitleKey } from '../../../domain/contract/common.ts';
import type { Me } from '../../../domain/contract/core.ts';
import { titleKeyForLevel } from '../../../domain/progression.ts';
import type { PetStage } from '../../../domain/types.ts';
import type { RootParamList } from '../../app/routes';
import { boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/progression';
import { levelTitleText } from '../../shared/i18n/vi/today';
import { loadCelebratedLevel, saveCelebratedLevel } from '../../shared/storage/celebrated';
import { OverlayCelebration } from '../../shared/ui/OverlayCelebration';
import { meKey } from '../auth/api';
import { useDay } from '../quests/api';
import { useFocusHeld } from '../quests/useStandUp';
import { markInboxRead } from './api';
import { clearCelebrations, dismissCelebration, pushCelebrations, useCelebrationQueue } from './celebrations';

/** What is on screen: a level reached (S65) or a streak milestone (S66). `id` is what the overlay is keyed on. */
export type Shown =
  | { id: string; kind: 'LEVEL_UP'; level: number; titleKey: TitleKey; points: number }
  | { id: string; kind: 'STREAK_MILESTONE'; days: number; coins: number; badgeCode: string };

type Props = { shown: Shown; stage: PetStage; skin?: 'fox'; onClose: () => void; onSee: () => void };

/** S65 / S66 as the host shows them: the copy and the two buttons. `onSee` and `onClose` both leave it to the caller to close. */
export function CelebrationOverlay({ shown, stage, skin, onClose, onSee }: Props) {
  const primary = { onPress: onSee };
  const secondary = { onPress: onClose };
  // `key`: the overlay plays once per mounted instance, so another celebration is another instance.
  return shown.kind === 'LEVEL_UP' ? (
    // motion: level-up (the overlay's own tracks)
    <OverlayCelebration
      key={shown.id}
      kind="LEVEL_UP"
      level={shown.level}
      stage={stage}
      skin={skin}
      title={vi.levelUpTitle(shown.level)}
      subtitle={levelTitleText[shown.titleKey]}
      body={vi.levelUpBody(shown.points)}
      primary={{ ...primary, label: vi.seePerks }}
      secondary={{ ...secondary, label: vi.later }}
      onClose={onClose}
    />
  ) : (
    // motion: streak-milestone (the overlay's own tracks)
    <OverlayCelebration
      key={shown.id}
      kind="STREAK_MILESTONE"
      days={shown.days}
      skin={skin}
      title={vi.milestoneTitle(shown.days)}
      body={vi.milestoneBody(shown.badgeCode, shown.coins, shown.days)}
      primary={{ ...primary, label: vi.seeBadge }}
      secondary={{ ...secondary, label: vi.keepGoing }}
      onClose={onClose}
    />
  );
}

/**
 * The profile the screens have read, without asking for it: the host watches the cache and is no observer of the query, so
 * mounting it costs no request (and cannot bring back an older answer); it follows every read the screens make.
 */
function useKnownMe(): Me | undefined {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (notify: () => void) =>
      queryClient.getQueryCache().subscribe(event => {
        // not 'added' / 'observerAdded': a query is built while another component renders, and nothing changed yet
        if ((event.type === 'updated' || event.type === 'removed') && event.query.queryKey[0] === meKey[0]) notify();
      }),
    [queryClient],
  );
  return useSyncExternalStore(subscribe, () => queryClient.getQueryData<Me>(meKey));
}

/**
 * Shows one celebration at a time, from what the SERVER said and only that: a `LEVEL_UP` of a confirmed write (the
 * queue of `celebrations.ts`), a level the profile (`['me']`) has reached that was never celebrated (a record the offline
 * queue delivered later hands back no answer, nor does another device), and an unread `STREAK_MILESTONE` of the day.
 * - A level is celebrated once: the highest one celebrated is kept per user on this device and seeded, without a
 *   celebration, from the first profile read after sign-in, so a fresh install never replays old levels. A pushed event
 *   and a derived one for the same level are one celebration.
 * - A milestone is shown once per item id and `POST /inbox/read` goes out when it is shown. If that fails the item stays
 *   unread on the server and is shown again the next time the app starts: acceptable, nothing is lost.
 * - Nothing is laid over the focus flow (`useFocusHeld`); what is queued is shown after it closes.
 * - `PET_STAGE_UP` stays in the queue for the pet screens (Task 38).
 * Mount it once, inside the navigation container (`AppNavigation` children).
 */
export function CelebrationHost() {
  const { status, userId } = useSession();
  const onboarded = useKnownMe()?.user.onboarded === true;
  // Keyed by user: another account starts from nothing.
  return status === 'signedIn' && userId && onboarded ? <ActiveHost key={userId} userId={userId} /> : null;
}

function ActiveHost({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const navigation = useNavigation<NavigationProp<RootParamList>>();
  const me = useKnownMe();
  const day = useDay().data;
  const queue = useCelebrationQueue();
  const held = useFocusHeld();
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  // The highest level celebrated (null: not seeded yet) and the milestone items shown in this run.
  const celebrated = useRef<number | null>(null);
  const items = useRef(new Set<string>());
  const level = me?.progression?.level;

  useEffect(() => {
    let alive = true;
    loadCelebratedLevel(userId).then(stored => {
      if (!alive || boundUserId() !== userId) return;
      celebrated.current = stored ?? null;
      setReady(true);
    });
    return () => {
      alive = false;
      // Another account, or none: nothing of this one may be shown to the next.
      clearCelebrations();
    };
  }, [userId]);

  // The profile is the server's word on the level: seed it, or queue the levels reached that were never celebrated.
  useEffect(() => {
    if (!ready || level === undefined) return;
    const known = celebrated.current;
    if (known === null) {
      celebrated.current = level;
      if (boundUserId() === userId) saveCelebratedLevel(userId, level);
      return;
    }
    // Levels reached together are ONE celebration, as the server's own event for a jump is: the highest level, the points
    // of all of them. What a queued event already covers is not asked for again, so whichever arrives first, one overlay.
    const covered = queue.reduce((highest, event) => (event.type === 'LEVEL_UP' ? Math.max(highest, event.level) : highest), known);
    if (level > covered) pushCelebrations([{ type: 'LEVEL_UP', level, titleKey: titleKeyForLevel(level), perkPointsGained: level - covered }]);
  }, [ready, level, queue, userId]);

  // What is next, when nothing is on screen and nothing holds it.
  useEffect(() => {
    const known = celebrated.current;
    if (!ready || held || shown || known === null) return;
    const levels = queue.flatMap(event => (event.type === 'LEVEL_UP' ? [event] : []));
    // Already celebrated (a replayed answer, or the other way in): dropped without a word.
    const stale = levels.filter(event => event.level <= known);
    if (stale.length > 0) {
      stale.forEach(event => dismissCelebration(event));
      return;
    }
    const next = levels.reduce<(typeof levels)[number] | undefined>((lowest, event) => (lowest && lowest.level <= event.level ? lowest : event), undefined);
    if (next) {
      celebrated.current = next.level;
      if (boundUserId() === userId) saveCelebratedLevel(userId, next.level);
      dismissCelebration(next);
      setShown({ id: `level-up:${next.level}`, kind: 'LEVEL_UP', level: next.level, titleKey: next.titleKey, points: next.perkPointsGained });
      return;
    }
    const milestone = day?.celebrations.find(item => item.kind === 'STREAK_MILESTONE' && item.readAt === null && !items.current.has(item.id));
    if (milestone) {
      items.current.add(milestone.id);
      setShown({ id: milestone.id, kind: 'STREAK_MILESTONE', days: milestone.payload.days, coins: milestone.payload.coins, badgeCode: milestone.payload.badgeCode });
      // Online only (not a queueable path). A refusal or no network leaves it unread: it comes back at the next start.
      markInboxRead(queryClient, userId, [milestone.id]).catch(() => undefined);
    }
  }, [ready, held, shown, queue, day, userId, queryClient]);

  if (!shown || held) return null;
  const close = () => setShown(null);
  return (
    <CelebrationOverlay
      shown={shown}
      stage={me?.pet?.stage ?? 'EGG'}
      skin={me?.pet?.skinCode === 'SKIN_FOX' ? 'fox' : undefined}
      onClose={close}
      onSee={() => {
        close();
        navigation.navigate(shown.kind === 'LEVEL_UP' ? 'Levels' : 'Inventory');
      }}
    />
  );
}
