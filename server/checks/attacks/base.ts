// Gate 2, the attack cases of accounts, idempotency and profile (10, 11, 20, 21-*.sql), and the
// contract every file of this directory implements: `export const attacks: Attack[]`.
// api-check.test.ts runs every attack of every file here, after its generic checks.
//
// Rules for an attack:
//   * it acts as the application does: ctx.app (app_conn) through ctx.asUser / ctx.asAnon, one
//     request transaction per call. ctx.admin only arranges and reads back;
//   * it first asserts, through ctx.admin, that the row it attacks is there: an attack on a row
//     that does not exist always "passes";
//   * a refusal is pinned with ctx.expectPgError (SQLSTATE and the start of the message), a
//     silent one with the value or the row count; "it threw" proves nothing;
//   * a policy is probed with a statement that needs that policy only: an UPDATE or DELETE
//     without WHERE, rolled back, whose row count must be the rows the attacker owns. "0 rows
//     WHERE id = the decoy" is also what the SELECT policy alone answers;
//   * it leaves the decoy rows as it found them: wrap it in decoyUntouched.
//
// Exported for the other attack files: userDataTables, decoyRows, decoyUntouched.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import pg from 'pg';
import type { Pool } from 'pg';
import { calculatePrescription } from '../../../domain/energy.ts';
import type { ActivityLevel, Archetype, Sex } from '../../../domain/types.ts';
import { ageFrom } from '../../../domain/validation.ts';
import { lockProfile } from '../../src/routes/me.ts';
import type { asAnon, asUser, expectPgError } from '../../test/helpers.ts';

export type AttackCtx = {
  /** The pool of the application: app_conn. */
  app: Pool;
  /** Superuser: arranging and reading back only, never the attack itself. */
  admin: Pool;
  /** An onboarded user with a live session: the attacker. */
  userA: string;
  /** DECOY_1: the user whose rows are there to be found. */
  decoy: string;
  asUser: typeof asUser;
  asAnon: typeof asAnon;
  expectPgError: typeof expectPgError;
};
export type Attack = { name: string; run(ctx: AttackCtx): Promise<void> };

// The fixed values of server/sql/80-decoy-base.sql.
export const DECOY_1 = '00000000-0000-4000-8000-0000000000d1';
export const DECOY_2 = '00000000-0000-4000-8000-0000000000d2';
const DECOY_EMAIL = 'decoy-1@decoy.invalid';
const REVOKED_TOKEN_HASH = Buffer.alloc(32, 0xd1);
const USED_CODE_HASH = Buffer.alloc(32, 0xd2);
const STORED_KEY = '00000000-0000-4000-8000-0000000d1003';
const STORED_REQUEST_HASH = Buffer.alloc(32, 0xd3);

/** What the functions raise on purpose: MESSAGE is the error code of the API contract. */
const HM = 'HM000';

// Names below come from the catalog, read as the superuser: never from a request.
const q = pg.escapeIdentifier;

export type UserDataTable = {
  name: string;
  /** The WHERE clause that selects the rows of the table that lead to the user $1. */
  ofUser: string;
};

/**
 * The tables that hold user data, by their structure and not by what a file declared: users,
 * and every table of public with a foreign key to it, directly or through another such table.
 * A table reached by several keys (sender and receiver) counts a row for the user of any of them.
 */
export async function userDataTables(admin: Pool): Promise<UserDataTable[]> {
  const { rows: keys } = await admin.query<{
    child: string;
    parent: string;
    columns: string[];
    parentColumns: string[];
  }>(
    `SELECT child.relname::text AS child, parent.relname::text AS parent,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k (num, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num
                   ORDER BY k.ord) AS columns,
            ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k (num, ord)
                    JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num
                   ORDER BY k.ord) AS "parentColumns"
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
      WHERE c.contype = 'f'
        AND child.relnamespace = 'public'::regnamespace AND parent.relnamespace = 'public'::regnamespace
      ORDER BY child.relname, c.conname`,
  );
  // `seen` stops a chain that comes back to a table it already passed (a self-reference)
  const ofUser = (table: string, seen: string[]): string | null => {
    if (table === 'users') {
      return 'id = $1';
    }
    const paths = keys
      .filter(key => key.child === table && !seen.includes(key.parent))
      .flatMap(key => {
        const parent = ofUser(key.parent, [...seen, table]);
        return parent === null
          ? []
          : [
              `(${key.columns.map(q).join(', ')}) IN (SELECT ${key.parentColumns
                .map(q)
                .join(', ')} FROM public.${q(key.parent)} WHERE ${parent})`,
            ];
      });
    return paths.length > 0 ? paths.join(' OR ') : null;
  };
  return [...new Set(['users', ...keys.map(key => key.child)])]
    .sort()
    .flatMap(name => {
      const where = ofUser(name, []);
      return where === null ? [] : [{ name, ofUser: where }];
    });
}

