-- Profile: biometric snapshots, the prescription, settings, and the three profile_* functions
-- that complete onboarding, record new numbers and change the archetype. Re-runnable.
--
-- The prescription is computed in Node (domain/energy.ts) and handed in as values; it is not
-- currency. The functions re-check what makes it safe, as the last fence (AR-03): the ranges,
-- the age, the BMI rule for ASSASSIN and the absolute calorie floor. A refusal is raised with
-- SQLSTATE HM000 (MESSAGE = error code of the API, DETAIL = its details): nothing a refused
-- call wrote may stay, so the caller rolls back.
--
-- Rules for whoever edits this file:
--   * order of refusals: wrong fields (VALIDATION_FAILED, every field at once, named as in the
--     request body), then the age (AGE_NOT_ALLOWED), then the archetype (ARCHETYPE_NOT_ALLOWED
--     with details.allowed), then the prescription. The app sends each to its own screen;
--   * a snapshot is never updated or deleted (R-01.2), and recorded_at rises strictly per user:
--     "the latest snapshot" is one row, whatever the clock did;
--   * the functions lock the caller's users row first, FOR NO KEY UPDATE: profile changes of one
--     user run one after the other. Never FOR UPDATE: every idempotent request already holds a
--     key-share lock on that row (the foreign key of its idempotency_keys row), FOR UPDATE
--     conflicts with it, and two requests of one user would wait for each other until PostgreSQL
--     ends one as a deadlock. FOR NO KEY UPDATE keeps writers apart and leaves key-share alone;
--   * changing the archetype touches no ledger and no streak field (R-01.1);
--   * time is app.now() only.

CREATE TABLE IF NOT EXISTS biometric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  height_cm numeric NOT NULL CHECK (height_cm BETWEEN 120 AND 230),
  weight_kg numeric NOT NULL CHECK (weight_kg BETWEEN 30 AND 250),
  birth_year int NOT NULL,
  sex text NOT NULL CHECK (sex IN ('MALE', 'FEMALE')),
  activity_level text NOT NULL
    CHECK (activity_level IN ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE')),
  recorded_at timestamptz NOT NULL DEFAULT app.now(),
  created_at timestamptz NOT NULL DEFAULT app.now()
);
-- Unique: two snapshots of one user never share an instant, so ORDER BY recorded_at DESC LIMIT 1
-- always names the same row.
CREATE UNIQUE INDEX IF NOT EXISTS biometric_snapshots_user_recorded_idx
  ON biometric_snapshots (user_id, recorded_at DESC);

-- One row per user: the targets in effect.
CREATE TABLE IF NOT EXISTS prescriptions (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  bmr numeric NOT NULL,
  tdee numeric NOT NULL,
  calorie_target numeric NOT NULL,
  protein_g numeric NOT NULL,
  carbs_g numeric NOT NULL,
  fat_g numeric NOT NULL,
  water_ml int NOT NULL CHECK (water_ml BETWEEN 1500 AND 4000),
  safety_clamped boolean NOT NULL,
  macro_adjusted boolean NOT NULL,
  computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now()
);
-- The range of every stored number. calorie_target is integer-valued; 1200 is the lower of the
-- two floors, the one by sex is checked in app._prescription_put. Each ceiling is a round number
-- above the largest value calculatePrescription (domain/energy.ts) gives anywhere in the valid
-- input ranges: bmr 3862.5, tdee 7338.8, calorieTarget 8073, proteinG 500, carbsG 1014, fatG 224
-- (a test recomputes them and sends every such prescription through the fence). water_ml has its
-- exact range on the column. Dropped and added again so that an edit reaches a table that
-- already exists; app._prescription_put repeats the ranges to answer with an error code.
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_bmr_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_bmr_check CHECK (bmr > 0 AND bmr <= 5000);
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_tdee_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_tdee_check CHECK (tdee > 0 AND tdee <= 10000);
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_calorie_target_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_calorie_target_check CHECK (
  calorie_target >= 1200 AND calorie_target <= 10000 AND calorie_target = trunc(calorie_target));
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_protein_g_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_protein_g_check CHECK (protein_g >= 0 AND protein_g <= 1000);
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_carbs_g_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_carbs_g_check CHECK (carbs_g >= 0 AND carbs_g <= 2000);
ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_fat_g_check;
ALTER TABLE prescriptions ADD CONSTRAINT prescriptions_fat_g_check CHECK (fat_g >= 0 AND fat_g <= 500);

