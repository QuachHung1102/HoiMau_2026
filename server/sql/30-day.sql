-- The day: quests, the daily log, quest progress and ticks, and the three functions a client
-- calls to tick a DAILY quest, take a tick back and mark bedtime. Re-runnable.
--
-- A logical day runs 03:00 -> 02:59:59 on the wall clock of users.timezone (spec 6.1); its label
-- is app.logical_date(instant, zone). A day is open until the day-close job has processed it
-- (progression_state.last_closed_date, AR-09), whatever the wall clock says. A day without any
-- action has no daily_logs row: reading never creates one.
--
-- Rules for whoever edits this file, or writes a function that maps a write to a day:
--   * ONE lock order, in every function: the caller's users row (FOR NO KEY UPDATE), then the
--     daily_logs row, then the quest_completions row, then progression_state (inside app._grant).
--     Never take an earlier one while holding a later one: two requests of one user would wait
--     for each other until PostgreSQL ends one as a deadlock (a 500);
--   * the users row is the mutex of one user's day: app._open_log takes it before it reads the
--     time zone and last_closed_date, so a write and the job that closes that day cannot pass
--     each other. The job must take the same lock before it moves last_closed_date;
--   * never FOR UPDATE on a row another table references (users, daily_logs, quest_completions):
--     it conflicts with the key-share lock a foreign key takes, held by every idempotent request
--     on its users row. FOR NO KEY UPDATE keeps writers apart and leaves key-share alone;
--   * a refusal is raised with SQLSTATE HM000 (MESSAGE = error code of the API, DETAIL = its
--     details): nothing a refused call wrote may stay, so the caller rolls back;
--   * the zone given to AT TIME ZONE is users.timezone and nothing else: never the zone of the
--     session, never an offset ('+07:00' is seven hours WEST of Greenwich to PostgreSQL);
--   * a ledger row is keyed by what may happen once (AR-34): the tick id for a tick and for its
--     undo, <QUEST_CODE>:<logical_date> for a quest completed once a day;
--   * time is app.now() only.

-- Content, written by the seeder from server/content/quests.ts, by code.
CREATE TABLE IF NOT EXISTS quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title_key text NOT NULL,
  category text NOT NULL CHECK (category IN ('STORY', 'DAILY', 'HIDDEN')),
  target_count int NOT NULL CHECK (target_count >= 1),
  xp_reward int NOT NULL CHECK (xp_reward >= 0),
  coin_reward int NOT NULL CHECK (coin_reward >= 0),
  archetypes text[] NOT NULL,
  is_active boolean NOT NULL,
  -- the order of the content file: the order a day lists its quests in
  position int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now()
);

CREATE TABLE IF NOT EXISTS daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  logical_date date NOT NULL,
  calories_in numeric NOT NULL DEFAULT 0 CHECK (calories_in >= 0),
  water_ml int NOT NULL DEFAULT 0 CHECK (water_ml >= 0),
  bedtime_marked_at timestamptz,
  closed_at timestamptz,
  story_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT daily_logs_user_date_key UNIQUE (user_id, logical_date),
  -- the target of the children's foreign key: a child row cannot name another user than its log's
  CONSTRAINT daily_logs_id_user_key UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS daily_logs_date_closed_idx ON daily_logs (logical_date, closed_at);

-- progress never exceeds the quest's target_count: held by the functions below, under the row
-- lock (a CHECK cannot read another table).
CREATE TABLE IF NOT EXISTS quest_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  daily_log_id uuid NOT NULL,
  quest_id uuid NOT NULL REFERENCES quests (id),
  progress int NOT NULL DEFAULT 0 CHECK (progress >= 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT quest_completions_log_quest_key UNIQUE (daily_log_id, quest_id),
  CONSTRAINT quest_completions_log_user_fkey FOREIGN KEY (daily_log_id, user_id)
    REFERENCES daily_logs (id, user_id) ON DELETE CASCADE
);

