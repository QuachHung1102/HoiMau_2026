import { useMutation, useQuery } from '@tanstack/react-query';
import type { Me, OnboardingRequest, PrescriptionResponse, TimezoneList } from '../../../domain/contract/core.ts';
import { api } from '../../shared/api/client';

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** The zones the server accepts (`GET /meta/timezones`): the only source of the picker's options. */
export const timezonesKey = ['meta', 'timezones'] as const;
export function useTimezones() {
  return useQuery({
    queryKey: timezonesKey,
    queryFn: ({ signal }) => api.get<TimezoneList>('/meta/timezones', undefined, { signal }),
    select: list => list.zones,
    staleTime: Infinity, // the list does not change while the app runs
  });
}

/** The zone the phone is set to, as Intl names it; undefined when the engine cannot say. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The zone shown before the person picks one: the device's, but only when the server's list has it (Intl also
 * reads names such as "CET" or "+07:00" that the server refuses). Unknown list or unknown device zone: Việt Nam.
 */
export function defaultTimezone(zones: readonly string[] | undefined, device: string | undefined): string {
  return device !== undefined && zones?.includes(device) ? device : DEFAULT_TIMEZONE;
}

/**
 * The current targets (`GET /me/prescription`). The answer holds the person's own measurements: it lives in the
 * in-memory query cache only and is never passed to `writeCache`.
 */
export const prescriptionKey = ['prescription'] as const;
export function usePrescription() {
  return useQuery({
    queryKey: prescriptionKey,
    queryFn: ({ signal }) => api.get<PrescriptionResponse>('/me/prescription', undefined, { signal }),
  });
}

type Submit = { body: OnboardingRequest; idempotencyKey: string; signal: AbortSignal };

/**
 * `POST /onboarding`. The caller supplies the key (one per attempt, the same again on a retry); the variables hold
 * measurements, so nothing keeps them once the request has settled (`gcTime: 0`, and the screen calls `reset()`).
 */
export const useSubmitOnboarding = () =>
  useMutation({
    gcTime: 0,
    networkMode: 'always', // offline: fail fast with NETWORK instead of waiting with the button busy
    mutationFn: ({ body, idempotencyKey, signal }: Submit) => api.write<Me>('POST', '/onboarding', body, { idempotencyKey, signal }),
  });
