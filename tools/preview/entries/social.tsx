import type { Inbox, InboxItem } from '../../../domain/contract/core.ts';
import type { GuildMember, Leaderboard, NudgeTemplates } from '../../../domain/contract/social.ts';
import { NUDGE_TEMPLATES } from '../../../server/content/nudgeTemplates.ts';
import { guildKey, leaderboardKey, nudgeTemplatesKey } from '../../../src/features/guild/api';
import { inboxKey } from '../../../src/features/notifications/api';
import type { Entries } from '../harness';
import { byText, guildOf, PressWhen } from './guild';
import { app, pathOf, respond } from './today';

// The ranking, the nudge and the inbox of frames S28, S73, S29, S74, S30 and S75, with illustrative values (never logic).
const board = (more: Partial<Leaderboard> = {}): Leaderboard => ({
  weekStart: '2026-10-12',
  final: false,
  // 02:40 UTC: "09:40" on a clock in Asia/Ho_Chi_Minh, the time of the frame; another zone shows its own
  updatedAt: '2026-10-14T02:40:00.000Z',
  entries: [
    { rank: 1, guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.86, activeMembers: 5, isMine: false },
    { rank: 2, guildName: 'Nhịp sống mới', avgCompletion: 0.79, activeMembers: 4, isMine: true },
    { rank: 3, guildName: 'Bạn cùng tiến', avgCompletion: 0.71, activeMembers: 6, isMine: false },
  ],
  mine: { ranked: true, rank: 2, avgCompletion: 0.79, activeMembers: 4 },
  ...more,
});
const week = (which: 'current' | 'previous', data: Leaderboard): [readonly unknown[], unknown] => [[...leaderboardKey, which], data];

const unranked = board({
  entries: [
    { rank: 1, guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.86, activeMembers: 5, isMine: false },
    { rank: 2, guildName: 'Bạn cùng tiến', avgCompletion: 0.71, activeMembers: 6, isMine: false },
  ],
  mine: { ranked: false, rank: null, avgCompletion: 0.4, activeMembers: 2 },
});
const closed = board({
  weekStart: '2026-10-05',
  final: true,
  updatedAt: '2026-10-12T03:30:00.000Z',
  entries: [
    { rank: 1, guildName: 'Nhịp sống mới', avgCompletion: 0.82, activeMembers: 4, isMine: true },
    { rank: 2, guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.77, activeMembers: 5, isMine: false },
    { rank: 3, guildName: 'Bạn cùng tiến', avgCompletion: 0.7, activeMembers: 6, isMine: false },
  ],
  mine: { ranked: true, rank: 1, avgCompletion: 0.82, activeMembers: 4 },
});

const MINH = '00000000-0000-4000-9000-000000000002';
const HA = '00000000-0000-4000-9000-000000000003';
const templates = (): [readonly unknown[], unknown] => [nudgeTemplatesKey, { templates: [...NUDGE_TEMPLATES].sort((a, b) => (a.code < b.code ? -1 : 1)) } satisfies NudgeTemplates];
/** The guild of frame S27 with Minh refused for `reason` (null: can be nudged). */
const minhWith = (reason: GuildMember['nudge']['reason']) =>
  guildOf({
    members: guildOf().guild?.members.map(one => (one.userId === MINH ? { ...one, nudge: { allowed: reason === null, reason } } : one)),
  });
const nudging = (state: ReturnType<typeof guildOf>, receiverId: string, receiverName: string) => ({
  route: 'Nudge' as const,
  params: { receiverId, receiverName },
  queries: [[guildKey, state], templates()] as [readonly unknown[], unknown][],
});

const NOW = Date.now();
const item = (n: number, kind: InboxItem['kind'], payload: object, read = false): InboxItem =>
  ({ id: `00000000-0000-4000-9000-7000000000${String(n).padStart(2, '0')}`, kind, payload, createdAt: new Date(NOW - n * 3_600_000).toISOString(), readAt: read ? new Date(NOW).toISOString() : null }) as InboxItem;
const inbox = (items: InboxItem[]): [readonly unknown[], unknown] => [inboxKey, { pages: [{ items, unreadCount: items.filter(one => one.readAt === null).length, nextBefore: null } satisfies Inbox], pageParams: [undefined] }];

const first = byText('radio', NUDGE_TEMPLATES.find(template => template.code === 'MOVE_TOGETHER')?.text ?? '');
const send = byText('button', 'Gửi cho Minh');

export const entries: Entries = {
  's28-leaderboard': () => app({ route: 'Leaderboard', queries: [[guildKey, guildOf()], week('current', board())] }),
  // The preview has no network: the closed week is read from the cache, and "Tuần trước" is pressed to show it.
  's28-leaderboard-previous': () =>
    app({ route: 'Leaderboard', queries: [[guildKey, guildOf()], week('current', board()), week('previous', closed)], extra: <PressWhen find={byText('radio', 'Tuần trước')} /> }),
  's73-leaderboard-unranked': () => app({ route: 'Leaderboard', queries: [[guildKey, guildOf()], week('current', unranked)] }),

  's29-nudge': () => app({ ...nudging(minhWith(null), MINH, 'Minh'), extra: <PressWhen find={first} /> }),
  's29-nudge-sent': () =>
    app({
      ...nudging(minhWith(null), MINH, 'Minh'),
      fetchStub: (url, init) =>
        init?.method === 'POST' ? respond(200, { sentAt: new Date().toISOString(), senderRemainingToday: 2 }) : pathOf(url) === '/guilds/me' ? respond(200, minhWith(null)) : respond(404),
      extra: (
        <>
          <PressWhen find={first} />
          <PressWhen find={send} />
        </>
      ),
    }),
  's74-nudge-muted': () => app(nudging(guildOf(), HA, 'Hà')),
  's74-nudge-receiver-limit': () => app(nudging(minhWith('NUDGE_RECEIVER_LIMIT'), MINH, 'Minh')),
  's74-nudge-sender-limit': () => app(nudging(minhWith('NUDGE_SENDER_LIMIT'), MINH, 'Minh')),

  's30-inbox': () =>
    app({
      route: 'Inbox',
      queries: [
        inbox([
          item(1, 'NUDGE', { senderName: 'Linh', templateCode: 'MOVE_TOGETHER', text: 'Mình cùng vận động nhé?' }),
          item(2, 'STREAK_MILESTONE', { days: 7, coins: 50, badgeCode: 'BADGE_STREAK_7' }),
          item(3, 'PET_TIRED', {}, true),
        ]),
      ],
    }),
  's75-inbox-empty': () => app({ route: 'Inbox', queries: [inbox([])] }),
};
