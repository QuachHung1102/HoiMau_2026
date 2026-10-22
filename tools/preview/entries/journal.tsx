import { useEffect } from 'react';
import type { JournalCreateResult, JournalEntry, JournalList, Tickets } from '../../../domain/contract/social.ts';
import * as vi from '../../../src/shared/i18n/vi/journal';
import { journalKey, ticketsKey } from '../../../src/features/journal/api';
import { beginDrive, type Entries } from '../harness';
import { byText } from './guild';
import { app, meOf, respond } from './today';

// The journal and the tickets of frames S32, S33, S77, S56, S49, S50, S34 and S78, with illustrative values (never logic).
const quote = { code: 'Q010', text: 'Bước nhỏ vẫn là bước tiến.', author: null };
const result = (outcome: JournalCreateResult['ticket']['outcome'], more: Partial<JournalCreateResult> = {}): JournalCreateResult => ({
  entry: { id: '00000000-0000-4000-8000-000000000a01', createdAt: new Date().toISOString() },
  quote,
  xpAwarded: 15,
  ticket: { outcome, available: 2, cap: 2 },
  delta: { xp: 15, coin: 0, events: [] },
  ...more,
});
const feedback = (outcome: JournalCreateResult['ticket']['outcome'], crisis = false) => app({ route: 'JournalFeedback', params: { result: result(outcome), crisis } });

const NOW = Date.now();
const DAY = 24 * 3_600_000;
const entryRow = (n: number, preview: string, at: number) => ({ id: `00000000-0000-4000-8000-0000000000b${n}`, createdAt: new Date(at).toISOString(), preview, quoteCode: 'Q010' });
const list = (entries: JournalList['entries']): [readonly unknown[], unknown] => [[...journalKey, 'list'], { pages: [{ entries, nextBefore: null } satisfies JournalList], pageParams: [undefined] }];
const BODY = 'Mình rời bàn làm việc sớm hơn một chút và đi bộ quanh nhà. Không làm được hết mọi thứ đã định, nhưng khoảng nghỉ đó giúp mình thấy dễ chịu hơn.';
const page = (): JournalEntry => ({ id: '00000000-0000-4000-8000-0000000000b1', createdAt: new Date(NOW).toISOString(), body: BODY, quote });

/** A server day: 10:00 on 25/9 (Asia/Ho_Chi_Minh); yesterday (24/9, a Thursday) closed with a break of 12 days, five hours to use a ticket for it. */
const tickets = (more: Partial<Tickets> = {}): Tickets => ({
  serverTime: '2026-09-25T03:00:00.000Z',
  available: 1,
  cap: 2,
  eligible: [
    { date: '2026-09-25', target: 'TODAY', deadline: '2026-09-26T08:00:00.000Z', needed: false, withoutTicket: 0, withTicket: 0, alreadyUsed: false },
    { date: '2026-09-24', target: 'YESTERDAY', deadline: '2026-09-25T08:00:00.000Z', needed: true, withoutTicket: 0, withTicket: 12, alreadyUsed: false },
  ],
  progression: meOf().progression as NonNullable<ReturnType<typeof meOf>['progression']>,
  ...more,
});
const seenTickets = (data: Tickets): [readonly unknown[], unknown] => [ticketsKey, data];

const WORDS = 'Hôm nay mình đã chậm lại một chút.\nKhông làm được hết mọi thứ, nhưng mình thấy dễ chịu hơn.';
const HEAVY_WORDS = 'Mình mệt lắm rồi.\nMình không thiết sống nữa, mọi thứ nặng nề quá.';
/** shot.mjs cannot type or press: this writes into the field, then presses save once the button is enabled. */
function TypeAndSave({ text, scrollDown = false }: { text: string; scrollDown?: boolean }) {
  useEffect(() => {
    const done = beginDrive();
    let save: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea');
      if (!area) return;
      clearInterval(timer);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, text);
      area.dispatchEvent(new Event('input', { bubbles: true }));
      save = setTimeout(() => {
        const button = byText('button', vi.save)();
        // not found: the drive stays open and the sweep reports the entry
        if (!button) return;
        button.click();
        done();
      }, 150);
    }, 50);
    return () => {
      clearInterval(timer);
      clearTimeout(save);
      done();
    };
  }, [text]);
  // the support block stands below the fold of a 844 px screen: keep every scroller at its end so the shot shows it whole
  useEffect(() => {
    if (!scrollDown) return undefined;
    const timer = setInterval(() => document.querySelectorAll<HTMLElement>('*').forEach(node => node.scrollHeight > node.clientHeight + 40 && getComputedStyle(node).overflowY !== 'visible' && (node.scrollTop = node.scrollHeight)), 100);
    return () => clearInterval(timer);
  }, [scrollDown]);
  return null;
}

export const entries: Entries = {
  's32-journal-write': () => app({ route: 'JournalWrite' }),
  // The save cannot reach the server: the words stay in the field, with the reason and "Thử lại".
  's32-journal-write-error': () =>
    app({
      route: 'JournalWrite',
      fetchStub: () => {
        throw new TypeError('Network request failed');
      },
      extra: <TypeAndSave text={WORDS} />,
    }),
  // The same, with words the device's check takes as a call for support: the block stands under the error, never instead of it.
  's32-journal-write-error-support': () =>
    app({
      route: 'JournalWrite',
      fetchStub: () => {
        throw new TypeError('Network request failed');
      },
      extra: <TypeAndSave text={HEAVY_WORDS} scrollDown />,
    }),

  's33-journal-feedback': () => feedback('ALREADY_DECIDED'),
  's77-journal-ticket-granted': () => feedback('GRANTED'),
  's77-journal-ticket-at-cap': () => feedback('AT_CAP'),
  's33-journal-feedback-support': () => feedback('ALREADY_DECIDED', true),
  's56-support': () => app({ route: 'Support' }),

  's49-journal-list': () =>
    app({
      route: 'JournalList',
      queries: [list([entryRow(1, 'Hôm nay mình đã chậm lại', NOW - 3_600_000), entryRow(2, 'Một ngày không như dự định', NOW - DAY), entryRow(3, 'Niềm vui nhỏ cuối tuần', NOW - 3 * DAY)])],
    }),
  's50-journal-entry': () => app({ route: 'JournalEntry', params: { id: page().id }, queries: [[[...journalKey, 'entry', page().id], page()]] }),

  's34-tickets': () => app({ route: 'Tickets', queries: [seenTickets(tickets())] }),
  's34-tickets-none': () => app({ route: 'Tickets', queries: [seenTickets(tickets({ available: 0 }))] }),
  's78-ticket-preview': () => app({ route: 'TicketPreview', params: { date: '2026-09-24' }, queries: [seenTickets(tickets())], fetchStub: () => respond(404) }),
};
