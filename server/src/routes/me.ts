// Profile routes: onboarding, the own profile, new biometrics, the archetype, the targets.
//
// Each write validates with domain/validation.ts, computes the prescription in Node and hands it
// to a profile_* function of 21-profile.sql, which checks everything again and writes. Every
// refusal here is THROWN (AppError, or HM000 raised by the function): nothing a refused request
// wrote may stay, so the request transaction rolls back. Order of refusals: wrong fields, then
// the age, then the archetype (the onboarding screens send each to its own step).
//
// A handler that reads the profile, computes from it and then writes takes the caller's row lock
// BEFORE its first read (lockProfile): two requests of one user would otherwise both compute
// from the state before either wrote, and the later write would store targets that belong to
// numbers no longer in effect.
import type { PoolClient } from 'pg';
import type { Biometrics } from '../../../domain/contract/core.ts';
import {
  ARCHETYPE_FACTOR,
  calculatePrescription,
} from '../../../domain/energy.ts';
import { findBannedTerms } from '../../../domain/language.ts';
import { isValidTimeZone } from '../../../domain/logicalDate.ts';
import type { Archetype } from '../../../domain/types.ts';
import {
  LIMITS,
  ageFrom,
  allowedArchetypes,
  isDisplayName,
  validateBiometrics,
} from '../../../domain/validation.ts';
import type {
  BiometricsInput,
  FieldError,
} from '../../../domain/validation.ts';
import type { Ctx, Route } from '../app.ts';
import { AppError } from '../errors.ts';
import { buildMe, buildPrescription } from '../readModels/me.ts';
import { members } from './auth.ts';

const ARCHETYPES = Object.keys(ARCHETYPE_FACTOR);

/**
 * Locks the caller's own users row until the request transaction ends: the lock the profile_*
 * functions take, taken early. Call it before the first read of anything a prescription is
 * computed from; every later read of this request then sees what the previous request of the
 * same user committed, and no other request of that user gets between the read and the write.
 *
 * FOR NO KEY UPDATE, never FOR UPDATE: every idempotent request holds a key-share lock on this
 * row (the foreign key of its idempotency_keys row), which FOR UPDATE conflicts with: two
 * requests of one user would then wait for each other until PostgreSQL ends one as a deadlock.
 * As app_auth the statement reaches the own row only (the policy), so it locks nobody else.
 */
export async function lockProfile(db: PoolClient): Promise<void> {
  await db.query(
    'SELECT 1 FROM users WHERE id = app.current_user_id() FOR NO KEY UPDATE',
  );
}

function refuse(problems: FieldError[]): void {
  if (problems.length > 0) {
    throw new AppError('VALIDATION_FAILED', { fields: problems });
  }
}

/**
 * A time zone `users.timezone` can hold and both sides read alike: JavaScript knows it, it is an
 * Area/City name or UTC, and it is a row of `timezones` (a name missing there would otherwise
 * surface as the foreign key failing: a 500). Null with the problem noted.
 */
async function timeZoneOf(
  db: PoolClient,
  value: unknown,
  problems: FieldError[],
): Promise<string | null> {
  if (typeof value !== 'string' || value === '') {
    problems.push({ field: 'timezone', rule: 'required' });
    return null;
  }
  const named =
    isValidTimeZone(value) && (value.includes('/') || value === 'UTC');
  const known =
    named &&
    (await db.query('SELECT 1 FROM timezones WHERE name = $1', [value]))
      .rowCount === 1;
  if (!known) {
    problems.push({ field: 'timezone', rule: 'format' });
    return null;
  }
  return value;
}

/** Null for a member that is absent (allowed only when not `required`) or wrong, the latter noted. */
function archetypeOf(
  value: unknown,
  problems: FieldError[],
  required: boolean,
): Archetype | null {
  if (value === undefined || value === null) {
    if (required) {
      problems.push({ field: 'archetype', rule: 'required' });
    }
    return null;
  }
  if (!ARCHETYPES.includes(value as string)) {
    problems.push({ field: 'archetype', rule: 'enum' });
    return null;
  }
  return value as Archetype;
}

