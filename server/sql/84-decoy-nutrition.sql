-- Decoy rows of 40-nutrition.sql for decoy 1, on its day of 81-decoy-day.sql: the LUNCH of its
-- plan, the seeded meal COM_GA_RAU_CU (by code), swapped once. The rules are those of
-- 80-decoy-base.sql (never clean these up; fixed values; ON CONFLICT DO NOTHING). The values are
-- repeated in server/checks/attacks/nutrition.ts.

INSERT INTO daily_meal_plans (user_id, logical_date, meal_slot, meal_id, swaps_used, macro_warning, created_at)
SELECT '00000000-0000-4000-8000-0000000000d1', '2026-01-01', 'LUNCH', m.id, 1, false, '2026-01-01T05:00:00Z'
  FROM meal_plans m WHERE m.code = 'COM_GA_RAU_CU'
ON CONFLICT DO NOTHING;
