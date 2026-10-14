// Inbox routes: the caller's notifications, newest first, and marking them read. Both are plain
// statements as app_auth under row level security (33-inbox.sql): the caller is named explicitly,
// and the policy is the second filter under it. Marking read is an UPDATE of the one column the
// owner may write (read_at): an id of somebody else's item is simply not updated, and the answer
// does not tell it apart from an id that does not exist.
import type {
  Inbox,
  InboxItem,
  InboxReadResult,
} from '../../../domain/contract/core.ts';
import type { Ctx, Route, RouteResponse } from '../app.ts';
import { idempotencyKey } from '../idempotency.ts';
import { LAST_INSTANT, instantOf, objectBody, refuse } from './day.ts';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

/** `limit`: absent is the default; otherwise a whole number from 1 to LIMIT_MAX. */
function limitOf(value: string | null): number {
  if (value === null) {
    return LIMIT_DEFAULT;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw refuse('limit', 'format');
  }
  const limit = Number(value);
  if (limit < 1) {
    throw refuse('limit', 'min');
  }
  if (limit > LIMIT_MAX) {
    throw refuse('limit', 'max');
  }
  return limit;
}

/**
 * `before`: absent, or an instant that exists (the house rule of routes/day.ts), handed to SQL as
 * written so that its microseconds survive: `nextBefore` carries them, and two items a
 * microsecond apart must not fall on the same side of a page. Before 1970 nothing exists.
 */
function beforeOf(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const ms = instantOf(value);
  if (Number.isNaN(ms) || ms > LAST_INSTANT) {
    throw refuse('before', 'format');
  }
  return ms < 0 ? new Date(0).toISOString() : value;
}

type Row = {
  items: (Omit<InboxItem, 'createdAt' | 'readAt'> & {
    createdAt: string;
    readAt: string | null;
    cursor: string;
  })[];
  unread: number;
};

// One statement: the page and the unread count are one snapshot. $1: before (null: from the
// newest), $2: the page size; one row more is read to know whether a next page exists. cursor:
// created_at in UTC to the microsecond, the value `nextBefore` hands back.
const PAGE = `
  SELECT (SELECT count(*)::int FROM notifications n
           WHERE n.user_id = app.current_user_id() AND n.read_at IS NULL) AS unread,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', p.id, 'kind', p.kind, 'payload', p.payload,
                   'createdAt', p.created_at, 'readAt', p.read_at,
                   'cursor', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
                   ORDER BY p.created_at DESC, p.id DESC), '[]'::jsonb)
            FROM (SELECT n.* FROM notifications n
                   WHERE n.user_id = app.current_user_id()
                     AND ($1::timestamptz IS NULL OR n.created_at < $1::timestamptz)
                   ORDER BY n.created_at DESC, n.id DESC
                   LIMIT $2::int + 1) p) AS items`;

const iso = (value: string | null) =>
  value === null ? null : new Date(value).toISOString();

async function inbox(ctx: Ctx): Promise<RouteResponse> {
  const limit = limitOf(ctx.query.get('limit'));
  const before = beforeOf(ctx.query.get('before'));
  const { rows } = await ctx.db.query<Row>(PAGE, [before, limit]);
  const { items, unread } = rows[0];
  const page = items.slice(0, limit);
  const body: Inbox = {
    items: page.map(
      ({ cursor: _cursor, createdAt, readAt, ...item }) =>
        ({ ...item, createdAt: iso(createdAt), readAt: iso(readAt) }) as InboxItem,
    ),
    unreadCount: unread,
    nextBefore: items.length > limit ? page[page.length - 1].cursor : null,
  };
  return { status: 200, body };
}

/** `ids` of the body: absent is every unread item; else an array of UUIDs. */
function idsOf(body: unknown): string[] | null {
  const { ids } = objectBody(body);
  if (ids === undefined) {
    return null;
  }
  if (!Array.isArray(ids)) {
    throw refuse('ids', 'format');
  }
  return ids.map(id => {
    const uuid = typeof id === 'string' ? idempotencyKey(id) : null;
    if (uuid === null) {
      throw refuse('ids', 'format');
    }
    return uuid;
  });
}

async function markRead(ctx: Ctx): Promise<RouteResponse> {
  const ids = idsOf(ctx.body);
  await ctx.db.query(
    `UPDATE notifications SET read_at = app.now()
      WHERE user_id = app.current_user_id() AND read_at IS NULL
        AND ($1::uuid[] IS NULL OR id = ANY ($1::uuid[]))`,
    [ids],
  );
  const { rows } = await ctx.db.query<{ unread: number }>(
    `SELECT count(*)::int AS unread FROM notifications
      WHERE user_id = app.current_user_id() AND read_at IS NULL`,
  );
  const body: InboxReadResult = { unreadCount: rows[0].unread };
  return { status: 200, body };
}

const routes: Route[] = [
  { method: 'GET', path: '/inbox', auth: 'user', handler: inbox },
  {
    method: 'POST',
    path: '/inbox/read',
    auth: 'user',
    idempotent: true,
    handler: markRead,
  },
];

export default routes;
