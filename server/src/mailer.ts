import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mailer } from './app.ts';

/** server/.outbox/mail.jsonl (git-ignored). */
export const DEFAULT_OUTBOX = fileURLToPath(
  new URL('../.outbox/mail.jsonl', import.meta.url),
);

/**
 * Development only: appends one JSON line `{ts, to, subject, text}` per message to `filePath`
 * (its directory is created on demand) instead of sending anything. The text holds the reset
 * code, which is why this is not a production mailer: see "Thư" in docs/backend.md.
 */
export function outboxMailer(filePath: string): Mailer {
  return async ({ to, subject, text }) => {
    await mkdir(dirname(filePath), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), to, subject, text });
    await appendFile(filePath, `${line}\n`, 'utf8');
  };
}
