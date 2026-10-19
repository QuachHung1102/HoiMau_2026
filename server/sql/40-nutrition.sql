-- The meal library and the daily meal plan: four planned meals a day, a limited number of swaps
-- per slot, and the log of a planned meal. Re-runnable.
--
-- The plan is CHOSEN in Node (rankMeals and pickMeal of domain/mealPlan.ts) and STORED here; a
-- swap's candidates are ranked in Node too. What SQL guarantees whoever calls it: a plan only for
-- the caller's own open day of today and never overwritten, a meal of the right slot, the swap
-- limit, nothing swapped or logged twice.
--
-- Rules for whoever edits this file (those of 30-day.sql and 31-story.sql hold here too):
--   * the locks are taken in the ONE order: users, daily log, plan row, quest completion,
--     progression state (the last two inside app._add_calories); the nutrition log is inserted
--     after them;
--   * never FOR UPDATE on a row another table references: FOR NO KEY UPDATE;
--   * a refusal is raised with SQLSTATE HM000; time is app.now() only.

-- Content, written by the seeder from server/content/meals.ts, by code. A meal keeps its id for
-- good: plans and logs point at it.
CREATE TABLE IF NOT EXISTS meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  -- the range of nutrition_logs.kcal: a planned meal can always be logged
  kcal numeric NOT NULL CONSTRAINT meal_plans_kcal_check CHECK (kcal BETWEEN 1 AND 5000),
  protein_g numeric NOT NULL CHECK (protein_g >= 0),
  carbs_g numeric NOT NULL CHECK (carbs_g >= 0),
  fat_g numeric NOT NULL CHECK (fat_g >= 0),
  meal_slot text NOT NULL CHECK (meal_slot IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')),
  tags text[] NOT NULL,
  portion_text text NOT NULL,
  description text NOT NULL,
  image_key text,
  created_at timestamptz NOT NULL DEFAULT app.now()
);

-- One row per user, logical date and slot. meal_id null: every meal of the slot was excluded
-- when the plan was made. shown_meal_ids: the meals this slot showed before, never offered again
-- that day. logged_action_id: the nutrition log of this planned meal, once it is logged.
CREATE TABLE IF NOT EXISTS daily_meal_plans (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  logical_date date NOT NULL,
  meal_slot text NOT NULL CHECK (meal_slot IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')),
  meal_id uuid REFERENCES meal_plans (id),
  swaps_used int NOT NULL DEFAULT 0 CHECK (swaps_used >= 0),
  shown_meal_ids uuid[] NOT NULL DEFAULT '{}',
  macro_warning boolean NOT NULL,
  logged_action_id uuid REFERENCES nutrition_logs (id),
  created_at timestamptz NOT NULL DEFAULT app.now(),
  PRIMARY KEY (user_id, logical_date, meal_slot)
);
-- each nutrition log the purge's cascade deletes checks this key: without the index, a scan of
-- every user's plans per log
CREATE INDEX IF NOT EXISTS daily_meal_plans_logged_action_idx ON daily_meal_plans (logged_action_id);

-- The meal of a planned-meal log (31-story.sql left this key to the task that made the table),
-- added once; and the kcal range on a table made before it was 1 to 5000.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'nutrition_logs'::regclass AND conname = 'nutrition_logs_meal_id_fkey') THEN
    ALTER TABLE nutrition_logs ADD CONSTRAINT nutrition_logs_meal_id_fkey
      FOREIGN KEY (meal_id) REFERENCES meal_plans (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'meal_plans'::regclass AND conname = 'meal_plans_kcal_check'
                    AND pg_get_constraintdef(oid) LIKE '%5000%') THEN
    ALTER TABLE meal_plans DROP CONSTRAINT IF EXISTS meal_plans_kcal_check;
    ALTER TABLE meal_plans ADD CONSTRAINT meal_plans_kcal_check CHECK (kcal BETWEEN 1 AND 5000);
  END IF;
END $$;

ALTER TABLE daily_meal_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_select ON daily_meal_plans;
CREATE POLICY own_select ON daily_meal_plans FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

REVOKE ALL ON meal_plans, daily_meal_plans FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON meal_plans, daily_meal_plans TO app_auth;