/**
 * Every row of DECOY_1 in every table that holds user data (userDataTables), by table name, as
 * the superuser sees them. Fails when one of those tables holds no row of the decoy.
 */
export async function decoyRows(
  admin: Pool,
): Promise<Record<string, unknown[]>> {
  const tables = await userDataTables(admin);
  const { rows } = await admin.query<Record<string, unknown[] | null>>(
    `SELECT ${tables
      .map(
        ({ name, ofUser }) =>
          `(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.${q(
            name,
          )} t WHERE ${ofUser}) AS ${q(name)}`,
      )
      .join(', ')}`,
    [DECOY_1],
  );
  for (const { name } of tables) {
    assert.ok(rows[0][name], `no decoy row in ${name}: nothing to attack`);
  }
  return rows[0] as Record<string, unknown[]>;
}

/**
 * Runs the attack and requires every decoy row of the database to be, value for value, what it
 * was. Not for an attack whose intact outcome writes a row of the decoy (a nudge it receives).
 */
export async function decoyUntouched(
  ctx: AttackCtx,
  attack: () => Promise<void>,
): Promise<void> {
  const before = await decoyRows(ctx.admin);
  await attack();
  const after = await decoyRows(ctx.admin);
  const changed = Object.keys(before).filter(
    table => !isDeepStrictEqual(after[table], before[table]),
  );
  assert.deepEqual(
    changed,
    [],
    `the attack changed rows of the decoy in: ${changed.join(', ')}`,
  );
}

const ROLLED_BACK = new Error('rolled back on purpose');

const register = (ctx: AttackCtx, email: string) =>
  ctx.asAnon(ctx.app, c =>
    c.query('SELECT auth_register($1, $2, $3, $4, $5)', [
      email,
      'Kẻ lạ',
      randomBytes(16),
      randomBytes(32),
      randomBytes(32),
    ]),
  );

