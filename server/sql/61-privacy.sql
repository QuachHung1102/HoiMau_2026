-- Privacy (spec 10, AR-08, AR-30): account deletion, the nudges of the export, and the purge
-- jobs. No table of its own. Re-runnable.
--
-- Deletion is soft first: account_delete sets deleted_at and purge_after (30 days later), revokes
-- every session and leaves the guild. Every function and job of the schema already treats a row
-- with deleted_at as no user (login, session, the locks of every write, every job). The purge
-- deletes the users row; every table holding user data cascades from it (a test derives that
-- list from the catalog).
--
-- Rules for whoever edits this file:
--   * lock order: account_delete takes the auth advisory lock of the email first (as auth_login,
--     auth_reset_request and auth_reset_confirm do), then the user's sessions, then the users
--     row, then the guild (FOR UPDATE), then guild_memberships. Sessions before users because
--     every request does it that way: auth_session slides (row-locks) its session before the
--     handler locks the users row; the other order deadlocks with a request of another device.
--     The purge takes the users row FOR UPDATE, then its guild, then memberships, each SKIP
--     LOCKED: a user or a guild busy right now is purged on the next run, never waited for;
--   * a job never touches a decoy (an email under @decoy.invalid, 80-decoy-base.sql), whatever
--     its dates say;
--   * a wrong password is a return value (false), never an exception: the caller commits, and
--     with it the attempt counted on 'login:<email>';
--   * time is app.now() in the request functions, p_now in the jobs.

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role, not SECURITY DEFINER.

-- Whether the user is one of the decoys: never deleted, purged or cleaned up by a job.
CREATE OR REPLACE FUNCTION app._is_decoy(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT u.email LIKE '%@decoy.invalid' FROM users u WHERE u.id = p_user), false)
$$;

