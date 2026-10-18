// Seeds nudge_templates from content/nudgeTemplates.ts, by code: nudge_events point at a code
// for good, so a template is never deleted here. Idempotent: a second run rewrites no row.
import type { ClientBase } from 'pg';
import { NUDGE_TEMPLATES } from '../../content/nudgeTemplates.ts';

export async function seed(db: ClientBase): Promise<void> {
  await db.query(
    `INSERT INTO nudge_templates AS t (code, text)
     SELECT x.code, x.text FROM jsonb_to_recordset($1::jsonb) AS x (code text, text text)
     ON CONFLICT (code) DO UPDATE SET text = EXCLUDED.text WHERE t.text IS DISTINCT FROM EXCLUDED.text`,
    [JSON.stringify(NUDGE_TEMPLATES)],
  );
}
