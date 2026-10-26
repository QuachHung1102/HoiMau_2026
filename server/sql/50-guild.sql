-- Guilds: up to eight members joined by invite code, one guild per user, one leader per guild,
-- and the one read a member has of the others: guild_overview. Re-runnable.
--
-- What a member sees of another member is display name, role, join date, XP sum and STORY
-- counts per day (F-11, R-P.1). guild_overview reads users, guild_memberships, guilds,
-- xp_ledger, daily_logs (id and logical_date only), quests, quest_completions and
-- freeze_tickets, and nothing else: no biometric, prescription, nutrition or journal table, no
-- calories_in or water_ml (a test reads its source for those names).
--
-- Rules for whoever edits this file:
--   * ONE lock order in every function: the caller's users row (FOR NO KEY UPDATE, in
--     app._lock_member, the first lock of every write of the user, as in 30-day.sql and
--     41-shop.sql), then the guilds row (FOR UPDATE), then guild_memberships rows. The guild row
--     is the mutex of its member list: whoever counts members, reads a role or changes either
--     holds it, and READS AGAIN after taking it what it read before (a concurrent transfer may
--     have changed the caller's role). progression_state is never locked here;
--   * FOR UPDATE on guilds although other tables reference it: a membership row is only
--     inserted under that same lock (or for a guild made in the same transaction); the one other
--     holder of a key-share lock on a guild is job_apply_guild_week (51-guild-week.sql), which
--     takes every users row it needs BEFORE it touches a guild, so it never waits for a users
--     row while it holds a guild, and no cycle can form with the order above;
--   * "one leader per guild" is the unique index below, so a role swap demotes before it
--     promotes, in two statements;
--   * a refusal is raised with SQLSTATE HM000; time is app.now() only.

-- name: trimmed, 3 to 30 characters, unique ignoring case. invite_code: 8 characters of
-- ABCDEFGHJKLMNPQRSTUVWXYZ23456789 for every guild a user makes; the table takes any 8 of A-Z
-- and 0-9 so that the decoy guild (86-decoy-guild.sql) can hold a code guild_join never matches.
CREATE TABLE IF NOT EXISTS guilds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 3 AND 30),
  motto text NOT NULL DEFAULT '' CHECK (char_length(motto) <= 80),
  invite_code text NOT NULL CONSTRAINT guilds_invite_code_key UNIQUE CHECK (invite_code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS guilds_name_key ON guilds (lower(name));
-- NFC only (guild_create normalizes): a decomposed spelling of a taken name is that name, not a
-- second guild that renders the same. Dropped and added again so an edit reaches an existing table.
ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_text_nfc_check;
ALTER TABLE guilds ADD CONSTRAINT guilds_text_nfc_check CHECK (name IS NFC NORMALIZED AND motto IS NFC NORMALIZED);

-- One row per current member: a user who leaves loses the row (a departed member is no one's
-- business any more). joined_at drives the mid-week average (D-08).
CREATE TABLE IF NOT EXISTS guild_memberships (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  guild_id uuid NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('LEADER', 'MEMBER')),
  joined_at timestamptz NOT NULL DEFAULT app.now(),
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE INDEX IF NOT EXISTS guild_memberships_guild_idx ON guild_memberships (guild_id);
CREATE UNIQUE INDEX IF NOT EXISTS guild_memberships_one_leader_idx ON guild_memberships (guild_id)
  WHERE role = 'LEADER';

ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_select ON guild_memberships;
CREATE POLICY own_select ON guild_memberships FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

REVOKE ALL ON guilds, guild_memberships FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON guild_memberships TO app_auth;

SELECT meta.expect_table('guilds', 'internal', '{}', '{}', NULL);
SELECT meta.expect_table('guild_memberships', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('guild_memberships', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role, not SECURITY DEFINER.

-- The caller's users row, locked: ONBOARDING_REQUIRED for a caller who is not a live,
-- onboarded user.
CREATE OR REPLACE FUNCTION app._lock_member(p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM users u
   WHERE u.id = p_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
END $$;

-- A new invite code: 8 characters of the 32-character alphabet, one random byte each
-- (256 is a multiple of 32, so every character is equally likely).
CREATE OR REPLACE FUNCTION app._invite_code() RETURNS text
LANGUAGE sql VOLATILE SET search_path = public, pg_temp
AS $$
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', get_byte(s.b, i) % 32 + 1, 1), '' ORDER BY i)
    FROM (SELECT sha256(uuid_send(gen_random_uuid())) AS b) s, generate_series(0, 7) i
$$;

-- The days of p_from..p_through on which the user has a log, as memberWeek (domain/guild.ts)
-- takes them: [{date, storyDone, storyTotal, frozen}] by date. STORY done / total for the
-- user's archetype; frozen = a ticket was used for the date and the STORY quests are not all
-- done (a ticket on a completed day leaves it completed). The one copy of this rule:
-- guild_overview and job_guild_week_inputs (51-guild-week.sql) both read it here.
CREATE OR REPLACE FUNCTION app._member_days(p_user uuid, p_from date, p_through date) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.logical_date, 'storyDone', k.done, 'storyTotal', k.total,
           'frozen', NOT (k.total > 0 AND k.done = k.total) AND EXISTS (
             SELECT 1 FROM freeze_tickets t WHERE t.user_id = d.user_id AND t.used_for_date = d.logical_date))
         ORDER BY d.logical_date), '[]'::jsonb)
    FROM users u
    JOIN daily_logs d ON d.user_id = u.id
   CROSS JOIN LATERAL (
          SELECT count(c.completed_at)::int AS done, count(*)::int AS total
            FROM quests q
            LEFT JOIN quest_completions c ON c.quest_id = q.id AND c.daily_log_id = d.id
           WHERE q.category = 'STORY' AND q.is_active AND u.archetype = ANY (q.archetypes)) k
   WHERE u.id = p_user AND d.logical_date BETWEEN p_from AND p_through
$$;

REVOKE ALL ON FUNCTION app._lock_member(uuid), app._invite_code(), app._member_days(uuid, date, date)
  FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._lock_member(uuid)', 'invoker', '{}');
SELECT meta.expect_function('app._invite_code()', 'invoker', '{}');
SELECT meta.expect_function('app._member_days(uuid, date, date)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The five functions the server calls. The caller is app.current_user_id().

-- Makes a guild with the caller as its LEADER. Name and motto are NFC-normalized and trimmed
-- before every check and before they are stored. In this order: VALIDATION_FAILED (name 3 to 30
-- characters once trimmed, motto at most 80; the route judged both before, this is the second
-- fence), ALREADY_IN_GUILD, GUILD_NAME_TAKEN (any case; also the loser of two creates racing
-- for one name, who waits on the unique index). An invite code that is taken is drawn again,
-- up to five times. The banned-term check is the route's (domain/language.ts).
CREATE OR REPLACE FUNCTION guild_create(p_name text, p_motto text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_name text := btrim(normalize(p_name, NFC));
  v_motto text := coalesce(btrim(normalize(p_motto, NFC)), '');
  v_id uuid;
  v_constraint text;
BEGIN
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"name","rule":"format"}]}';
  END IF;
  IF char_length(v_motto) > 80 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"motto","rule":"max"}]}';
  END IF;
  PERFORM app._lock_member(v_user);
  IF EXISTS (SELECT 1 FROM guild_memberships m WHERE m.user_id = v_user) THEN
    RAISE EXCEPTION 'ALREADY_IN_GUILD' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  FOR attempt IN 1..5 LOOP
    BEGIN
      INSERT INTO guilds (name, motto, invite_code) VALUES (v_name, v_motto, app._invite_code())
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'guilds_name_key' THEN
        RAISE EXCEPTION 'GUILD_NAME_TAKEN' USING ERRCODE = 'HM000', DETAIL = '{}';
      ELSIF v_constraint <> 'guilds_invite_code_key' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'guild_create: no free invite code in 5 draws';
  END IF;
  INSERT INTO guild_memberships (user_id, guild_id, role) VALUES (v_user, v_id, 'LEADER');
  RETURN v_id;
