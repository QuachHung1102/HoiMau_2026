// Workout routes: the catalog, one workout, and a recorded session.
//
// The two reads run as app_auth over the content tables; the kcal estimate uses the caller's
// latest weight, read in the same statement and never handed to Node. The session goes to
// workout_complete (31-story.sql), which decides the day and the XP (AR-11). Every refusal is
// THROWN: a refused session leaves no row and frees its key.
import type { GameEvent } from '../../../domain/contract/common.ts';
import type {
  WorkoutDetail,
  WorkoutResult,
  WorkoutSummary,
} from '../../../domain/contract/content.ts';
import type { SpaceRequirement } from '../../../domain/types.ts';
import type { Equipment } from '../../content/types.ts';
import type { Ctx, Route, RouteResponse } from '../app.ts';
import { AppError } from '../errors.ts';
import { idempotencyKey } from '../idempotency.ts';
import { buildDay } from '../readModels/day.ts';
import { buildDelta, logGrants } from '../readModels/delta.ts';
import type { Grant } from '../readModels/delta.ts';
import { objectBody, occurredAtOf, refuse } from './day.ts';

/** The `duration` filter, in minutes, as it is written in the query. */
const DURATIONS: Record<string, number> = { '5': 300, '15': 900, '30': 1800, '45': 2700 };
const SPACES: Record<SpaceRequirement, true> = {
  DESK_SIDE: true,
  ROOM: true,
  GYM: true,
  OUTDOOR: true,
};
const EQUIPMENT: Record<Equipment, true> = {
  tham: true,
  'ta-tay': true,
  'day-khang-luc': true,
};
const INT_MAX = 2 ** 31 - 1;

// The summary columns of a workout for the caller: recommended when the caller's archetype is
// among the workout's, kcal = MET x the latest weight x hours, rounded to the nearest 10.
const SUMMARY = `
  i.id, i.code, i.name, i.modality, i.duration_sec AS "durationSec", i.space_needed AS "spaceNeeded",
  i.equipment, me.archetype = ANY (i.archetypes) AS recommended,
  (round(i.met_value * me.weight_kg * i.duration_sec / 36000) * 10)::int AS "kcalEstimate"`;
const ME = `
  (SELECT u.archetype, b.weight_kg
     FROM users u
     JOIN LATERAL (SELECT s.weight_kg FROM biometric_snapshots s
                    WHERE s.user_id = u.id ORDER BY s.recorded_at DESC LIMIT 1) b ON true
    WHERE u.id = app.current_user_id()) me`;

// $1 duration in seconds, $2 space, $3 the equipment owned: null = no filter of that kind. A
// workout matches the equipment when it needs nothing outside what is owned.
const CATALOG = `
  SELECT ${SUMMARY}
    FROM exercise_items i, ${ME}
   WHERE ($1::int IS NULL OR i.duration_sec = $1)
     AND ($2::text IS NULL OR i.space_needed = $2)
     AND ($3::text[] IS NULL OR i.equipment <@ $3)
   ORDER BY recommended DESC, i.name, i.code`;

const DETAIL = `
  SELECT ${SUMMARY}, i.sets,
         (SELECT jsonb_agg(jsonb_build_object(
                   'position', s.position, 'phase', s.phase, 'seconds', s.seconds, 'repsText', s.reps_text,
                   'move', jsonb_build_object('code', m.code, 'name', m.name, 'demoCode', m.demo_code,
                                              'steps', to_jsonb(m.steps), 'caution', m.caution))
                   ORDER BY s.position)
            FROM exercise_item_steps s JOIN exercise_moves m ON m.code = s.move_code
           WHERE s.item_id = i.id) AS steps
    FROM exercise_items i, ${ME}
   WHERE i.id = $1`;

function oneOf<T extends string>(
  ctx: Ctx,
  name: string,
  allowed: Record<T, unknown>,
): T | null {
  const value = ctx.query.get(name);
  if (value === null) {
    return null;
  }
  if (!Object.hasOwn(allowed, value)) {
    throw refuse(name, 'enum');
  }
  return value as T;
}

