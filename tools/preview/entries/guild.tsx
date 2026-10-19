import { useEffect } from 'react';
import type { GuildMember, GuildState } from '../../../domain/contract/social.ts';
import { guildKey } from '../../../src/features/guild/api';
import * as vi from '../../../src/shared/i18n/vi/guild';
import type { Entries } from '../harness';
import { app } from './today';

// Illustrative values, as in frames S27 and S76: a guild of four, the week at 79 %. The server's `GuildState` is what the
// screens read; nothing here holds a measurement of anyone (the type has none).
const member = (userId: string, displayName: string, level: number, more: Partial<GuildMember> = {}): GuildMember => ({
  userId,
  displayName,
  level,
  role: 'MEMBER',
  isMe: false,
  daysCompletedThisWeek: 4,
  daysCountedThisWeek: 7,
  storyDoneToday: false,
  nudge: { allowed: true, reason: null },
  ...more,
});
const ME = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';

const guildOf = (more: { myRole?: 'LEADER' | 'MEMBER'; inactiveDays?: number; members?: GuildMember[] } = {}): GuildState => {
  const { myRole = 'MEMBER', inactiveDays = 0, members } = more;
  return {
    guild: {
      id: '00000000-0000-4000-9000-900000000001',
      name: 'Nhịp sống mới',
      motto: '',
      inviteCode: 'NHJPM2K9',
      myRole,
      weekCompletion: 0.79,
      inactive: inactiveDays >= 14,
      inactiveDays,
      members: members ?? [
        member(ME, 'An', 5, { isMe: true, role: myRole, daysCompletedThisWeek: 6, nudge: { allowed: false, reason: null } }),
        member('00000000-0000-4000-9000-000000000001', 'Linh', 7, { role: myRole === 'LEADER' ? 'MEMBER' : 'LEADER', daysCompletedThisWeek: 7, storyDoneToday: true, nudge: { allowed: false, reason: 'NUDGE_NOT_NEEDED' } }),
        member('00000000-0000-4000-9000-000000000002', 'Minh', 3),
        member('00000000-0000-4000-9000-000000000003', 'Hà', 6, { daysCompletedThisWeek: 5, nudge: { allowed: false, reason: 'NUDGE_RECEIVER_MUTED' } }),
      ],
    },
  };
};
const seen = (state: GuildState): [readonly unknown[], unknown][] => [[guildKey, state]];

/** shot.mjs cannot press anything: this presses the first control `find` returns once it is on the page. */
function PressWhen({ find }: { find: () => HTMLElement | null }) {
  useEffect(() => {
    const timer = setInterval(() => {
      const control = find();
      if (!control) return;
      clearInterval(timer);
      control.click();
    }, 50);
    return () => clearInterval(timer);
  }, [find]);
  return null;
}
const byText = (role: string, text: string) => () => Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find(node => node.textContent?.includes(text)) ?? null;

const quiet = guildOf({
  inactiveDays: 14,
  members: [
    member(ME, 'An', 5, { isMe: true, daysCompletedThisWeek: 0, nudge: { allowed: false, reason: null } }),
    member('00000000-0000-4000-9000-000000000001', 'Linh', 7, { daysCompletedThisWeek: 0, nudge: { allowed: false, reason: 'NUDGE_OUTSIDE_WINDOW' } }),
    member('00000000-0000-4000-9000-000000000002', 'Minh', 3, { daysCompletedThisWeek: 0 }),
    member('00000000-0000-4000-9000-000000000003', 'Hà', 6, { daysCompletedThisWeek: 0, nudge: { allowed: false, reason: 'NUDGE_RECEIVER_MUTED' } }),
  ],
});

export const entries: Entries = {
  's25-guild-empty': () => app({ route: 'Guild', queries: seen({ guild: null }) }),
  's26-guild-join': () => app({ route: 'GuildJoin' }),
  // A code that is not complete is refused at once, with the words of an invalid code, before any request.
  's26-guild-join-invalid': () => app({ route: 'GuildJoin', extra: <PressWhen find={byText('button', vi.joinAction)} /> }),
  's42-guild-create': () => app({ route: 'GuildCreate' }),
  's27-guild': () => app({ route: 'Guild', queries: seen(guildOf()) }),
  's76-guild-quiet': () => app({ route: 'Guild', queries: seen(quiet) }),
  's54-guild-manage': () => app({ route: 'GuildManage', queries: seen(guildOf()) }),
  's54-guild-manage-leader': () => app({ route: 'GuildManage', queries: seen(guildOf({ myRole: 'LEADER' })) }),
};
