// Seeds quotes from content/quotes.ts, by code: journal entries point at a code for good, so a
// quote is never deleted here. Idempotent: a second run rewrites no row.
import type { ClientBase } from 'pg';
import { QUOTES } from '../../content/quotes.ts';

export async function seed(db: ClientBase): Promise<void> {
  await db.query(
    `INSERT INTO quotes AS q (code, text, author)
     SELECT x.code, x.text, x.author FROM jsonb_to_recordset($1::jsonb) AS x (code text, text text, author text)
     ON CONFLICT (code) DO UPDATE SET text = EXCLUDED.text, author = EXCLUDED.author
      WHERE (q.text, q.author) IS DISTINCT FROM (EXCLUDED.text, EXCLUDED.author)`,
    [JSON.stringify(QUOTES)],
  );
}
