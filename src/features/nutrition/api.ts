import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { MealPlanState, NutritionLogRequest, SwapCandidates, SwapRequest } from '../../../domain/contract/content.ts';
import type { Settings, SettingsPatch } from '../../../domain/contract/core.ts';
import { INGREDIENT_TAGS, STYLE_TAGS, type IngredientTag, type MealSlot } from '../../../domain/types.ts';
import { LIMITS } from '../../../domain/validation.ts';
import { api, ApiError, boundUserId, isValidationDetails } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import { newActionId } from '../../shared/api/uuid';
import * as vi from '../../shared/i18n/vi/nutrition';
import { failureText } from '../../shared/i18n/vi/sync';
import { acceptDay, settingsKey } from '../quests/api';
import { pushCelebrations } from '../progression/celebrations';
import { useQueuedWrite } from '../sync/useQueuedWrite';

/** Queueable. The body is `NutritionLogRequest`: a planned meal of a slot, or a manual amount. */
export const NUTRITION_LOG_PATH = '/nutrition/log';
const NUTRITION_QUEST = 'NUTRITION_TARGET';

// ---- the manual form: what was typed -> what is sent ----

export type KcalField = 'kcal' | 'label';
export type KcalForm = { ok: true; kcal: number; label?: string } | { ok: false; errors: Partial<Record<KcalField, string>> };

const length = (text: string) => [...text].length;

/**
 * Reads the two fields. The amount is digits only (no sign, no decimals, no separators), 1 to 5000 as the domain
 * says; the name is optional, trimmed, and at most 60 characters. Nothing is sent when anything is wrong.
 */
export function checkKcalForm(kcalText: string, labelText: string): KcalForm {
  const errors: Partial<Record<KcalField, string>> = {};
  const typed = kcalText.trim();
  const { min, max } = LIMITS.manualKcal;
  if (typed === '') errors.kcal = vi.kcalRequired;
  else if (!/^[0-9]+$/.test(typed)) errors.kcal = vi.kcalFormat;
  else if (Number(typed) < min || Number(typed) > max) errors.kcal = vi.kcalRange;
  // The form that is counted is the form that is sent: a label typed in decomposed form is sent composed.
  const label = labelText.trim().normalize('NFC');
  if (length(label) > LIMITS.mealLabel.max) errors.label = vi.labelTooLong;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, kcal: Number(typed), ...(label === '' ? {} : { label }) };
}

