// Gate 2, the attack cases of deletion and the purge jobs (61-privacy.sql): account_delete with a
// wrong key and with the decoy's own key, the shape of the three request functions (none takes a
// user), the job and internal functions and a DELETE of users as app_auth, and every purge job
// run as app_job with the clock far ahead. Ownership and the privileges themselves stop each one.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { asJob } from '../../test/helpers.ts';
import { DECOY_1, decoyRows, decoyUntouched } from './base.ts';
import type { Attack } from './base.ts';

const FAR = '2999-01-01T00:00:00Z';

export const attacks: Attack[] = [
  {
    name: "account_delete as A with a wrong key, and with the decoy's stored key: false, A and the decoy not deleted",
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const { rows: stored } = await ctx.admin.query<{ key: Buffer }>(
          'SELECT key FROM credentials WHERE user_id = $1',
          [DECOY_1],
        );
        assert.equal(stored.length, 1, 'no decoy credentials');
        for (const key of [randomBytes(32), stored[0].key]) {
          const { rows } = await ctx.asUser(ctx.app, ctx.userA, c =>
            c.query<{ ok: boolean }>('SELECT account_delete($1) AS ok', [key]),
          );
          assert.deepEqual(rows, [{ ok: false }]);
        }
        const { rows } = await ctx.admin.query(
          'SELECT id, deleted_at, purge_after FROM users WHERE id = ANY($1) ORDER BY id',
          [[ctx.userA, DECOY_1]],
        );
        assert.deepEqual(
          rows.map(row => [row.deleted_at, row.purge_after]),
          [
            [null, null],
            [null, null],
          ],
        );
      }),
  },
  {
    name: 'account_delete, account_salt and export_nudges take no user: their only argument is the key',
    async run(ctx) {
      const { rows } = await ctx.admin.query<{ fn: string; args: string }>(
        `SELECT p.proname::text AS fn, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('account_delete', 'account_salt', 'export_nudges') ORDER BY 1`,
      );
      assert.deepEqual(rows, [
        { fn: 'account_delete', args: 'p_key bytea' },
        { fn: 'account_salt', args: '' },
        { fn: 'export_nudges', args: '' },
      ]);
      // what A gets of them is A's: no nudge of the decoy, A's own salt
      const got = await ctx.asUser(ctx.app, ctx.userA, c =>
        c.query<{ nudges: unknown; salt: Buffer }>('SELECT export_nudges() AS nudges, account_salt() AS salt'),
      );
      const own = await ctx.admin.query<{ salt: Buffer }>('SELECT salt FROM credentials WHERE user_id = $1', [ctx.userA]);
      assert.deepEqual(got.rows[0], { nudges: [], salt: own.rows[0].salt });
    },
  },
  {
    name: 'app_auth cannot run the purge jobs or the internal helpers, nor DELETE FROM users; app_anon cannot call account_delete',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        for (const [sql, fn] of [
          ['SELECT job_account_purge(now())', 'job_account_purge'],
          ['SELECT job_purge_idempotency(now())', 'job_purge_idempotency'],
          ['SELECT job_purge_auth(now())', 'job_purge_auth'],
          ['SELECT app._guild_depart(app.current_user_id())', '_guild_depart'],
          ['SELECT app._is_decoy(app.current_user_id())', '_is_decoy'],
        ]) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query(sql)),
            { code: '42501', messagePrefix: `permission denied for function ${fn}` },
          );
        }
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c => c.query('DELETE FROM users')),
          { code: '42501', messagePrefix: 'permission denied for table users' },
        );
        await ctx.expectPgError(
          ctx.asAnon(ctx.app, c => c.query('SELECT account_delete($1)', [randomBytes(32)])),
          { code: '42501', messagePrefix: 'permission denied for function account_delete' },
        );
      }),
  },
  {
    name: 'every purge job run as app_job with the clock far ahead leaves every decoy row as it was, and does purge a due user',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        // the decoys never carry a purge date; even with one they stay
        await ctx.admin.query(
          "UPDATE users SET deleted_at = '2026-01-01', purge_after = '2026-01-31' WHERE id = $1",
          [DECOY_1],
        );
        const before = await decoyRows(ctx.admin);
        const { rows: victim } = await ctx.admin.query<{ id: string }>(
          `INSERT INTO users (email, display_name, terms_accepted_at, deleted_at, purge_after)
           VALUES ($1, 'Sắp xóa', now(), now(), now()) RETURNING id`,
          [`victim-${randomBytes(6).toString('hex')}@example.com`],
        );
        try {
          const { rows } = await asJob(ctx.app, c =>
            c.query<{ accounts: number; keys: number; auth: number }>(
              'SELECT job_account_purge($1) AS accounts, job_purge_idempotency($1) AS keys, job_purge_auth($1) AS auth',
              [FAR],
            ),
          );
          assert.ok(rows[0].accounts >= 1, 'the purge purged nothing: the attack proves nothing');
          const gone = await ctx.admin.query('SELECT 1 FROM users WHERE id = $1', [victim[0].id]);
          assert.equal(gone.rowCount, 0);
          assert.deepEqual(await decoyRows(ctx.admin), before);
        } finally {
          await ctx.admin.query('UPDATE users SET deleted_at = NULL, purge_after = NULL WHERE id = $1', [DECOY_1]);
        }
      }),
  },
];