END $$;

-- Joins the guild of the invite code, trimmed and upper-cased. In this order:
-- INVITE_CODE_INVALID (no guild has it, or it is not 8 characters of the invite alphabet: the
-- decoy guild's code never matches), ALREADY_IN_GUILD (in any guild, this one included),
-- GUILD_FULL (8 members, counted under the guild's lock, so parallel joins cannot pass 8).
CREATE OR REPLACE FUNCTION guild_join(p_invite_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_code text := upper(btrim(p_invite_code));
  v_guild uuid;
BEGIN
  PERFORM app._lock_member(v_user);
  SELECT g.id INTO v_guild FROM guilds g
   WHERE v_code ~ '^[A-HJ-NP-Z2-9]{8}$' AND g.invite_code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_CODE_INVALID' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF EXISTS (SELECT 1 FROM guild_memberships m WHERE m.user_id = v_user) THEN
    RAISE EXCEPTION 'ALREADY_IN_GUILD' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF (SELECT count(*) FROM guild_memberships m WHERE m.guild_id = v_guild) >= 8 THEN
    RAISE EXCEPTION 'GUILD_FULL' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  INSERT INTO guild_memberships (user_id, guild_id, role) VALUES (v_user, v_guild, 'MEMBER');
  RETURN v_guild;
END $$;

-- Leaves the guild. NOT_IN_GUILD; LEADER_MUST_TRANSFER for a leader with other
-- members. A lone leader's guild is deleted with its row (its invite code with it); a member's
-- row is deleted. The role is read after the guild's lock.
CREATE OR REPLACE FUNCTION guild_leave() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_guild uuid;
  v_role text;
BEGIN
  PERFORM app._lock_member(v_user);
  SELECT m.guild_id INTO v_guild FROM guild_memberships m WHERE m.user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_IN_GUILD' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  PERFORM 1 FROM guilds g WHERE g.id = v_guild FOR UPDATE;
  SELECT m.role INTO v_role FROM guild_memberships m WHERE m.user_id = v_user;
  IF v_role = 'MEMBER' THEN
    DELETE FROM guild_memberships WHERE user_id = v_user;
  ELSIF EXISTS (SELECT 1 FROM guild_memberships m WHERE m.guild_id = v_guild AND m.user_id <> v_user) THEN
    RAISE EXCEPTION 'LEADER_MUST_TRANSFER' USING ERRCODE = 'HM000', DETAIL = '{}';
  ELSE
    DELETE FROM guilds WHERE id = v_guild;
  END IF;
END $$;

-- Hands leadership to another member of the caller's guild: the caller becomes MEMBER, the
-- target LEADER. In this order: NOT_LEADER (in no guild, or not its leader, read after the
-- guild's lock), TRANSFER_TARGET_INVALID (the caller, or anyone not in this guild).
CREATE OR REPLACE FUNCTION guild_transfer(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_guild uuid;
BEGIN
  PERFORM app._lock_member(v_user);
  SELECT m.guild_id INTO v_guild FROM guild_memberships m WHERE m.user_id = v_user;
  IF FOUND THEN
    PERFORM 1 FROM guilds g WHERE g.id = v_guild FOR UPDATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM guild_memberships m
                  WHERE m.user_id = v_user AND m.guild_id = v_guild AND m.role = 'LEADER') THEN
    RAISE EXCEPTION 'NOT_LEADER' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_user OR NOT EXISTS (
       SELECT 1 FROM guild_memberships m WHERE m.user_id = p_user_id AND m.guild_id = v_guild) THEN
    RAISE EXCEPTION 'TRANSFER_TARGET_INVALID' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  UPDATE guild_memberships SET role = 'MEMBER' WHERE user_id = v_user;
  UPDATE guild_memberships SET role = 'LEADER' WHERE user_id = p_user_id;
END $$;

-- Re-created by 52-nudge.sql (adds nudge): edit the body there, and keep both in step.
-- The caller's guild as buildGuild (readModels/guild.ts) needs it, or {"guild": null}. It has
-- no parameter: the guild is the caller's, there is no other to ask for.
--   {guild: {id, name, motto, inviteCode, createdAt, myRole,
--            today: the Asia/Ho_Chi_Minh calendar date of app.now(), weekStart: its Monday,
--            lastLogDate: the latest logical date of any member's log (null without one),
--            members: [{userId, displayName, role, joinedDate (the member's logical date of
--                       joined_at), xp (the XP sum),
--                       days: app._member_days over the week (each date of it with a log),
--                       today: {date (the member's own logical date), storyDone, storyTotal}}]
--            leader first, then by joined_at}}
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
                                   WHERE q.category = 'STORY' AND q.is_active AND u.archetype = ANY (q.archetypes))))
               ORDER BY m.role = 'LEADER' DESC, m.joined_at, u.id)
          FROM guild_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.guild_id = g.id))
      FROM mine JOIN guilds g ON g.id = mine.guild_id))
$$;

REVOKE ALL ON FUNCTION
  guild_create(text, text), guild_join(text), guild_leave(), guild_transfer(uuid), guild_overview()
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  guild_create(text, text), guild_join(text), guild_leave(), guild_transfer(uuid), guild_overview()
  TO app_auth;
SELECT meta.expect_function('guild_create(text, text)', 'definer', '{app_auth}');
SELECT meta.expect_function('guild_join(text)', 'definer', '{app_auth}');
SELECT meta.expect_function('guild_leave()', 'definer', '{app_auth}');
SELECT meta.expect_function('guild_transfer(uuid)', 'definer', '{app_auth}');
SELECT meta.expect_function('guild_overview()', 'definer', '{app_auth}');