-- Takes p_user out of its guild, whoever calls (AR-30): a MEMBER's row is deleted; a LEADER hands
-- the guild to the live member with the earliest joined_at (then user id) and loses the row;
-- a leader without another live member takes the guild with it (its memberships and scores
-- cascade). The caller holds p_user's users row; this takes the guild row next, and reads the
-- role again under it (a transfer may have committed meanwhile).
CREATE OR REPLACE FUNCTION app._guild_depart(p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_guild uuid;
  v_role text;
  v_next uuid;
BEGIN
  SELECT m.guild_id INTO v_guild FROM guild_memberships m WHERE m.user_id = p_user;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM 1 FROM guilds g WHERE g.id = v_guild FOR UPDATE;
  SELECT m.role INTO v_role FROM guild_memberships m WHERE m.user_id = p_user;
  IF v_role IS DISTINCT FROM 'LEADER' THEN
    DELETE FROM guild_memberships WHERE user_id = p_user;
    RETURN;
  END IF;
  SELECT m.user_id INTO v_next
    FROM guild_memberships m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
   WHERE m.guild_id = v_guild AND m.user_id <> p_user
   ORDER BY m.joined_at, m.user_id
   LIMIT 1;
  IF v_next IS NULL THEN
    DELETE FROM guilds WHERE id = v_guild;
  ELSE
    -- one leader per guild (a unique index): the old one goes before the new one is named
    DELETE FROM guild_memberships WHERE user_id = p_user;
    UPDATE guild_memberships SET role = 'LEADER' WHERE user_id = v_next;
  END IF;
END $$;

REVOKE ALL ON FUNCTION app._is_decoy(uuid), app._guild_depart(uuid) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._is_decoy(uuid)', 'invoker', '{}');
SELECT meta.expect_function('app._guild_depart(uuid)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The three functions of the request role. The caller is app.current_user_id().

-- The caller's own salt, to derive the key account_delete compares. Null for no live caller.
CREATE OR REPLACE FUNCTION account_salt() RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.salt FROM users u JOIN credentials c ON c.user_id = u.id
   WHERE u.id = app.current_user_id() AND u.deleted_at IS NULL
$$;

-- Deletes the caller's account when p_key is the caller's key: true. False, and nothing but the
-- attempt changed, for a wrong key or from the sixth attempt of the 15-minute window of
-- 'login:<email>' on (the same counter as auth_login: a stolen session cannot guess the
-- password faster than a login can). On success: deleted_at = app.now(), purge_after 30 days
-- later, every session revoked, every unused reset code used up, the NUDGE notifications it sent
-- deleted from the receivers' inboxes, the guild left (app._guild_depart). The email stays taken
-- while the row exists.
CREATE OR REPLACE FUNCTION account_delete(p_key bytea) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_email text;
  v_attempts int;
  v_stored bytea;
BEGIN
  IF octet_length(p_key) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'account_delete: key must be 32 bytes';
  END IF;
  SELECT u.email INTO v_email FROM users u WHERE u.id = v_user AND u.deleted_at IS NULL;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;
  -- one auth transaction per email at a time (10-auth.sql): a login in flight finishes before
  -- the account goes, or sees it gone
  PERFORM pg_advisory_xact_lock(hashtextextended('auth:' || v_email, 0));
  v_attempts := app._throttle_hit('login:' || v_email, interval '15 minutes');
  -- no row lock: every auth function of this email waits on the advisory lock above
  SELECT c.key INTO v_stored
    FROM users u JOIN credentials c ON c.user_id = u.id
   WHERE u.id = v_user AND u.deleted_at IS NULL;
  IF NOT app._same_bytes(v_stored, p_key) OR v_attempts > 5 THEN
    RETURN false;
  END IF;

  UPDATE sessions SET revoked_at = app.now() WHERE user_id = v_user AND revoked_at IS NULL;
  UPDATE users SET deleted_at = app.now(), purge_after = app.now() + interval '30 days' WHERE id = v_user;
  UPDATE reset_codes SET used_at = app.now() WHERE user_id = v_user AND used_at IS NULL;
  -- the nudges this user sent leave the receivers' inboxes now: the payload names the sender
  -- (the dedupe key of a NUDGE is its event id, 52-nudge.sql). A nudge sent in flight holds the
  -- users row; this statement runs after it and sees what it wrote.
  DELETE FROM notifications n USING nudge_events e
   WHERE e.sender_id = v_user AND n.user_id = e.receiver_id AND n.kind = 'NUDGE' AND n.dedupe_key = e.id::text;
  PERFORM app._guild_depart(v_user);
  RETURN true;
END $$;

-- The caller's nudges, sent and received, oldest first: [{direction: 'SENT' | 'RECEIVED',
-- templateCode, sentAt}]. Nothing of the other party.
CREATE OR REPLACE FUNCTION export_nudges() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'direction', CASE WHEN e.sender_id = app.current_user_id() THEN 'SENT' ELSE 'RECEIVED' END,
           'templateCode', e.template_code, 'sentAt', e.sent_at) ORDER BY e.sent_at, e.id), '[]'::jsonb)
    FROM nudge_events e
   WHERE app.current_user_id() IN (e.sender_id, e.receiver_id)
$$;

REVOKE ALL ON FUNCTION account_salt(), account_delete(bytea), export_nudges()
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION account_salt(), account_delete(bytea), export_nudges() TO app_auth;
SELECT meta.expect_function('account_salt()', 'definer', '{app_auth}');
SELECT meta.expect_function('account_delete(bytea)', 'definer', '{app_auth}');
SELECT meta.expect_function('export_nudges()', 'definer', '{app_auth}');

-- ---------------------------------------------------------------------------------------------
-- The job functions (app_job), run by the housekeeping job.