/** The field errors of a server `VALIDATION_FAILED` for this form; undefined when it names nothing this form has. */
export function serverKcalErrors(details: unknown): Partial<Record<KcalField, string>> | undefined {
  if (!isValidationDetails(details)) return undefined;
  const errors: Partial<Record<KcalField, string>> = {};
  for (const { field, rule } of details.fields) {
    if (field === 'kcal') errors.kcal ??= rule === 'required' ? vi.kcalRequired : rule === 'format' ? vi.kcalFormat : vi.kcalRange;
    else if (field === 'label') errors.label ??= vi.labelTooLong;
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

// ---- the record ----

export type LogKcalOutcome =
  /** The server has it: `total` is ITS day total, `xp` its grant, `questDone` whether it completed the nutrition quest. */
  | { state: 'confirmed'; total: number; xp: number; questDone: boolean }
  /** Kept on this device ("Đang chờ gửi"); no total, no reward. It reaches the screens through the refreshed day. */
  | { state: 'queued' }
  /** Not kept anywhere; show `failureText(code)` beside the control, with a new try. */
  | { state: 'failed'; code: string; details?: Record<string, unknown> };

/**
 * Records one nutrition log (`POST /nutrition/log`) through the offline queue, and nothing else: the screen decides
 * what to show. `record` answers undefined when a record is already on its way (a second press) or when the person
 * has signed out meanwhile. There is no undo for a logged meal (AR-12).
 * - confirmed: the server's day replaces the cached one (no local arithmetic) and `delta.events` go to the
 *   celebrations once; the rest of the answer is returned for the screen's message.
 * - queued / failed: nothing is changed here; the waiting amount is laid over the day by `applyPending`.
 */
function useRecordNutrition() {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const { send } = useQueuedWrite<ActionResult>();
  // The ref is what two presses inside one frame read; the state is what is drawn.
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  const record = useCallback(
    async (body: NutritionLogRequest): Promise<LogKcalOutcome | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      setSaving(true);
      try {
        const outcome = await send({ path: NUTRITION_LOG_PATH, body });
        if (outcome.state === 'queued') return { state: 'queued' };
        if (outcome.state === 'failed') return { state: 'failed', code: outcome.code, details: outcome.details };
        if (boundUserId() !== userId) return undefined;
        const { day, delta } = outcome.result;
        acceptDay(queryClient, userId, day);
        // The plan carries the day's total and which slots are logged: it is read again, whichever kind of record this was.
        queryClient.invalidateQueries({ queryKey: mealPlanKey });
        pushCelebrations(delta.events, outcome.id);
        return {
          state: 'confirmed',
          total: day.caloriesIn,
          xp: delta.xp,
          questDone: delta.events.some(event => event.type === 'QUEST_COMPLETED' && event.questCode === NUTRITION_QUEST),
        };
      } finally {
        sending.current = false;
        setSaving(false);
      }
    },
    [userId, queryClient, send],
  );
  return { record, saving };
}
/** A manual meal: `{ kcal, label? }`. */
export function useLogKcal() {
  const { record, saving } = useRecordNutrition();
  const log = useCallback((kcal: number, label?: string) => record({ kcal, ...(label ? { label } : {}) }), [record]);
  return { log, saving };
}

/**
 * The planned meal of a slot: `{ mealSlot }`. Confirmed: the plan on screen takes the server's total and marks the
 * slot logged at once, and is read again.
 */
export function useLogMeal() {
  const queryClient = useQueryClient();
  const { record, saving } = useRecordNutrition();
  const log = useCallback(
    async (mealSlot: MealSlot) => {
      const outcome = await record({ mealSlot });
      if (outcome?.state === 'confirmed') {
        queryClient.setQueryData<MealPlanState>(mealPlanKey, plan => plan && { ...plan, caloriesIn: outcome.total, slots: plan.slots.map(slot => (slot.mealSlot === mealSlot ? { ...slot, logged: true } : slot)) });
      }
      return outcome;
    },
    [record, queryClient],
  );
  return { log, saving };
}

// ---- the plan, the candidates, the swap, the exclusions ----

/** `GET /nutrition/plan`. The delivery of a queued log (`usePendingSync`) refreshes this key and everything under it. */
export const mealPlanKey = ['mealPlan'] as const;
export const swapCandidatesKey = (mealSlot: MealSlot) => [...mealPlanKey, 'candidates', mealSlot] as const;

// `409 DAY_CLOSED` on these reads means the logical date turned between the read and the save: one more read answers.
const retryDayClosed = (count: number, error: Error) => count < 1 && error instanceof ApiError && error.code === 'DAY_CLOSED';
const RETRY_DELAY_MS = 300;

/** Today's four slots (`GET /nutrition/plan`, generated by the server on the first read); idle while signed out. */
export function useMealPlan() {
  const { status } = useSession();
  return useQuery({
    queryKey: mealPlanKey,
    queryFn: status === 'signedIn' ? ({ signal }) => api.get<MealPlanState>('/nutrition/plan', undefined, { signal }) : skipToken,
    retry: retryDayClosed,
    retryDelay: RETRY_DELAY_MS,
  });
}

/**
 * Up to three ranked alternatives for a slot and the swaps left (`GET /nutrition/swap-candidates`). Kept only while a
 * screen shows it: a list from an earlier visit would offer meals that have been planned since.
 * No swap left and a logged slot look the same here (`swapsRemaining: 0`, no candidates); the plan's `logged` tells them apart.
 */
export function useSwapCandidates(mealSlot: MealSlot) {
  const { status } = useSession();
  return useQuery({
    queryKey: swapCandidatesKey(mealSlot),
    queryFn: status === 'signedIn' ? ({ signal }) => api.get<SwapCandidates>('/nutrition/swap-candidates', { mealSlot }, { signal }) : skipToken,
    gcTime: 0,
    retry: retryDayClosed,
    retryDelay: RETRY_DELAY_MS,
  });
}

/** One action id per distinct request: the same request again after a lost answer repeats the key, a new one gets a new key. */
function useAttemptKey() {
  const held = useRef<{ tag: string; id: string } | null>(null);
  return useMemo(
    () => ({
      of: (tag: string) => (held.current?.tag === tag ? held.current : (held.current = { tag, id: newActionId() })).id,
      clear: () => {
        held.current = null;
      },
    }),
    [],
  );
}
const answered = (error: unknown) => !(error instanceof ApiError && (error.code === 'NETWORK' || error.code === 'TIMEOUT'));
export type CallOutcome = { state: 'done' } | { state: 'failed'; code: string; details?: Record<string, unknown> };
const failure = (error: unknown): CallOutcome => (error instanceof ApiError ? { state: 'failed', code: error.code, details: error.details } : { state: 'failed', code: 'INTERNAL' });

/**
 * `POST /nutrition/swap` (needs the network, never queued). Nothing changes on screen until the server has answered:
 * the old meal stays while this waits, and after a refusal. `swap` answers undefined when one is already on its way
 * or the person has signed out meanwhile.
 */
export function useSwapMeal() {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const key = useAttemptKey();
  const sending = useRef(false);
  const [swapping, setSwapping] = useState(false);
  const swap = useCallback(
    async (mealSlot: MealSlot, mealId: string): Promise<CallOutcome | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      setSwapping(true);
      try {
        const plan = await api.write<MealPlanState>('POST', '/nutrition/swap', { mealSlot, mealId } satisfies SwapRequest, { idempotencyKey: key.of(`${mealSlot}:${mealId}`) });
        if (boundUserId() !== userId) return undefined;
        key.clear();
        queryClient.setQueryData(mealPlanKey, plan);
        // Marked old, not read now: the screen is about to leave, and the next visit reads the list anew.
        queryClient.invalidateQueries({ queryKey: swapCandidatesKey(mealSlot), refetchType: 'none' });
        return { state: 'done' };
      } catch (error) {
        if (answered(error)) key.clear();
        return failure(error);
      } finally {
        sending.current = false;
        setSwapping(false);
      }
    },
    [userId, queryClient, key],
  );
  return { swap, swapping };
}

