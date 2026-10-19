-- The two STORY quests for real: calories logged by hand, the workout library and a recorded
-- workout session. Re-runnable.
--
-- NUTRITION_TARGET completes the first time the day's calories lie inside the band the user is
-- shown (AR-12) and never un-completes; a log is never taken back (there is no undo and no
-- negative amount). WORKOUT_MAIN pays at most its xp_reward per logical day (AR-11): a session
-- under half of the workout's duration earns its share, the first one of at least half earns
-- the rest and the coins and completes the quest, a session after that earns nothing.
--
-- Rules for whoever edits this file (those of 30-day.sql hold here too):
--   * every write goes through app._open_log, and the locks are taken in the ONE order: users,
--     daily log, quest completion, progression state. The nutrition log or the session is
--     inserted after them;
--   * never FOR UPDATE on a row another table references: FOR NO KEY UPDATE;
--   * the band of the latch is app._calorie_band and nothing else: it must stay equal, for
--     every integer target, to calorieWindow of domain/energy.ts (a test compares all of them);
--   * what a session earned is read from the ledger, not from a column;
--   * a refusal is raised with SQLSTATE HM000; time is app.now() only.

-- Content, written by the seeder from server/content/exercises.ts, by code.
CREATE TABLE IF NOT EXISTS exercise_moves (
  code text PRIMARY KEY,
  name text NOT NULL,
  demo_code text,
  steps text[] NOT NULL CHECK (array_ndims(steps) = 1 AND cardinality(steps) = 3),
  caution text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now()
);

CREATE TABLE IF NOT EXISTS exercise_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('RESISTANCE', 'CARDIO', 'HIIT', 'MOBILITY', 'BREATHING')),
  duration_sec int NOT NULL CHECK (duration_sec IN (300, 900, 1800, 2700)),
  space_needed text NOT NULL CHECK (space_needed IN ('DESK_SIDE', 'ROOM', 'GYM', 'OUTDOOR')),
  -- what the workout REQUIRES; empty = nothing
  equipment text[] NOT NULL CHECK (equipment <@ ARRAY['tham', 'ta-tay', 'day-khang-luc']),
  met_value numeric NOT NULL CHECK (met_value > 0),
  -- how many times the MAIN steps repeat
  sets int NOT NULL CHECK (sets >= 1),
  archetypes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now()
);

CREATE TABLE IF NOT EXISTS exercise_item_steps (
  item_id uuid NOT NULL REFERENCES exercise_items (id) ON DELETE CASCADE,
  -- from 1, the order of the content file
  position int NOT NULL CHECK (position >= 1),
  move_code text NOT NULL REFERENCES exercise_moves (code),
  phase text NOT NULL CHECK (phase IN ('WARMUP', 'MAIN', 'COOLDOWN')),
  seconds int NOT NULL CHECK (seconds > 0),
  reps_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  PRIMARY KEY (item_id, position)
);