-- The owner of the row writes six of these columns directly, so their rules are constraints.
-- sound_enabled is not one of the six and is false in this build (AR-22: the app has no audio).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  nudges_enabled boolean NOT NULL DEFAULT true,
  reminder_enabled boolean NOT NULL DEFAULT false,
  reminder_window text NOT NULL DEFAULT 'EVENING' CHECK (reminder_window IN ('MORNING', 'NOON', 'EVENING')),
  hide_streak boolean NOT NULL DEFAULT false,
  sound_enabled boolean NOT NULL DEFAULT false CHECK (NOT sound_enabled),
  motion text NOT NULL DEFAULT 'SYSTEM' CHECK (motion IN ('SYSTEM', 'REDUCED', 'FULL')),
  excluded_meal_tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT app.now()
);
-- excluded_meal_tags is a set of INGREDIENT_TAGS (domain/types.ts; a test writes every tag):
-- only those tags, one dimension, no tag twice, hence never more than eight elements. A CHECK
-- cannot hold a subquery, so "no tag twice" is written as: there are exactly as many elements
-- as there are tags of the list present. The list therefore stands here twice; keep both in
-- step. Dropped and added again so that an edit reaches a table that already exists.
ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_excluded_meal_tags_check;
ALTER TABLE user_settings ADD CONSTRAINT user_settings_excluded_meal_tags_check CHECK (
  excluded_meal_tags <@ ARRAY['co:thit-do', 'co:gia-cam', 'co:hai-san', 'co:trung', 'co:sua',
                              'co:dau-phong', 'co:gluten', 'co:dau-nanh']
  AND coalesce(array_ndims(excluded_meal_tags), 1) = 1
  AND cardinality(excluded_meal_tags) =
        ('co:thit-do' = ANY (excluded_meal_tags))::int + ('co:gia-cam' = ANY (excluded_meal_tags))::int
      + ('co:hai-san' = ANY (excluded_meal_tags))::int + ('co:trung' = ANY (excluded_meal_tags))::int
      + ('co:sua' = ANY (excluded_meal_tags))::int + ('co:dau-phong' = ANY (excluded_meal_tags))::int
      + ('co:gluten' = ANY (excluded_meal_tags))::int + ('co:dau-nanh' = ANY (excluded_meal_tags))::int
);

ALTER TABLE biometric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON biometric_snapshots;
CREATE POLICY own_select ON biometric_snapshots FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON prescriptions;
CREATE POLICY own_select ON prescriptions FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON user_settings;
CREATE POLICY own_select ON user_settings FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_update ON user_settings;
CREATE POLICY own_update ON user_settings FOR UPDATE TO app_auth
  USING (app.current_user_id() = user_id) WITH CHECK (app.current_user_id() = user_id);

REVOKE ALL ON biometric_snapshots, prescriptions, user_settings FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON biometric_snapshots, prescriptions, user_settings TO app_auth;
GRANT UPDATE (nudges_enabled, reminder_enabled, reminder_window, hide_streak, motion, excluded_meal_tags)
  ON user_settings TO app_auth;