/**
 * `PATCH /settings { excludedMealTags }` (needs the network). The answer is the settings, which replace the cached
 * ones; the candidates on screen are read again.
 */
export function useSaveExcludedTags() {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const key = useAttemptKey();
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  const save = useCallback(
    async (tags: readonly IngredientTag[]): Promise<CallOutcome | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      setSaving(true);
      try {
        const settings = await api.write<Settings>('PATCH', '/settings', { excludedMealTags: [...tags] } satisfies SettingsPatch, { idempotencyKey: key.of(tags.join(',')) });
        if (boundUserId() !== userId) return undefined;
        key.clear();
        queryClient.setQueryData(settingsKey, settings);
        queryClient.invalidateQueries({ queryKey: [...mealPlanKey, 'candidates'] });
        return { state: 'done' };
      } catch (error) {
        if (answered(error)) key.clear();
        return failure(error);
      } finally {
        sending.current = false;
        setSaving(false);
      }
    },
    [userId, queryClient, key],
  );
  return { save, saving };
}

/** The words of a meal's tags: its style first, then what it contains. A tag this app does not know is left out. */
export function tagWords(tags: readonly string[]): string[] {
  const style = STYLE_TAGS.filter(tag => tags.includes(tag)).map(tag => vi.styleWord[tag]);
  return [...style, ...INGREDIENT_TAGS.filter(tag => tags.includes(tag)).map(tag => vi.containsWord[tag])];
}

/** What a failed read of the plan or the candidates says: the day turning is not a record refused. */
export const loadText = (code: string) => (code === 'DAY_CLOSED' ? vi.dayTurned : failureText(code));
