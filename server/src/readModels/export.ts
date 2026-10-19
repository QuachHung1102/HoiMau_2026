// The data export (spec R-P.3, S44): every row the caller owns, by table name, read as app_auth
// so that row level security keeps every other user's row out. A table of user data added later
// gets a line in TABLES: export.test.ts compares this list with the registry (meta.expected_tables,
// classes own_read and own_rw) and fails for one missing.
//
// Never in it: credentials, sessions, reset codes, idempotency keys (none is own_*), and nothing
// that names another user: a NUDGE notification loses senderName, the nudges come from
// export_nudges() without the other party, the guild is its name only.
import type { ExportDocument } from '../../../domain/contract/social.ts';
import type { Ctx } from '../app.ts';
import { decryptJournal } from '../journalCrypto.ts';

/** The rows of `from`, oldest first as `order` says: a jsonb array, never null. */
const rows = (select: string, from: string, order: string) =>
  `(SELECT coalesce(jsonb_agg(${select} ORDER BY ${order}), '[]'::jsonb) FROM ${from})`;
const plain = (table: string, order = 't.created_at') =>
  rows('to_jsonb(t)', `${table} t`, order);

/** Table name -> SQL expression (jsonb) of the caller's rows. */
const TABLES: Record<string, string> = {
  users: plain('users'),
  user_settings: plain('user_settings'),
  biometric_snapshots: plain('biometric_snapshots', 't.recorded_at, t.id'),
  prescriptions: plain('prescriptions'),
  progression_state: plain('progression_state'),
  xp_ledger: plain('xp_ledger', 't.created_at, t.id'),
  coin_ledger: plain('coin_ledger', 't.created_at, t.id'),
  daily_logs: plain('daily_logs', 't.logical_date'),
  quest_completions: plain('quest_completions', 't.created_at, t.id'),
  quest_ticks: plain('quest_ticks', 't.occurred_at, t.id'),
  nutrition_logs: plain('nutrition_logs', 't.occurred_at, t.id'),
  workout_sessions: plain('workout_sessions', 't.occurred_at, t.id'),
  daily_meal_plans: plain('daily_meal_plans', 't.logical_date, t.meal_slot'),
  inventory: rows(
    "to_jsonb(t) || jsonb_build_object('itemCode', s.code, 'itemName', s.name)",
    'inventory t JOIN shop_items s ON s.id = t.shop_item_id',
    't.created_at, t.id',
  ),
  perk_unlocks: rows(
    "to_jsonb(t) || jsonb_build_object('itemCode', s.code, 'itemName', s.name)",
    'perk_unlocks t LEFT JOIN shop_items s ON s.id = t.shop_item_id',
    't.created_at, t.id',
  ),
  guild_memberships: rows(
    "to_jsonb(t) || jsonb_build_object('guildName', guild_overview() -> 'guild' ->> 'name')",
    'guild_memberships t',
    't.created_at',
  ),
  freeze_tickets: plain('freeze_tickets', 't.created_at, t.id'),
  ticket_grant_weeks: plain('ticket_grant_weeks', 't.week_start'),
  notifications: rows(
    "CASE WHEN t.kind = 'NUDGE' THEN to_jsonb(t) || jsonb_build_object('payload', t.payload - 'senderName') ELSE to_jsonb(t) END",
    'notifications t',
    't.created_at, t.id',
  ),
  // the cipher text is replaced by the text below
  journal_entries: rows("to_jsonb(t) - 'body_encrypted'", 'journal_entries t', 't.created_at, t.id'),
};

/** Table names of the export, for the test that compares them with the registry. */
export const EXPORT_TABLES = Object.keys(TABLES);

const QUERY = `SELECT jsonb_build_object(${Object.entries(TABLES)
  .map(([name, sql]) => `'${name}', ${sql}`)
  .join(', ')}) AS data,
  export_nudges() AS nudges,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'body', encode(j.body_encrypted, 'base64'))), '[]'::jsonb)
     FROM journal_entries j) AS cipher`;

type JournalRow = { id: string } & Record<string, unknown>;

/** The ExportDocument of the caller; `ctx.db` runs as app_auth with the caller's id. */
export async function buildExport(ctx: Ctx): Promise<ExportDocument> {
  const userId = ctx.userId as string;
  const { rows: result } = await ctx.db.query<{
    data: Record<string, unknown>;
    nudges: unknown[];
    cipher: { id: string; body: string }[];
  }>(QUERY);
  const { data, nudges, cipher } = result[0];
  // as routes/journal.ts: an entry that cannot be read is null, logged by id only
  const texts = new Map(
    cipher.map(({ id, body }) => {
      try {
        return [id, decryptJournal(ctx.journalKey, userId, id, Buffer.from(body, 'base64'))];
      } catch {
        ctx.log.line({ level: 'error', evt: 'journal_decrypt_failed', entryId: id });
        return [id, null];
      }
    }),
  );
  data.journal_entries = (data.journal_entries as JournalRow[]).map(row => ({
    ...row,
    text: texts.get(row.id),
  }));
  data.nudge_events = nudges;
  return { formatVersion: 1, exportedAt: ctx.now.toISOString(), data };
}
