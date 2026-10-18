-- The journal (F-13, spec 10.1), the freeze tickets' functions (F-08, R-D04, AR-10) and the
-- ticket-grant job. The ticket tables are those of 32-dayclose.sql. Re-runnable.
--
-- An entry reaches this file already encrypted (AES-256-GCM in Node, server/src/journalCrypto.ts):
-- the database never sees the text, so no function, log, index or error of PostgreSQL can hold it.
-- journal_entries has no index on its content and no function here reads the bytes back.
--
-- Rules for whoever edits this file:
--   * lock order, the one of the codebase: the caller's users row FOR NO KEY UPDATE, then
--     progression_state FOR UPDATE (app._lock_progression of 41-shop.sql), and nothing of
--     another user after it. journal_create and ticket_use take it first; job_ticket_grant
--     takes the same two rows per user, users by id. A day-close apply takes the users row
--     first too, so a ticket and the close of the day it names never pass each other;
--   * app._ticket_block_reason is the one rule of whether a ticket may be applied to a date,
--     and app._ticket_needed of whether it is needed: ticket_use raises what the first answers,
--     and ticket_overview (GET /freeze-tickets) shows the second, so the screen and the
--     function cannot disagree;
--   * the week of a ticket is app.week_start of the entry's logical-date label (AR-10); the
--     decision of a week is its ticket_grant_weeks row, and its primary key is the last fence;
--   * the XP of an entry is app._grant(..., 'JOURNAL', '<logical date>') (AR-34): only the first
--     entry of a logical day pays;
--   * a refusal is raised with SQLSTATE HM000; time is app.now() only (the job: p_now).

-- Content, written by the seeder from server/content/quotes.ts, by code. Never deleted there:
-- entries point at a code for good.
CREATE TABLE IF NOT EXISTS quotes (
  code text PRIMARY KEY,
  text text NOT NULL CHECK (text <> ''),
  author text,
  created_at timestamptz NOT NULL DEFAULT app.now()
);

-- id = the action id of the request. body_encrypted: version byte 0x01, 12-byte IV, ciphertext
-- (1 to 5000 characters of UTF-8: up to 20000 bytes), 16-byte tag.
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body_encrypted bytea NOT NULL
    CHECK (octet_length(body_encrypted) BETWEEN 30 AND 20029 AND get_byte(body_encrypted, 0) = 1),
  quote_code text NOT NULL REFERENCES quotes (code),
  logical_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE INDEX IF NOT EXISTS journal_entries_user_created_idx ON journal_entries (user_id, created_at DESC, id DESC);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_select ON journal_entries;
CREATE POLICY own_select ON journal_entries FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

REVOKE ALL ON quotes, journal_entries FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON quotes, journal_entries TO app_auth;