-- Hard-deletes every user whose purge_after has come (never a decoy); every table of user data
-- cascades from users. A user still in a guild leaves it first (AR-30). Then, for guilds left
-- by any other path (a users row deleted by hand): a guild with members and no leader gets the
-- earliest-joined live member as LEADER, a guild without members is deleted. Returns the number
-- of users deleted: at most 50 per call (the housekeeping job calls it again until 0). A user
-- whose guild another transaction holds is skipped, never waited for (the next run takes it).
-- ponytail: 50 accounts per statement, each with its cascade, under the 10 s statement timeout
-- of the pool (every key of the cascade is indexed, a test pins that); a user with years of
-- data, or a slower disk, lowers it. Upgrade path: per-user transactions in the job.
CREATE OR REPLACE FUNCTION job_account_purge(p_now timestamptz) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_guild uuid;
  v_count int := 0;
BEGIN
  FOR v_user IN
    SELECT u.id FROM users u
     WHERE u.purge_after <= p_now AND NOT app._is_decoy(u.id)
     ORDER BY u.id
       FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_count >= 50;
    SELECT m.guild_id INTO v_guild FROM guild_memberships m WHERE m.user_id = v_user;
    IF v_guild IS NOT NULL THEN
      PERFORM 1 FROM guilds g WHERE g.id = v_guild FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
    END IF;
    PERFORM app._guild_depart(v_user);
    DELETE FROM users WHERE id = v_user;
    v_count := v_count + 1;
  END LOOP;

  FOR v_guild IN
    SELECT g.id FROM guilds g
     WHERE NOT EXISTS (SELECT 1 FROM guild_memberships m WHERE m.guild_id = g.id AND m.role = 'LEADER')
     ORDER BY g.id
       FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE guild_memberships SET role = 'LEADER'
     WHERE user_id = (SELECT m.user_id FROM guild_memberships m
                        JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
                       WHERE m.guild_id = v_guild
                       ORDER BY m.joined_at, m.user_id
                       LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM guild_memberships m WHERE m.guild_id = v_guild AND m.role = 'LEADER');
    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM guild_memberships m WHERE m.guild_id = v_guild) THEN
      DELETE FROM guilds WHERE id = v_guild;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

-- Deletes the idempotency keys made 7 days or more before p_now (AR-08), stored answers with
-- them, except the decoys'. Returns how many.
CREATE OR REPLACE FUNCTION job_purge_idempotency(p_now timestamptz) RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH gone AS (
    DELETE FROM idempotency_keys k
     WHERE k.created_at <= p_now - interval '7 days' AND NOT app._is_decoy(k.user_id)
    RETURNING 1
  )
  SELECT count(*)::int FROM gone
$$;

-- Deletes what the auth functions no longer read, except the decoys': sessions expired or
-- revoked, reset codes expired, throttle rows whose window started an hour or more before
-- p_now (the longest window is one hour). Returns how many rows in all.
CREATE OR REPLACE FUNCTION job_purge_auth(p_now timestamptz) RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH sessions_gone AS (
    DELETE FROM sessions s
     WHERE (s.expires_at <= p_now OR s.revoked_at IS NOT NULL) AND NOT app._is_decoy(s.user_id)
    RETURNING 1
  ), codes_gone AS (
    DELETE FROM reset_codes r
     WHERE r.expires_at <= p_now AND NOT app._is_decoy(r.user_id)
    RETURNING 1
  ), throttle_gone AS (
    DELETE FROM auth_throttle t
     WHERE t.window_start <= p_now - interval '1 hour' AND t.key NOT LIKE '%@decoy.invalid'
    RETURNING 1
  )
  SELECT ((SELECT count(*) FROM sessions_gone) + (SELECT count(*) FROM codes_gone)
          + (SELECT count(*) FROM throttle_gone))::int
$$;

REVOKE ALL ON FUNCTION
  job_account_purge(timestamptz), job_purge_idempotency(timestamptz), job_purge_auth(timestamptz)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  job_account_purge(timestamptz), job_purge_idempotency(timestamptz), job_purge_auth(timestamptz)
  TO app_job;
SELECT meta.expect_function('job_account_purge(timestamptz)', 'definer', '{app_job}');
SELECT meta.expect_function('job_purge_idempotency(timestamptz)', 'definer', '{app_job}');
SELECT meta.expect_function('job_purge_auth(timestamptz)', 'definer', '{app_job}');
