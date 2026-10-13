import { chmod, mkdir, open } from 'node:fs/promises';
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
    // Owner only: the lines hold live reset codes. The modes of mkdir and open apply only when
    // the directory or the file is created, so an existing one is chmod-ed before anything is
    // written. Windows ignores modes (the ACL of the parent decides): nothing to do there.
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ ts: new Date().toISOString(), to, subject, text });
    const file = await open(filePath, 'a', 0o600);
    try {
      if (process.platform !== 'win32') {
        await chmod(dir, 0o700);
        await file.chmod(0o600);
      }
      await file.appendFile(`${line}\n`, 'utf8');
    } finally {
      await file.close();
    }
  };
}
