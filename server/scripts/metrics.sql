-- Success metrics of spec section 12, computed from the database.
--
-- Run as the database owner (the superuser), never through the application: no application role
-- may read every user. For the development database, with npm run server:dev running:
--   psql "postgres://postgres:<superuser password>@127.0.0.1:54330/hoimau" -f server/scripts/metrics.sql
-- (the development password is in server/scripts/cluster.ts; a real deployment uses its own).
--
-- Rules, and server/test/metrics.test.ts holds the queries to them:
--   * ONE statement per metric, under its own comment that starts "-- M-" and a number, and
--     ended by its own semicolon; no other semicolon in the file outside a comment. The test
--     reads the file by those comments.
--   * One row: `value` (the metric) and `n` (how many users it was computed over). A metric with
--     nobody to count over answers value = NULL, never 0: "no one yet" is not "no one returned".
--   * Nothing personal comes out: no id, no email, no name, no date of a person, no measurement.
--     Only a ratio (0 to 1), or for M-04 a median, and a count.
--   * The people counted are real, live accounts: the decoy accounts (@decoy.invalid, the second
--     gate's) and accounts that asked for deletion (deleted_at set) are left out of every query.
--   * Days are the person's own logical days: app.logical_date(app.now(), users.timezone), the
--     same function the application uses, so "yesterday" is yesterday where the person lives.
--     A day that has not ended yet is not counted against anyone: D1 looks only at people whose
--     second day is over, D7 only at people whose eighth day is over.
--   * Every figure is a snapshot at the moment of the run. Nothing is stored.
--
-- Not offered: M-06 (time to record a day, target < 60 seconds) cannot be measured from the server: it would
-- take the time between opening the app and the last write of the day on the phone, and that
-- needs client analytics, which are not built (rule R-P.4: no analytics tool receives anything
-- but anonymous events, and none is approved). The server sees writes, not the screen time
-- between them, so no query is offered for it and none should be invented from timestamps.

-- M-01 Onboarding completion: registered users who finished onboarding / registered users.
-- Target: > 70 %.
SELECT round(count(*) FILTER (WHERE u.onboarded_at IS NOT NULL)::numeric / nullif(count(*), 0), 4) AS value,
       count(*) AS n
  FROM users u
 WHERE u.deleted_at IS NULL AND u.email NOT LIKE '%@decoy.invalid';

-- M-02 Return on the next day (D1): of the onboarded users whose second day is over, the share
-- with a daily log on the day after onboard_date (a log exists only when the person acted).
-- Target: > 40 %.
SELECT round(count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM daily_logs d WHERE d.user_id = u.id AND d.logical_date = s.onboard_date + 1
               ))::numeric / nullif(count(*), 0), 4) AS value,
       count(*) AS n
  FROM users u
  JOIN progression_state s ON s.user_id = u.id
 WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL AND u.email NOT LIKE '%@decoy.invalid'
   AND s.onboard_date + 1 < app.logical_date(app.now(), u.timezone);

-- M-03 Return after 7 days (D7): the same, for the day 7 days after onboard_date.
-- Target: > 20 %.
SELECT round(count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM daily_logs d WHERE d.user_id = u.id AND d.logical_date = s.onboard_date + 7
               ))::numeric / nullif(count(*), 0), 4) AS value,
       count(*) AS n
  FROM users u
  JOIN progression_state s ON s.user_id = u.id
 WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL AND u.email NOT LIKE '%@decoy.invalid'
   AND s.onboard_date + 7 < app.logical_date(app.now(), u.timezone);

-- M-04 Median current streak of the active users: active = a daily log on one of the last 7
-- logical days (today and the 6 before). The streak is the stored one, as of the last close.
-- Target: >= 4. A median is an aggregate, but over a handful of users it is one person's value:
-- read it together with n.
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.streak_current) AS value,
       count(*) AS n
  FROM users u
  JOIN progression_state s ON s.user_id = u.id
 WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL AND u.email NOT LIKE '%@decoy.invalid'
   AND EXISTS (SELECT 1 FROM daily_logs d
                WHERE d.user_id = u.id AND d.logical_date >= app.logical_date(app.now(), u.timezone) - 6);

-- M-05 Guild membership: onboarded users who are in a guild / onboarded users.
-- Target: > 35 %.
SELECT round(count(m.user_id)::numeric / nullif(count(*), 0), 4) AS value,
       count(*) AS n
  FROM users u
  LEFT JOIN guild_memberships m ON m.user_id = u.id
 WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL AND u.email NOT LIKE '%@decoy.invalid';

-- M-07 Guardrail intervention: onboarded users whose prescription in effect was clamped by the
-- safety floor (safety_clamped) / onboarded users with a prescription.
-- Watch; above 15 % the formula or the input form has a problem.
SELECT round(count(*) FILTER (WHERE p.safety_clamped)::numeric / nullif(count(*), 0), 4) AS value,
       count(*) AS n
  FROM users u
  JOIN prescriptions p ON p.user_id = u.id
 WHERE u.onboarded_at IS NOT NULL AND u.deleted_at IS NULL AND u.email NOT LIKE '%@decoy.invalid';
