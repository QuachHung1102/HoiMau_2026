-- Accounts: users, credentials, sessions, password-reset codes. Re-runnable.
--
-- Every rule lives in the seven auth_* functions at the end (SECURITY DEFINER): attempt limits,
-- uniform failures, session validity. A request role never reads a credential, a session or a
-- code; a signed-in user reads the own users row and edits two of its columns.
--
-- Rules for whoever edits the functions:
--   * a failure is a return value (null / false), never an exception: the caller commits, and
--     with it the attempt the failing call counted. What raises is a bug of the server (an
--     argument of the wrong size, checked before the first write; a token hash already in use;
--     a missing pepper), or auth_register, which counts nothing;
--   * no key, hash or salt in a message. A constraint violation prints the whole row into the
--     error and the server log, so every size is checked here before the row is written;
--   * time is app.now() only;
--   * SECURITY DEFINER is not subject to row level security: "the user is not deleted" is
--     written out in every lookup.

-- The time zone names PostgreSQL knows, copied so that users.timezone can reference them: the
-- view reads the zone files on every query (about 250 ms on the development machine), a foreign
-- key lookup does not. '+07:00', 'ICT' and 'UTC+7' are not names: they mean something else, or
-- nothing, to JavaScript. A migration after a tzdata update adds the new names.
CREATE TABLE IF NOT EXISTS timezones (
  name text PRIMARY KEY
);
INSERT INTO timezones (name)
SELECT name FROM pg_timezone_names
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- stored as app._email() returns it; stays reserved while the row exists, deleted or not
  email text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 1 AND 254),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' REFERENCES timezones (name),
  archetype text CHECK (archetype IN ('TANKER', 'ASSASSIN', 'SUPPORTER')),
  archetype_set_at timestamptz,
  onboarded_at timestamptz,
  terms_accepted_at timestamptz NOT NULL,
  deleted_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS credentials (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  salt bytea NOT NULL CHECK (octet_length(salt) = 16),
  key bytea NOT NULL CHECK (octet_length(key) = 32),
  created_at timestamptz NOT NULL DEFAULT app.now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE INDEX IF NOT EXISTS reset_codes_user_id_idx ON reset_codes (user_id);

-- key: 'login:<email>' (failed logins, 15 minutes) or 'reset:<email>' (code requests, 1 hour).
-- A row whose window is over is reused by the next hit and may be deleted at any time.
CREATE TABLE IF NOT EXISTS auth_throttle (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count int NOT NULL CHECK (count >= 1),
  created_at timestamptz NOT NULL DEFAULT app.now()
);

CREATE TABLE IF NOT EXISTS app_secrets (
  name text PRIMARY KEY,
  value bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now()
);
-- 32 bytes from two random uuids (244 random bits), made once: a new value would change the
-- fake salt of every unknown email, which is exactly what an observer must never see.
INSERT INTO app_secrets (name, value)
VALUES ('fake_salt_pepper', sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())))
ON CONFLICT (name) DO NOTHING;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON users;
CREATE POLICY own_select ON users FOR SELECT TO app_auth
  USING (app.current_user_id() = id);
DROP POLICY IF EXISTS own_update ON users;
CREATE POLICY own_update ON users FOR UPDATE TO app_auth
  USING (app.current_user_id() = id) WITH CHECK (app.current_user_id() = id);

REVOKE ALL ON timezones, users, credentials, sessions, reset_codes, auth_throttle, app_secrets
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON timezones TO app_auth;
GRANT SELECT ON users TO app_auth;
GRANT UPDATE (display_name, timezone) ON users TO app_auth;

