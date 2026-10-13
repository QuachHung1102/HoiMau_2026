// GET and PATCH /settings. The row is the user's own (created at onboarding) and is updated by
// a plain UPDATE of the six columns app_auth may write; row level security picks the row.
import type { PoolClient } from 'pg';
import type { Settings } from '../../../domain/contract/core.ts';
import { INGREDIENT_TAGS } from '../../../domain/types.ts';
import type { FieldError } from '../../../domain/validation.ts';
import type { Route } from '../app.ts';
import { AppError } from '../errors.ts';

const REMINDER_WINDOWS: readonly unknown[] = ['MORNING', 'NOON', 'EVENING'];
const MOTIONS: readonly unknown[] = ['SYSTEM', 'REDUCED', 'FULL'];

const COLUMNS = `nudges_enabled AS "nudgesEnabled", reminder_enabled AS "reminderEnabled",
  reminder_window AS "reminderWindow", hide_streak AS "hideStreak", sound_enabled AS "soundEnabled",
  motion, excluded_meal_tags AS "excludedMealTags"`;

async function one(
  db: PoolClient,
  sql: string,
  values: unknown[] = [],
): Promise<Settings> {
  const { rows } = await db.query<Settings>(sql, values);
  if (rows.length !== 1) {
    throw new Error('an onboarded user without a user_settings row');
  }
  return rows[0];
}

/**
 * The patch as the six column values, null for a member that is absent. A member that is
 * present must be valid, and every wrong one is named. `soundEnabled` is known and read-only
 * (the build has no audio): sending it at all is refused, unlike a member the server does not
 * know, which is ignored.
 */
function checkPatch(body: unknown): unknown[] {
  const input: Record<string, unknown> =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const problems: FieldError[] = [];
  const given = (
    field: string,
    rule: FieldError['rule'],
    valid: (value: unknown) => boolean,
  ) => {
    const value = input[field];
    if (value !== undefined && !valid(value)) {
      problems.push({ field, rule });
    }
    return value ?? null;
  };
  const flag = (field: string) =>
    given(field, 'format', value => typeof value === 'boolean');

  const nudgesEnabled = flag('nudgesEnabled');
  const reminderEnabled = flag('reminderEnabled');
  const reminderWindow = given('reminderWindow', 'enum', value =>
    REMINDER_WINDOWS.includes(value),
  );
  const hideStreak = flag('hideStreak');
  given('soundEnabled', 'format', () => false);
  const motion = given('motion', 'enum', value => MOTIONS.includes(value));

  // once each, in the order of INGREDIENT_TAGS
  let tags: string[] | null = null;
  const sent = input.excludedMealTags;
  if (sent !== undefined) {
    if (!Array.isArray(sent)) {
      problems.push({ field: 'excludedMealTags', rule: 'format' });
    } else if (
      !sent.every(tag => (INGREDIENT_TAGS as readonly unknown[]).includes(tag))
    ) {
      problems.push({ field: 'excludedMealTags', rule: 'enum' });
    } else {
      tags = INGREDIENT_TAGS.filter(tag => sent.includes(tag));
    }
  }
  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', { fields: problems });
  }
  return [
    nudgesEnabled,
    reminderEnabled,
    reminderWindow,
    hideStreak,
    motion,
    tags,
  ];
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/settings',
    auth: 'user',
    handler: async ({ db }) => ({
      status: 200,
      body: await one(
        db,
        `SELECT ${COLUMNS} FROM user_settings WHERE user_id = app.current_user_id()`,
      ),
    }),
  },
  {
    method: 'PATCH',
    path: '/settings',
    auth: 'user',
    idempotent: true,
    handler: async ({ db, body }) => ({
      status: 200,
      body: await one(
        db,
        `UPDATE user_settings SET
           nudges_enabled = coalesce($1, nudges_enabled),
           reminder_enabled = coalesce($2, reminder_enabled),
           reminder_window = coalesce($3, reminder_window),
           hide_streak = coalesce($4, hide_streak),
           motion = coalesce($5, motion),
           excluded_meal_tags = coalesce($6, excluded_meal_tags)
         WHERE user_id = app.current_user_id()
         RETURNING ${COLUMNS}`,
        checkPatch(body),
      ),
    }),
  },
];

export default routes;