SELECT meta.expect_table('quotes', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('journal_entries', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('journal_entries', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role, not SECURITY DEFINER.

-- TICKET_CAP of domain/economy.ts: 2, or 3 with the perk TICKET_CAP_PLUS.
CREATE OR REPLACE FUNCTION app._ticket_cap(p_user uuid) RETURNS int
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM perk_unlocks k WHERE k.user_id = p_user AND k.perk_code = 'TICKET_CAP_PLUS')
              THEN 3 ELSE 2 END
$$;

-- The weekly ticket of p_week_start (AR-10). The week has a decision already: ALREADY_DECIDED.
-- Else the decision is written: unused tickets at the cap -> granted false, AT_CAP (the week is
-- forfeited, whatever happens later in it); else a ticket of that week -> GRANTED. The caller
-- holds the user's lock; the primary key of ticket_grant_weeks decides two callers anyway.
CREATE OR REPLACE FUNCTION app._ticket_grant_check(p_user uuid, p_week_start date) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_granted boolean;
BEGIN
  INSERT INTO ticket_grant_weeks (user_id, week_start, granted)
  SELECT p_user, p_week_start,
         EXISTS (SELECT 1 FROM freeze_tickets t WHERE t.user_id = p_user AND t.grant_week = p_week_start)
         OR (SELECT count(*) FROM freeze_tickets t WHERE t.user_id = p_user AND t.used_at IS NULL) < app._ticket_cap(p_user)
  ON CONFLICT (user_id, week_start) DO NOTHING
  RETURNING granted INTO v_granted;
  IF NOT FOUND THEN
    RETURN 'ALREADY_DECIDED';
  END IF;
  IF NOT v_granted THEN
    RETURN 'AT_CAP';
  END IF;
  -- a decision row lost while the week's ticket stayed (restored by hand): that ticket is the grant
  INSERT INTO freeze_tickets (user_id, grant_week) VALUES (p_user, p_week_start)
  ON CONFLICT (user_id, grant_week) DO NOTHING;
  RETURN 'GRANTED';
END $$;

-- Whether a ticket on p_date protects anything for p_user (null date or no state: false).
-- A date that is still open (after last_closed_date, from the first day on): the streak is
-- above 0 and that day's STORY quests are not all completed. A closed date: it is the break
-- date and the streak before the break is kept (a rescue restores it).
CREATE OR REPLACE FUNCTION app._ticket_needed(p_user uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN p_date > coalesce(s.last_closed_date, s.onboard_date - 1)
        THEN s.streak_current > 0
             AND NOT coalesce((SELECT d.story_completed FROM daily_logs d
                                WHERE d.user_id = p_user AND d.logical_date = p_date), false)
      ELSE s.break_date = p_date AND s.streak_before_break IS NOT NULL
    END
      FROM progression_state s WHERE s.user_id = p_user), false)
$$;

-- Why a ticket may not be applied to p_date now, or null when it may. First match wins:
-- TICKET_DATE_NOT_ELIGIBLE (not the current logical date, nor yesterday while the local hour is
-- in [3, 15)), TICKET_ALREADY_USED_FOR_DATE, NO_TICKET (no unused ticket), TICKET_NOT_NEEDED
-- (app._ticket_needed).
CREATE OR REPLACE FUNCTION app._ticket_block_reason(p_user uuid, p_date date) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_date IS NULL OR x.today IS NULL
      OR NOT (p_date = x.today OR (p_date = x.today - 1 AND x.hour >= 3 AND x.hour < 15))
      THEN 'TICKET_DATE_NOT_ELIGIBLE'
    WHEN EXISTS (SELECT 1 FROM freeze_tickets t WHERE t.user_id = p_user AND t.used_for_date = p_date)
      THEN 'TICKET_ALREADY_USED_FOR_DATE'
    WHEN NOT EXISTS (SELECT 1 FROM freeze_tickets t WHERE t.user_id = p_user AND t.used_at IS NULL)
      THEN 'NO_TICKET'
    WHEN NOT app._ticket_needed(p_user, p_date) THEN 'TICKET_NOT_NEEDED'
  END
    FROM (SELECT app.logical_date(app.now(), u.timezone) AS today,
                 extract(hour FROM app.now() AT TIME ZONE u.timezone)::int AS hour
            FROM (SELECT 1) one LEFT JOIN users u ON u.id = p_user) x
$$;

REVOKE ALL ON FUNCTION
  app._ticket_cap(uuid), app._ticket_grant_check(uuid, date), app._ticket_needed(uuid, date),
  app._ticket_block_reason(uuid, date)
  FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._ticket_cap(uuid)', 'invoker', '{}');
SELECT meta.expect_function('app._ticket_grant_check(uuid, date)', 'invoker', '{}');
SELECT meta.expect_function('app._ticket_needed(uuid, date)', 'invoker', '{}');
SELECT meta.expect_function('app._ticket_block_reason(uuid, date)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The functions the server calls. The caller is app.current_user_id(); none takes a user id.

-- Stores the entry p_id (the action id) of the caller's current logical date with the bytes
-- the server encrypted. In this order: ONBOARDING_REQUIRED; the locks; the quote, at random
-- among those the caller has not received in the last 30 days, else the least recently
-- received; the entry (an id that is already an entry: IDEMPOTENCY_KEY_REUSED); 15 XP
-- (JOURNAL_XP) through app._grant with ref = the logical date; the week's ticket
-- (app._ticket_grant_check). Returns
--   {entry: {id, createdAt}, quote: {code, text, author}, grant: app._grant result + {reason, ref},
--    ticket: {outcome, available, cap}}
CREATE OR REPLACE FUNCTION journal_create(p_id uuid, p_body_encrypted bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_date date;
  v_ref text;
  v_quote quotes;
  v_entry journal_entries;
  v_grant jsonb;
  v_outcome text;
  v_constraint text;
BEGIN
  IF p_id IS NULL OR p_body_encrypted IS NULL THEN
    RAISE EXCEPTION 'journal_create: id and body are required';
  END IF;
  PERFORM app._lock_progression(v_user);
  SELECT app.logical_date(app.now(), u.timezone) INTO v_date FROM users u WHERE u.id = v_user;
  v_ref := to_char(v_date, 'YYYY-MM-DD');

  SELECT q.* INTO v_quote
    FROM quotes q
    LEFT JOIN LATERAL (SELECT max(e.created_at) AS last FROM journal_entries e
                        WHERE e.user_id = v_user AND e.quote_code = q.code) r ON true
   ORDER BY coalesce(r.last > app.now() - interval '30 days', false),
            CASE WHEN r.last > app.now() - interval '30 days' THEN r.last END,
            random()
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_create: no quote is seeded';
  END IF;

  BEGIN
    INSERT INTO journal_entries (id, user_id, body_encrypted, quote_code, logical_date)
    VALUES (p_id, v_user, p_body_encrypted, v_quote.code, v_date)
    RETURNING * INTO v_entry;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'journal_entries_pkey' THEN
      -- the action id is already an entry (its stored answer is gone, or the key is reused)
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    RAISE;
  END;

  v_grant := app._grant(v_user, 15, 0, 'JOURNAL', v_ref);
  v_outcome := app._ticket_grant_check(v_user, app.week_start(v_date));
  RETURN jsonb_build_object(
    'entry', jsonb_build_object('id', v_entry.id, 'createdAt', v_entry.created_at),
    'quote', jsonb_build_object('code', v_quote.code, 'text', v_quote.text, 'author', v_quote.author),
    'grant', v_grant || jsonb_build_object('reason', 'JOURNAL', 'ref', v_ref),
    'ticket', jsonb_build_object(
      'outcome', v_outcome,
      'available', (SELECT count(*)::int FROM freeze_tickets t WHERE t.user_id = v_user AND t.used_at IS NULL),
      'cap', app._ticket_cap(v_user)));
END $$;

-- Applies the caller's oldest unused ticket to p_date. In this order: ONBOARDING_REQUIRED; the
-- locks; app._ticket_block_reason, raised. Then the ticket gets used_at and used_for_date (the
-- unique key of the date is the last fence: TICKET_ALREADY_USED_FOR_DATE); for a date already
-- closed, the rescue (rescueWithTicket of domain/streak.ts): the streak before the break back,
-- the break fields cleared, missed_run one lower, last_outcome FROZEN, streak_best untouched.
-- An open date is left to the day-close, which reads the ticket (AR-10).
-- p_action_id names no row: a replay is the idempotency layer's.
CREATE OR REPLACE FUNCTION ticket_use(p_date date, p_action_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_reason text;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'ticket_use: the action id is required';
  END IF;
  PERFORM app._lock_progression(v_user);
  v_reason := app._ticket_block_reason(v_user, p_date);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  BEGIN
    UPDATE freeze_tickets SET used_at = app.now(), used_for_date = p_date
     WHERE id = (SELECT t.id FROM freeze_tickets t WHERE t.user_id = v_user AND t.used_at IS NULL
                  ORDER BY t.granted_at, t.grant_week, t.id LIMIT 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TICKET_ALREADY_USED_FOR_DATE' USING ERRCODE = 'HM000', DETAIL = '{}';
  END;

  UPDATE progression_state s
     SET streak_current = s.streak_before_break, streak_before_break = NULL, break_date = NULL,
         missed_run = greatest(0, s.missed_run - 1), last_outcome = 'FROZEN'
   WHERE s.user_id = v_user AND p_date <= coalesce(s.last_closed_date, s.onboard_date - 1);
END $$;

-- What GET /freeze-tickets shows of the caller, as of app.now():
--   {available, cap, state: StreakState of domain/streak.ts, eligible: [{date, target, open,
--    deadline, needed, alreadyUsed}]}
-- eligible: TODAY always, YESTERDAY while the local hour is in [3, 15); deadline: 15:00 local
-- of the day after the date; open: the date is not closed yet; needed: app._ticket_needed.
-- Null for a caller who is not onboarded.
CREATE OR REPLACE FUNCTION ticket_overview() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'available', (SELECT count(*)::int FROM freeze_tickets t WHERE t.user_id = u.id AND t.used_at IS NULL),
    'cap', app._ticket_cap(u.id),
    'state', jsonb_build_object(
      'streakCurrent', s.streak_current, 'streakBest', s.streak_best,
      'streakBeforeBreak', s.streak_before_break, 'breakDate', to_char(s.break_date, 'YYYY-MM-DD'),
      'missedRun', s.missed_run, 'lastOutcome', s.last_outcome),
    'eligible', (
      SELECT jsonb_agg(jsonb_build_object(
               'date', to_char(e.day, 'YYYY-MM-DD'), 'target', e.target,
               'open', e.day > coalesce(s.last_closed_date, s.onboard_date - 1),
               'deadline', ((e.day + 1) + time '15:00') AT TIME ZONE u.timezone,
               'needed', app._ticket_needed(u.id, e.day),
               'alreadyUsed', EXISTS (SELECT 1 FROM freeze_tickets t WHERE t.user_id = u.id AND t.used_for_date = e.day))
             ORDER BY e.day DESC)
        FROM (SELECT x.today AS day, 'TODAY' AS target
              UNION ALL
              SELECT x.today - 1, 'YESTERDAY' WHERE x.hour >= 3 AND x.hour < 15) e))
    FROM users u
    JOIN progression_state s ON s.user_id = u.id
   CROSS JOIN LATERAL (SELECT app.logical_date(app.now(), u.timezone) AS today,
                              extract(hour FROM app.now() AT TIME ZONE u.timezone)::int AS hour) x
   WHERE u.id = app.current_user_id() AND u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION journal_create(uuid, bytea), ticket_use(date, uuid), ticket_overview()
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION journal_create(uuid, bytea), ticket_use(date, uuid), ticket_overview() TO app_auth;
SELECT meta.expect_function('journal_create(uuid, bytea)', 'definer', '{app_auth}');
SELECT meta.expect_function('ticket_use(date, uuid)', 'definer', '{app_auth}');
SELECT meta.expect_function('ticket_overview()', 'definer', '{app_auth}');

-- ---------------------------------------------------------------------------------------------
-- The job's function (app_job).

-- The safety net of the weekly ticket (AR-10): for every onboarded, live user with a journal
-- entry in the week of their logical date at p_now and no decision for that week, in id order:
-- the users row FOR NO KEY UPDATE and progression_state FOR UPDATE (the lock order of
-- journal_create), then app._ticket_grant_check. Returns how many weeks it decided.
CREATE OR REPLACE FUNCTION job_ticket_grant(p_now timestamptz) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_decided int := 0;
BEGIN
  FOR r IN
    SELECT u.id, w.week_start
      FROM users u
     CROSS JOIN LATERAL (SELECT app.logical_date(p_now, u.timezone) AS today) d
     CROSS JOIN LATERAL (SELECT app.week_start(d.today) AS week_start) w
     WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM journal_entries e
                    WHERE e.user_id = u.id AND e.logical_date BETWEEN w.week_start AND d.today)
       AND NOT EXISTS (SELECT 1 FROM ticket_grant_weeks g WHERE g.user_id = u.id AND g.week_start = w.week_start)
     ORDER BY u.id
  LOOP
    PERFORM 1 FROM users u WHERE u.id = r.id AND u.deleted_at IS NULL FOR NO KEY UPDATE;
    CONTINUE WHEN NOT FOUND;
    PERFORM 1 FROM progression_state s WHERE s.user_id = r.id FOR UPDATE;
    IF app._ticket_grant_check(r.id, r.week_start) <> 'ALREADY_DECIDED' THEN
      v_decided := v_decided + 1;
    END IF;
  END LOOP;
  RETURN v_decided;
END $$;

REVOKE ALL ON FUNCTION job_ticket_grant(timestamptz) FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION job_ticket_grant(timestamptz) TO app_job;
SELECT meta.expect_function('job_ticket_grant(timestamptz)', 'definer', '{app_job}');
