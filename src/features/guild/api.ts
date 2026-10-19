import { Share } from 'react-native';
import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { GuildCreateRequest, GuildJoinRequest, GuildState, Leaderboard, NudgeRequest, NudgeResult, NudgeTemplates, TransferRequest } from '../../../domain/contract/social.ts';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/api/session';
import * as vi from '../../shared/i18n/vi/guild';
import { useServerWrite } from '../shop/api';

export const guildKey = ['guild'] as const;
// The weekly ranking shows the caller's own guild: a guild that was made, joined or left changes it.
export const leaderboardKey = ['leaderboard'] as const;

/** `GET /guilds/me`: the own guild with its members, or `{ guild: null }`. Idle while signed out. */
export function useGuild() {
  const { status } = useSession();
  return useQuery({ queryKey: guildKey, queryFn: status === 'signedIn' ? ({ signal }) => api.get<GuildState>('/guilds/me', undefined, { signal }) : skipToken });
}

/** The guild the server has just answered with, then everything that shows guild data is read again. */
function confirmed(queryClient: QueryClient, state?: GuildState) {
  if (state) queryClient.setQueryData(guildKey, state);
  for (const queryKey of [guildKey, leaderboardKey]) queryClient.invalidateQueries({ queryKey });
}

/** The server said something about the guild that this screen did not know (a stale membership): read it again. */
export function useReadGuildAgain() {
  const queryClient = useQueryClient();
  return () => confirmed(queryClient);
}

// The four writes need the network and are never queued; `useServerWrite` gives each its rules: one request at a time,
// one Idempotency-Key per distinct request (repeated after a lost answer, new after any answer), nothing on screen
// changes before the server has answered.

/** `POST /guilds`. */
export function useCreateGuild() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (name: string, motto: string) => `${name}\n${motto}`,
    (key, name: string, motto: string) => api.write<GuildState>('POST', '/guilds', { name, ...(motto === '' ? {} : { motto }) } satisfies GuildCreateRequest, { idempotencyKey: key }),
    state => confirmed(queryClient, state),
  );
}

/** `POST /guilds/join`. */
export function useJoinGuild() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (inviteCode: string) => inviteCode,
    (key, inviteCode: string) => api.write<GuildState>('POST', '/guilds/join', { inviteCode } satisfies GuildJoinRequest, { idempotencyKey: key }),
    state => confirmed(queryClient, state),
  );
}

/** `POST /guilds/me/leave` (204): the guild is gone from the cache at once, the reads follow. */
export function useLeaveGuild() {
  const queryClient = useQueryClient();
  return useServerWrite(
    () => 'leave',
    key => api.write<void>('POST', '/guilds/me/leave', undefined, { idempotencyKey: key }),
    () => confirmed(queryClient, { guild: null }),
  );
}

/** `POST /guilds/me/transfer`: the answer is the guild with the new roles. */
export function useTransferGuild() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (userId: string) => userId,
    (key, userId: string) => api.write<GuildState>('POST', '/guilds/me/transfer', { userId } satisfies TransferRequest, { idempotencyKey: key }),
    state => confirmed(queryClient, state),
  );
}

export type BoardWeek = 'current' | 'previous';
/** `GET /leaderboard?week`: one read per week (the key carries it), so switching weeks asks again and keeps the other week's board. */
export function useLeaderboard(week: BoardWeek) {
  const { status } = useSession();
  return useQuery({ queryKey: [...leaderboardKey, week], queryFn: status === 'signedIn' ? ({ signal }) => api.get<Leaderboard>('/leaderboard', { week }, { signal }) : skipToken });
}

export const nudgeTemplatesKey = ['nudge-templates'] as const;
/** `GET /guilds/nudge-templates`: the fixed texts, ordered by code. `enabled` false (a nudge that cannot be sent anyway) asks nothing. */
export function useNudgeTemplates(enabled: boolean) {
  const { status } = useSession();
  return useQuery({ queryKey: nudgeTemplatesKey, queryFn: enabled && status === 'signedIn' ? ({ signal }) => api.get<NudgeTemplates>('/guilds/nudge-templates', undefined, { signal }) : skipToken });
}

/** `POST /guilds/nudge` (online only): the receiver's row now says "already nudged", so the guild is read again. */
export function useSendNudge() {
  const queryClient = useQueryClient();
  return useServerWrite(
    (receiverId: string, templateCode: string) => `${receiverId}:${templateCode}`,
    (key, receiverId: string, templateCode: string) => api.write<NudgeResult>('POST', '/guilds/nudge', { receiverId, templateCode } satisfies NudgeRequest, { idempotencyKey: key }),
    () => queryClient.invalidateQueries({ queryKey: guildKey }),
  );
}

/** The system share sheet with a short invitation: the name of the guild and its invite code, nothing else. */
export const shareInvitation = (guildName: string, inviteCode: string) => Share.share({ message: vi.invitation(guildName, inviteCode) });