export const attacks: Attack[] = [
  {
    name: 'auth_register with the email of the decoy, in any spelling, is REGISTRATION_UNAVAILABLE',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        for (const email of [
          DECOY_EMAIL,
          DECOY_EMAIL.toUpperCase(),
          `  ${DECOY_EMAIL} `,
        ]) {
          await ctx.expectPgError(register(ctx, email), {
            code: HM,
            messagePrefix: 'REGISTRATION_UNAVAILABLE',
          });
        }
      }),
  },
  {
    name: 'auth_register refuses a look-alike of the email of the decoy that is not in normal form',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const fullwidthAt = DECOY_EMAIL.replace(
          '@',
          String.fromCodePoint(0xff20),
        );
        const decomposed = `mồi-${DECOY_EMAIL}`.normalize('NFD');
        assert.notEqual(decomposed, decomposed.normalize('NFC'));
        for (const email of [fullwidthAt, decomposed]) {
          await ctx.expectPgError(register(ctx, email), {
            code: HM,
            messagePrefix: 'VALIDATION_FAILED',
          });
        }
      }),
  },
  {
    name: 'auth_login with a wrong key answers null and opens no session',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const { rows } = await ctx.asAnon(ctx.app, c =>
          c.query<{ id: string | null }>(
            'SELECT auth_login($1, $2, $3) AS id',
            [DECOY_EMAIL, randomBytes(32), randomBytes(32)],
          ),
        );
        assert.deepEqual(rows, [{ id: null }]);
        // the null is the key speaking, not the lock of an email tried too often
        const attempts = await ctx.admin.query<{ count: number }>(
          'SELECT count FROM auth_throttle WHERE key = $1',
          [`login:${DECOY_EMAIL}`],
        );
        assert.equal(attempts.rows.length, 1);
        assert.ok(attempts.rows[0].count <= 5, 'the email is locked');
      }),
  },
  {
    name: 'auth_salt answers 16 bytes for an unknown email, the same on every call',
    async run(ctx) {
      const email = `nobody-${randomBytes(6).toString('hex')}@decoy.invalid`;
      const salt = () =>
        ctx.asAnon(ctx.app, c =>
          c.query<{ salt: Buffer }>('SELECT auth_salt($1) AS salt', [email]),
        );
      const first = (await salt()).rows[0].salt;
      assert.equal(first.length, 16);
      assert.deepEqual((await salt()).rows[0].salt, first);
    },
  },
  {
    name: 'auth_session with the revoked token hash of the decoy answers null',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        // revocation alone keeps it shut: the session has not expired
        const stored = await ctx.admin.query(
          `SELECT 1 FROM sessions
            WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NOT NULL AND expires_at > app.now()`,
          [DECOY_1, REVOKED_TOKEN_HASH],
        );
        assert.equal(stored.rowCount, 1, 'no revoked, unexpired decoy session');
        const { rows } = await ctx.asAnon(ctx.app, c =>
          c.query<{ id: string | null }>('SELECT auth_session($1) AS id', [
            REVOKED_TOKEN_HASH,
          ]),
        );
        assert.deepEqual(rows, [{ id: null }]);
      }),
  },
  {
    name: 'idempotency_begin with the key and request hash of the decoy claims a new key and serves no stored answer',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const stored = await ctx.admin.query(
          'SELECT 1 FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND request_hash = $3 AND status = 200',
          [DECOY_1, STORED_KEY, STORED_REQUEST_HASH],
        );
        assert.equal(stored.rowCount, 1, 'no stored decoy answer');
        const rows = await ctx.asUser(ctx.app, ctx.userA, async c => {
          const begun = await c.query(
            'SELECT same_request, status, response FROM idempotency_begin($1, $2)',
            [STORED_KEY, STORED_REQUEST_HASH],
          );
          await c.query('SELECT idempotency_release($1)', [STORED_KEY]);
          return begun.rows;
        });
        assert.deepEqual(rows, [
          { same_request: true, status: null, response: null },
        ]);
      }),
  },
  {
    name: 'profile_add_biometrics and a change of archetype by A write rows of A and none of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const own = () =>
          ctx.admin.query<{
            snapshots: number;
            target: string;
            archetype: Archetype;
          }>(
            `SELECT (SELECT count(*)::int FROM biometric_snapshots WHERE user_id = $1) AS snapshots,
                    (SELECT calorie_target::text FROM prescriptions WHERE user_id = $1) AS target,
                    (SELECT archetype FROM users WHERE id = $1) AS archetype`,
            [ctx.userA],
          );
        const before = (await own()).rows[0];
        // past the 14-day cooldown: the change of archetype really writes users
        await ctx.admin.query(
          "UPDATE users SET archetype_set_at = app.now() - interval '15 days' WHERE id = $1",
          [ctx.userA],
        );
        const next: Archetype =
          before.archetype === 'TANKER' ? 'SUPPORTER' : 'TANKER';
        // as the routes do: lock, read, compute in Node, write
        const target = await ctx.asUser(ctx.app, ctx.userA, async c => {
          await lockProfile(c);
          const { rows } = await c.query<{
            timezone: string;
            archetype: Archetype;
            height_cm: string;
            weight_kg: string;
            birth_year: number;
            sex: Sex;
            activity_level: ActivityLevel;
            now: Date;
          }>(
            `SELECT u.timezone, u.archetype, s.height_cm, s.weight_kg, s.birth_year, s.sex, s.activity_level,
                    app.now() AS now
               FROM users u JOIN biometric_snapshots s ON s.user_id = u.id
              WHERE u.id = app.current_user_id()
              ORDER BY s.recorded_at DESC LIMIT 1`,
          );
          const me = rows[0];
          const weightKg = Number(me.weight_kg) + 1;
          const numbers = {
            heightCm: Number(me.height_cm),
            weightKg,
            ageYears: ageFrom(me.birth_year, me.now.getTime(), me.timezone),
            sex: me.sex,
            activityLevel: me.activity_level,
          };
          const prescription = calculatePrescription({
            ...numbers,
            archetype: me.archetype,
          });
          await c.query(
            'SELECT profile_add_biometrics($1, $2, $3, $4, $5, $6)',
            [
              me.height_cm,
              weightKg,
              me.birth_year,
              me.sex,
              me.activity_level,
              JSON.stringify(prescription),
            ],
          );
          const changed = calculatePrescription({
            ...numbers,
            archetype: next,
          });
          await c.query('SELECT profile_set_archetype($1, $2)', [
            next,
            JSON.stringify(changed),
          ]);
          return changed.calorieTarget;
        });
        // the calls did write: otherwise "the decoy is untouched" says nothing
        assert.deepEqual((await own()).rows[0], {
          snapshots: before.snapshots + 1,
          target: String(target),
          archetype: next,
        });
      }),
  },
  {
    name: 'an UPDATE of users or of user_settings by A, without WHERE, changes the row of A only',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const own = await ctx.admin.query<{ name: string }>(
          'SELECT display_name AS name FROM users WHERE id = $1',
          [ctx.userA],
        );
        // Neither statement reads a column: the UPDATE policy alone decides which rows it reaches.
        let counts: (number | null)[] = [];
        await ctx
          .asUser(ctx.app, ctx.userA, async c => {
            counts = [
              (
                await c.query('UPDATE users SET display_name = $1', [
                  own.rows[0].name,
                ])
              ).rowCount,
              (
                await c.query(
                  'UPDATE user_settings SET hide_streak = false, nudges_enabled = false',
                )
              ).rowCount,
            ];
            throw ROLLED_BACK;
          })
          .catch(e => {
            if (e !== ROLLED_BACK) {
              throw e;
            }
          });
        assert.deepEqual(
          counts,
          [1, 1],
          `rows changed by an UPDATE without WHERE (users, user_settings): ${counts}; user A owns one of each`,
        );
      }),
  },
  {
    name: 'auth_reset_confirm with the used, expired code of the decoy answers false',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const stored = await ctx.admin.query(
          `SELECT 1 FROM reset_codes
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NOT NULL AND expires_at < app.now()`,
          [DECOY_1, USED_CODE_HASH],
        );
        assert.equal(stored.rowCount, 1, 'no used, expired decoy reset code');
        const { rows } = await ctx.asAnon(ctx.app, c =>
          c.query<{ ok: boolean }>(
            'SELECT auth_reset_confirm($1, $2, $3, $4) AS ok',
            [DECOY_EMAIL, USED_CODE_HASH, randomBytes(16), randomBytes(32)],
          ),
        );
        assert.deepEqual(
          rows,
          [{ ok: false }],
          'auth_reset_confirm accepted the used, expired code of the decoy',
        );
      }),
  },
  {
    name: 'a time zone outside the table timezones is refused on the column A may write',
    async run(ctx) {
      const zone = () =>
        ctx.admin.query('SELECT timezone FROM users WHERE id = $1', [
          ctx.userA,
        ]);
      const before = (await zone()).rows;
      // CET is a zone PostgreSQL knows: it is refused for not being a row of timezones
      for (const timezone of ['Mars/Olympus_Mons', 'CET', '+07:00']) {
        await ctx.expectPgError(
          ctx.asUser(ctx.app, ctx.userA, c =>
            c.query('UPDATE users SET timezone = $2 WHERE id = $1', [
              ctx.userA,
              timezone,
            ]),
          ),
          {
            code: '23503',
            messagePrefix:
              'insert or update on table "users" violates foreign key constraint "users_timezone_fkey"',
          },
        );
      }
      assert.deepEqual((await zone()).rows, before);
    },
  },
];