SELECT meta.expect_table('meal_plans', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('daily_meal_plans', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('daily_meal_plans', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helper: EXECUTE for no role, not SECURITY DEFINER.

-- The caller's today (the logical date of app.now() in the caller's zone), with the user's row
-- locked: ONBOARDING_REQUIRED for a caller who is not a live, onboarded user, DAY_CLOSED when
-- today is not open (at or before last_closed_date, or before the first day).
CREATE OR REPLACE FUNCTION app._open_today(p_user uuid) RETURNS date
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_first date;
  v_closed date;
BEGIN
  SELECT app.logical_date(app.now(), u.timezone) INTO v_today
    FROM users u
   WHERE u.id = p_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT s.onboard_date, s.last_closed_date INTO v_first, v_closed
    FROM progression_state s WHERE s.user_id = p_user;
  IF v_today < v_first OR v_today <= v_closed THEN
    RAISE EXCEPTION 'DAY_CLOSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  RETURN v_today;
END $$;

REVOKE ALL ON FUNCTION app._open_today(uuid) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._open_today(uuid)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The three functions the server calls. The caller is app.current_user_id(); none takes a user
-- id or an amount.

-- Stores the plan the server chose for the caller's today. p_slots: a JSON array of
-- {mealSlot, mealId (a meal of that slot, or null), macroWarning (boolean)}. Only for today
-- (an earlier date is DAY_CLOSED, a later one OCCURRED_AT_INVALID) and only while today is open;
-- VALIDATION_FAILED (slots, format) for anything else in p_slots. A slot that already has a row
-- keeps it: two first reads racing end with one plan, the first one stored.
CREATE OR REPLACE FUNCTION nutrition_plan_save(p_logical_date date, p_slots jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_today date := app._open_today(v_user);
BEGIN
  IF p_logical_date IS NULL OR p_logical_date < v_today THEN
    RAISE EXCEPTION 'DAY_CLOSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF p_logical_date > v_today THEN
    RAISE EXCEPTION 'OCCURRED_AT_INVALID' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF jsonb_typeof(p_slots) IS DISTINCT FROM 'array' OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(p_slots) e
         LEFT JOIN meal_plans m ON m.id::text = e ->> 'mealId'
        WHERE jsonb_typeof(e) <> 'object'
           OR coalesce(e ->> 'mealSlot', '') NOT IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')
           OR jsonb_typeof(e -> 'macroWarning') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(e -> 'mealId') IS NULL
           OR (jsonb_typeof(e -> 'mealId') <> 'null'
               AND (m.id IS NULL OR m.meal_slot <> e ->> 'mealSlot'))) THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"slots","rule":"format"}]}';
  END IF;
  INSERT INTO daily_meal_plans (user_id, logical_date, meal_slot, meal_id, macro_warning)
  SELECT v_user, v_today, e ->> 'mealSlot', m.id, (e ->> 'macroWarning')::boolean
    FROM jsonb_array_elements(p_slots) e
    LEFT JOIN meal_plans m ON m.id::text = e ->> 'mealId'
   ORDER BY e ->> 'mealSlot'
  ON CONFLICT (user_id, logical_date, meal_slot) DO NOTHING;
END $$;

-- Puts the meal p_meal_id into the slot p_meal_slot of the caller's today. In this order:
-- DAY_CLOSED (today is not open), PLAN_NOT_FOUND (no plan row for the slot), MEAL_ALREADY_LOGGED,
-- SWAP_LIMIT_REACHED (swaps_used has reached 3, or 5 with the perk MEAL_SWAP_PLUS),
-- SWAP_CANDIDATE_INVALID (no meal of that slot, or one the slot shows or has shown today). The
-- old meal joins shown_meal_ids. macro_warning becomes what rankMeals would say of the new meal:
-- true when its kcal lies outside ±30 % of the slot's share of the calorie target (SLOT_SHARE of
-- domain/mealPlan.ts). That the meal is among the server's ranked candidates is the route's
-- check. p_action_id names no row: a replay is the idempotency layer's.
CREATE OR REPLACE FUNCTION nutrition_swap(p_meal_slot text, p_meal_id uuid, p_action_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_today date;
  v_allowed int;
  v_target numeric;
  r daily_meal_plans;
  m meal_plans;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'nutrition_swap: the action id is required';
  END IF;
  v_today := app._open_today(v_user);
  SELECT x.* INTO r
    FROM daily_meal_plans x
   WHERE x.user_id = v_user AND x.logical_date = v_today AND x.meal_slot = p_meal_slot
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF r.logged_action_id IS NOT NULL THEN
    RAISE EXCEPTION 'MEAL_ALREADY_LOGGED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  v_allowed := CASE WHEN EXISTS (SELECT 1 FROM perk_unlocks k
                                  WHERE k.user_id = v_user AND k.perk_code = 'MEAL_SWAP_PLUS')
                    THEN 5 ELSE 3 END;
  IF r.swaps_used >= v_allowed THEN
    RAISE EXCEPTION 'SWAP_LIMIT_REACHED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT x.* INTO m FROM meal_plans x WHERE x.id = p_meal_id AND x.meal_slot = p_meal_slot;
  IF NOT FOUND OR m.id = r.meal_id OR m.id = ANY (r.shown_meal_ids) THEN
    RAISE EXCEPTION 'SWAP_CANDIDATE_INVALID' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT p.calorie_target * CASE p_meal_slot WHEN 'BREAKFAST' THEN 0.25 WHEN 'LUNCH' THEN 0.35
                                             WHEN 'DINNER' THEN 0.30 ELSE 0.10 END
    INTO v_target
    FROM prescriptions p WHERE p.user_id = v_user;
  UPDATE daily_meal_plans
     SET meal_id = m.id,
         shown_meal_ids = shown_meal_ids || CASE WHEN r.meal_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[r.meal_id] END,
         swaps_used = swaps_used + 1,
         macro_warning = abs(m.kcal - v_target) > 0.3 * v_target
   WHERE user_id = r.user_id AND logical_date = r.logical_date AND meal_slot = r.meal_slot;