SELECT meta.expect_table('biometric_snapshots', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('biometric_snapshots', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('prescriptions', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('prescriptions', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('user_settings', 'own_rw', '{SELECT}',
  '{nudges_enabled,reminder_enabled,reminder_window,hide_streak,motion,excluded_meal_tags}', 'user_id');
SELECT meta.expect_policy('user_settings', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_policy('user_settings', 'own_update', 'UPDATE',
  '(app.current_user_id() = user_id)', '(app.current_user_id() = user_id)');

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role, and none is SECURITY DEFINER.

-- allowedArchetypes of domain/validation.ts: no ASSASSIN (the fat-loss profile) below BMI 18.5.
-- In float8 and with the same operations in the same order as the TypeScript, so that both
-- sides give the same answer for the same numbers, also right at 18.5 (a test compares them).
CREATE OR REPLACE FUNCTION app._archetypes_allowed(p_height_cm numeric, p_weight_kg numeric) RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_weight_kg::float8 / ((p_height_cm::float8 / 100) * (p_height_cm::float8 / 100)) < 18.5
              THEN ARRAY['TANKER', 'SUPPORTER']
              ELSE ARRAY['TANKER', 'ASSASSIN', 'SUPPORTER'] END
$$;

-- The checks of validateBiometrics (domain/validation.ts) and of the routes, again. Raises
-- VALIDATION_FAILED with every wrong field, else AGE_NOT_ALLOWED, else ARCHETYPE_NOT_ALLOWED
-- when p_archetype is given and these numbers rule it out. Returns the archetypes the numbers
-- allow. Age = the calendar year of app.now() in p_timezone minus the birth year.
CREATE OR REPLACE FUNCTION app._profile_check(
  p_timezone text, p_height_cm numeric, p_weight_kg numeric, p_birth_year int,
  p_sex text, p_activity_level text, p_archetype text, p_archetype_required boolean
) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_zone_known boolean := EXISTS (SELECT 1 FROM timezones z WHERE z.name = p_timezone);
  v_age bigint;
  v_fields jsonb;
  v_allowed text[];
BEGIN
  IF v_zone_known THEN
    v_age := extract(year FROM app.now() AT TIME ZONE p_timezone)::bigint - p_birth_year;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('field', f.field, 'rule', f.rule) ORDER BY f.ord)
    INTO v_fields
    FROM (VALUES
      (1, 'timezone', CASE WHEN p_timezone IS NULL THEN 'required' WHEN NOT v_zone_known THEN 'format' END),
      (2, 'archetype', CASE WHEN p_archetype IS NULL THEN CASE WHEN p_archetype_required THEN 'required' END
                            WHEN p_archetype NOT IN ('TANKER', 'ASSASSIN', 'SUPPORTER') THEN 'enum' END),
      (3, 'heightCm', CASE WHEN p_height_cm IS NULL THEN 'required'
                           WHEN p_height_cm < 120 THEN 'min' WHEN p_height_cm > 230 THEN 'max' END),
      (4, 'weightKg', CASE WHEN p_weight_kg IS NULL THEN 'required'
                           WHEN p_weight_kg < 30 THEN 'min' WHEN p_weight_kg > 250 THEN 'max' END),
      -- older than 90: the birth year is below its minimum
      (5, 'birthYear', CASE WHEN p_birth_year IS NULL THEN 'required' WHEN v_age > 90 THEN 'min' END),
      (6, 'sex', CASE WHEN p_sex IS NULL THEN 'required' WHEN p_sex NOT IN ('MALE', 'FEMALE') THEN 'enum' END),
      (7, 'activityLevel', CASE WHEN p_activity_level IS NULL THEN 'required'
                                WHEN p_activity_level NOT IN ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE')
                                  THEN 'enum' END)
    ) AS f (ord, field, rule)
   WHERE f.rule IS NOT NULL;
  IF v_fields IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = jsonb_build_object('fields', v_fields)::text;
  END IF;
  IF v_age < 16 THEN
    RAISE EXCEPTION 'AGE_NOT_ALLOWED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  v_allowed := app._archetypes_allowed(p_height_cm, p_weight_kg);
  IF p_archetype <> ALL (v_allowed) THEN
    RAISE EXCEPTION 'ARCHETYPE_NOT_ALLOWED' USING ERRCODE = 'HM000',
      DETAIL = jsonb_build_object('allowed', v_allowed)::text;
  END IF;
  RETURN v_allowed;
END $$;

-- Stores p (a Prescription of domain/energy.ts, as JSON) as the prescription of p_user,
-- replacing the one in effect. Refused with VALIDATION_FAILED: a calorieTarget that is not a
-- whole number (calorieTarget, format), lies below 1200 for FEMALE / 1500 for MALE
-- (calorieTarget, min) or above 10000 (calorieTarget, max), and anything that is not a
-- prescription at all, which includes a number outside the range its column allows
-- (prescription, format). The ranges are those of the table constraints above.
CREATE OR REPLACE FUNCTION app._prescription_put(p_user uuid, p_sex text, p jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_target numeric;
  v_water numeric;
  v_problem text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p -> 'bmr') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'tdee') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'calorieTarget') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'proteinG') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'carbsG') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'fatG') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'waterMl') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p -> 'safetyClamped') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p -> 'macroAdjusted') IS DISTINCT FROM 'boolean' THEN
    v_problem := '{"fields":[{"field":"prescription","rule":"format"}]}';
  ELSE
    v_target := (p ->> 'calorieTarget')::numeric;
    v_water := (p ->> 'waterMl')::numeric;
    IF v_target <> trunc(v_target) THEN
      v_problem := '{"fields":[{"field":"calorieTarget","rule":"format"}]}';
    -- (in parentheses: plpgsql would end the condition at the THEN inside the CASE)
    ELSIF v_target < (CASE p_sex WHEN 'FEMALE' THEN 1200 ELSE 1500 END) THEN
      v_problem := '{"fields":[{"field":"calorieTarget","rule":"min"}]}';
    ELSIF v_target > 10000 THEN
      v_problem := '{"fields":[{"field":"calorieTarget","rule":"max"}]}';
    ELSIF (p ->> 'bmr')::numeric NOT BETWEEN 0 AND 5000 OR (p ->> 'bmr')::numeric = 0
          OR (p ->> 'tdee')::numeric NOT BETWEEN 0 AND 10000 OR (p ->> 'tdee')::numeric = 0
          OR (p ->> 'proteinG')::numeric NOT BETWEEN 0 AND 1000
          OR (p ->> 'carbsG')::numeric NOT BETWEEN 0 AND 2000
          OR (p ->> 'fatG')::numeric NOT BETWEEN 0 AND 500
          OR v_water NOT BETWEEN 1500 AND 4000 OR v_water <> trunc(v_water) THEN
      v_problem := '{"fields":[{"field":"prescription","rule":"format"}]}';
    END IF;
  END IF;
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000', DETAIL = v_problem;
  END IF;

  INSERT INTO prescriptions (user_id, bmr, tdee, calorie_target, protein_g, carbs_g, fat_g, water_ml,
                             safety_clamped, macro_adjusted, computed_at)
  VALUES (p_user, (p ->> 'bmr')::numeric, (p ->> 'tdee')::numeric, v_target,
          (p ->> 'proteinG')::numeric, (p ->> 'carbsG')::numeric, (p ->> 'fatG')::numeric, v_water::int,
          (p ->> 'safetyClamped')::boolean, (p ->> 'macroAdjusted')::boolean, app.now())
  ON CONFLICT (user_id) DO UPDATE SET
    bmr = EXCLUDED.bmr, tdee = EXCLUDED.tdee, calorie_target = EXCLUDED.calorie_target,
    protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
    water_ml = EXCLUDED.water_ml, safety_clamped = EXCLUDED.safety_clamped,
    macro_adjusted = EXCLUDED.macro_adjusted, computed_at = EXCLUDED.computed_at;