async function catalog(ctx: Ctx): Promise<RouteResponse> {
  const duration = oneOf(ctx, 'duration', DURATIONS);
  const space = oneOf(ctx, 'space', SPACES);
  const owned = ctx.query.get('equipment');
  // present but empty: the user owns nothing (contract), which is not "no filter"
  const equipment = owned === null ? null : owned === '' ? [] : owned.split(',');
  if (equipment?.some(code => !Object.hasOwn(EQUIPMENT, code))) {
    throw refuse('equipment', 'enum');
  }
  const { rows } = await ctx.db.query<WorkoutSummary>(CATALOG, [
    duration === null ? null : DURATIONS[duration],
    space,
    equipment,
  ]);
  return { status: 200, body: { items: rows } };
}

async function item(ctx: Ctx): Promise<RouteResponse> {
  const id = idempotencyKey(ctx.params.id);
  if (id === null) {
    throw refuse('id', 'format');
  }
  const { rows } = await ctx.db.query<WorkoutDetail>(DETAIL, [id]);
  if (rows.length === 0) {
    throw new AppError('NOT_FOUND');
  }
  return { status: 200, body: rows[0] };
}

type SessionResult = Grant & {
  completed: boolean;
  questCompleted: boolean;
  storyAllDone: boolean;
  xpAwarded: number;
  coinAwarded: number;
  elapsedSec: number;
  durationSec: number;
};

async function complete(ctx: Ctx): Promise<RouteResponse> {
  const body = objectBody(ctx.body);
  const fields = [];
  const itemId =
    typeof body.exerciseItemId === 'string' ? idempotencyKey(body.exerciseItemId) : null;
  if (itemId === null) {
    fields.push({
      field: 'exerciseItemId',
      rule: body.exerciseItemId === undefined ? 'required' : 'format',
    } as const);
  }
  const { elapsedSec } = body;
  if (elapsedSec === undefined) {
    fields.push({ field: 'elapsedSec', rule: 'required' } as const);
  } else if (typeof elapsedSec !== 'number' || !Number.isInteger(elapsedSec)) {
    fields.push({ field: 'elapsedSec', rule: 'format' } as const);
  } else if (elapsedSec < 1) {
    fields.push({ field: 'elapsedSec', rule: 'min' } as const);
  } else if (elapsedSec > INT_MAX) {
    // the bound of the workout is the function's to judge; this one keeps the number an int
    fields.push({ field: 'elapsedSec', rule: 'max' } as const);
  }
  if (fields.length > 0) {
    throw new AppError('VALIDATION_FAILED', { fields });
  }
  const { rows } = await ctx.db.query<{ result: SessionResult }>(
    'SELECT workout_complete($1, $2, $3, $4) AS result',
    [ctx.actionId, itemId, elapsedSec, occurredAtOf(body)],
  );
  const { result } = rows[0];
  const events: GameEvent[] = [
    ...(result.questCompleted ? [{ type: 'QUEST_COMPLETED', questCode: 'WORKOUT_MAIN' } as const] : []),
    ...(result.storyAllDone ? [{ type: 'STORY_ALL_DONE' } as const] : []),
  ];
  logGrants(ctx, [result]);
  const answer: WorkoutResult = {
    completed: result.completed,
    xpAwarded: result.xpAwarded,
    coinAwarded: result.coinAwarded,
    elapsedSec: result.elapsedSec,
    durationSec: result.durationSec,
    day: await buildDay(ctx),
    delta: buildDelta([result], events),
  };
  return { status: 200, body: answer };
}

const routes: Route[] = [
  { method: 'GET', path: '/workout/catalog', auth: 'user', handler: catalog },
  { method: 'GET', path: '/workout/items/:id', auth: 'user', handler: item },
  {
    method: 'POST',
    path: '/workout/complete',
    auth: 'user',
    idempotent: true,
    handler: complete,
  },
];

export default routes;
