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
//   * it leaves the decoy rows as it found them.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
const STORED_KEY = '00000000-0000-4000-8000-0000000d1003';
const STORED_REQUEST_HASH = Buffer.alloc(32, 0xd3);

/** What the functions raise on purpose: MESSAGE is the error code of the API contract. */
const HM = 'HM000';

/** Every row of the decoy in the tables of 10, 11 and 21, as the superuser sees them. */
async function decoyRows(admin: Pool): Promise<unknown> {
  const { rows } = await admin.query(
    `SELECT (SELECT jsonb_agg(to_jsonb(u)) FROM users u WHERE u.id = $1 OR lower(u.email) = $2) AS users,
            (SELECT jsonb_agg(to_jsonb(c)) FROM credentials c WHERE c.user_id = $1) AS credentials,
            (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM sessions s WHERE s.user_id = $1) AS sessions,
            (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM reset_codes r WHERE r.user_id = $1) AS reset_codes,
            (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.key) FROM idempotency_keys k WHERE k.user_id = $1) AS keys,
            (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM biometric_snapshots b WHERE b.user_id = $1) AS snapshots,
            (SELECT jsonb_agg(to_jsonb(p)) FROM prescriptions p WHERE p.user_id = $1) AS prescriptions,
            (SELECT jsonb_agg(to_jsonb(t)) FROM user_settings t WHERE t.user_id = $1) AS settings`,
    [DECOY_1, DECOY_EMAIL],
  );
  for (const [table, found] of Object.entries(rows[0])) {
    assert.ok(found, `no decoy row in ${table}: nothing to attack`);
  }
  return rows[0];
}

/** Runs the attack and requires the decoy rows to be, value for value, what they were. */
async function decoyUntouched(
  ctx: AttackCtx,
  attack: () => Promise<void>,
): Promise<void> {
  const before = await decoyRows(ctx.admin);
  await attack();
  assert.deepEqual(await decoyRows(ctx.admin), before);
}

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
    name: 'profile_add_biometrics and profile_set_archetype of A write rows of A and none of the decoy',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const own = () =>
          ctx.admin.query<{ snapshots: number; target: string }>(
            `SELECT (SELECT count(*)::int FROM biometric_snapshots WHERE user_id = $1) AS snapshots,
                    (SELECT calorie_target::text FROM prescriptions WHERE user_id = $1) AS target`,
            [ctx.userA],
          );
        const before = (await own()).rows[0];
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
          const prescription = calculatePrescription({
            heightCm: Number(me.height_cm),
            weightKg,
            ageYears: ageFrom(me.birth_year, me.now.getTime(), me.timezone),
            sex: me.sex,
            activityLevel: me.activity_level,
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
          // the archetype in effect: accepted inside the cooldown, replaces the prescription
          const again = {
            ...prescription,
            calorieTarget: prescription.calorieTarget + 1,
          };
          await c.query('SELECT profile_set_archetype($1, $2)', [
            me.archetype,
            JSON.stringify(again),
          ]);
          return again.calorieTarget;
        });
        // the calls did write: otherwise "the decoy is untouched" says nothing
        assert.deepEqual((await own()).rows[0], {
          snapshots: before.snapshots + 1,
          target: String(target),
        });
      }),
  },
  {
    name: 'UPDATE of users and of user_settings aimed at the decoy changes 0 rows',
    run: ctx =>
      decoyUntouched(ctx, async () => {
        const counts = await ctx.asUser(ctx.app, ctx.userA, async c => [
          (
            await c.query('UPDATE users SET display_name = $2 WHERE id = $1', [
              ctx.decoy,
              'Đã bị chiếm',
            ])
          ).rowCount,
          (
            await c.query(
              'UPDATE user_settings SET hide_streak = NOT hide_streak, nudges_enabled = false WHERE user_id = $1',
              [ctx.decoy],
            )
          ).rowCount,
          // and the same statements do reach the own row
          (
            await c.query(
              'UPDATE users SET display_name = display_name WHERE id = $1',
              [ctx.userA],
            )
          ).rowCount,
          (
            await c.query(
              'UPDATE user_settings SET hide_streak = hide_streak WHERE user_id = $1',
              [ctx.userA],
            )
          ).rowCount,
        ]);
        assert.deepEqual(
          counts,
          [0, 0, 1, 1],
          `rows changed (users of the decoy, user_settings of the decoy, own users, own user_settings): ${counts}`,
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
