import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { ActionResult } from '../../../domain/contract/common.ts';
import type { NutritionLogRequest } from '../../../domain/contract/content.ts';
import { LIMITS } from '../../../domain/validation.ts';
import { boundUserId, isValidationDetails } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/nutrition';
import { acceptDay } from '../quests/api';
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
 * Records a manual meal (`POST /nutrition/log` with `{ kcal, label? }`) through the offline queue, and nothing else:
 * the screen decides what to show. `log` answers undefined when a record is already on its way (a second press) or
 * when the person has signed out meanwhile. There is no undo for a logged meal (AR-12).
 * - confirmed: the server's day replaces the cached one (no local arithmetic) and `delta.events` go to the
 *   celebrations once; the rest of the answer is returned for the screen's message.
 * - queued / failed: nothing is changed here; the waiting amount is laid over the day by `applyPending`.
 */
export function useLogKcal() {
  const { userId } = useSession();
  const queryClient = useQueryClient();
  const { send } = useQueuedWrite<ActionResult>();
  // The ref is what two presses inside one frame read; the state is what is drawn.
  const sending = useRef(false);
  const [saving, setSaving] = useState(false);
  const log = useCallback(
    async (kcal: number, label?: string): Promise<LogKcalOutcome | undefined> => {
      if (sending.current || !userId) return undefined;
      sending.current = true;
      setSaving(true);
      const body = { kcal, ...(label ? { label } : {}) } satisfies NutritionLogRequest;
      try {
        const outcome = await send({ path: NUTRITION_LOG_PATH, body });
        if (outcome.state === 'queued') return { state: 'queued' };
        if (outcome.state === 'failed') return { state: 'failed', code: outcome.code, details: outcome.details };
        if (boundUserId() !== userId) return undefined;
        const { day, delta } = outcome.result;
        acceptDay(queryClient, userId, day);
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
  return { log, saving };
}
