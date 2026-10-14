-- Decoy rows of 30-day.sql for decoy 1: one day with one tick of the seeded quest WATER_8.
-- The rules are those of 80-decoy-base.sql (never clean these up; fixed ids; ON CONFLICT DO
-- NOTHING; content is referenced by code). The ids are repeated in server/checks/attacks/day.ts.
-- The tick was recorded long ago: only its owner check stands between it and an undo by
-- somebody else being refused for the right reason.

INSERT INTO daily_logs (id, user_id, logical_date, water_ml, created_at)
VALUES ('00000000-0000-4000-8000-0000000d1009', '00000000-0000-4000-8000-0000000000d1',
        '2026-01-01', 250, '2026-01-01T05:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO quest_completions (id, user_id, daily_log_id, quest_id, progress, created_at)
SELECT '00000000-0000-4000-8000-0000000d100a', '00000000-0000-4000-8000-0000000000d1',
       '00000000-0000-4000-8000-0000000d1009', q.id, 1, '2026-01-01T05:00:00Z'
  FROM quests q WHERE q.code = 'WATER_8'
ON CONFLICT DO NOTHING;

INSERT INTO quest_ticks (id, user_id, daily_log_id, quest_id, occurred_at, created_at)
SELECT '00000000-0000-4000-8000-0000000d100b', '00000000-0000-4000-8000-0000000000d1',
       '00000000-0000-4000-8000-0000000d1009', q.id, '2026-01-01T05:00:00Z', '2026-01-01T05:00:00Z'
  FROM quests q WHERE q.code = 'WATER_8'
ON CONFLICT DO NOTHING;