/**
 * The five biometric members by the rules of the domain, with the problems of the members
 * checked before them: every wrong field in one VALIDATION_FAILED, else AGE_NOT_ALLOWED, else
 * the numbers and the age they give.
 */
function biometricsOf(
  input: Record<string, unknown>,
  nowMs: number,
  timeZone: string,
  problems: FieldError[],
): Biometrics & { ageYears: number } {
  const checked = validateBiometrics(
    input as unknown as BiometricsInput,
    nowMs,
    timeZone,
  );
  if (!checked.ok && checked.code === 'VALIDATION_FAILED') {
    problems.push(...checked.fields);
  }
  refuse(problems);
  if (!checked.ok) {
    throw new AppError('AGE_NOT_ALLOWED');
  }
  const { heightCm, weightKg, birthYear, sex, activityLevel } =
    input as unknown as Biometrics;
  return {
    heightCm,
    weightKg,
    birthYear,
    sex,
    activityLevel,
    ageYears: checked.ageYears,
  };
}

function notAllowed(allowed: Archetype[]): AppError {
  return new AppError('ARCHETYPE_NOT_ALLOWED', { allowed });
}

/** The caller's own row: row level security shows no other. */
async function account(db: PoolClient): Promise<{
  timezone: string;
  archetype: Archetype | null;
  onboarded: boolean;
}> {
  const { rows } = await db.query<{
    timezone: string;
    archetype: Archetype | null;
    onboarded: boolean;
  }>(
    `SELECT timezone, archetype, onboarded_at IS NOT NULL AS onboarded
       FROM users WHERE id = app.current_user_id()`,
  );
  return rows[0];
}

async function onboard(ctx: Ctx) {
  const { db, body, now } = ctx;
  await lockProfile(db);
  // An onboarded user gets the current Me whatever was sent: nothing is judged, nothing changes.
  if (!(await account(db)).onboarded) {
    const input = members(body);
    const problems: FieldError[] = [];
    const timezone = await timeZoneOf(db, input.timezone, problems);
    const archetype = archetypeOf(input.archetype, problems, true);
    // with an unusable zone the request is refused anyway: UTC only lets the other fields be judged
    const bio = biometricsOf(input, now.getTime(), timezone ?? 'UTC', problems);
    if (timezone === null || archetype === null) {
      throw new Error('unreachable: a missing member was reported above');
    }
    const allowed = allowedArchetypes(bio.heightCm, bio.weightKg);
    if (!allowed.includes(archetype)) {
      throw notAllowed(allowed);
    }
    await db.query('SELECT profile_onboard($1, $2, $3, $4, $5, $6, $7, $8)', [
      timezone,
      archetype,
      bio.heightCm,
      bio.weightKg,
      bio.birthYear,
      bio.sex,
      bio.activityLevel,
      JSON.stringify(calculatePrescription({ ...bio, archetype })),
    ]);
  }
  return { status: 200, body: await buildMe(ctx) };
}

async function addBiometrics(ctx: Ctx) {
  const { db, body, now } = ctx;
  await lockProfile(db);
  const { timezone, archetype: current } = await account(db);
  const input = members(body);
  const problems: FieldError[] = [];
  const wanted = archetypeOf(input.archetype, problems, false);
  const bio = biometricsOf(input, now.getTime(), timezone, problems);

  // The rule of profile_add_biometrics, to compute the targets for the archetype it will keep:
  // the one in effect while the new numbers allow it (an archetype sent along is then not
  // applied: that would be a way around the cooldown), else the replacement that was sent.
  const allowed = allowedArchetypes(bio.heightCm, bio.weightKg);
  if (wanted !== null && !allowed.includes(wanted)) {
    throw notAllowed(allowed);
  }
  const archetype =
    current !== null && allowed.includes(current) ? current : wanted;
  if (archetype === null) {
    throw notAllowed(allowed);
  }
  await db.query('SELECT profile_add_biometrics($1, $2, $3, $4, $5, $6, $7)', [
    bio.heightCm,
    bio.weightKg,
    bio.birthYear,
    bio.sex,
    bio.activityLevel,
    JSON.stringify(calculatePrescription({ ...bio, archetype })),
    wanted,
  ]);
  return { status: 200, body: await buildPrescription(ctx) };
}

