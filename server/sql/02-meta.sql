-- Schema meta: the test clock and the verification registry. Owner only: no app_* role holds
-- any privilege here. Re-runnable.
--
-- Every SQL file declares what it expects of its own tables, policies and functions with
-- meta.expect_*; 90-verify.sql compares those declarations with the catalog.

CREATE SCHEMA IF NOT EXISTS meta;
REVOKE ALL ON SCHEMA meta FROM PUBLIC, app_conn, app_anon, app_auth, app_job;

-- At most one row. While it exists app.now() returns it: tests only (90-verify.sql refuses it).
CREATE TABLE IF NOT EXISTS meta.test_clock (
  one boolean PRIMARY KEY DEFAULT true CHECK (one),
  now timestamptz NOT NULL
);

-- class         RLS   app_auth is granted                     rows are written by
-- own_read      on    SELECT                                  SECURITY DEFINER functions only
-- own_rw        on    exactly auth_privileges (among SELECT,  the owner of the row, through policies
--                     INSERT, UPDATE, DELETE), and UPDATE on
--                     exactly auth_update_columns
-- internal      on    nothing (and no policy)                 SECURITY DEFINER functions only
-- content       -     SELECT                                  the schema owner (seeders)
-- owner_column: the column holding the owning user id; null for internal and content.
-- No other role is granted anything on any table, whatever its class.
CREATE TABLE IF NOT EXISTS meta.expected_tables (
  name text PRIMARY KEY,
  class text NOT NULL,
  auth_privileges text[] NOT NULL,
  auth_update_columns text[] NOT NULL,
  owner_column text
);

-- using_expr / check_expr: the exact text pg_get_expr prints for the policy, or null.
-- Every policy is PERMISSIVE and TO app_auth: 90-verify.sql accepts nothing else.
CREATE TABLE IF NOT EXISTS meta.expected_policies (
  table_name text NOT NULL REFERENCES meta.expected_tables (name) ON DELETE CASCADE,
  policy text NOT NULL,
  cmd text NOT NULL CHECK (cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')),
  using_expr text,
  check_expr text,
  PRIMARY KEY (table_name, policy)
);

-- roles: exactly the roles granted EXECUTE (PUBLIC counts as one). Every function in public,
-- app and meta must be registered; internal ones (app._*, everything in meta) with '{}'.
CREATE TABLE IF NOT EXISTS meta.expected_functions (
  signature text PRIMARY KEY,
  roles text[] NOT NULL
);

-- The registry is exactly what the files of this run declare: nothing survives from a
-- declaration that has since been renamed or removed.
DELETE FROM meta.expected_policies;
DELETE FROM meta.expected_tables;
DELETE FROM meta.expected_functions;

CREATE OR REPLACE FUNCTION meta.expect_table(
  p_name text, p_class text, p_auth_privileges text[], p_auth_update_columns text[], p_owner_column text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  problem text := CASE
    WHEN p_class NOT IN ('own_read', 'own_rw', 'internal', 'content')
      THEN 'unknown class'
    WHEN (p_class IN ('own_read', 'own_rw')) <> (p_owner_column IS NOT NULL)
      THEN 'owner_column is required for own_read and own_rw, and null for the other classes'
    WHEN p_class IN ('own_read', 'content') AND NOT (p_auth_privileges = '{SELECT}' AND p_auth_update_columns = '{}')
      THEN 'app_auth holds exactly {SELECT} and no column grant'
    WHEN p_class = 'internal' AND NOT (p_auth_privileges = '{}' AND p_auth_update_columns = '{}')
      THEN 'app_auth holds nothing'
    -- TRUNCATE ignores row level security; REFERENCES and TRIGGER are not a client's business
    WHEN p_class = 'own_rw' AND NOT p_auth_privileges <@ ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
      THEN 'app_auth may hold only SELECT, INSERT, UPDATE, DELETE'
  END;
BEGIN
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'meta.expect_table(%, %): %', p_name, p_class, problem USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO meta.expected_tables (name, class, auth_privileges, auth_update_columns, owner_column)
  VALUES (p_name, p_class, p_auth_privileges, p_auth_update_columns, p_owner_column)
  ON CONFLICT (name) DO UPDATE SET
    class = EXCLUDED.class,
    auth_privileges = EXCLUDED.auth_privileges,
    auth_update_columns = EXCLUDED.auth_update_columns,
    owner_column = EXCLUDED.owner_column;
END $$;

CREATE OR REPLACE FUNCTION meta.expect_policy(
  p_table text, p_policy text, p_cmd text, p_using_expr text, p_check_expr text
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO meta.expected_policies (table_name, policy, cmd, using_expr, check_expr)
  VALUES (p_table, p_policy, p_cmd, p_using_expr, p_check_expr)
  ON CONFLICT (table_name, policy) DO UPDATE SET
    cmd = EXCLUDED.cmd,
    using_expr = EXCLUDED.using_expr,
    check_expr = EXCLUDED.check_expr
$$;

-- p_signature as in GRANT EXECUTE ON FUNCTION: 'auth_login(text, bytea, bytea)', with the
-- schema for a function outside public. The function must exist; it is stored in the canonical
-- form 90-verify.sql prints, for which both sides pin the same search_path.
CREATE OR REPLACE FUNCTION meta.expect_function(p_signature text, p_roles text[]) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp
AS $$
  INSERT INTO meta.expected_functions (signature, roles)
  VALUES (p_signature::regprocedure::text, p_roles)
  ON CONFLICT (signature) DO UPDATE SET roles = EXCLUDED.roles
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA meta FROM PUBLIC, app_conn, app_anon, app_auth, app_job;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA meta FROM PUBLIC, app_conn, app_anon, app_auth, app_job;

-- What 01-app-context.sql and this file created.
SELECT meta.expect_function('app.current_user_id()', '{app_anon,app_auth,app_job}');
SELECT meta.expect_function('app.now()', '{app_anon,app_auth,app_job}');
SELECT meta.expect_function('app.logical_date(timestamptz, text)', '{app_anon,app_auth,app_job}');
SELECT meta.expect_function('app.week_start(date)', '{app_anon,app_auth,app_job}');
SELECT meta.expect_function('meta.expect_table(text, text, text[], text[], text)', '{}');
SELECT meta.expect_function('meta.expect_policy(text, text, text, text, text)', '{}');
SELECT meta.expect_function('meta.expect_function(text, text[])', '{}');