END $$;

-- Logs the planned meal of the slot p_meal_slot on the day p_occurred_at falls on: a nutrition
-- log with the meal's kcal, slot, id and name (the label the day's history shows), the plan row
-- marked logged, and app._add_calories (the NUTRITION_TARGET latch).
--   the result of app._add_calories: app._grant + {reason, ref, logicalDate, completed, storyAllDone}
-- p_action_id becomes the id of the log. A log with that id that the caller owns makes the call
-- a no-op that answers a grant of nothing; one that somebody else owns is
-- IDEMPOTENCY_KEY_REUSED. Then, in this order: VALIDATION_FAILED (mealSlot), OCCURRED_AT_INVALID,
-- DAY_CLOSED, PLAN_NOT_FOUND (no plan row, or no meal in it), MEAL_ALREADY_LOGGED.
CREATE OR REPLACE FUNCTION nutrition_log_slot(
  p_action_id uuid, p_meal_slot text, p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_at timestamptz;
  v_result jsonb;
  n nutrition_logs;
  l daily_logs;
  r daily_meal_plans;
  m meal_plans;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'nutrition_log_slot: the action id is required';
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

  IF p_meal_slot IS NULL OR p_meal_slot NOT IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK') THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"mealSlot","rule":"enum"}]}';
  END IF;

  v_at := app._occurred_at(p_occurred_at);
  l := app._open_log(v_user, v_at);
  SELECT x.* INTO r
    FROM daily_meal_plans x
   WHERE x.user_id = v_user AND x.logical_date = l.logical_date AND x.meal_slot = p_meal_slot
     FOR NO KEY UPDATE;
  IF NOT FOUND OR r.meal_id IS NULL THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF r.logged_action_id IS NOT NULL THEN
    RAISE EXCEPTION 'MEAL_ALREADY_LOGGED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT x.* INTO m FROM meal_plans x WHERE x.id = r.meal_id;

  v_result := app._add_calories(l.id, m.kcal);
  INSERT INTO nutrition_logs (id, user_id, daily_log_id, meal_slot, meal_id, label, kcal, occurred_at)
  VALUES (p_action_id, v_user, l.id, r.meal_slot, m.id, left(m.name, 60), m.kcal, v_at)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    -- somebody else made a log with this id since the look above (the caller's own are serialised)
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  UPDATE daily_meal_plans SET logged_action_id = p_action_id
   WHERE user_id = r.user_id AND logical_date = r.logical_date AND meal_slot = r.meal_slot;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION
  nutrition_plan_save(date, jsonb), nutrition_swap(text, uuid, uuid),
  nutrition_log_slot(uuid, text, timestamptz)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  nutrition_plan_save(date, jsonb), nutrition_swap(text, uuid, uuid),
  nutrition_log_slot(uuid, text, timestamptz)
  TO app_auth;
SELECT meta.expect_function('nutrition_plan_save(date, jsonb)', 'definer', '{app_auth}');
SELECT meta.expect_function('nutrition_swap(text, uuid, uuid)', 'definer', '{app_auth}');
SELECT meta.expect_function('nutrition_log_slot(uuid, text, timestamptz)', 'definer', '{app_auth}');
