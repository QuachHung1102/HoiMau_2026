import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { Inventory, PurchaseResult, Shop } from '../../../domain/contract/content.ts';
import type { Pet, PerkCode, PerkUnlockRequest, Perks } from '../../../domain/contract/core.ts';
import { api, boundUserId } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { meKey, useMe } from '../auth/api';
import { answered, failure, mealPlanKey, useAttemptKey } from '../nutrition/api';
import { progressionKey } from '../progression/api';

export const petKey = ['pet'] as const;
export const shopKey = ['shop'] as const;
export const inventoryKey = ['inventory'] as const;
export const perksKey = ['perks'] as const;

function useRead<T>(queryKey: readonly unknown[], path: string) {
  const { status } = useSession();
  return useQuery({ queryKey, queryFn: status === 'signedIn' ? ({ signal }) => api.get<T>(path, undefined, { signal }) : skipToken });
}
/** `GET /pet`: stage, growth, mood, skin. */
export const usePet = () => useRead<Pet>(petKey, '/pet');
/** The pet of the server, or the profile's copy of it while that is not read (an offline start): both are the server's word. */
export function useKnownPet() {
  const query = usePet();
  const me = useMe().data;
  return { query, pet: query.data ?? me?.pet ?? undefined };
}
/** `GET /shop`: the purchasable and the default items, the balance and the level (every flag is the server's). */
export const useShop = () => useRead<Shop>(shopKey, '/shop');
/** `GET /inventory`: what is owned, the defaults and earned badges included. */
export const useInventory = () => useRead<Inventory>(inventoryKey, '/inventory');
/** `GET /perks`: the three perks and the points left. */
export const usePerks = () => useRead<Perks>(perksKey, '/perks');

export type WriteOutcome<R> = { state: 'done'; result: R } | { state: 'failed'; code: string; details?: Record<string, unknown> };

/**
 * One server write that needs the network (never queued). The three here share their rules:
 * - one request at a time: a second press while one is out answers undefined, as does a person who has signed out;
 * - one Idempotency-Key per distinct request: the SAME request again after a lost answer (NETWORK / TIMEOUT) repeats
 *   its key, so the server replays it and never applies it twice; any answer of the server, a refusal included, ends it;
 * - nothing is changed on screen until the server has answered: `accept` gets the confirmed answer.
 */
function useServerWrite<A extends unknown[], R>(tag: (...args: A) => string, call: (key: string, ...args: A) => Promise<R>, accept: (result: R) => void) {
  const { userId } = useSession();
  const key = useAttemptKey();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  // The latest closures, so that `run` itself stays one function for the life of the screen.
  const latest = useRef({ tag, call, accept });
  latest.current = { tag, call, accept };
  const run = useCallback(
    async (...args: A): Promise<WriteOutcome<R> | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      setBusy(true);
      try {
        const result = await latest.current.call(key.of(latest.current.tag(...args)), ...args);
        if (boundUserId() !== userId) return undefined;
        key.clear();
        latest.current.accept(result);
        return { state: 'done', result };
      } catch (error) {
        if (answered(error)) key.clear();
        return failure(error) as WriteOutcome<R>; // `failure` answers a failed outcome here
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [userId, key],
  );
  return [run, busy] as const;
}

/** `POST /shop/{itemCode}/purchase`. The balance on screen comes from the answer and from the reads it makes stale. */
export function usePurchase() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (code: string) => code,
    (key, code) => api.write<PurchaseResult>('POST', `/shop/${encodeURIComponent(code)}/purchase`, undefined, { idempotencyKey: key }),
    () => {
      // Coins, level, ownership and what is equipped are read again from the server, never worked out here.
      for (const queryKey of [shopKey, inventoryKey, meKey, progressionKey]) queryClient.invalidateQueries({ queryKey });
    },
  );
}

/** `POST /inventory/{itemCode}/equip`: the answer is the inventory; `me.appearance` (the palette, Mầm's skin) is read again. */
export function useEquip() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (code: string) => code,
    (key, code) => api.write<Inventory>('POST', `/inventory/${encodeURIComponent(code)}/equip`, undefined, { idempotencyKey: key }),
    inventory => {
      queryClient.setQueryData(inventoryKey, inventory);
      for (const queryKey of [shopKey, meKey, petKey]) queryClient.invalidateQueries({ queryKey });
    },
  );
}

/** `POST /perks/unlock`: the answer is the perks; the points of the profile, the shop, the inventory and the meal plan (MEAL_SWAP_PLUS changes its swaps) are read again. */
export function useUnlockPerk() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (perkCode: PerkCode, itemCode?: string) => `${perkCode}:${itemCode ?? ''}`,
    (key, perkCode: PerkCode, itemCode?: string) =>
      api.write<Perks>('POST', '/perks/unlock', { perkCode, ...(itemCode === undefined ? {} : { itemCode }) } satisfies PerkUnlockRequest, { idempotencyKey: key }),
    perks => {
      queryClient.setQueryData(perksKey, perks);
      for (const queryKey of [progressionKey, meKey, shopKey, inventoryKey, mealPlanKey]) queryClient.invalidateQueries({ queryKey });
    },
  );
}
