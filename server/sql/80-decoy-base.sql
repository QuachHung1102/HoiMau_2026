-- Decoy rows: two accounts that belong to nobody, there only to be found by `npm run db:api-check`.
-- "A cannot read B's rows" passes on any database in which B has no rows, so B exists for good,
-- in every database this schema is applied to. Re-runnable: fixed ids, ON CONFLICT DO NOTHING.
--
-- Rules for whoever edits this file, or adds an 8N-decoy-<area>.sql next to it:
--   * never delete or "clean up" a decoy row, here or in a job: a job that deletes old rows skips
--     the users whose email ends in @decoy.invalid;
--   * decoy 1 (...d1) owns at least one row in every table that holds user data; the api-check
--     fails with "no decoy row in <table>" for a registered own_read / own_rw table without one;
--   * the rows are written by the schema owner, past every function: they must satisfy the
--     constraints, and they must be inert. Nobody can sign in (the key is random and thrown
--     away, the session is revoked, the reset code is used and expired, the hashes below are
--     not the hash of anything), and onboarded_at stays null so that no job picks them up;
--   * a row that needs content references seeded content by code, never a decoy content row
--     that a user could be served;
--   * the fixed values are repeated in server/checks/attacks/base.ts: keep both in step.

INSERT INTO users (id, email, display_name, terms_accepted_at) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'decoy-1@decoy.invalid', 'Mồi nhử 1', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d2', 'decoy-2@decoy.invalid', 'Mồi nhử 2', '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- 10-auth.sql
INSERT INTO credentials (user_id, salt, key)
VALUES ('00000000-0000-4000-8000-0000000000d1',
        substring(sha256(uuid_send(gen_random_uuid())) FROM 1 FOR 16),
        sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())))
ON CONFLICT DO NOTHING;

-- Revoked, and not expired: revocation is the only thing that keeps this session shut.
INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at)
VALUES ('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-0000000000d1',
        decode(repeat('d1', 32), 'hex'), '2999-12-31T00:00:00Z', '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO reset_codes (id, user_id, code_hash, expires_at, used_at)
VALUES ('00000000-0000-4000-8000-0000000d1002', '00000000-0000-4000-8000-0000000000d1',
        decode(repeat('d2', 32), 'hex'), '2026-01-01T00:10:00Z', '2026-01-01T00:05:00Z')
ON CONFLICT DO NOTHING;

-- 11-idempotency.sql: a stored answer, the thing another user must never be served.
INSERT INTO idempotency_keys (user_id, key, request_hash, status, response)
VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000d1003',
        decode(repeat('d3', 32), 'hex'), 200, '{"decoy": true}')
ON CONFLICT DO NOTHING;

-- 20-progression.sql
INSERT INTO progression_state (user_id, xp_high_water, onboard_date)
VALUES ('00000000-0000-4000-8000-0000000000d1', 10, '2026-01-01')
ON CONFLICT DO NOTHING;

INSERT INTO xp_ledger (id, user_id, amount, reason, ref_id)
VALUES ('00000000-0000-4000-8000-0000000d1004', '00000000-0000-4000-8000-0000000000d1', 10, 'DECOY', 'base')
ON CONFLICT DO NOTHING;

INSERT INTO coin_ledger (id, user_id, amount, reason, ref_id)
VALUES ('00000000-0000-4000-8000-0000000d1005', '00000000-0000-4000-8000-0000000000d1', 10, 'DECOY', 'base')
ON CONFLICT DO NOTHING;

INSERT INTO inventory (id, user_id, shop_item_id, kind)
SELECT '00000000-0000-4000-8000-0000000d1006', '00000000-0000-4000-8000-0000000000d1', s.id, s.kind
  FROM shop_items s WHERE s.code = 'THEME_FOREST'
ON CONFLICT DO NOTHING;

INSERT INTO perk_unlocks (id, user_id, perk_code, shop_item_id, cost)
SELECT '00000000-0000-4000-8000-0000000d1007', '00000000-0000-4000-8000-0000000000d1', 'THEME_UNLOCK', s.id, 1
  FROM shop_items s WHERE s.code = 'THEME_FOREST'
ON CONFLICT DO NOTHING;

-- 21-profile.sql
INSERT INTO biometric_snapshots (id, user_id, height_cm, weight_kg, birth_year, sex, activity_level, recorded_at)
VALUES ('00000000-0000-4000-8000-0000000d1008', '00000000-0000-4000-8000-0000000000d1',
        170, 65, 1996, 'FEMALE', 'LIGHT', '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO prescriptions (user_id, bmr, tdee, calorie_target, protein_g, carbs_g, fat_g, water_ml,
                           safety_clamped, macro_adjusted, computed_at)
VALUES ('00000000-0000-4000-8000-0000000000d1', 1400, 1925, 1800, 100, 220, 60, 2000,
        false, false, '2026-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO user_settings (user_id, hide_streak, excluded_meal_tags)
VALUES ('00000000-0000-4000-8000-0000000000d1', true, '{co:sua}')
ON CONFLICT DO NOTHING;