-- id = the action id (the Idempotency-Key of the request that made the tick). occurred_at: when
-- the user did it (a late write names an earlier instant). created_at: when the server recorded
-- it; it rises strictly per log and quest, so "the latest tick" is one row whatever the clock
-- did, and the undo window is counted from it.
CREATE TABLE IF NOT EXISTS quest_ticks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  daily_log_id uuid NOT NULL,
  quest_id uuid NOT NULL REFERENCES quests (id),
  occurred_at timestamptz NOT NULL,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT quest_ticks_log_user_fkey FOREIGN KEY (daily_log_id, user_id)
    REFERENCES daily_logs (id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS quest_ticks_log_quest_created_idx
  ON quest_ticks (daily_log_id, quest_id, created_at);

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quest_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quest_ticks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON daily_logs;
CREATE POLICY own_select ON daily_logs FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON quest_completions;
CREATE POLICY own_select ON quest_completions FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON quest_ticks;
CREATE POLICY own_select ON quest_ticks FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

-- A client reads; every row comes from a function below (or, for quests, from the seeder).
REVOKE ALL ON quests, daily_logs, quest_completions, quest_ticks FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON quests, daily_logs, quest_completions, quest_ticks TO app_auth;

SELECT meta.expect_table('quests', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('daily_logs', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('daily_logs', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('quest_completions', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('quest_completions', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('quest_ticks', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('quest_ticks', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);

-- ---------------------------------------------------------------------------------------------
-- A read-only helper beside app.logical_date, for the request roles.

-- The instant at which the logical date of ts in zone tz changes: the earliest instant after ts
-- whose app.logical_date is another one. By that definition and nothing else, so it is right
-- also where the label goes BACK for a while (Pacific/Chatham, 4 April 2026: 03:45 becomes
-- 02:45, so the next date starts at 03:00, stops at 03:45 and starts again 15 minutes later).
-- It asks app.logical_date itself, so the day a read shows as open and the day a write lands
-- on come from one time zone database: PostgreSQL's. Never compute this outside SQL.
-- Found by walking whole minutes, then the seconds of the minute in which the label changed:
-- zone offsets are whole seconds, so a label changes on a whole second.
-- ponytail: up to 1500 steps for a whole day ahead (about half a millisecond, measured); it
-- would miss a label that changes and changes back inside one minute, which no zone does.
CREATE OR REPLACE FUNCTION app.logical_day_end(ts timestamptz, tz text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_label date := app.logical_date(ts, tz);
  v_at timestamptz := to_timestamp(floor(extract(epoch FROM ts) / 60) * 60);
BEGIN
  FOR i IN 1..3000 LOOP
    v_at := v_at + interval '1 minute';
    EXIT WHEN app.logical_date(v_at, tz) <> v_label;
  END LOOP;
  v_at := v_at - interval '1 minute';
  FOR i IN 1..60 LOOP
    v_at := v_at + interval '1 second';
    IF v_at > ts AND app.logical_date(v_at, tz) <> v_label THEN
      RETURN v_at;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'app.logical_day_end: the logical date did not change within 50 hours';
END $$;

REVOKE ALL ON FUNCTION app.logical_day_end(timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.logical_day_end(timestamptz, text) TO app_anon, app_auth, app_job;
SELECT meta.expect_function('app.logical_day_end(timestamptz, text)', 'invoker', '{app_anon,app_auth,app_job}');

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role, and none is SECURITY DEFINER.

-- The instant a write counts for (AR-08, R-D05). Null: now. More than 120 s ahead of app.now():
-- OCCURRED_AT_INVALID. Ahead by less: now (the device clock runs fast). More than 48 hours
-- old (LATE_WINDOW_HOURS of domain/economy.ts): DAY_CLOSED.
CREATE OR REPLACE FUNCTION app._occurred_at(p_occurred_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := app.now();
BEGIN
  IF p_occurred_at > v_now + interval '120 seconds' THEN
    RAISE EXCEPTION 'OCCURRED_AT_INVALID' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF p_occurred_at < v_now - interval '48 hours' THEN
    RAISE EXCEPTION 'DAY_CLOSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  RETURN least(coalesce(p_occurred_at, v_now), v_now);
END $$;

-- The daily log of the day p_occurred_at falls on for p_user, created when it is not there yet,
-- locked until the transaction ends. Takes the user's row lock first (the mutex of that user's
-- day, see the rules above). DAY_CLOSED when the day is at or before last_closed_date, or before
-- the user's first day (after a move to a zone that is a day behind: no close will ever reach
-- such a day). ONBOARDING_REQUIRED for a caller who is not a live, onboarded user.
CREATE OR REPLACE FUNCTION app._open_log(p_user uuid, p_occurred_at timestamptz) RETURNS daily_logs
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_at timestamptz := app._occurred_at(p_occurred_at);
  v_timezone text;
  v_date date;
  v_first date;
  v_closed date;
  l daily_logs;
BEGIN
  SELECT u.timezone INTO v_timezone
    FROM users u
   WHERE u.id = p_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT s.onboard_date, s.last_closed_date INTO v_first, v_closed
    FROM progression_state s WHERE s.user_id = p_user;
  v_date := app.logical_date(v_at, v_timezone);
  IF v_date < v_first OR v_date <= v_closed THEN
    RAISE EXCEPTION 'DAY_CLOSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  INSERT INTO daily_logs (user_id, logical_date) VALUES (p_user, v_date)
  ON CONFLICT (user_id, logical_date) DO NOTHING;
  SELECT d.* INTO l
    FROM daily_logs d WHERE d.user_id = p_user AND d.logical_date = v_date FOR NO KEY UPDATE;
  RETURN l;
END $$;

-- Sets story_completed once every active STORY quest of the user's archetype has completed_at in
-- that log. True only on the call that made the change; a day without any STORY quest is never
-- "all done". The caller holds the lock of the log (app._open_log); it is taken again here.
CREATE OR REPLACE FUNCTION app._story_check(p_daily_log uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  l daily_logs;
  v_total int;
  v_done int;
BEGIN
  SELECT d.* INTO l FROM daily_logs d WHERE d.id = p_daily_log FOR NO KEY UPDATE;
  IF NOT FOUND OR l.story_completed THEN
    RETURN false;
  END IF;
  SELECT count(*), count(c.completed_at) INTO v_total, v_done
    FROM quests q
    LEFT JOIN quest_completions c ON c.quest_id = q.id AND c.daily_log_id = l.id
   WHERE q.category = 'STORY' AND q.is_active
     AND (SELECT u.archetype FROM users u WHERE u.id = l.user_id) = ANY (q.archetypes);
  IF v_total = 0 OR v_done < v_total THEN
    RETURN false;
  END IF;
  UPDATE daily_logs SET story_completed = true WHERE id = l.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION
  app._occurred_at(timestamptz), app._open_log(uuid, timestamptz), app._story_check(uuid)
  FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._occurred_at(timestamptz)', 'invoker', '{}');
SELECT meta.expect_function('app._open_log(uuid, timestamptz)', 'invoker', '{}');
SELECT meta.expect_function('app._story_check(uuid)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The three functions the server calls. The caller is app.current_user_id(); none takes a user
-- id or an amount. Each returns the result of app._grant (a grant of nothing when nothing was
-- earned: applied = false, the sums as they are) plus reason and ref of the ledger rows it may
-- have written, logicalDate, and its own members.

-- One tick of a DAILY quest of the caller's archetype, on the day p_occurred_at falls on.
--   + {progress, completed}; applied = false for a repeat of a tick the caller already made
-- p_action_id becomes the id of the tick. A tick with that id that the caller owns makes the
-- call a no-op that answers the state of that tick's quest (the retry of a request whose stored
-- answer is gone); one that somebody else owns is IDEMPOTENCY_KEY_REUSED. Then, in this order:
-- QUEST_NOT_FOUND, QUEST_NOT_TICKABLE, OCCURRED_AT_INVALID, DAY_CLOSED, QUEST_ALREADY_COMPLETE.
CREATE OR REPLACE FUNCTION quest_tick(p_quest_code text, p_action_id uuid, p_occurred_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_archetype text;
  v_at timestamptz;
  v_grant jsonb;
  q quests;
  l daily_logs;
  c quest_completions;
  t quest_ticks;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'quest_tick: the action id is required';
  END IF;
  SELECT u.archetype INTO v_archetype
    FROM users u
   WHERE u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  SELECT k.* INTO t FROM quest_ticks k WHERE k.id = p_action_id;
  IF FOUND THEN
    IF t.user_id <> v_user THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    RETURN app._grant(v_user, 0, 0, 'QUEST_TICK', t.id::text)
      || (SELECT jsonb_build_object('reason', 'QUEST_TICK', 'ref', t.id, 'logicalDate', d.logical_date,
                                    'progress', k.progress, 'completed', k.completed_at IS NOT NULL)
            FROM daily_logs d
            JOIN quest_completions k ON k.daily_log_id = d.id AND k.quest_id = t.quest_id
           WHERE d.id = t.daily_log_id);
  END IF;

  SELECT x.* INTO q
    FROM quests x WHERE x.code = p_quest_code AND x.is_active AND v_archetype = ANY (x.archetypes);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEST_NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF q.category <> 'DAILY' THEN
    RAISE EXCEPTION 'QUEST_NOT_TICKABLE' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  v_at := app._occurred_at(p_occurred_at);
  l := app._open_log(v_user, v_at);
  INSERT INTO quest_completions (user_id, daily_log_id, quest_id) VALUES (v_user, l.id, q.id)
  ON CONFLICT (daily_log_id, quest_id) DO NOTHING;
  SELECT k.* INTO c
    FROM quest_completions k WHERE k.daily_log_id = l.id AND k.quest_id = q.id FOR NO KEY UPDATE;
  IF c.progress >= q.target_count THEN
    RAISE EXCEPTION 'QUEST_ALREADY_COMPLETE' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  -- recorded strictly after the latest tick of this quest in this log, also when the clock stands
  INSERT INTO quest_ticks (id, user_id, daily_log_id, quest_id, occurred_at, created_at)
  SELECT p_action_id, v_user, l.id, q.id, v_at,
         greatest(app.now(), max(k.created_at) + interval '1 microsecond')
    FROM quest_ticks k WHERE k.daily_log_id = l.id AND k.quest_id = q.id
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    -- somebody else made a tick with this id since the look above (the caller's own are serialised)
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  UPDATE quest_completions
     SET progress = progress + 1,
         completed_at = CASE WHEN progress + 1 >= q.target_count THEN app.now() END
   WHERE id = c.id
  RETURNING * INTO c;
  IF q.code = 'WATER_8' THEN
    -- AR-12: the share of the water target that the ticks stand for
    UPDATE daily_logs
       SET water_ml = (SELECT round(p.water_ml::numeric * c.progress / q.target_count)
                         FROM prescriptions p WHERE p.user_id = v_user)
     WHERE id = l.id;
  END IF;
  v_grant := app._grant(v_user, q.xp_reward, q.coin_reward, 'QUEST_TICK', p_action_id::text);
  RETURN v_grant || jsonb_build_object(
    'reason', 'QUEST_TICK', 'ref', p_action_id, 'logicalDate', l.logical_date,
    'progress', c.progress, 'completed', c.completed_at IS NOT NULL);
END $$;

-- Takes back the caller's tick p_tick_id of quest p_quest_code: marks it undone, progress - 1,
-- the quest is not completed any more, and the ledgers get the amounts of that tick's own rows
-- with the opposite sign (reason QUEST_TICK_UNDO, ref = the tick id). xp_high_water stays.
--   + {progress, completed}
-- TICK_NOT_FOUND: no such tick of the caller for that quest, or it is undone already.
-- UNDO_NOT_LATEST: a later live tick of that quest exists in its log. UNDO_WINDOW_EXPIRED: it
-- was recorded more than 10 s ago (UNDO_WINDOW_SERVER_MS), or what it earned is spent already (a
-- sum would go below zero). DAY_CLOSED: its day is closed.
CREATE OR REPLACE FUNCTION quest_undo(p_quest_code text, p_tick_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_xp int;
  v_coin int;
  v_grant jsonb;
  t quest_ticks;
  l daily_logs;
  c quest_completions;
BEGIN
  PERFORM 1 FROM users u
   WHERE u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT k.* INTO t
    FROM quest_ticks k JOIN quests q ON q.id = k.quest_id
   WHERE k.id = p_tick_id AND k.user_id = v_user AND k.undone_at IS NULL AND q.code = p_quest_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICK_NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT d.* INTO l FROM daily_logs d WHERE d.id = t.daily_log_id FOR NO KEY UPDATE;
  SELECT k.* INTO c
    FROM quest_completions k
   WHERE k.daily_log_id = t.daily_log_id AND k.quest_id = t.quest_id FOR NO KEY UPDATE;

  IF EXISTS (SELECT 1 FROM quest_ticks k
              WHERE k.daily_log_id = t.daily_log_id AND k.quest_id = t.quest_id
                AND k.undone_at IS NULL AND k.created_at > t.created_at) THEN
    RAISE EXCEPTION 'UNDO_NOT_LATEST' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF app.now() - t.created_at > interval '10 seconds' THEN
    RAISE EXCEPTION 'UNDO_WINDOW_EXPIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF l.logical_date <= (SELECT s.last_closed_date FROM progression_state s WHERE s.user_id = v_user) THEN
    RAISE EXCEPTION 'DAY_CLOSED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  UPDATE quest_ticks SET undone_at = app.now() WHERE id = t.id;
  UPDATE quest_completions SET progress = progress - 1, completed_at = NULL WHERE id = c.id
  RETURNING * INTO c;
  IF p_quest_code = 'WATER_8' THEN
    UPDATE daily_logs
       SET water_ml = (SELECT round(p.water_ml::numeric * c.progress / q.target_count)
                         FROM prescriptions p, quests q WHERE p.user_id = v_user AND q.id = t.quest_id)
     WHERE id = l.id;
  END IF;
  -- exactly what this tick was granted, whatever the quest pays today
  SELECT coalesce(sum(x.amount), 0) INTO v_xp
    FROM xp_ledger x WHERE x.user_id = v_user AND x.reason = 'QUEST_TICK' AND x.ref_id = t.id::text;
  SELECT coalesce(sum(x.amount), 0) INTO v_coin
    FROM coin_ledger x WHERE x.user_id = v_user AND x.reason = 'QUEST_TICK' AND x.ref_id = t.id::text;
  v_grant := app._grant(v_user, -v_xp, -v_coin, 'QUEST_TICK_UNDO', t.id::text);
  IF (v_grant ->> 'xpAfter')::bigint < 0 OR (v_grant ->> 'coinAfter')::bigint < 0 THEN
    -- a ledger sum is never negative (the contract: xp and coin have minimum 0)
    RAISE EXCEPTION 'UNDO_WINDOW_EXPIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  RETURN v_grant || jsonb_build_object(
    'reason', 'QUEST_TICK_UNDO', 'ref', t.id, 'logicalDate', l.logical_date,
    'progress', c.progress, 'completed', false);
END $$;

-- "Close today" (S45, AR-13). The wall clock of the instant in the user's zone decides:
-- 03:00-17:59 BEDTIME_TOO_EARLY; otherwise bedtime_marked_at is set unless it is set already,
-- and from 18:00 to 22:59 the hidden quest BEDTIME_BEFORE_23 of that log is completed, once,
-- for its reward (reason QUEST_COMPLETE, ref BEDTIME_BEFORE_23:<logical_date>). A repeat is not
-- an error and earns nothing.
--   + {bedtimeMarkedAt, completed}; completed = this call completed the hidden quest
-- p_action_id names no row: the mark is a column of the day.
CREATE OR REPLACE FUNCTION day_bedtime(p_action_id uuid, p_occurred_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_at timestamptz := app._occurred_at(p_occurred_at);
  v_hour int;
  v_ref text;
  v_grant jsonb;
  v_completed boolean := false;
  l daily_logs;
  q quests;
  c quest_completions;
BEGIN
  l := app._open_log(v_user, v_at);
  v_hour := (SELECT extract(hour FROM v_at AT TIME ZONE u.timezone)::int FROM users u WHERE u.id = v_user);
  IF v_hour BETWEEN 3 AND 17 THEN
    RAISE EXCEPTION 'BEDTIME_TOO_EARLY' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  UPDATE daily_logs SET bedtime_marked_at = coalesce(bedtime_marked_at, v_at) WHERE id = l.id
  RETURNING * INTO l;

  v_ref := 'BEDTIME_BEFORE_23:' || to_char(l.logical_date, 'YYYY-MM-DD');
  IF v_hour BETWEEN 18 AND 22 THEN
    SELECT x.* INTO q
      FROM quests x
     WHERE x.code = 'BEDTIME_BEFORE_23' AND x.is_active
       AND (SELECT u.archetype FROM users u WHERE u.id = v_user) = ANY (x.archetypes);
    IF FOUND THEN
      INSERT INTO quest_completions (user_id, daily_log_id, quest_id) VALUES (v_user, l.id, q.id)
      ON CONFLICT (daily_log_id, quest_id) DO NOTHING;
      SELECT k.* INTO c
        FROM quest_completions k WHERE k.daily_log_id = l.id AND k.quest_id = q.id FOR NO KEY UPDATE;
      IF c.completed_at IS NULL THEN
        UPDATE quest_completions SET progress = q.target_count, completed_at = app.now() WHERE id = c.id;
        v_grant := app._grant(v_user, q.xp_reward, q.coin_reward, 'QUEST_COMPLETE', v_ref);
        v_completed := true;
      END IF;
    END IF;
  END IF;
  RETURN coalesce(v_grant, app._grant(v_user, 0, 0, 'QUEST_COMPLETE', v_ref)) || jsonb_build_object(
    'reason', 'QUEST_COMPLETE', 'ref', v_ref, 'logicalDate', l.logical_date,
    'bedtimeMarkedAt', l.bedtime_marked_at, 'completed', v_completed);
END $$;

REVOKE ALL ON FUNCTION
  quest_tick(text, uuid, timestamptz), quest_undo(text, uuid), day_bedtime(uuid, timestamptz)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  quest_tick(text, uuid, timestamptz), quest_undo(text, uuid), day_bedtime(uuid, timestamptz)
  TO app_auth;
SELECT meta.expect_function('quest_tick(text, uuid, timestamptz)', 'definer', '{app_auth}');
SELECT meta.expect_function('quest_undo(text, uuid)', 'definer', '{app_auth}');
SELECT meta.expect_function('day_bedtime(uuid, timestamptz)', 'definer', '{app_auth}');
