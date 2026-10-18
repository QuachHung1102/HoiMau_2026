-- Decoy rows of 51-guild-week.sql: an unranked guild_weekly_scores row of the decoy guild
-- (86-decoy-guild.sql) for the week of 2026-01-05. The rules are those of 80-decoy-base.sql
-- (never clean these up; fixed values; ON CONFLICT DO NOTHING). Unranked, so no leaderboard
-- lists it, and its guild has no member anyone else could be. The values are repeated in
-- server/checks/attacks/leaderboard.ts.

INSERT INTO guild_weekly_scores (id, guild_id, week_start, avg_completion, active_members, rank, created_at)
VALUES ('00000000-0000-4000-8000-0000000d1401', '00000000-0000-4000-8000-0000000d1301', '2026-01-05',
        0.5, 2, NULL, '2026-01-12T00:00:00Z')
ON CONFLICT DO NOTHING;
