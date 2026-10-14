-- Day close: the freeze ticket tables (read by the close; their functions come with the journal
-- task), the record of job runs, and the functions the day-close job calls as app_job. Re-runnable.
--
-- A logical day is open until this job has processed it (AR-09). The job (server/src/jobs/
-- dayClose.ts) asks job_day_close_candidates which users have past days to close and what those
-- days were, computes the streak in TypeScript (closeDays of domain/streak.ts, AR-03) and hands
-- the result to job_apply_day_close, one user per transaction.
--
-- Rules for whoever edits this file:
--   * which dates to close comes from SQL only: app.logical_date over the user's stored zone, the
--     function that labels daily_logs and decides where a write lands. Node and PostgreSQL carry
--     two copies of the zone database and they do not always agree;
--   * the apply takes the user's users row FOR NO KEY UPDATE before anything else: it is the
--     mutex of that user's day (30-day.sql), so a write and the close cannot pass each other.
--     Then the one lock order: daily logs, progression_state. Never FOR UPDATE on a row another
--     table references;
--   * the apply is a compare-and-set on progression_state.last_closed_date: a second runner that
--     read the same candidate row applies nothing. It also re-reads, under the users lock, the
--     days it was given: a late write or a ticket that changed a day since makes it apply nothing,
--     and the user is offered again with the new truth;
--   * only onboarded, not deleted users are candidates: the decoys (onboarded_at null) are never
--     processed;
--   * a milestone is paid through app._grant with ref '7', '30' or '100' (AR-34): once ever;
--   * time is app.now() only; the job's own instant is a parameter.

-- One row per ticket. grant_week: the Monday of the week it was granted for (AR-10, at most one
-- per week); used_for_date: the logical date it protects, one ticket per date.
CREATE TABLE IF NOT EXISTS freeze_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT app.now(),
  grant_week date NOT NULL CHECK (extract(isodow FROM grant_week) = 1),
  used_at timestamptz,
  used_for_date date,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT freeze_tickets_used_check CHECK ((used_at IS NULL) = (used_for_date IS NULL)),
  CONSTRAINT freeze_tickets_week_key UNIQUE (user_id, grant_week),
  -- unique treats nulls as distinct: an unused ticket names no date
  CONSTRAINT freeze_tickets_date_key UNIQUE (user_id, used_for_date)
);

-- Whether the week's ticket was decided (granted, or forfeited at the cap): the journal grants it
-- once, the ticket-grant job is a safety net that finds the week decided.
CREATE TABLE IF NOT EXISTS ticket_grant_weeks (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  granted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  PRIMARY KEY (user_id, week_start)
);

