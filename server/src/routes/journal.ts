// Journal routes: POST /journal, GET /journal, GET /journal/{id} (F-13, spec 10.1). The text is
// encrypted here (journalCrypto.ts) before anything reaches the database, and decrypted here for
// its author only: SQL sees the blob, row level security keeps the rows the caller's. The text is
// never logged, never part of an error, never in an answer of POST /journal (that answer is what
// the idempotency table stores). The rules of the XP, the quote and the weekly ticket are those of
// journal_create (60-journal.sql); its refusals are THROWN, so a refused entry leaves no row.
import type { JournalCreateResult, JournalEntry, JournalList, Quote } from '../../../domain/contract/social.ts';
import { LIMITS } from '../../../domain/validation.ts';
import type { Ctx, Route } from '../app.ts';
import { AppError } from '../errors.ts';
import { idempotencyKey } from '../idempotency.ts';
import { decryptJournal, encryptJournal } from '../journalCrypto.ts';
import { buildDelta, logGrants } from '../readModels/delta.ts';
import type { Grant } from '../readModels/delta.ts';
import { objectBody, refuse } from './day.ts';
import { limitOf } from './inbox.ts';

const PREVIEW_CHARS = 80;

type Created = {
  entry: { id: string; createdAt: string };
  quote: Quote;
  grant: Grant;
  ticket: JournalCreateResult['ticket'];
};

type Row = { id: string; created_at: Date; quote_code: string; body_encrypted: Buffer };

/**
 * The text of an entry, or null for a blob that does not open (logged with the entry id only):
 * GET /journal/{id} answers 500 for it, GET /journal leaves it out of the page (the contract's
 * preview is a string, and one bad blob must not hide every other entry).
 */
function textOf(ctx: Ctx, row: Row): string | null {
  try {
    return decryptJournal(ctx.journalKey, ctx.userId as string, row.id, row.body_encrypted);
  } catch {
    ctx.log.line({ level: 'error', evt: 'journal_decrypt_failed', entryId: row.id });
    return null;
  }
}

/** The trimmed text of the request: a string of 1 to 5000 characters (code points). */
function bodyOf(ctx: Ctx): string {
  const { body } = objectBody(ctx.body);
  if (body === undefined || body === null) {
    throw refuse('body', 'required');
  }
  if (typeof body !== 'string') {
    throw refuse('body', 'format');
  }
  const text = body.trim();
  const length = [...text].length;
  if (length < LIMITS.journalBody.min) {
    throw refuse('body', 'min');
  }
  if (length > LIMITS.journalBody.max) {
    throw refuse('body', 'max');
  }
  return text;
}

const routes: Route[] = [
  {
    method: 'POST',
    path: '/journal',
    auth: 'user',
    idempotent: true,
    rateLimit: { perMinute: 10 },
    handler: async ctx => {
      const id = ctx.actionId as string;
      const blob = encryptJournal(ctx.journalKey, ctx.userId as string, id, bodyOf(ctx));
      const { rows } = await ctx.db.query<{ result: Created }>('SELECT journal_create($1, $2) AS result', [id, blob]);
      const { entry, quote, grant, ticket } = rows[0].result;
      logGrants(ctx, [grant]);
      const answer: JournalCreateResult = {
        entry: { id: entry.id, createdAt: new Date(entry.createdAt).toISOString() },
        quote,
        xpAwarded: grant.xpAfter - grant.xpBefore,
        ticket,
        delta: buildDelta([grant], []),
      };
      return { status: 200, body: answer };
    },
  },
  {
    method: 'GET',
    path: '/journal',
    auth: 'user',
    handler: async ctx => {
      const limit = limitOf(ctx.query.get('limit'));
      const rawBefore = ctx.query.get('before');
      const before = rawBefore === null ? null : idempotencyKey(rawBefore);
      if (rawBefore !== null && before === null) {
        throw refuse('before', 'format');
      }
      // the cursor is the id of the last entry of the previous page; created_at can repeat, id breaks the tie
      const { rows } = await ctx.db.query<Row>(
        `SELECT e.id, e.created_at, e.quote_code, e.body_encrypted
           FROM journal_entries e
          WHERE e.user_id = app.current_user_id()
            AND ($1::uuid IS NULL OR (e.created_at, e.id) < (
                  SELECT b.created_at, b.id FROM journal_entries b
                   WHERE b.id = $1::uuid AND b.user_id = app.current_user_id()))
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT $2::int + 1`,
        [before, limit],
      );
      const page = rows.slice(0, limit);
      const answer: JournalList = {
        entries: page.flatMap(row => {
          const text = textOf(ctx, row);
          return text === null
            ? []
            : [
                {
                  id: row.id,
                  createdAt: row.created_at.toISOString(),
                  preview: [...text].slice(0, PREVIEW_CHARS).join(''),
                  quoteCode: row.quote_code,
                },
              ];
        }),
        nextBefore: rows.length > limit ? page[page.length - 1].id : null,
      };
      return { status: 200, body: answer };
    },
  },
  {
    method: 'GET',
    path: '/journal/:id',
    auth: 'user',
    handler: async ctx => {
      const id = idempotencyKey(ctx.params.id);
      if (id === null) {
        throw refuse('id', 'format');
      }
      const { rows } = await ctx.db.query<Row & { text: string; author: string | null }>(
        `SELECT e.id, e.created_at, e.quote_code, e.body_encrypted, q.text, q.author
           FROM journal_entries e JOIN quotes q ON q.code = e.quote_code
          WHERE e.id = $1 AND e.user_id = app.current_user_id()`,
        [id],
      );
      if (rows.length === 0) {
        throw new AppError('NOT_FOUND');
      }
      const [row] = rows;
      const body = textOf(ctx, row);
      if (body === null) {
        throw new AppError('INTERNAL');
      }
      const answer: JournalEntry = {
        id: row.id,
        createdAt: row.created_at.toISOString(),
        body,
        quote: { code: row.quote_code, text: row.text, author: row.author },
      };
      return { status: 200, body: answer };
    },
  },
];

export default routes;