async function changeArchetype(ctx: Ctx) {
  const { db, body, now } = ctx;
  const problems: FieldError[] = [];
  const archetype = archetypeOf(members(body).archetype, problems, true);
  refuse(problems);
  if (archetype === null) {
    throw new Error('unreachable: a missing member was reported above');
  }
  await lockProfile(db);
  const { timezone } = await account(db);
  const { biometrics } = await buildPrescription(ctx);
  const allowed = allowedArchetypes(biometrics.heightCm, biometrics.weightKg);
  if (!allowed.includes(archetype)) {
    throw notAllowed(allowed);
  }
  // The function raises ARCHETYPE_COOLDOWN (details.availableAt) inside the 14 days, and checks
  // the snapshot again: its age rule answers for a user who has grown out of the range.
  await db.query('SELECT profile_set_archetype($1, $2)', [
    archetype,
    JSON.stringify(
      calculatePrescription({
        ...biometrics,
        ageYears: ageFrom(biometrics.birthYear, now.getTime(), timezone),
        archetype,
      }),
    ),
  ]);
  return { status: 200, body: await buildMe(ctx) };
}

/** Trimmed; 1 to 40 code points as the database counts; nothing a reader cannot see. */
function displayNameOf(value: unknown, problems: FieldError[]): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  let rule: FieldError['rule'] | null = null;
  if (name === '') {
    rule = 'required';
  } else if ([...name].length > LIMITS.displayName.max) {
    rule = 'max';
  } else if (!isDisplayName(name)) {
    rule = 'format';
  }
  if (rule !== null) {
    problems.push({ field: 'displayName', rule });
    return null;
  }
  return name;
}

async function patchMe(ctx: Ctx) {
  const { db, body } = ctx;
  const input = members(body);
  const problems: FieldError[] = [];
  // a member that is absent stays as it is; one that is present must be valid
  const displayName =
    input.displayName === undefined
      ? null
      : displayNameOf(input.displayName, problems);
  const timezone =
    input.timezone === undefined
      ? null
      : await timeZoneOf(db, input.timezone, problems);
  refuse(problems);
  // judged last, as at registration: only a name that is otherwise fine is called not allowed
  if (displayName !== null && findBannedTerms(displayName).length > 0) {
    throw new AppError('NAME_NOT_ALLOWED');
  }
  try {
    // a plain UPDATE of the two columns the owner of the row may write; the policy picks the row
    await db.query(
      `UPDATE users SET display_name = coalesce($1, display_name), timezone = coalesce($2, timezone)
        WHERE id = app.current_user_id()`,
      [displayName, timezone],
    );
  } catch (thrown) {
    // The rule of a display name is also a constraint. Where it refuses what passed above, the
    // answer is still a refusal of the name; rethrown, so the transaction rolls back.
    const { code, constraint } = thrown as {
      code?: string;
      constraint?: string;
    };
    if (code === '23514' && constraint === 'users_display_name_check') {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ field: 'displayName', rule: 'format' }],
      });
    }
    throw thrown;
  }
  return { status: 200, body: await buildMe(ctx) };
}

const routes: Route[] = [
  {
    method: 'POST',
    path: '/onboarding',
    auth: 'session',
    idempotent: true,
    handler: onboard,
  },
  {
    method: 'GET',
    path: '/me',
    auth: 'session',
    handler: async ctx => ({ status: 200, body: await buildMe(ctx) }),
  },
  {
    method: 'PATCH',
    path: '/me',
    auth: 'user',
    idempotent: true,
    handler: patchMe,
  },
  {
    method: 'POST',
    path: '/me/biometrics',
    auth: 'user',
    idempotent: true,
    handler: addBiometrics,
  },
  {
    method: 'PATCH',
    path: '/me/archetype',
    auth: 'user',
    idempotent: true,
    handler: changeArchetype,
  },
  {
    method: 'GET',
    path: '/me/prescription',
    auth: 'user',
    handler: async ctx => ({
      status: 200,
      body: await buildPrescription(ctx),
    }),
  },
];

export default routes;
