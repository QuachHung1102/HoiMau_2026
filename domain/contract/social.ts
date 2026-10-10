import type { DateLabel } from '../types.ts';
import type { Delta, ErrorCode, IsoDateTime } from './common.ts';
import type { Progression } from './core.ts';

// Guild — nothing here may carry a biometric or calorie field (R-P.1).

export type GuildRole = 'LEADER' | 'MEMBER';

export type GuildMember = {
  userId: string;
  displayName: string;
  level: number;
  role: GuildRole;
  isMe: boolean;
  daysCompletedThisWeek: number;
  daysCountedThisWeek: number;
  /** The member has completed every STORY quest of their current logical day. */
  storyDoneToday: boolean;
  /** `reason`: why a nudge cannot be sent now; null when allowed. */
  nudge: { allowed: boolean; reason: ErrorCode | null };
};

export type GuildState = {
  guild: null | {
    id: string;
    name: string;
    /** Empty string when the guild has none. */
    motto: string;
    inviteCode: string;
    myRole: GuildRole;
    /** 0–1. */
    weekCompletion: number;
    inactive: boolean;
    inactiveDays: number;
    members: GuildMember[];
  };
};
export type GuildCreateRequest = { name: string; motto?: string };
export type GuildJoinRequest = { inviteCode: string };
export type TransferRequest = { userId: string };

/** `avgCompletion` is 0–1. `mine` is null without a guild; its `rank` is null when unranked. */
export type Leaderboard = {
  weekStart: DateLabel;
  final: boolean;
  updatedAt: IsoDateTime;
  entries: {
    rank: number;
    guildName: string;
    avgCompletion: number;
    activeMembers: number;
    isMine: boolean;
  }[];
  mine: null | {
    ranked: boolean;
    rank: number | null;
    avgCompletion: number;
    activeMembers: number;
  };
};

export type NudgeTemplates = { templates: { code: string; text: string }[] };
export type NudgeRequest = { receiverId: string; templateCode: string };
export type NudgeResult = { sentAt: IsoDateTime; senderRemainingToday: number };

// Journal

export type Quote = { code: string; text: string; author: string | null };

export type JournalCreateRequest = { body: string };
export type JournalCreateResult = {
  entry: { id: string; createdAt: IsoDateTime };
  quote: Quote;
  xpAwarded: number;
  ticket: {
    outcome: 'GRANTED' | 'ALREADY_DECIDED' | 'AT_CAP';
    available: number;
    cap: number;
  };
  delta: Delta;
};
/** `nextBefore`: pass as `before` to get the next page; null on the last page. */
export type JournalList = {
  entries: {
    id: string;
    createdAt: IsoDateTime;
    preview: string;
    quoteCode: string;
  }[];
  nextBefore: string | null;
};
export type JournalEntry = {
  id: string;
  createdAt: IsoDateTime;
  body: string;
  quote: Quote;
};

// Freeze tickets

export type Tickets = {
  serverTime: IsoDateTime;
  available: number;
  cap: number;
  eligible: {
    date: DateLabel;
    target: 'TODAY' | 'YESTERDAY';
    deadline: IsoDateTime | null;
    needed: boolean;
    withoutTicket: number;
    withTicket: number;
    alreadyUsed: boolean;
  }[];
  progression: Progression;
};
export type TicketUseRequest = { date: DateLabel };

// Export

export type ExportDocument = {
  formatVersion: 1;
  exportedAt: IsoDateTime;
  data: Record<string, unknown>;
};