SELECT meta.expect_table('timezones', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('users', 'own_rw', '{SELECT}', '{display_name,timezone}', 'id');
SELECT meta.expect_policy('users', 'own_select', 'SELECT', '(app.current_user_id() = id)', NULL);
SELECT meta.expect_policy('users', 'own_update', 'UPDATE',
  '(app.current_user_id() = id)', '(app.current_user_id() = id)');
SELECT meta.expect_table('credentials', 'internal', '{}', '{}', NULL);
SELECT meta.expect_table('sessions', 'internal', '{}', '{}', NULL);
SELECT meta.expect_table('reset_codes', 'internal', '{}', '{}', NULL);
SELECT meta.expect_table('auth_throttle', 'internal', '{}', '{}', NULL);
SELECT meta.expect_table('app_secrets', 'internal', '{}', '{}', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role.

-- The one spelling of an email: spaces trimmed, lower-cased by the database collation (ICU:
-- full Unicode case mapping, the result JavaScript's toLowerCase() gives). No Unicode
-- normalisation: a composed and a decomposed spelling are two emails. Null when the result is
-- empty or longer than 254 characters: such an email names no account.
CREATE OR REPLACE FUNCTION app._email(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN char_length(s.email) BETWEEN 1 AND 254 THEN s.email END
    FROM (SELECT lower(btrim(p_email)) AS email) s
$$;

-- Equality that reads every byte whatever the first difference is. False for null, for
-- different lengths and for two empty values.
CREATE OR REPLACE FUNCTION app._same_bytes(a bytea, b bytea) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(octet_length(a) = octet_length(b) AND bit_or(get_byte(a, i) # get_byte(b, i)) = 0, false)
    FROM generate_series(0, least(octet_length(a), octet_length(b)) - 1) i
$$;

-- Counts one hit on p_key and returns the count inside the current window. The window starts
-- at the first hit and is not moved by later ones; once it is over the row starts again at 1.
CREATE OR REPLACE FUNCTION app._throttle_hit(p_key text, p_window interval) RETURNS int
LANGUAGE sql SET search_path = public, pg_temp
AS $$
  INSERT INTO auth_throttle AS t (key, window_start, count)
  VALUES (p_key, app.now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN t.window_start + p_window <= app.now() THEN app.now() ELSE t.window_start END,
    count = CASE WHEN t.window_start + p_window <= app.now() THEN 1 ELSE t.count + 1 END
  RETURNING t.count
$$;

-- A new 30-day session. A token hash that already names a session is a bug of the caller, and
-- answering "done" would hand the caller somebody else's session: refuse, without the value.
CREATE OR REPLACE FUNCTION app._session_open(p_user uuid, p_token_hash bytea) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO sessions (user_id, token_hash, expires_at)
  VALUES (p_user, p_token_hash, app.now() + interval '30 days')
  ON CONFLICT (token_hash) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth: this token hash already names a session';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- The seven functions the server calls.

-- The salt to derive the key with: the stored one, or for an email without a live account the
-- first 16 bytes of sha256(pepper || email), the same on every call. Both are computed every
-- time, so that a known email does not run fewer statements than an unknown one.
CREATE OR REPLACE FUNCTION auth_salt(p_email text) RETURNS bytea
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := app._email(p_email);
  v_stored bytea;
  v_fake bytea;
BEGIN
  SELECT c.salt INTO v_stored
    FROM users u JOIN credentials c ON c.user_id = u.id
   WHERE lower(u.email) = v_email AND u.deleted_at IS NULL;
  SELECT substring(sha256(s.value || convert_to(coalesce(v_email, ''), 'UTF8')) FROM 1 FOR 16) INTO v_fake
    FROM app_secrets s WHERE s.name = 'fake_salt_pepper';
  IF v_fake IS NULL THEN
    -- without it an unknown email would answer null: an oracle, and a crash in the caller
    RAISE EXCEPTION 'auth_salt: app_secrets has no fake_salt_pepper';
  END IF;
  RETURN coalesce(v_stored, v_fake);
END $$;

-- User, credentials and first session in one go. The only auth function that raises its
-- refusals (it counts no attempts): HM000 with the error code of the API as the message.
CREATE OR REPLACE FUNCTION auth_register(
  p_email text, p_display_name text, p_salt bytea, p_key bytea, p_token_hash bytea
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := app._email(p_email);
  v_user uuid;
BEGIN
  IF octet_length(p_salt) IS DISTINCT FROM 16 OR octet_length(p_key) IS DISTINCT FROM 32
     OR octet_length(p_token_hash) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'auth_register: salt must be 16 bytes, key and token hash 32 bytes each';
  END IF;
  -- second fence: the route has validated both before
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"email","rule":"format"}]}';
  ELSIF coalesce(char_length(p_display_name), 0) < 1 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"displayName","rule":"min"}]}';
  ELSIF char_length(p_display_name) > 40 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"displayName","rule":"max"}]}';
  END IF;

  -- the email of a deleted account is still a row, so it is still taken
  INSERT INTO users (email, display_name, terms_accepted_at)
  VALUES (v_email, p_display_name, app.now())
  ON CONFLICT (lower(email)) DO NOTHING
  RETURNING id INTO v_user;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'REGISTRATION_UNAVAILABLE' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  INSERT INTO credentials (user_id, salt, key) VALUES (v_user, p_salt, p_key);
  PERFORM app._session_open(v_user, p_token_hash);
  RETURN v_user;