-- One row per run of a job: run_id is drawn by the runner for each run, so two runs for one
-- instant (the CLI beside the scheduler, two processes) are two rows; run_for is the instant the
-- run ran for. No user data.
CREATE TABLE IF NOT EXISTS job_runs (
  run_id uuid PRIMARY KEY,
  job text NOT NULL,
  run_for timestamptz NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT app.now(),
  ok boolean NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE INDEX IF NOT EXISTS job_runs_job_for_idx ON job_runs (job, run_for);

ALTER TABLE freeze_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_grant_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON freeze_tickets;
CREATE POLICY own_select ON freeze_tickets FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON ticket_grant_weeks;
CREATE POLICY own_select ON ticket_grant_weeks FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

REVOKE ALL ON freeze_tickets, ticket_grant_weeks, job_runs FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON freeze_tickets, ticket_grant_weeks TO app_auth;

SELECT meta.expect_table('freeze_tickets', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('freeze_tickets', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('ticket_grant_weeks', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('ticket_grant_weeks', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('job_runs', 'internal', '{}', '{}', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal: EXECUTE for no role, not SECURITY DEFINER.

-- What the close needs to know of each date from p_from through p_through, ascending:
-- [{date, storyCompleted, ticketApplied}]. A date without a log was not completed. '[]' when
-- p_through is before p_from. The candidates query offers this, and the apply reads it again.
CREATE OR REPLACE FUNCTION app._close_days(p_user uuid, p_from date, p_through date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(g.day, 'YYYY-MM-DD'),
           'storyCompleted', coalesce(d.story_completed, false),
           'ticketApplied', EXISTS (SELECT 1 FROM freeze_tickets t
                                     WHERE t.user_id = p_user AND t.used_for_date = g.day))
         ORDER BY g.day), '[]'::jsonb)
    FROM (SELECT p_from + n AS day FROM generate_series(0, p_through - p_from) n) g
    LEFT JOIN daily_logs d ON d.user_id = p_user AND d.logical_date = g.day
$$;

REVOKE ALL ON FUNCTION app._close_days(uuid, date, date) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._close_days(uuid, date, date)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The functions of the day-close job: SECURITY DEFINER, EXECUTE for app_job only (AR-03: the one
-- sanctioned kind of function that takes a user id, and no request role may call it).

-- At most p_limit users, in id order after p_after (null: from the first), who are onboarded, not
-- deleted, and whose logical yesterday at p_now (in their stored zone) is after their last closed
-- date (the day before their first day when nothing was closed yet). For each: last_closed, the
-- six streak fields as the StreakState of domain/streak.ts, and the days to close (app._close_days)
-- from the day after the last close through that yesterday.
CREATE OR REPLACE FUNCTION job_day_close_candidates(p_now timestamptz, p_limit int, p_after uuid)
RETURNS TABLE (user_id uuid, last_closed date, state jsonb, days jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT u.id, s.last_closed_date,
         jsonb_build_object(
           'streakCurrent', s.streak_current, 'streakBest', s.streak_best,
           'streakBeforeBreak', s.streak_before_break,
           'breakDate', to_char(s.break_date, 'YYYY-MM-DD'),
           'missedRun', s.missed_run, 'lastOutcome', s.last_outcome),
         app._close_days(u.id, coalesce(s.last_closed_date, s.onboard_date - 1) + 1,
                         app.logical_date(p_now, u.timezone) - 1)
    FROM users u
    JOIN progression_state s ON s.user_id = u.id
   WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL
     AND app.logical_date(p_now, u.timezone) - 1 > coalesce(s.last_closed_date, s.onboard_date - 1)
     AND (p_after IS NULL OR u.id > p_after)
   ORDER BY u.id
   LIMIT p_limit
$$;

-- Closes p_user's days through p_through with the streak fields of p_state (computed by
-- closeDays over p_days, the days job_day_close_candidates offered) and the events of p_events:
--   {type: 'STREAK_MILESTONE', days, coins, badgeCode}: the coins through app._grant with
--     reason STREAK_MILESTONE and ref '<days>' (once ever), the badge into inventory (once), a
--     STREAK_MILESTONE notification (dedupe key = days);
--   {type: 'PET_TIRED', date}: a PET_TIRED notification (dedupe key = the date).
-- A broken streak is no event here: no notification blames anyone (S67 is on the journey screen).
-- Returns {applied, grants}: grants = the app._grant results that wrote ledger rows, with reason
-- and ref, for log.ledger. Applies nothing ({applied: false, grants: []}) when the user is not a
-- live onboarded user, when last_closed_date is not p_expected_last_closed any more (another run
-- was first: compare-and-set), or when the days are not p_days any more (stale).
-- streak_best is never written lower than it is.
CREATE OR REPLACE FUNCTION job_apply_day_close(
  p_user_id uuid, p_expected_last_closed date, p_through date, p_days jsonb, p_state jsonb, p_events jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_nothing constant jsonb := '{"applied": false, "grants": []}';
  v_first date;
  v_grants jsonb := '[]';
  v_grant jsonb;
  v_days int;
  v_coins int;
  e jsonb;
BEGIN
  -- 1. the mutex of the user's day, before anything is read
  PERFORM 1 FROM users u
   WHERE u.id = p_user_id AND u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN v_nothing;
  END IF;
  -- what the job decided from is still the truth: nobody closed since it read, nothing changed
  SELECT s.onboard_date INTO v_first
    FROM progression_state s
   WHERE s.user_id = p_user_id AND s.last_closed_date IS NOT DISTINCT FROM p_expected_last_closed;
  IF NOT FOUND
     OR app._close_days(p_user_id, coalesce(p_expected_last_closed, v_first - 1) + 1, p_through)
        IS DISTINCT FROM p_days
     OR p_through <= coalesce(p_expected_last_closed, v_first - 1) THEN
    RETURN v_nothing;
  END IF;

  -- 2. the logs of the closed dates
  UPDATE daily_logs d SET closed_at = app.now()
   WHERE d.user_id = p_user_id AND d.logical_date <= p_through AND d.closed_at IS NULL;

  -- 3. the state, compare-and-set (the users lock keeps it true since the read above)
  UPDATE progression_state s
     SET streak_current = (p_state ->> 'streakCurrent')::int,
         streak_best = greatest(s.streak_best, (p_state ->> 'streakBest')::int),
         streak_before_break = (p_state ->> 'streakBeforeBreak')::int,
         break_date = (p_state ->> 'breakDate')::date,
         missed_run = (p_state ->> 'missedRun')::int,
         last_outcome = p_state ->> 'lastOutcome',
         last_closed_date = p_through
   WHERE s.user_id = p_user_id AND s.last_closed_date IS NOT DISTINCT FROM p_expected_last_closed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_apply_day_close: last_closed_date moved under the users lock';
  END IF;

  -- 4. what the close earned
  FOR e IN SELECT x FROM jsonb_array_elements(coalesce(p_events, '[]')) x LOOP
    CASE e ->> 'type'
    WHEN 'STREAK_MILESTONE' THEN
      v_days := (e ->> 'days')::int;
      v_coins := (e ->> 'coins')::int;
      IF v_days IS NULL OR v_days NOT IN (7, 30, 100) OR v_coins IS NULL OR v_coins <= 0
         OR NOT EXISTS (SELECT 1 FROM shop_items i WHERE i.code = e ->> 'badgeCode' AND i.kind = 'BADGE') THEN
        RAISE EXCEPTION 'job_apply_day_close: not a milestone';
      END IF;
      v_grant := app._grant(p_user_id, 0, v_coins, 'STREAK_MILESTONE', v_days::text);
      IF (v_grant ->> 'applied')::boolean THEN
        v_grants := v_grants || jsonb_build_array(
          v_grant || jsonb_build_object('reason', 'STREAK_MILESTONE', 'ref', v_days::text));
      END IF;
      INSERT INTO inventory (user_id, shop_item_id, kind)
      SELECT p_user_id, i.id, i.kind FROM shop_items i WHERE i.code = e ->> 'badgeCode'
      ON CONFLICT (user_id, shop_item_id) DO NOTHING;
      PERFORM app._notify(p_user_id, 'STREAK_MILESTONE',
        jsonb_build_object('days', v_days, 'coins', v_coins, 'badgeCode', e ->> 'badgeCode'), v_days::text);
    WHEN 'PET_TIRED' THEN
      PERFORM app._notify(p_user_id, 'PET_TIRED', '{}',
        to_char((e ->> 'date')::date, 'YYYY-MM-DD'));
    ELSE
      RAISE EXCEPTION 'job_apply_day_close: unknown event';
    END CASE;
  END LOOP;
  RETURN jsonb_build_object('applied', true, 'grants', v_grants);
END $$;

-- One row per run (p_run_id: drawn by the runner for that run).
CREATE OR REPLACE FUNCTION job_record_run(p_job text, p_run_id uuid, p_run_for timestamptz, p_ok boolean, p_detail jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  INSERT INTO job_runs (run_id, job, run_for, ok, detail)
  VALUES (p_run_id, p_job, p_run_for, p_ok, coalesce(p_detail, '{}'))
$$;

REVOKE ALL ON FUNCTION
  job_day_close_candidates(timestamptz, int, uuid),
  job_apply_day_close(uuid, date, date, jsonb, jsonb, jsonb),
  job_record_run(text, uuid, timestamptz, boolean, jsonb)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  job_day_close_candidates(timestamptz, int, uuid),
  job_apply_day_close(uuid, date, date, jsonb, jsonb, jsonb),
  job_record_run(text, uuid, timestamptz, boolean, jsonb)
  TO app_job;
SELECT meta.expect_function('job_day_close_candidates(timestamptz, int, uuid)', 'definer', '{app_job}');
SELECT meta.expect_function('job_apply_day_close(uuid, date, date, jsonb, jsonb, jsonb)', 'definer', '{app_job}');
SELECT meta.expect_function('job_record_run(text, uuid, timestamptz, boolean, jsonb)', 'definer', '{app_job}');
