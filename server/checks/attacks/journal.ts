// Gate 2, the attack cases of the journal and the tickets (60-journal.sql): the decoy's entry
// asked for over HTTP and read as app_auth, its id reused as the id of a new entry, direct writes
// of the ticket tables, and the internal and job functions called as app_auth. Ownership and the
// privileges themselves are what stop each one: A has no entry of its own to confuse with it.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.ts';
import { BASE_PATH } from '../../src/http.ts';
import { encryptJournal } from '../../src/journalCrypto.ts';
import { createLogger } from '../../src/log.ts';
import { TEST_JOURNAL_KEY, newOnboardedUser } from '../../test/http.ts';
import type { TestDb } from '../../test/testdb.ts';
import { DECOY_1, decoyRows, decoyUntouched } from './base.ts';
import type { Attack, AttackCtx } from './base.ts';

// The fixed value of server/sql/89-decoy-journal.sql.
const DECOY_ENTRY = '00000000-0000-4000-8000-0000000d1601';

/** decoyUntouched, after proving the decoy entry is there to be attacked. */
async function entryUntouched(ctx: AttackCtx, attack: () => Promise<void>): Promise<void> {
  const rows = await decoyRows(ctx.admin);
  assert.ok((rows.journal_entries as { id: string }[]).some(row => row.id === DECOY_ENTRY), 'no decoy journal entry');
  await decoyUntouched(ctx, attack);
}

export const attacks: Attack[] = [
  {
    name: 'GET /journal/{decoy entry id} over HTTP as an onboarded user: 404 NOT_FOUND, nothing of it in the answer',
    run: ctx =>
      entryUntouched(ctx, async () => {
        // newOnboardedUser only needs the app pool: a fresh attacker with a live token
        const attacker = await newOnboardedUser({ app: ctx.app } as TestDb);
        const server = createApp({
          pool: ctx.app,
          mailer: async () => {},
          journalKey: TEST_JOURNAL_KEY,
          rateLimits: false,
          log: createLogger(() => {}),
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${BASE_PATH}`;
          const response = await fetch(`${base}/journal/${DECOY_ENTRY}`, {
            headers: { authorization: `Bearer ${attacker.token}` },
          });
          const body = (await response.json()) as { error: { code: string } };
          assert.equal(response.status, 404);
          assert.equal(body.error.code, 'NOT_FOUND');
          const list = await fetch(`${base}/journal`, { headers: { authorization: `Bearer ${attacker.token}` } });
          assert.deepEqual(await list.json(), { entries: [], nextBefore: null });
        } finally {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
      }),
  },
  {
    name: "app_auth reads no decoy journal entry, writes none, and journal_create with the decoy entry's id is IDEMPOTENCY_KEY_REUSED",
    run: ctx =>
      entryUntouched(ctx, async () => {
        const { rows } = await ctx.asUser(ctx.app, ctx.userA, c =>
          c.query<{ n: number; decoy: number }>(
            `SELECT count(*)::int AS n, count(*) FILTER (WHERE user_id = $1)::int AS decoy FROM journal_entries`,
            [DECOY_1],
          ),
        );
        assert.deepEqual(rows[0], { n: 0, decoy: 0 });
        for (const sql of ["UPDATE journal_entries SET quote_code = 'Q002'", 'DELETE FROM journal_entries']) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query(sql)),
            { code: '42501', messagePrefix: 'permission denied for table journal_entries' },
          );
        }
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('SELECT journal_create($1, $2)', [
              DECOY_ENTRY,
              encryptJournal(TEST_JOURNAL_KEY, ctx.userA, DECOY_ENTRY, 'chữ của A'),
            ]),
          ),
          { code: 'HM000', messagePrefix: 'IDEMPOTENCY_KEY_REUSED' },
        );
      }),
  },
  {
    name: 'app_auth writes no freeze_tickets or ticket_grant_weeks row and cannot call job_ticket_grant or the internal ticket functions',
    run: ctx =>
      entryUntouched(ctx, async () => {
        for (const [sql, table] of [
          ["INSERT INTO freeze_tickets (user_id, grant_week) VALUES (app.current_user_id(), '2027-03-08')", 'freeze_tickets'],
          ['UPDATE freeze_tickets SET used_at = NULL, used_for_date = NULL', 'freeze_tickets'],
          ["INSERT INTO ticket_grant_weeks (user_id, week_start, granted) VALUES (app.current_user_id(), '2027-03-08', true)", 'ticket_grant_weeks'],
          ['DELETE FROM ticket_grant_weeks', 'ticket_grant_weeks'],
          ["INSERT INTO quotes (code, text) VALUES ('X', 'x')", 'quotes'],
        ]) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query(sql)),
            { code: '42501', messagePrefix: `permission denied for table ${table}` },
          );
        }
        for (const [sql, fn] of [
          ['SELECT job_ticket_grant(now())', 'job_ticket_grant'],
          ["SELECT app._ticket_grant_check(app.current_user_id(), '2027-03-08')", '_ticket_grant_check'],
          ["SELECT app._ticket_block_reason(app.current_user_id(), '2027-03-08')", '_ticket_block_reason'],
          ["SELECT app._ticket_needed(app.current_user_id(), '2027-03-08')", '_ticket_needed'],
          ['SELECT app._ticket_cap(app.current_user_id())', '_ticket_cap'],
        ]) {
          await ctx.expectPgError(
            ctx.asUser(ctx.app, ctx.userA, c => c.query(sql)),
            { code: '42501', messagePrefix: `permission denied for function ${fn}` },
          );
        }
      }),
  },
];
