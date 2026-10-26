-- Nudges (F-12) and the reminder-dispatch job. Re-runnable.
--
-- A guild member sends one of the fixed templates (nudge_templates, seeded from
-- server/content/nudgeTemplates.ts) to a teammate: the receiver gets one NUDGE inbox item
-- carrying the sender's display name, the template code and its text, and nothing else of the
-- sender. No free text exists anywhere (R-12.5). app._nudge_block_reason is the one rule of who
-- may be nudged: nudge_send raises what it answers, and guild_overview (re-created below) shows
-- it per member, so GET /guilds/me and POST /guilds/nudge cannot disagree.
--
-- Rules for whoever edits this file:
--   * lock order of nudge_send, the one of the codebase: users rows FIRST, by id (the sender's
--     and, when it shares the sender's guild, the receiver's: app._notify needs the receiver's
--     row held, 33-inbox.sql), then the sender's progression_state FOR UPDATE (it serialises
--     the sender's count), and nothing after. Two users nudging each other take the same two
--     users rows in the same order, so no cycle; job_apply_guild_week takes users rows by id
--     before anything else too; the guild functions take one users row first;
--   * the block reason is evaluated AFTER the locks, in a statement of its own (READ COMMITTED:
--     it reads what a leave, a transfer or another nudge committed while this one waited);
--   * the daily limits use each party's own logical date; the window is [12:00, 20:00) on the
--     receiver's wall clock;
--   * a refusal is raised with SQLSTATE HM000; time is app.now() only (the job: p_now).

CREATE TABLE IF NOT EXISTS nudge_templates (
  code text PRIMARY KEY,
  text text NOT NULL CHECK (text <> ''),
  created_at timestamptz NOT NULL DEFAULT app.now()
);

-- id = the action id of the request. One per receiver per receiver-logical day (R-12.3): the
-- unique key is the last fence behind the receiver's row lock.
CREATE TABLE IF NOT EXISTS nudge_events (
  id uuid PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  template_code text NOT NULL REFERENCES nudge_templates (code),
  sender_date date NOT NULL,
  receiver_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT app.now(),
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT nudge_events_not_self_check CHECK (sender_id <> receiver_id),
  CONSTRAINT nudge_events_receiver_day_key UNIQUE (receiver_id, receiver_date)
);
CREATE INDEX IF NOT EXISTS nudge_events_sender_day_idx ON nudge_events (sender_id, sender_date);

ALTER TABLE nudge_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nudge_templates, nudge_events FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON nudge_templates TO app_auth;

