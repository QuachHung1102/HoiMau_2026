import type { Tickets } from '../../../domain/contract/social.ts';

export type Eligible = Tickets['eligible'][number];

/**
 * Why a ticket cannot be used for this date, as the server's refusal code, or null. In the order the server checks them
 * (a date that is not eligible is never in the list): already used, no ticket in hand, nothing to protect. The screens
 * only explain; the server decides.
 */
export function blockOf(entry: Eligible, available: number): 'TICKET_ALREADY_USED_FOR_DATE' | 'NO_TICKET' | 'TICKET_NOT_NEEDED' | null {
  if (entry.alreadyUsed) return 'TICKET_ALREADY_USED_FOR_DATE';
  if (available < 1) return 'NO_TICKET';
  if (!entry.needed) return 'TICKET_NOT_NEEDED';
  return null;
}