-- id = the action id (the Idempotency-Key of the request). A manual entry has neither slot nor
-- meal; the log of a planned meal (Task 33) has both, and that task adds the foreign key of
-- meal_id once its table exists.
CREATE TABLE IF NOT EXISTS nutrition_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  daily_log_id uuid NOT NULL,
  meal_slot text CHECK (meal_slot IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')),
  meal_id uuid,
  label text CHECK (label <> '' AND char_length(label) <= 60),
  kcal numeric NOT NULL CHECK (kcal BETWEEN 1 AND 5000),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT nutrition_logs_slot_meal_check CHECK ((meal_slot IS NULL) = (meal_id IS NULL)),
  CONSTRAINT nutrition_logs_log_user_fkey FOREIGN KEY (daily_log_id, user_id)
    REFERENCES daily_logs (id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS nutrition_logs_log_idx ON nutrition_logs (daily_log_id);
-- the purge's cascade (61-privacy.sql) finds the rows of a user, and of a (log, user) pair, by
-- these; a test asserts every key of the cascade has an index that leads with its columns
CREATE INDEX IF NOT EXISTS nutrition_logs_user_log_idx ON nutrition_logs (user_id, daily_log_id);

-- id = the action id. modality and duration_sec are those of the workout when it was done.
-- completed: the session reached half of the duration, whatever it earned. xp_awarded and
-- coin_awarded: what this session was granted (the ledger holds the rows).
CREATE TABLE IF NOT EXISTS workout_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  daily_log_id uuid NOT NULL,
  exercise_item_id uuid NOT NULL REFERENCES exercise_items (id),
  modality text NOT NULL CHECK (modality IN ('RESISTANCE', 'CARDIO', 'HIIT', 'MOBILITY', 'BREATHING')),
  duration_sec int NOT NULL CHECK (duration_sec > 0),
  elapsed_sec int NOT NULL CHECK (elapsed_sec > 0),
  completed boolean NOT NULL,
  xp_awarded int NOT NULL CHECK (xp_awarded >= 0),
  coin_awarded int NOT NULL DEFAULT 0 CHECK (coin_awarded >= 0),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT workout_sessions_elapsed_max_check CHECK (elapsed_sec <= 2 * duration_sec),
  CONSTRAINT workout_sessions_completed_check CHECK (completed = (elapsed_sec * 2 >= duration_sec)),
  CONSTRAINT workout_sessions_log_user_fkey FOREIGN KEY (daily_log_id, user_id)
    REFERENCES daily_logs (id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workout_sessions_log_idx ON workout_sessions (daily_log_id);
CREATE INDEX IF NOT EXISTS workout_sessions_user_log_idx ON workout_sessions (user_id, daily_log_id);

ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON nutrition_logs;
CREATE POLICY own_select ON nutrition_logs FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON workout_sessions;
CREATE POLICY own_select ON workout_sessions FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

REVOKE ALL ON exercise_moves, exercise_items, exercise_item_steps, nutrition_logs, workout_sessions
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON exercise_moves, exercise_items, exercise_item_steps, nutrition_logs, workout_sessions
  TO app_auth;

SELECT meta.expect_table('exercise_moves', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('exercise_items', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('exercise_item_steps', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('nutrition_logs', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('nutrition_logs', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('workout_sessions', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('workout_sessions', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role, and none is SECURITY DEFINER.

-- The calories that complete NUTRITION_TARGET for a calorie target (AR-12), ends included:
-- 0.9 and 1.1 of the target, each rounded half up, in exact numeric arithmetic. For an integer
-- target that is Math.round(0.9 * t) and Math.round(1.1 * t), the band of calorieWindow.
CREATE OR REPLACE FUNCTION app._calorie_band(p_target numeric) RETURNS numrange
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$ SELECT numrange(floor((9 * p_target + 5) / 10), floor((11 * p_target + 5) / 10), '[]') $$;

-- Adds p_kcal to the calories of the log p_log, whose lock the caller holds (app._open_log), and
-- completes NUTRITION_TARGET of that log, once, the first time the total lies inside the band:
-- its reward with reason QUEST_COMPLETE, ref NUTRITION_TARGET:<logical_date>. A total that
-- leaves the band later changes nothing.
--   the result of app._grant + {reason, ref, logicalDate, completed, storyAllDone}
-- completed: this call completed the quest. storyAllDone: this call made the day's story whole.
CREATE OR REPLACE FUNCTION app._add_calories(p_log uuid, p_kcal numeric) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref text;
  v_grant jsonb;
  v_completed boolean := false;
  v_story boolean := false;
  l daily_logs;
  q quests;
  c quest_completions;
BEGIN
  UPDATE daily_logs SET calories_in = calories_in + p_kcal WHERE id = p_log RETURNING * INTO l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app._add_calories: no such daily log';
  END IF;
  v_ref := 'NUTRITION_TARGET:' || to_char(l.logical_date, 'YYYY-MM-DD');
  SELECT x.* INTO q
    FROM quests x
   WHERE x.code = 'NUTRITION_TARGET' AND x.is_active
     AND (SELECT u.archetype FROM users u WHERE u.id = l.user_id) = ANY (x.archetypes);
  IF FOUND THEN
    INSERT INTO quest_completions (user_id, daily_log_id, quest_id) VALUES (l.user_id, l.id, q.id)
    ON CONFLICT (daily_log_id, quest_id) DO NOTHING;
    SELECT k.* INTO c
      FROM quest_completions k WHERE k.daily_log_id = l.id AND k.quest_id = q.id FOR NO KEY UPDATE;
    IF c.completed_at IS NULL
       AND l.calories_in <@ (SELECT app._calorie_band(p.calorie_target)
                               FROM prescriptions p WHERE p.user_id = l.user_id) THEN
      UPDATE quest_completions SET progress = q.target_count, completed_at = app.now() WHERE id = c.id;
      v_completed := true;
      v_story := app._story_check(l.id);
      v_grant := app._grant(l.user_id, q.xp_reward, q.coin_reward, 'QUEST_COMPLETE', v_ref);
    END IF;
  END IF;
  RETURN coalesce(v_grant, app._grant(l.user_id, 0, 0, 'QUEST_COMPLETE', v_ref)) || jsonb_build_object(
    'reason', 'QUEST_COMPLETE', 'ref', v_ref, 'logicalDate', l.logical_date,
    'completed', v_completed, 'storyAllDone', v_story);
END $$;

REVOKE ALL ON FUNCTION app._calorie_band(numeric), app._add_calories(uuid, numeric)
  FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._calorie_band(numeric)', 'invoker', '{}');
SELECT meta.expect_function('app._add_calories(uuid, numeric)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The two functions the server calls. The caller is app.current_user_id(); neither takes a user
-- id or a reward. Each returns the result of app._grant (a grant of nothing when nothing was
-- earned) plus reason and ref of the ledger rows it may have written, logicalDate, and its own
-- members.

-- A manual calorie entry on the day p_occurred_at falls on: p_kcal from 1 to 5000, p_label at
-- most 60 characters or null.
--   + {completed, storyAllDone}: see app._add_calories
-- p_action_id becomes the id of the log. A log with that id that the caller owns makes the call
-- a no-op that answers a grant of nothing; one that somebody else owns is
-- IDEMPOTENCY_KEY_REUSED. Then, in this order: VALIDATION_FAILED, OCCURRED_AT_INVALID,
-- DAY_CLOSED.
CREATE OR REPLACE FUNCTION nutrition_log_manual(
  p_action_id uuid, p_kcal numeric, p_label text, p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_at timestamptz;
  v_fields jsonb;
  v_result jsonb;
  n nutrition_logs;
  l daily_logs;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'nutrition_log_manual: the action id is required';
  END IF;
  PERFORM 1 FROM users u
   WHERE u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  SELECT x.* INTO n FROM nutrition_logs x WHERE x.id = p_action_id;
  IF FOUND THEN
    IF n.user_id <> v_user THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    RETURN (SELECT app._grant(v_user, 0, 0, 'QUEST_COMPLETE', k.ref) || jsonb_build_object(
                     'reason', 'QUEST_COMPLETE', 'ref', k.ref, 'logicalDate', d.logical_date,
                     'completed', false, 'storyAllDone', false)
              FROM daily_logs d,
                   LATERAL (SELECT 'NUTRITION_TARGET:' || to_char(d.logical_date, 'YYYY-MM-DD') AS ref) k
             WHERE d.id = n.daily_log_id);
  END IF;

  SELECT jsonb_agg(jsonb_build_object('field', f.field, 'rule', f.rule) ORDER BY f.ord) INTO v_fields
    FROM (VALUES
      (1, 'kcal', CASE WHEN p_kcal IS NULL THEN 'required'
                       WHEN p_kcal < 1 THEN 'min'
                       WHEN NOT p_kcal <= 5000 THEN 'max' END),
      (2, 'label', CASE WHEN char_length(p_label) > 60 THEN 'max' END)
    ) AS f (ord, field, rule)
   WHERE f.rule IS NOT NULL;
  IF v_fields IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = jsonb_build_object('fields', v_fields)::text;
  END IF;

  v_at := app._occurred_at(p_occurred_at);
  l := app._open_log(v_user, v_at);
  v_result := app._add_calories(l.id, p_kcal);
  INSERT INTO nutrition_logs (id, user_id, daily_log_id, label, kcal, occurred_at)
  VALUES (p_action_id, v_user, l.id, nullif(p_label, ''), p_kcal, v_at)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    -- somebody else made a log with this id since the look above (the caller's own are serialised)
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  RETURN v_result;
END $$;

-- A session of the workout p_exercise_item_id that lasted p_elapsed_sec, on the day
-- p_occurred_at falls on. The session keeps the workout's modality and duration.
--   + {completed, questCompleted, storyAllDone, xpAwarded, coinAwarded, elapsedSec, durationSec}
-- completed: the session reached half of the duration. questCompleted: this call completed
-- WORKOUT_MAIN. xpAwarded, coinAwarded: what the session earned (AR-11). With given = the XP the
-- quest has paid on that day (the WORKOUT_PARTIAL rows of the day's sessions and the
-- QUEST_COMPLETE row), while the quest is open:
--   * at least half: xp_reward - given and coin_reward, reason QUEST_COMPLETE, ref
--     WORKOUT_MAIN:<logical_date>, and the quest is completed;
--   * less: least(floor(xp_reward * elapsed / duration), xp_reward - given), no coins, reason
--     WORKOUT_PARTIAL, ref = the session id.
-- Once the quest is completed a session earns nothing; it is recorded all the same.
-- p_action_id becomes the id of the session. A session with that id that the caller owns makes
-- the call a no-op that answers what that session earned, with a grant of nothing; one that
-- somebody else owns is IDEMPOTENCY_KEY_REUSED. Then, in this order: NOT_FOUND (no such
-- workout), VALIDATION_FAILED (elapsedSec outside 1 .. 2 x duration), OCCURRED_AT_INVALID,
-- DAY_CLOSED.
CREATE OR REPLACE FUNCTION workout_complete(
  p_action_id uuid, p_exercise_item_id uuid, p_elapsed_sec int, p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_archetype text;
  v_at timestamptz;
  v_rule text;
  v_ref text;
  v_given int;
  v_xp int := 0;
  v_coin int := 0;
  v_half boolean;
  v_quest_completed boolean := false;
  v_story boolean := false;
  v_grant jsonb;
  s workout_sessions;
  i exercise_items;
  l daily_logs;
  q quests;
  c quest_completions;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'workout_complete: the action id is required';
  END IF;
  SELECT u.archetype INTO v_archetype
    FROM users u
   WHERE u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  SELECT x.* INTO s FROM workout_sessions x WHERE x.id = p_action_id;
  IF FOUND THEN
    IF s.user_id <> v_user THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    RETURN app._grant(v_user, 0, 0, 'WORKOUT_PARTIAL', s.id::text) || jsonb_build_object(
      'reason', 'WORKOUT_PARTIAL', 'ref', s.id,
      'logicalDate', (SELECT d.logical_date FROM daily_logs d WHERE d.id = s.daily_log_id),
      'completed', s.completed, 'questCompleted', false, 'storyAllDone', false,
      'xpAwarded', s.xp_awarded, 'coinAwarded', s.coin_awarded,
      'elapsedSec', s.elapsed_sec, 'durationSec', s.duration_sec);
  END IF;

  SELECT x.* INTO i FROM exercise_items x WHERE x.id = p_exercise_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  v_rule := CASE WHEN p_elapsed_sec IS NULL THEN 'required'
                 WHEN p_elapsed_sec < 1 THEN 'min'
                 WHEN p_elapsed_sec > 2 * i.duration_sec THEN 'max' END;
  IF v_rule IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = jsonb_build_object('fields', jsonb_build_array(
        jsonb_build_object('field', 'elapsedSec', 'rule', v_rule)))::text;
  END IF;

  v_at := app._occurred_at(p_occurred_at);
  l := app._open_log(v_user, v_at);
  v_half := p_elapsed_sec * 2 >= i.duration_sec;
  v_ref := 'WORKOUT_MAIN:' || to_char(l.logical_date, 'YYYY-MM-DD');
  SELECT x.* INTO q
    FROM quests x WHERE x.code = 'WORKOUT_MAIN' AND x.is_active AND v_archetype = ANY (x.archetypes);
  IF FOUND THEN
    INSERT INTO quest_completions (user_id, daily_log_id, quest_id) VALUES (v_user, l.id, q.id)
    ON CONFLICT (daily_log_id, quest_id) DO NOTHING;
    SELECT k.* INTO c
      FROM quest_completions k WHERE k.daily_log_id = l.id AND k.quest_id = q.id FOR NO KEY UPDATE;
    IF c.completed_at IS NULL THEN
      SELECT coalesce(sum(x.amount), 0) INTO v_given
        FROM xp_ledger x
       WHERE x.user_id = v_user
         AND ((x.reason = 'QUEST_COMPLETE' AND x.ref_id = v_ref)
           OR (x.reason = 'WORKOUT_PARTIAL'
               AND x.ref_id IN (SELECT w.id::text FROM workout_sessions w WHERE w.daily_log_id = l.id)));
      IF v_half THEN
        v_xp := greatest(q.xp_reward - v_given, 0);
        v_coin := q.coin_reward;
        UPDATE quest_completions SET progress = q.target_count, completed_at = app.now() WHERE id = c.id;
        v_quest_completed := true;
        v_story := app._story_check(l.id);
        v_grant := app._grant(v_user, v_xp, v_coin, 'QUEST_COMPLETE', v_ref);
      ELSE
        v_xp := greatest(least(floor(q.xp_reward::numeric * p_elapsed_sec / i.duration_sec)::int,
                               q.xp_reward - v_given), 0);
        v_grant := app._grant(v_user, v_xp, 0, 'WORKOUT_PARTIAL', p_action_id::text);
      END IF;
    END IF;
  END IF;

  INSERT INTO workout_sessions (id, user_id, daily_log_id, exercise_item_id, modality, duration_sec,
                                elapsed_sec, completed, xp_awarded, coin_awarded, occurred_at)
  VALUES (p_action_id, v_user, l.id, i.id, i.modality, i.duration_sec, p_elapsed_sec, v_half, v_xp, v_coin, v_at)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    -- somebody else made a session with this id since the look above
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  RETURN coalesce(v_grant, app._grant(v_user, 0, 0, 'WORKOUT_PARTIAL', p_action_id::text))
    || CASE WHEN v_quest_completed THEN jsonb_build_object('reason', 'QUEST_COMPLETE', 'ref', v_ref)
            ELSE jsonb_build_object('reason', 'WORKOUT_PARTIAL', 'ref', p_action_id) END
    || jsonb_build_object(
      'logicalDate', l.logical_date,
      'completed', v_half, 'questCompleted', v_quest_completed, 'storyAllDone', v_story,
      'xpAwarded', v_xp, 'coinAwarded', v_coin,
      'elapsedSec', p_elapsed_sec, 'durationSec', i.duration_sec);
END $$;

REVOKE ALL ON FUNCTION
  nutrition_log_manual(uuid, numeric, text, timestamptz), workout_complete(uuid, uuid, int, timestamptz)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  nutrition_log_manual(uuid, numeric, text, timestamptz), workout_complete(uuid, uuid, int, timestamptz)
  TO app_auth;
SELECT meta.expect_function('nutrition_log_manual(uuid, numeric, text, timestamptz)', 'definer', '{app_auth}');
SELECT meta.expect_function('workout_complete(uuid, uuid, int, timestamptz)', 'definer', '{app_auth}');