SELECT meta.expect_table('nudge_templates', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('nudge_events', 'internal', '{}', '{}', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helper: EXECUTE for no role, not SECURITY DEFINER.

-- Why p_sender may not nudge p_receiver now, or null when it may. First match wins:
-- NOT_IN_GUILD (the sender is in none), NUDGE_NOT_SAME_GUILD (the receiver is the sender or not
-- in the sender's guild), NUDGE_RECEIVER_MUTED, NUDGE_NOT_NEEDED (every STORY quest of the
-- receiver's current logical day is done: app._member_days, the rule of storyDoneToday),
-- NUDGE_OUTSIDE_WINDOW (receiver-local time outside [12:00, 20:00)), NUDGE_RECEIVER_LIMIT (the
-- receiver has a nudge for the receiver's current logical date), NUDGE_SENDER_LIMIT (3 for the
-- sender's current logical date).
CREATE OR REPLACE FUNCTION app._nudge_block_reason(p_sender uuid, p_receiver uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN x.sender_guild IS NULL THEN 'NOT_IN_GUILD'
    WHEN p_receiver IS NULL OR p_receiver = p_sender OR x.receiver_guild IS DISTINCT FROM x.sender_guild
      THEN 'NUDGE_NOT_SAME_GUILD'
    WHEN NOT coalesce((SELECT s.nudges_enabled FROM user_settings s WHERE s.user_id = p_receiver), true)
      THEN 'NUDGE_RECEIVER_MUTED'
    WHEN coalesce((SELECT (t.d ->> 'storyTotal')::int > 0 AND t.d ->> 'storyDone' = t.d ->> 'storyTotal'
                     FROM (SELECT app._member_days(p_receiver, y.receiver_day, y.receiver_day) -> 0 AS d) t), false)
      THEN 'NUDGE_NOT_NEEDED'
    WHEN y.receiver_time < time '12:00' OR y.receiver_time >= time '20:00' THEN 'NUDGE_OUTSIDE_WINDOW'
    WHEN EXISTS (SELECT 1 FROM nudge_events e WHERE e.receiver_id = p_receiver AND e.receiver_date = y.receiver_day)
      THEN 'NUDGE_RECEIVER_LIMIT'
    WHEN (SELECT count(*) FROM nudge_events e WHERE e.sender_id = p_sender AND e.sender_date = y.sender_day) >= 3
      THEN 'NUDGE_SENDER_LIMIT'
  END
    -- a deleted user (deleted_at set) is in no guild, as sender and as receiver
    FROM (SELECT (SELECT m.guild_id FROM guild_memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.user_id = p_sender AND u.deleted_at IS NULL) AS sender_guild,
                 (SELECT m.guild_id FROM guild_memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.user_id = p_receiver AND u.deleted_at IS NULL) AS receiver_guild,
                 (SELECT u.timezone FROM users u WHERE u.id = p_sender) AS sender_tz,
                 (SELECT u.timezone FROM users u WHERE u.id = p_receiver) AS receiver_tz,
                 app.now() AS now) x
   CROSS JOIN LATERAL (
          SELECT app.logical_date(x.now, x.sender_tz) AS sender_day,
                 app.logical_date(x.now, x.receiver_tz) AS receiver_day,
                 (x.now AT TIME ZONE x.receiver_tz)::time AS receiver_time) y
$$;

REVOKE ALL ON FUNCTION app._nudge_block_reason(uuid, uuid) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._nudge_block_reason(uuid, uuid)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The function the server calls. The caller is app.current_user_id().

-- Sends p_template_code to p_receiver_id. In this order: NUDGE_TEMPLATE_UNKNOWN;
-- ONBOARDING_REQUIRED (the caller is not a live, onboarded user); the locks (see the rules
-- above); app._nudge_block_reason, raised, except that a receiver who was not in the sender's
-- guild when the rows were locked (so not locked: it may have joined in between) is
-- NUDGE_NOT_SAME_GUILD whatever else holds (NOT_IN_GUILD still comes first); the
-- event (id = p_action_id; the unique key of the receiver's day becomes NUDGE_RECEIVER_LIMIT);
-- the receiver's NUDGE notification {senderName, templateCode, text}, dedupe key = the event id.
-- Returns {sentAt, senderRemainingToday}.
CREATE OR REPLACE FUNCTION nudge_send(p_receiver_id uuid, p_template_code text, p_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_text text;
  v_sender_locked boolean;
  v_receiver_locked boolean;
  v_reason text;
  v_constraint text;
  v_event nudge_events;
BEGIN
  SELECT t.text INTO v_text FROM nudge_templates t WHERE t.code = p_template_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NUDGE_TEMPLATE_UNKNOWN' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  -- 1. the users rows, by id: the sender's, and the receiver's only when it shares the sender's guild
  WITH locked AS (
    SELECT u.id FROM users u
     WHERE (u.id = v_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL)
        OR (u.id = p_receiver_id AND u.id IS DISTINCT FROM v_user AND u.deleted_at IS NULL AND EXISTS (
              SELECT 1 FROM guild_memberships s JOIN guild_memberships r ON r.guild_id = s.guild_id
               WHERE s.user_id = v_user AND r.user_id = u.id))
     ORDER BY u.id
       FOR NO KEY UPDATE
  )
  SELECT coalesce(bool_or(l.id = v_user), false), coalesce(bool_or(l.id = p_receiver_id), false)
    INTO v_sender_locked, v_receiver_locked FROM locked l;
  IF NOT v_sender_locked THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  -- 2. the sender's count
  PERFORM 1 FROM progression_state s WHERE s.user_id = v_user FOR UPDATE;

  v_reason := app._nudge_block_reason(v_user, p_receiver_id);
  IF NOT v_receiver_locked AND v_reason IS DISTINCT FROM 'NOT_IN_GUILD' THEN
    v_reason := 'NUDGE_NOT_SAME_GUILD';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;

  BEGIN
    INSERT INTO nudge_events (id, sender_id, receiver_id, template_code, sender_date, receiver_date)
    SELECT p_action_id, s.id, r.id, p_template_code,
           app.logical_date(app.now(), s.timezone), app.logical_date(app.now(), r.timezone)
      FROM users s, users r WHERE s.id = v_user AND r.id = p_receiver_id
    RETURNING * INTO v_event;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'nudge_events_receiver_day_key' THEN
      RAISE EXCEPTION 'NUDGE_RECEIVER_LIMIT' USING ERRCODE = 'HM000', DETAIL = '{}';
    ELSIF v_constraint = 'nudge_events_pkey' THEN
      -- the action id is already an event (its stored answer is gone, or the key is reused)
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    RAISE;
  END;

  PERFORM app._notify(p_receiver_id, 'NUDGE',
    jsonb_build_object('senderName', (SELECT u.display_name FROM users u WHERE u.id = v_user),
                       'templateCode', p_template_code, 'text', v_text),
    v_event.id::text);
  RETURN jsonb_build_object(
    'sentAt', v_event.sent_at,
    'senderRemainingToday', 3 - (SELECT count(*) FROM nudge_events e
                                  WHERE e.sender_id = v_user AND e.sender_date = v_event.sender_date));
END $$;

REVOKE ALL ON FUNCTION nudge_send(uuid, text, uuid) FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION nudge_send(uuid, text, uuid) TO app_auth;
SELECT meta.expect_function('nudge_send(uuid, text, uuid)', 'definer', '{app_auth}');

-- ---------------------------------------------------------------------------------------------
-- guild_overview of 50-guild.sql, re-created with one addition: 'nudge' per member, the
-- answer of app._nudge_block_reason(caller, member) (null: may be nudged; on the caller's own
-- row NUDGE_NOT_SAME_GUILD, which readModels/guild.ts shows as the contract's own-row value).
-- Everything else is 50-guild.sql's body, character for character (a test compares the two
-- outputs on one fixture); an edit of one is an edit of both. Same signature, so the grants
-- and the meta registration of 50-guild.sql stay.
CREATE OR REPLACE FUNCTION guild_overview() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH mine AS (
    SELECT m.guild_id, m.role,
           (app.now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today
      FROM guild_memberships m WHERE m.user_id = app.current_user_id()
  )
  SELECT jsonb_build_object('guild', (
    SELECT jsonb_build_object(
      'id', g.id, 'name', g.name, 'motto', g.motto, 'inviteCode', g.invite_code,
      'createdAt', g.created_at, 'myRole', mine.role,
      'today', mine.today, 'weekStart', app.week_start(mine.today),
      'lastLogDate', (SELECT max(d.logical_date) FROM daily_logs d
                        JOIN guild_memberships m ON m.user_id = d.user_id WHERE m.guild_id = g.id),
      'members', (
        SELECT jsonb_agg(jsonb_build_object(
                 'userId', u.id, 'displayName', u.display_name, 'role', m.role,
                 'joinedDate', app.logical_date(m.joined_at, u.timezone),
                 'xp', (SELECT coalesce(sum(l.amount), 0) FROM xp_ledger l WHERE l.user_id = u.id),
                 'days', app._member_days(u.id, app.week_start(mine.today), app.week_start(mine.today) + 6),
                 'today', jsonb_build_object(
                   'date', app.logical_date(app.now(), u.timezone),
                   'storyDone', coalesce((app._member_days(u.id, app.logical_date(app.now(), u.timezone),
                                                          app.logical_date(app.now(), u.timezone))
                                          -> 0 ->> 'storyDone')::int, 0),
                   'storyTotal', (SELECT count(*)::int FROM quests q
                                   WHERE q.category = 'STORY' AND q.is_active AND u.archetype = ANY (q.archetypes))),
                 'nudge', app._nudge_block_reason(app.current_user_id(), u.id))
               ORDER BY m.role = 'LEADER' DESC, m.joined_at, u.id)
          FROM guild_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.guild_id = g.id))
      FROM mine JOIN guilds g ON g.id = mine.guild_id))
$$;

-- ---------------------------------------------------------------------------------------------
-- The job's function (app_job).

-- One QUEST_REMINDER (payload {}, dedupe key = the user's logical date) for every onboarded,
-- live user with reminder_enabled whose wall clock at p_now lies in the chosen window (
-- MORNING [07:00, 09:00), NOON [11:30, 13:30), EVENING [18:00, 20:00)) and whose current logical
-- day is not story_completed. One statement: the users rows it notifies are locked by id
-- (app._notify needs them held; users rows first, the one lock order). Returns how many it created.
CREATE OR REPLACE FUNCTION job_reminder_dispatch(p_now timestamptz) RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT u.id, to_char(app.logical_date(p_now, u.timezone), 'YYYY-MM-DD') AS day
      FROM users u
      JOIN user_settings s ON s.user_id = u.id
      JOIN (VALUES ('MORNING', time '07:00', time '09:00'),
                   ('NOON', time '11:30', time '13:30'),
                   ('EVENING', time '18:00', time '20:00')) w (name, opens, closes) ON w.name = s.reminder_window
     WHERE u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL AND s.reminder_enabled
       AND (p_now AT TIME ZONE u.timezone)::time >= w.opens
       AND (p_now AT TIME ZONE u.timezone)::time < w.closes
       AND NOT EXISTS (SELECT 1 FROM daily_logs d
                        WHERE d.user_id = u.id AND d.logical_date = app.logical_date(p_now, u.timezone)
                          AND d.story_completed)
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.user_id = u.id AND n.kind = 'QUEST_REMINDER'
                          AND n.dedupe_key = to_char(app.logical_date(p_now, u.timezone), 'YYYY-MM-DD'))
     ORDER BY u.id
       FOR NO KEY UPDATE OF u
  )
  SELECT count(*)::int FROM due WHERE app._notify(due.id, 'QUEST_REMINDER', '{}', due.day)
$$;

REVOKE ALL ON FUNCTION job_reminder_dispatch(timestamptz) FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION job_reminder_dispatch(timestamptz) TO app_job;
SELECT meta.expect_function('job_reminder_dispatch(timestamptz)', 'definer', '{app_job}');
