import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import type { WorkoutCatalog, WorkoutCompleteRequest, WorkoutDetail, WorkoutResult } from '../../../domain/contract/content.ts';
import type { SpaceRequirement } from '../../../domain/types.ts';
import { api, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { pushCelebrations } from '../progression/celebrations';
import { acceptDay } from '../quests/api';
import { useQueuedWrite } from '../sync/useQueuedWrite';

/** The story quest a session counts toward. */
export const WORKOUT_QUEST = 'WORKOUT_MAIN';
/** Queueable. The body is `WorkoutCompleteRequest`; the `Idempotency-Key` becomes the session id on the server. */
export const WORKOUT_COMPLETE_PATH = '/workout/complete';

export const DURATIONS = [5, 15, 30, 45] as const;
export const SPACES: readonly SpaceRequirement[] = ['DESK_SIDE', 'ROOM', 'GYM', 'OUTDOOR'];
/** The equipment codes of the content. No workout needs a mat today; it is still something a person can have. */
export const EQUIPMENT = ['tham', 'ta-tay', 'day-khang-luc'] as const;

/**
 * What the person has. `space: null` = no space filter. `equipment` is the set of things they own, in the order of
 * `EQUIPMENT`: `[]` is
 * "Không cần" (only workouts that need nothing), and all of `EQUIPMENT` filters nothing out.
 */
export type CatalogFilters = { duration: (typeof DURATIONS)[number]; space: SpaceRequirement | null; equipment: readonly string[] };

export const catalogKey = (filters: CatalogFilters) => ['workout', 'catalog', filters.duration, filters.space, filters.equipment.join(',')] as const;
export const workoutKey = (id: string) => ['workout', 'item', id] as const;

/**
 * `GET /workout/catalog`: the server filters and orders (recommended first); nothing is filtered on this device.
 * `equipment` is always sent, as the comma-separated list the contract names: an empty value is the empty set
 * (the person owns nothing), which is not the same as leaving the parameter out (no equipment filter at all).
 */
export function useWorkoutCatalog(filters: CatalogFilters) {
  return useQuery({
    queryKey: catalogKey(filters),
    queryFn: ({ signal }) => api.get<WorkoutCatalog>('/workout/catalog', { duration: filters.duration, space: filters.space ?? undefined, equipment: filters.equipment.join(',') }, { signal }),
  });
}

/** `GET /workout/items/{id}`: the workout with its steps and moves. */
export function useWorkout(id: string) {
  return useQuery({ queryKey: workoutKey(id), queryFn: ({ signal }) => api.get<WorkoutDetail>(`/workout/items/${encodeURIComponent(id)}`, undefined, { signal }) });
}

/** One session: `id` is made once, when the session starts, and stays the same for every try to record it. */
export type Session = { id: string; exerciseItemId: string; elapsedSec: number };
export type CompleteOutcome =
  /** The server has it: everything shown as a result (XP, coins, completed) comes from `result`. */
  | { state: 'confirmed'; result: WorkoutResult }
  /** Kept on this device; no reward. It reaches the screens through the refreshed day. */
  | { state: 'queued' }
  /** Not kept anywhere; show `failureText(code)` with a new try of the SAME session. */
  | { state: 'failed'; code: string };

/**
 * Records a session (`POST /workout/complete`) through the offline queue. `complete` answers undefined when a try is
 * already out (a second press) or when the person has signed out meanwhile.
 * - confirmed: the server's day replaces the cached one and `delta.events` go to the celebrations, once.
 * - queued / failed: nothing is changed here.
 */
export function useCompleteWorkout() {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const { send } = useQueuedWrite<WorkoutResult>();
  // What two presses inside one frame read.
  const sending = useRef(false);
  const complete = useCallback(
    async ({ id, exerciseItemId, elapsedSec }: Session): Promise<CompleteOutcome | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      try {
        const outcome = await send({ id, path: WORKOUT_COMPLETE_PATH, body: { exerciseItemId, elapsedSec } satisfies WorkoutCompleteRequest });
        if (outcome.state === 'queued') return { state: 'queued' };
        if (outcome.state === 'failed') return { state: 'failed', code: outcome.code };
        if (boundUserId() !== userId) return undefined;
        acceptDay(queryClient, userId, outcome.result.day);
        pushCelebrations(outcome.result.delta.events);
        return { state: 'confirmed', result: outcome.result };
      } finally {
        sending.current = false;
      }
    },
    [userId, queryClient, send],
  );
  return { complete };
}
