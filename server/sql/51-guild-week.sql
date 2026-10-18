-- The guild week: the stored result of every closed week, the functions of the weekly-rollover
-- and leaderboard-refresh jobs (app_job), and the one read a user has of a closed week
-- (leaderboard_final). Re-runnable.
--
-- The jobs (server/src/jobs/weeklyRollover.ts, leaderboardRefresh.ts) read the members' days
-- with job_guild_week_inputs, score and rank them in TypeScript (scoreGuildWeek, rankGuilds,
-- guildWeeklyReward of the domain: AR-03) and, for a closed week, hand the result to
-- job_apply_guild_week, which stores it and pays the rewards once.
--
-- Rules for whoever edits this file:
--   * a week is matched on the logical_date label of the logs (R-D08): a log labelled Sunday is
--     Sunday's, in whatever zone and at whatever instant it was written;
--   * a week is applied once: its record in job_runs (job 'guild-week', run_for = its Monday
--     00:00 Asia/Ho_Chi_Minh, unique) is the FIRST row the apply writes, so a second run waits
--     on that unique index and then finds the week taken;
--   * lock order of the apply, after that record: every users row it may pay (FOR NO KEY
--     UPDATE, by id), THEN the guild rows (FOR KEY SHARE, by id), then progression_state (inside
--     app._grant). The guild functions (50-guild.sql) take a users row and then a guild FOR
--     UPDATE: taking a guild first and a users row after it would close a cycle with them;
--   * what a user reads of a week is guild name, completion ratio, active-member count and rank
--     (R-P.1): no user id, no guild id, no member;
--   * time is app.now() only.

-- One row per guild per closed week; rank null = unranked (fewer than 3 active members).
CREATE TABLE IF NOT EXISTS guild_weekly_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  avg_completion numeric NOT NULL CHECK (avg_completion BETWEEN 0 AND 1),
  active_members int NOT NULL CHECK (active_members >= 0),
  rank int CHECK (rank > 0),
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT guild_weekly_scores_week_key UNIQUE (guild_id, week_start),
  -- unique treats nulls as distinct: every unranked guild has rank null
  CONSTRAINT guild_weekly_scores_rank_key UNIQUE (week_start, rank)
);
CREATE INDEX IF NOT EXISTS guild_weekly_scores_week_idx ON guild_weekly_scores (week_start, avg_completion DESC);

-- The record of an applied week (see the rules above): at most one per Monday.
CREATE UNIQUE INDEX IF NOT EXISTS job_runs_guild_week_key ON job_runs (run_for) WHERE job = 'guild-week';