END $$;

REVOKE ALL ON FUNCTION
  app._archetypes_allowed(numeric, numeric),
  app._profile_check(text, numeric, numeric, int, text, text, text, boolean),
  app._prescription_put(uuid, text, jsonb)
  FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._archetypes_allowed(numeric, numeric)', '{}');
SELECT meta.expect_function('app._profile_check(text, numeric, numeric, int, text, text, text, boolean)', '{}');
SELECT meta.expect_function('app._prescription_put(uuid, text, jsonb)', '{}');

-- ---------------------------------------------------------------------------------------------
-- The three functions the server calls. The caller is app.current_user_id(); none takes a user id.

-- Completes onboarding, once: time zone, archetype, the first snapshot, the prescription,
-- default settings and the progression row. True when it did; false, with nothing judged and
-- nothing changed, for a caller who is already onboarded (two requests at once: the second
-- waits for the first one's lock on the users row and then answers false).
CREATE OR REPLACE FUNCTION profile_onboard(
  p_timezone text, p_archetype text, p_height_cm numeric, p_weight_kg numeric, p_birth_year int,
  p_sex text, p_activity_level text, p_prescription jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_onboarded_at timestamptz;
BEGIN
  SELECT u.onboarded_at INTO v_onboarded_at
    FROM users u WHERE u.id = v_user AND u.deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_INVALID' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF v_onboarded_at IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM app._profile_check(p_timezone, p_height_cm, p_weight_kg, p_birth_year, p_sex,
                             p_activity_level, p_archetype, true);

  UPDATE users
     SET timezone = p_timezone, archetype = p_archetype, archetype_set_at = app.now(), onboarded_at = app.now()
   WHERE id = v_user;
  INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level, recorded_at)
  VALUES (v_user, p_height_cm, p_weight_kg, p_birth_year, p_sex, p_activity_level, app.now());
  PERFORM app._prescription_put(v_user, p_sex, p_prescription);
  INSERT INTO user_settings (user_id) VALUES (v_user);
  INSERT INTO progression_state (user_id, onboard_date)
  VALUES (v_user, app.logical_date(app.now(), p_timezone));
  RETURN true;
END $$;

