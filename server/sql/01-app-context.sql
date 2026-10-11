-- Schema app: helpers that policies, column defaults and functions call. Re-runnable.
-- A helper whose name starts with "_" is internal: EXECUTE is granted to no app_* role.

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO app_anon, app_auth, app_job;

-- The user of the current request, set by the server with set_config('app.user_id', ..., true).
-- A pooled connection that has carried a user before reads '' afterwards, not NULL.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- The only clock SQL may read. Tests freeze it through the owner-only table meta.test_clock
-- (created in 02-meta.sql, hence plpgsql: the body is bound at call time).
CREATE OR REPLACE FUNCTION app.now() RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN coalesce((SELECT c.now FROM meta.test_clock c), now());
END $$;

-- The logical day runs 03:00 -> 02:59:59 on the wall clock of the zone (spec 6.1).
CREATE OR REPLACE FUNCTION app.logical_date(ts timestamptz, tz text) RETURNS date
LANGUAGE sql IMMUTABLE
AS $$ SELECT ((ts AT TIME ZONE tz) - interval '3 hours')::date $$;

-- Monday of the week of d.
CREATE OR REPLACE FUNCTION app.week_start(d date) RETURNS date
LANGUAGE sql IMMUTABLE
AS $$ SELECT d - (extract(isodow FROM d)::int - 1) $$;

REVOKE ALL ON FUNCTION
  app.current_user_id(), app.now(), app.logical_date(timestamptz, text), app.week_start(date)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.current_user_id(), app.now(), app.logical_date(timestamptz, text), app.week_start(date)
  TO app_anon, app_auth, app_job;