ALTER TABLE guild_weekly_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guild_weekly_scores FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_table('guild_weekly_scores', 'internal', '{}', '{}', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helper: EXECUTE for no role, not SECURITY DEFINER.

-- The rows handed to job_apply_guild_week, typed: [{guildId, avgCompletion, activeMembers,
-- rank (null: unranked), coins, badgeCode (null: none), members (the active members' ids)}].
CREATE OR REPLACE FUNCTION app._guild_week_rows(p_rows jsonb)
RETURNS TABLE (guild_id uuid, avg_completion numeric, active_members int, rank int, coins int, badge_code text, members uuid[])
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT x."guildId", x."avgCompletion", x."activeMembers", x.rank, x.coins, x."badgeCode", coalesce(x.members, '{}')
    FROM jsonb_to_recordset(p_rows) AS x("guildId" uuid, "avgCompletion" numeric, "activeMembers" int, rank int,
                                         coins int, "badgeCode" text, members uuid[])
$$;

REVOKE ALL ON FUNCTION app._guild_week_rows(jsonb) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._guild_week_rows(jsonb)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The jobs' functions (app_job).

-- One row per guild, by id: its name, created_at and its CURRENT members (a member who left has
-- no row any more, so is excluded; deleted and not onboarded users are not members here), each
-- as memberWeek takes it: {userId, joinedDate (the Asia/Ho_Chi_Minh date of joined_at), days
-- (app._member_days over p_week_start..p_through, the logs whose label lies in that range)}.
CREATE OR REPLACE FUNCTION job_guild_week_inputs(p_week_start date, p_through date)
RETURNS TABLE (guild_id uuid, name text, created_at timestamptz, members jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.name, g.created_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                            'userId', m.user_id,
                            'joinedDate', (m.joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                            'days', app._member_days(m.user_id, p_week_start, p_through))
                          ORDER BY m.user_id)
                     FROM guild_memberships m JOIN users u ON u.id = m.user_id
                    WHERE m.guild_id = g.id AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL), '[]'::jsonb)
    FROM guilds g
   ORDER BY g.id
$$;

-- Stores the closed week p_week_start and pays it, once (see the rules above). p_rows: one per
-- guild (app._guild_week_rows). Every guild that still exists gets its guild_weekly_scores row;
-- for a ranked one, each of its active members who is a member of it still is paid `coins`
-- through app._grant (reason GUILD_WEEKLY, ref = the week start, AR-34), the badge into
-- inventory when there is one, and a GUILD_WEEKLY_RESULT notification {rank, coins, weekStart}
-- (dedupe key = the week start). Returns {applied: false, grants: []} when the week is recorded
-- already, else {applied: true, grants}: the app._grant results that wrote ledger rows, each with
-- userId, reason and ref, for log.ledger.
CREATE OR REPLACE FUNCTION job_apply_guild_week(p_week_start date, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref text := to_char(p_week_start, 'YYYY-MM-DD');
  v_grants jsonb := '[]';
  v_grant jsonb;
  r record;
BEGIN
  IF p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'job_apply_guild_week: not a Monday, or the rows are not an array';
  END IF;
  IF EXISTS (SELECT 1 FROM app._guild_week_rows(p_rows) x
              WHERE x.guild_id IS NULL
                 OR x.rank IS NOT NULL AND (x.coins IS NULL OR x.coins <= 0
                    OR x.badge_code IS NOT NULL AND NOT EXISTS (
                         SELECT 1 FROM shop_items i WHERE i.code = x.badge_code AND i.kind = 'BADGE'))) THEN
    RAISE EXCEPTION 'job_apply_guild_week: a row without a guild, or a ranked row without a reward';
  END IF;

  -- 1. the record of the week, first
  INSERT INTO job_runs (run_id, job, run_for, ok, detail)
  VALUES (gen_random_uuid(), 'guild-week', p_week_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh', true,
          jsonb_build_object('weekStart', v_ref, 'guilds', jsonb_array_length(p_rows)))
  ON CONFLICT (run_for) WHERE job = 'guild-week' DO NOTHING;
  IF NOT FOUND THEN
    RETURN '{"applied": false, "grants": []}'::jsonb;
  END IF;

  -- 2. every users row that may be paid, by id; 3. then the guilds, by id. A guild deleted
  -- meanwhile is not locked and gets no row.
  PERFORM 1 FROM users u
   WHERE u.id IN (SELECT unnest(x.members) FROM app._guild_week_rows(p_rows) x WHERE x.rank IS NOT NULL)
   ORDER BY u.id FOR NO KEY UPDATE;
  PERFORM 1 FROM guilds g
   WHERE g.id IN (SELECT x.guild_id FROM app._guild_week_rows(p_rows) x)
   ORDER BY g.id FOR KEY SHARE;

  INSERT INTO guild_weekly_scores (guild_id, week_start, avg_completion, active_members, rank)
  SELECT x.guild_id, p_week_start, x.avg_completion, x.active_members, x.rank
    FROM app._guild_week_rows(p_rows) x JOIN guilds g ON g.id = x.guild_id
  ON CONFLICT (guild_id, week_start) DO NOTHING;

  -- 4. the rewards: active members who are members of that guild still (their rows are locked)
  FOR r IN
    SELECT x.rank, x.coins, x.badge_code, m.user_id
      FROM app._guild_week_rows(p_rows) x
     CROSS JOIN LATERAL unnest(x.members) AS a (user_id)
      JOIN guild_memberships m ON m.user_id = a.user_id AND m.guild_id = x.guild_id
      JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL
     WHERE x.rank IS NOT NULL
     ORDER BY m.user_id
  LOOP
    v_grant := app._grant(r.user_id, 0, r.coins, 'GUILD_WEEKLY', v_ref);
    IF (v_grant ->> 'applied')::boolean THEN
      v_grants := v_grants || jsonb_build_array(
        v_grant || jsonb_build_object('userId', r.user_id, 'reason', 'GUILD_WEEKLY', 'ref', v_ref));
    END IF;
    IF r.badge_code IS NOT NULL THEN
      INSERT INTO inventory (user_id, shop_item_id, kind)
      SELECT r.user_id, i.id, i.kind FROM shop_items i WHERE i.code = r.badge_code
      ON CONFLICT (user_id, shop_item_id) DO NOTHING;
    END IF;
    PERFORM app._notify(r.user_id, 'GUILD_WEEKLY_RESULT',
      jsonb_build_object('rank', r.rank, 'coins', r.coins, 'weekStart', v_ref), v_ref);
  END LOOP;
  RETURN jsonb_build_object('applied', true, 'grants', v_grants);
END $$;

-- ---------------------------------------------------------------------------------------------
-- The read of a user (app_auth).

-- The stored week p_week_start: {updatedAt (when the rollover applied it; null before),
-- entries: the top 50 ranked guilds by rank, [{rank, guildName, avgCompletion, activeMembers,
-- isMine}], mine: the row of the caller's current guild for that week ({ranked, rank,
-- avgCompletion, activeMembers}) or null}. Names, ratios, counts and ranks only (R-P.1).
CREATE OR REPLACE FUNCTION leaderboard_final(p_week_start date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH mine AS (
    SELECT m.guild_id FROM guild_memberships m WHERE m.user_id = app.current_user_id()
  )
  SELECT jsonb_build_object(
    'updatedAt', (SELECT r.ran_at FROM job_runs r
                   WHERE r.job = 'guild-week' AND r.run_for = p_week_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'),
    'entries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'rank', t.rank, 'guildName', t.name, 'avgCompletion', t.avg_completion,
               'activeMembers', t.active_members, 'isMine', t.is_mine) ORDER BY t.rank)
        FROM (SELECT s.rank, g.name, s.avg_completion, s.active_members,
                     EXISTS (SELECT 1 FROM mine WHERE mine.guild_id = s.guild_id) AS is_mine
                FROM guild_weekly_scores s JOIN guilds g ON g.id = s.guild_id
               WHERE s.week_start = p_week_start AND s.rank IS NOT NULL
               ORDER BY s.rank LIMIT 50) t), '[]'::jsonb),
    'mine', (SELECT jsonb_build_object('ranked', s.rank IS NOT NULL, 'rank', s.rank,
                                       'avgCompletion', s.avg_completion, 'activeMembers', s.active_members)
               FROM guild_weekly_scores s JOIN mine ON mine.guild_id = s.guild_id
              WHERE s.week_start = p_week_start))
$$;

REVOKE ALL ON FUNCTION
  job_guild_week_inputs(date, date), job_apply_guild_week(date, jsonb), leaderboard_final(date)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION job_guild_week_inputs(date, date), job_apply_guild_week(date, jsonb) TO app_job;
GRANT EXECUTE ON FUNCTION leaderboard_final(date) TO app_auth;
SELECT meta.expect_function('job_guild_week_inputs(date, date)', 'definer', '{app_job}');
SELECT meta.expect_function('job_apply_guild_week(date, jsonb)', 'definer', '{app_job}');
SELECT meta.expect_function('leaderboard_final(date)', 'definer', '{app_auth}');
