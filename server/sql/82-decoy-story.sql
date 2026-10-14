-- Decoy rows of 31-story.sql for decoy 1, on its day of 81-decoy-day.sql: one manual calorie
-- entry and one session of the seeded workout DESK_STRETCH (by code). The rules are those of
-- 80-decoy-base.sql (never clean these up; fixed ids; ON CONFLICT DO NOTHING). The ids are
-- repeated in server/checks/attacks/story.ts.

INSERT INTO nutrition_logs (id, user_id, daily_log_id, label, kcal, occurred_at, created_at)
VALUES ('00000000-0000-4000-8000-0000000d100c', '00000000-0000-4000-8000-0000000000d1',
        '00000000-0000-4000-8000-0000000d1009', 'Mồi nhử', 500, '2026-01-01T05:00:00Z',
        '2026-01-01T05:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO workout_sessions (id, user_id, daily_log_id, exercise_item_id, modality, duration_sec, elapsed_sec,
                              completed, xp_awarded, occurred_at, created_at)
SELECT '00000000-0000-4000-8000-0000000d100d', '00000000-0000-4000-8000-0000000000d1',
       '00000000-0000-4000-8000-0000000d1009', i.id, i.modality, i.duration_sec, i.duration_sec,
       true, 0, '2026-01-01T05:00:00Z', '2026-01-01T05:00:00Z'
  FROM exercise_items i WHERE i.code = 'DESK_STRETCH'
ON CONFLICT DO NOTHING;