END $$;

-- The user id and a new session, or null: unknown email, wrong key, deleted user, locked email
-- all look the same. Every call counts as one attempt on 'login:<email>' before anything is
-- compared; from the sixth attempt of a 15-minute window on the answer is null whatever the
-- key, and a success deletes the count. Counting first is what makes the limit hold for
-- attempts sent at the same moment.
CREATE OR REPLACE FUNCTION auth_login(p_email text, p_key bytea, p_token_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := app._email(p_email);
  v_attempts int;
  v_user uuid;
  v_stored bytea;
  v_dummy bytea;
  v_match boolean;
BEGIN
  IF octet_length(p_key) IS DISTINCT FROM 32 OR octet_length(p_token_hash) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'auth_login: key and token hash must be 32 bytes each';
  END IF;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;
  -- one auth transaction per email at a time: a login and a password reset of the same account
  -- never overlap, so a reset revokes every session, also the one of a login in flight
  PERFORM pg_advisory_xact_lock(hashtextextended('auth:' || v_email, 0));
  v_attempts := app._throttle_hit('login:' || v_email, interval '15 minutes');

  -- the same statements for every email: an unknown one is compared with a key nobody has
  SELECT u.id, c.key INTO v_user, v_stored
    FROM users u JOIN credentials c ON c.user_id = u.id
   WHERE lower(u.email) = v_email AND u.deleted_at IS NULL;
  SELECT sha256(s.value || convert_to('login:' || v_email, 'UTF8')) INTO v_dummy
    FROM app_secrets s WHERE s.name = 'fake_salt_pepper';
  v_match := app._same_bytes(coalesce(v_stored, v_dummy), p_key);
  IF v_user IS NULL OR NOT v_match OR v_attempts > 5 THEN
    RETURN NULL;
  END IF;

  DELETE FROM auth_throttle WHERE key = 'login:' || v_email;
  PERFORM app._session_open(v_user, p_token_hash);
  RETURN v_user;
END $$;

-- The user of a session, or null: unknown, revoked, expired, or the user is deleted. Slides
-- the expiry to 30 days once less than 29 remain, so a session is written at most once a day.
CREATE OR REPLACE FUNCTION auth_session(p_token_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_session uuid;
  v_user uuid;
  v_expires timestamptz;
BEGIN
  SELECT s.id, s.user_id, s.expires_at INTO v_session, v_user, v_expires
    FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > app.now()
     AND u.deleted_at IS NULL;
  IF v_expires < app.now() + interval '29 days' THEN
    UPDATE sessions SET expires_at = app.now() + interval '30 days' WHERE id = v_session;
  END IF;
  RETURN v_user;
END $$;

-- Revokes the session of that token. Knowing the token is the whole authority, as it is for
-- using the session.
CREATE OR REPLACE FUNCTION auth_logout(p_token_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE sessions SET revoked_at = app.now()
   WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

-- Stores the hash of a new code, valid 10 minutes, and returns true: the caller sends the mail.
-- False, and nothing stored, for an email without a live account or from the fourth request of
-- an hour on; the request is counted on 'reset:<email>' either way. A new code makes the older
-- ones of the account unusable.
CREATE OR REPLACE FUNCTION auth_reset_request(p_email text, p_code_hash bytea) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := app._email(p_email);
  v_requests int;
  v_user uuid;
BEGIN
  IF octet_length(p_code_hash) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'auth_reset_request: code hash must be 32 bytes';
  END IF;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth:' || v_email, 0));
  v_requests := app._throttle_hit('reset:' || v_email, interval '1 hour');
  SELECT u.id INTO v_user FROM users u WHERE lower(u.email) = v_email AND u.deleted_at IS NULL;
  IF v_user IS NULL OR v_requests > 3 THEN
    RETURN false;
  END IF;

  UPDATE reset_codes SET used_at = app.now() WHERE user_id = v_user AND used_at IS NULL;
  INSERT INTO reset_codes (user_id, code_hash, expires_at)
  VALUES (v_user, p_code_hash, app.now() + interval '10 minutes');
  RETURN true;
END $$;

-- Checks p_code_hash against the newest unused, unexpired code of the account. Every call
-- spends one attempt of that code; a mismatch, or any call after the fifth, is false. On a
-- match: new salt and key, the code is used up, every session of the user is revoked, the
-- login lock is lifted. One false for wrong, expired, exhausted, no code, unknown email.
CREATE OR REPLACE FUNCTION auth_reset_confirm(
  p_email text, p_code_hash bytea, p_salt bytea, p_key bytea
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := app._email(p_email);
  v_code uuid;
  v_user uuid;
  v_attempts int;
  v_hash bytea;
  v_match boolean;
BEGIN
  IF octet_length(p_code_hash) IS DISTINCT FROM 32 OR octet_length(p_key) IS DISTINCT FROM 32
     OR octet_length(p_salt) IS DISTINCT FROM 16 THEN
    RAISE EXCEPTION 'auth_reset_confirm: code hash and key must be 32 bytes each, salt 16 bytes';
  END IF;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth:' || v_email, 0));

  UPDATE reset_codes r SET attempts = r.attempts + 1
   WHERE r.id = (SELECT c.id
                   FROM reset_codes c JOIN users u ON u.id = c.user_id
                  WHERE lower(u.email) = v_email AND u.deleted_at IS NULL
                    AND c.used_at IS NULL AND c.expires_at > app.now()
                  ORDER BY c.created_at DESC, c.id
                  LIMIT 1)
     AND r.used_at IS NULL
  RETURNING r.id, r.user_id, r.attempts, r.code_hash INTO v_code, v_user, v_attempts, v_hash;
  v_match := app._same_bytes(v_hash, p_code_hash);
  IF v_code IS NULL OR NOT v_match OR v_attempts > 5 THEN
    RETURN false;
  END IF;

  INSERT INTO credentials (user_id, salt, key) VALUES (v_user, p_salt, p_key)
  ON CONFLICT (user_id) DO UPDATE SET salt = EXCLUDED.salt, key = EXCLUDED.key;
  UPDATE reset_codes SET used_at = app.now() WHERE id = v_code;
  UPDATE sessions SET revoked_at = app.now() WHERE user_id = v_user AND revoked_at IS NULL;
  DELETE FROM auth_throttle WHERE key = 'login:' || v_email;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION
  app._email(text), app._same_bytes(bytea, bytea), app._throttle_hit(text, interval),
  app._session_open(uuid, bytea),
  auth_salt(text), auth_register(text, text, bytea, bytea, bytea), auth_login(text, bytea, bytea),
  auth_session(bytea), auth_logout(bytea), auth_reset_request(text, bytea),
  auth_reset_confirm(text, bytea, bytea, bytea)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  auth_salt(text), auth_register(text, text, bytea, bytea, bytea), auth_login(text, bytea, bytea),
  auth_session(bytea), auth_reset_request(text, bytea),
  auth_reset_confirm(text, bytea, bytea, bytea)
  TO app_anon;
-- the logout route runs with a session
GRANT EXECUTE ON FUNCTION auth_logout(bytea) TO app_anon, app_auth;

SELECT meta.expect_function('app._email(text)', '{}');
SELECT meta.expect_function('app._same_bytes(bytea, bytea)', '{}');
SELECT meta.expect_function('app._throttle_hit(text, interval)', '{}');
SELECT meta.expect_function('app._session_open(uuid, bytea)', '{}');
SELECT meta.expect_function('auth_salt(text)', '{app_anon}');
SELECT meta.expect_function('auth_register(text, text, bytea, bytea, bytea)', '{app_anon}');
SELECT meta.expect_function('auth_login(text, bytea, bytea)', '{app_anon}');
SELECT meta.expect_function('auth_session(bytea)', '{app_anon}');
SELECT meta.expect_function('auth_logout(bytea)', '{app_anon,app_auth}');
SELECT meta.expect_function('auth_reset_request(text, bytea)', '{app_anon}');
SELECT meta.expect_function('auth_reset_confirm(text, bytea, bytea, bytea)', '{app_anon}');
