/**
 * Every operation of the API, one entry per operation of docs/api/openapi.yaml (same order).
 * Paths are relative to /api/v1. `auth`: 'anon' = no session; 'session' = valid bearer token;
 * 'user' = session and completed onboarding (otherwise 409 ONBOARDING_REQUIRED).
 * `idempotent`: the request must carry `Idempotency-Key: <uuid>`.
 */
export const OPERATIONS: readonly {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  auth: 'anon' | 'session' | 'user';
  idempotent: boolean;
}[] = [
  { method: 'GET', path: '/healthz', auth: 'anon', idempotent: false },
  { method: 'GET', path: '/meta/timezones', auth: 'anon', idempotent: false },
  { method: 'POST', path: '/auth/register', auth: 'anon', idempotent: false },
  { method: 'POST', path: '/auth/login', auth: 'anon', idempotent: false },
  { method: 'POST', path: '/auth/logout', auth: 'session', idempotent: false },
  {
    method: 'POST',
    path: '/auth/password/forgot',
    auth: 'anon',
    idempotent: false,
  },
  {
    method: 'POST',
    path: '/auth/password/reset',
    auth: 'anon',
    idempotent: false,
  },
  { method: 'POST', path: '/onboarding', auth: 'session', idempotent: true },
  { method: 'GET', path: '/me', auth: 'session', idempotent: false },
  { method: 'PATCH', path: '/me', auth: 'user', idempotent: true },
  { method: 'POST', path: '/me/biometrics', auth: 'user', idempotent: true },
  { method: 'PATCH', path: '/me/archetype', auth: 'user', idempotent: true },
  { method: 'GET', path: '/me/prescription', auth: 'user', idempotent: false },
  { method: 'GET', path: '/me/export', auth: 'user', idempotent: false },
  { method: 'POST', path: '/me/delete', auth: 'session', idempotent: true },
  { method: 'GET', path: '/settings', auth: 'user', idempotent: false },
  { method: 'PATCH', path: '/settings', auth: 'user', idempotent: true },
  { method: 'GET', path: '/day', auth: 'user', idempotent: false },
  {
    method: 'POST',
    path: '/day/quests/:questCode/progress',
    auth: 'user',
    idempotent: true,
  },
  {
    method: 'POST',
    path: '/day/quests/:questCode/undo',
    auth: 'user',
    idempotent: true,
  },
  { method: 'POST', path: '/day/bedtime', auth: 'user', idempotent: true },
  { method: 'GET', path: '/day/history', auth: 'user', idempotent: false },
  {
    method: 'GET',
    path: '/day/history/:date',
    auth: 'user',
    idempotent: false,
  },
  { method: 'GET', path: '/nutrition/plan', auth: 'user', idempotent: false },
  {
    method: 'GET',
    path: '/nutrition/swap-candidates',
    auth: 'user',
    idempotent: false,
  },
  { method: 'POST', path: '/nutrition/swap', auth: 'user', idempotent: true },
  { method: 'POST', path: '/nutrition/log', auth: 'user', idempotent: true },
  { method: 'GET', path: '/workout/catalog', auth: 'user', idempotent: false },
  {
    method: 'GET',
    path: '/workout/items/:id',
    auth: 'user',
    idempotent: false,
  },
  { method: 'POST', path: '/workout/complete', auth: 'user', idempotent: true },
  { method: 'GET', path: '/progression', auth: 'user', idempotent: false },
  { method: 'GET', path: '/pet', auth: 'user', idempotent: false },
  { method: 'GET', path: '/perks', auth: 'user', idempotent: false },
  { method: 'POST', path: '/perks/unlock', auth: 'user', idempotent: true },
  { method: 'GET', path: '/shop', auth: 'user', idempotent: false },
  {
    method: 'POST',
    path: '/shop/:itemCode/purchase',
    auth: 'user',
    idempotent: true,
  },
  { method: 'GET', path: '/inventory', auth: 'user', idempotent: false },
  {
    method: 'POST',
    path: '/inventory/:itemCode/equip',
    auth: 'user',
    idempotent: true,
  },
  { method: 'POST', path: '/guilds', auth: 'user', idempotent: true },
  { method: 'POST', path: '/guilds/join', auth: 'user', idempotent: true },
  { method: 'GET', path: '/guilds/me', auth: 'user', idempotent: false },
  { method: 'POST', path: '/guilds/me/leave', auth: 'user', idempotent: true },
  {
    method: 'POST',
    path: '/guilds/me/transfer',
    auth: 'user',
    idempotent: true,
  },
  { method: 'GET', path: '/leaderboard', auth: 'user', idempotent: false },
  {
    method: 'GET',
    path: '/guilds/nudge-templates',
    auth: 'user',
    idempotent: false,
  },
  { method: 'POST', path: '/guilds/nudge', auth: 'user', idempotent: true },
  { method: 'GET', path: '/inbox', auth: 'user', idempotent: false },
  { method: 'POST', path: '/inbox/read', auth: 'user', idempotent: true },
  { method: 'POST', path: '/journal', auth: 'user', idempotent: true },
  { method: 'GET', path: '/journal', auth: 'user', idempotent: false },
  { method: 'GET', path: '/journal/:id', auth: 'user', idempotent: false },
  { method: 'GET', path: '/freeze-tickets', auth: 'user', idempotent: false },
  {
    method: 'POST',
    path: '/freeze-tickets/use',
    auth: 'user',
    idempotent: true,
  },
];
