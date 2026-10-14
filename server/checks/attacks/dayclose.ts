// Gate 2, the attack cases of day close and the inbox (32-dayclose.sql, 33-inbox.sql): the job
// functions are app_job's alone, app_job reads no table, a client writes no notification and no
// ticket, the decoy's unread notification cannot be marked by another user, and a run of the
// job never touches the decoy (only onboarded users are candidates).
import assert from 'node:assert/strict';
import { createLogger } from '../../src/log.ts';
import { runJob } from '../../src/jobs/scheduler.ts';
import { asJob } from '../../test/helpers.ts';
import { decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed values of server/sql/83-decoy-dayclose.sql.
const DECOY_NOTIFICATION = '00000000-0000-4000-8000-0000000d100f';
const DECOY_TICKET = '00000000-0000-4000-8000-0000000d100e';

const DENIED = '42501';

/** The decoy's notification is there and unread: marking it is what must not happen. */
async function decoyItemUnread(ctx: AttackCtx): Promise<void> {
  const { rows } = await ctx.admin.query(
    'SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
    [DECOY_NOTIFICATION, ctx.decoy],
  );
  assert.equal(rows.length, 1, 'no unread notification of the decoy');
}

export const attacks: Attack[] = [
  {
    name: 'app_auth calling each job function is refused at EXECUTE',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        for (const [name, sql, params] of [
          ['job_day_close_candidates', 'SELECT * FROM job_day_close_candidates($1, $2, $3)', ['2031-01-01T00:00:00Z', 1000, null]],
          [
            'job_apply_day_close',
            'SELECT job_apply_day_close($1, $2, $3, $4, $5, $6)',
            [ctx.decoy, null, '2026-01-01', '[]', '{}', '[]'],
          ],
          [
            'job_record_run',
            'SELECT job_record_run($1, $2, $3, $4, $5)',
            ['day-close', '00000000-0000-4000-8000-000000000001', '2031-01-01T00:00:00Z', true, '{}'],
          ],
        ] as const) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query(sql, [...params])),
            { code: DENIED, messagePrefix: `permission denied for function ${name}` },
          );
        }
      }),
  },
  {
    name: 'app_job selecting daily_logs, notifications or freeze_tickets directly is refused at the GRANT',
    async run(ctx) {
      for (const table of ['daily_logs', 'notifications', 'freeze_tickets']) {
        await ctx.expectPgError(
          asJob(ctx.app, c => c.query(`SELECT * FROM public.${table}`)),
          { code: DENIED, messagePrefix: `permission denied for table ${table}` },
        );
      }
    },
  },
  {
    name: 'app_auth inserting a notifications or freeze_tickets row is refused at the GRANT',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query(
              "INSERT INTO public.notifications (user_id, kind, payload) VALUES ($1, 'STREAK_MILESTONE', '{}')",
              [ctx.userA],
            ),
          ),
          { code: DENIED, messagePrefix: 'permission denied for table notifications' },
        );
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query(
              "INSERT INTO public.freeze_tickets (user_id, grant_week, used_at, used_for_date) VALUES ($1, '2026-01-05', now(), '2026-01-05')",
              [ctx.userA],
            ),
          ),
          { code: DENIED, messagePrefix: 'permission denied for table freeze_tickets' },
        );
      }),
  },
  {
    name: 'user A marking the decoy\'s notification read (by id, and with every unread item) changes nothing of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        await decoyItemUnread(ctx);
        const marked = await ctx.asUser(ctx.app, ctx.userA, async c => [
          (await c.query('UPDATE public.notifications SET read_at = app.now() WHERE id = $1', [DECOY_NOTIFICATION]))
            .rowCount,
          (await c.query('UPDATE public.notifications SET read_at = app.now() WHERE read_at IS NULL')).rowCount,
        ]);
        assert.deepEqual(marked, [0, 0]);
      }),
  },
  {
    name: 'a run of day-close, now and with a clock far ahead, offers and changes nothing of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        // the decoy has a progression row, a day and a ticket: everything but onboarded_at
        const { rows } = await ctx.admin.query(
          `SELECT (SELECT count(*)::int FROM progression_state WHERE user_id = $1) AS state,
                  (SELECT count(*)::int FROM freeze_tickets WHERE id = $2) AS ticket`,
          [ctx.decoy, DECOY_TICKET],
        );
        assert.deepEqual(rows[0], { state: 1, ticket: 1 });
        // far ahead the candidates are every onboarded user, user A among them, and never the decoy
        const offered = await asJob(ctx.app, c =>
          c.query('SELECT user_id FROM job_day_close_candidates($1, 100000, NULL)', ['2031-01-01T00:00:00Z']),
        );
        const ids = offered.rows.map(row => row.user_id);
        assert.ok(ids.includes(ctx.userA), 'user A is a candidate far ahead');
        assert.ok(!ids.includes(ctx.decoy), 'the decoy is a candidate');
        // a real run, at the database's own instant (it closes nothing of today's users)
        const now = await asJob(ctx.app, c => c.query<{ now: Date }>('SELECT app.now() AS now'));
        const result = await runJob('day-close', ctx.app, now.rows[0].now, createLogger(() => {}));
        assert.equal(result.failed, 0);
        // and an apply naming the decoy applies nothing
        const applied = await asJob(ctx.app, c =>
          c.query('SELECT job_apply_day_close($1, NULL, $2, $3, $4, $5) AS result', [
            ctx.decoy,
            '2026-01-02',
            JSON.stringify([
              { date: '2026-01-01', storyCompleted: false, ticketApplied: true },
              { date: '2026-01-02', storyCompleted: false, ticketApplied: false },
            ]),
            JSON.stringify({ streakCurrent: 0, streakBest: 0, streakBeforeBreak: null, breakDate: null, missedRun: 1, lastOutcome: 'MISSED' }),
            JSON.stringify([{ type: 'PET_TIRED', date: '2026-01-02' }]),
          ]),
        );
        assert.deepEqual(applied.rows[0].result, { applied: false, grants: [] });
      }),
  },
];
