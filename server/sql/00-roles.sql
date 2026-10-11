-- Roles. The application connects as app_conn, which owns nothing and inherits nothing;
-- every request switches to exactly one of the three NOLOGIN roles with SET LOCAL ROLE.
-- Roles are cluster-global, the rest of this file is per database. Re-runnable.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_conn', 'app_anon', 'app_auth', 'app_job'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I', r);
    END IF;
  END LOOP;
END $$;

ALTER ROLE app_conn LOGIN   NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE app_anon NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE app_auth NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE app_job  NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- Since PostgreSQL 16 each membership carries its own options: INHERIT FALSE keeps app_conn
-- empty-handed after login, SET TRUE is what allows SET LOCAL ROLE.
GRANT app_anon, app_auth, app_job TO app_conn WITH INHERIT FALSE, SET TRUE;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_anon, app_auth, app_job;

-- Functions are executable by PUBLIC by default: without this every later function is open.
-- Applies to functions created by the role that runs the schema files.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