-- New numbers: one more snapshot (the earlier ones are never touched) and a new prescription.
-- The archetype in effect stays while the new numbers allow it; p_archetype is then not applied,
-- so this is no way around the cooldown of profile_set_archetype. When they rule it out, the
-- caller must name a replacement (ARCHETYPE_NOT_ALLOWED with details.allowed otherwise): that
-- change is forced by safety, skips the cooldown and starts a new one. An archetype that is
-- given must itself be allowed for the new numbers.
CREATE OR REPLACE FUNCTION profile_add_biometrics(
  p_height_cm numeric, p_weight_kg numeric, p_birth_year int, p_sex text, p_activity_level text,
  p_prescription jsonb, p_archetype text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_timezone text;
  v_archetype text;
  v_allowed text[];
BEGIN
  SELECT u.timezone, u.archetype INTO v_timezone, v_archetype
    FROM users u
   WHERE u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  v_allowed := app._profile_check(v_timezone, p_height_cm, p_weight_kg, p_birth_year, p_sex,
                                  p_activity_level, p_archetype, false);
  IF v_archetype <> ALL (v_allowed) THEN
    IF p_archetype IS NULL THEN
      RAISE EXCEPTION 'ARCHETYPE_NOT_ALLOWED' USING ERRCODE = 'HM000',
        DETAIL = jsonb_build_object('allowed', v_allowed)::text;
    END IF;
    UPDATE users SET archetype = p_archetype, archetype_set_at = app.now() WHERE id = v_user;
  END IF;

  -- strictly after the user's latest snapshot, also when two calls read the same clock
  INSERT INTO biometric_snapshots (user_id, height_cm, weight_kg, birth_year, sex, activity_level, recorded_at)
  SELECT v_user, p_height_cm, p_weight_kg, p_birth_year, p_sex, p_activity_level,
         greatest(app.now(), max(s.recorded_at) + interval '1 microsecond')
    FROM biometric_snapshots s WHERE s.user_id = v_user;
  PERFORM app._prescription_put(v_user, p_sex, p_prescription);
END $$;

-- The free change of archetype: at most once every 14 days (336 hours, whatever the zone of
-- the session), counted from archetype_set_at; ARCHETYPE_COOLDOWN with details.availableAt
-- before that. The numbers of the latest snapshot are checked again and decide whether the
-- archetype is allowed; "not allowed" is said before "wait". The archetype already in effect is
-- no change: it is accepted at any time and starts no cooldown, so the retry of a change that
-- went through is answered as the first time. The prescription is replaced; nothing else is
-- touched: no ledger, no streak field (R-01.1).
CREATE OR REPLACE FUNCTION profile_set_archetype(p_archetype text, p_prescription jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_timezone text;
  v_archetype text;
  v_available_at timestamptz;
  s biometric_snapshots;
BEGIN
  SELECT u.timezone, u.archetype, u.archetype_set_at + interval '336 hours'
    INTO v_timezone, v_archetype, v_available_at
    FROM users u
   WHERE u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT b.* INTO s FROM biometric_snapshots b
   WHERE b.user_id = v_user ORDER BY b.recorded_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_set_archetype: an onboarded user without a biometric snapshot';
  END IF;
  PERFORM app._profile_check(v_timezone, s.height_cm, s.weight_kg, s.birth_year, s.sex,
                             s.activity_level, p_archetype, true);

  IF p_archetype <> v_archetype THEN
    IF app.now() < v_available_at THEN
      RAISE EXCEPTION 'ARCHETYPE_COOLDOWN' USING ERRCODE = 'HM000',
        DETAIL = jsonb_build_object('availableAt',
          to_char(v_available_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text;
    END IF;
    UPDATE users SET archetype = p_archetype, archetype_set_at = app.now() WHERE id = v_user;
  END IF;
  PERFORM app._prescription_put(v_user, s.sex, p_prescription);
END $$;

REVOKE ALL ON FUNCTION
  profile_onboard(text, text, numeric, numeric, int, text, text, jsonb),
  profile_add_biometrics(numeric, numeric, int, text, text, jsonb, text),
  profile_set_archetype(text, jsonb)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  profile_onboard(text, text, numeric, numeric, int, text, text, jsonb),
  profile_add_biometrics(numeric, numeric, int, text, text, jsonb, text),
  profile_set_archetype(text, jsonb)
  TO app_auth;
SELECT meta.expect_function('profile_onboard(text, text, numeric, numeric, int, text, text, jsonb)', '{app_auth}');
SELECT meta.expect_function('profile_add_biometrics(numeric, numeric, int, text, text, jsonb, text)', '{app_auth}');
SELECT meta.expect_function('profile_set_archetype(text, jsonb)', '{app_auth}');
