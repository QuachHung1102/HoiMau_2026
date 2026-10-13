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

/** Pass `delta.events` of every confirmed write, as they are; only the server's events ever get here. */
export function pushCelebrations(events: readonly GameEvent[]) {
  const fresh = events.filter((event): event is Celebration => event.type === 'LEVEL_UP' || event.type === 'PET_STAGE_UP');
  if (fresh.length) set([...queue, ...fresh]);
}

/** The one on screen has been closed. */
export const dismissCelebration = () => set(queue.slice(1));
/** Another account, or a test: nothing of the previous one is shown. */
export const clearCelebrations = () => set([]);

/** Oldest first; the host shows the first one. */
export const useCelebrationQueue = (): readonly Celebration[] => useSyncExternalStore(subscribe, () => queue);
