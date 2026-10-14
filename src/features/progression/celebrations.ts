import { useSyncExternalStore } from 'react';
import type { GameEvent } from '../../../domain/contract/common.ts';

/** The events of a server answer that get a full-screen celebration: level up (S65) and Mầm's evolution (S69). */
export type Celebration = Extract<GameEvent, { type: 'LEVEL_UP' | 'PET_STAGE_UP' }>;

// A small store outside React: any screen that gets a `Delta` pushes its events, one host (Task 28) shows them.
let queue: readonly Celebration[] = [];
const listeners = new Set<() => void>();
function set(next: readonly Celebration[]) {
  queue = next;
  listeners.forEach(notify => notify());
}
const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

// The action ids already pushed, so that a replayed answer (the app retried after a lost answer) carries the same events
// and is taken once. Bounded: an id is only ever repeated by a retry of the same action, minutes later at most.
const SEEN_LIMIT = 200;
let seen: string[] = [];

/**
 * Pass `delta.events` of every confirmed write, as they are; only the server's events ever get here. `actionId` is the
 * id the app sent with that write (`ActionResult.actionId`; a workout result carries none, so the caller's own id): the
 * same action pushed again adds nothing.
 */
export function pushCelebrations(events: readonly GameEvent[], actionId?: string) {
  const fresh = events.filter((event): event is Celebration => event.type === 'LEVEL_UP' || event.type === 'PET_STAGE_UP');
  if (!fresh.length) return;
  if (actionId !== undefined) {
    if (seen.includes(actionId)) return;
    seen = [...seen, actionId].slice(-SEEN_LIMIT);
  }
  set([...queue, ...fresh]);
}

/** This one has been shown, or dropped (the first when none is named): the host takes its own, a later task takes PET_STAGE_UP. */
export const dismissCelebration = (celebration?: Celebration) => set(celebration ? queue.filter(item => item !== celebration) : queue.slice(1));
/** Another account, or a test: nothing of the previous one is shown, and no action id is remembered. */
export const clearCelebrations = () => {
  seen = [];
  set([]);
};

/** Oldest first; the host (CelebrationHost) takes the LEVEL_UPs, the pet screen task takes PET_STAGE_UP. */
export const useCelebrationQueue = (): readonly Celebration[] => useSyncExternalStore(subscribe, () => queue);
