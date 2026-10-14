// Seeds the exercise library from content/exercises.ts: moves by code, workouts by code (a
// workout keeps its id for good, so sessions keep pointing at it), and the steps of each workout
// by position, from 1. A step that a workout of the content no longer has is removed: the steps
// of a workout must add up to its duration. Idempotent: a second run rewrites no row.
import type { ClientBase } from 'pg';
import { MOVES, WORKOUTS } from '../../content/exercises.ts';

export async function seed(db: ClientBase): Promise<void> {
  await db.query(
    `INSERT INTO exercise_moves AS m (code, name, demo_code, steps, caution)
     SELECT x.code, x.name, x."demoCode", x.steps, x.caution
       FROM jsonb_to_recordset($1::jsonb) AS x (code text, name text, "demoCode" text, steps text[], caution text)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, demo_code = EXCLUDED.demo_code, steps = EXCLUDED.steps, caution = EXCLUDED.caution
      WHERE (m.name, m.demo_code, m.steps, m.caution)
            IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.demo_code, EXCLUDED.steps, EXCLUDED.caution)`,
    [JSON.stringify(MOVES)],
  );
  await db.query(
    `INSERT INTO exercise_items AS i (code, name, modality, duration_sec, space_needed, equipment, met_value,
                                      sets, archetypes)
     SELECT x.code, x.name, x.modality, x."durationSec", x."spaceNeeded", x.equipment, x."metValue", x.sets,
            x.archetypes
       FROM jsonb_to_recordset($1::jsonb) AS x (
         code text, name text, modality text, "durationSec" int, "spaceNeeded" text, equipment text[],
         "metValue" numeric, sets int, archetypes text[])
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, modality = EXCLUDED.modality, duration_sec = EXCLUDED.duration_sec,
       space_needed = EXCLUDED.space_needed, equipment = EXCLUDED.equipment, met_value = EXCLUDED.met_value,
       sets = EXCLUDED.sets, archetypes = EXCLUDED.archetypes
      WHERE (i.name, i.modality, i.duration_sec, i.space_needed, i.equipment, i.met_value, i.sets, i.archetypes)
            IS DISTINCT FROM
            (EXCLUDED.name, EXCLUDED.modality, EXCLUDED.duration_sec, EXCLUDED.space_needed, EXCLUDED.equipment,
             EXCLUDED.met_value, EXCLUDED.sets, EXCLUDED.archetypes)`,
    [JSON.stringify(WORKOUTS)],
  );
  const steps = WORKOUTS.flatMap(workout =>
    workout.steps.map((step, i) => ({ ...step, code: workout.code, position: i + 1 })),
  );
  await db.query(
    `WITH x AS (
       SELECT i.id AS item_id, x.position, x."moveCode", x.phase, x.seconds, x."repsText"
         FROM jsonb_to_recordset($1::jsonb) AS x (
           code text, position int, "moveCode" text, phase text, seconds int, "repsText" text)
         JOIN exercise_items i ON i.code = x.code
     ), removed AS (
       DELETE FROM exercise_item_steps s
        USING exercise_items i
        WHERE i.id = s.item_id AND i.code = ANY ($2::text[])
          AND NOT EXISTS (SELECT 1 FROM x WHERE x.item_id = s.item_id AND x.position = s.position)
     )
     INSERT INTO exercise_item_steps AS s (item_id, position, move_code, phase, seconds, reps_text)
     SELECT item_id, position, "moveCode", phase, seconds, "repsText" FROM x
     ON CONFLICT (item_id, position) DO UPDATE SET
       move_code = EXCLUDED.move_code, phase = EXCLUDED.phase, seconds = EXCLUDED.seconds,
       reps_text = EXCLUDED.reps_text
      WHERE (s.move_code, s.phase, s.seconds, s.reps_text)
            IS DISTINCT FROM (EXCLUDED.move_code, EXCLUDED.phase, EXCLUDED.seconds, EXCLUDED.reps_text)`,
    [JSON.stringify(steps), WORKOUTS.map(workout => workout.code)],
  );
}
