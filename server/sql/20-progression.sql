-- Progression: streak state, the XP and coin ledgers with their single writer, and the content
-- the level, the pet and the shop are read from. Re-runnable.
--
-- Nothing derivable is stored (AR-04): there is no xp, coin, level or perk point column anywhere.
-- XP and coins are the sums of the ledgers; the level is looked up from the XP sum; perk points
-- and the pet stage come from xp_high_water; skin and theme from the equipped inventory rows.
--
-- Rules for whoever edits this file:
--   * a ledger row is written by app._grant and by nothing else, and app._grant is executable by
--     no app_* role: only a SECURITY DEFINER function that decided the amount itself calls it;
--   * the ledgers are append-only: a correction is a new row with the opposite sign;
--   * (user_id, reason, ref_id) is unique. The caller of app._grant picks ref_id (AR-34): the
--     action id for a per-action grant, the natural key for a grant that may exist once per day,
--     week, milestone or item. That constraint is what makes "once" a fact of the database;
--   * time is app.now() only.

CREATE TABLE IF NOT EXISTS progression_state (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- the highest XP sum the user ever had: perk points and the pet never go back (an undo
  -- lowers the sum, not this)
  xp_high_water int NOT NULL DEFAULT 0 CHECK (xp_high_water >= 0),
  streak_current int NOT NULL DEFAULT 0 CHECK (streak_current >= 0),
  streak_best int NOT NULL DEFAULT 0,
  streak_before_break int,
  break_date date,
  missed_run int NOT NULL DEFAULT 0 CHECK (missed_run >= 0),
  last_outcome text CHECK (last_outcome IN ('COMPLETED', 'FROZEN', 'MISSED')),
  last_closed_date date,
  onboard_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT progression_state_streak_best_check CHECK (streak_best >= streak_current)
);

CREATE TABLE IF NOT EXISTS xp_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount int NOT NULL CHECK (amount <> 0),
  reason text NOT NULL,
  ref_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT xp_ledger_once_key UNIQUE (user_id, reason, ref_id)
);
CREATE INDEX IF NOT EXISTS xp_ledger_user_created_idx ON xp_ledger (user_id, created_at);

CREATE TABLE IF NOT EXISTS coin_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount int NOT NULL CHECK (amount <> 0),
  reason text NOT NULL,
  ref_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT coin_ledger_once_key UNIQUE (user_id, reason, ref_id)
);
CREATE INDEX IF NOT EXISTS coin_ledger_user_created_idx ON coin_ledger (user_id, created_at);

-- Content, written by the seeders from the TypeScript domain (the single source): SQL only
-- looks these up. cumulative_xp = the XP sum at which the level starts; level 1 starts at 0.
CREATE TABLE IF NOT EXISTS level_thresholds (
  level int PRIMARY KEY CHECK (level >= 1),
  cumulative_xp int NOT NULL CHECK (cumulative_xp >= 0),
  created_at timestamptz NOT NULL DEFAULT app.now()
);

-- size_xp: the XP earned inside the stage that completes it; null for the last stage.
CREATE TABLE IF NOT EXISTS pet_stages (
  stage text PRIMARY KEY,
  ord int NOT NULL UNIQUE,
  size_xp int CHECK (size_xp > 0),
  created_at timestamptz NOT NULL DEFAULT app.now()
);

CREATE TABLE IF NOT EXISTS shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('THEME', 'PET_SKIN', 'BADGE')),
  price_coin int NOT NULL CHECK (price_coin >= 0),
  min_level int NOT NULL CHECK (min_level >= 1),
  asset_key text NOT NULL,
  purchasable boolean NOT NULL,
  is_default boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  -- the target of inventory's foreign key: an inventory row cannot name another kind than its item's
  CONSTRAINT shop_items_id_kind_key UNIQUE (id, kind)
);
-- "the default theme", "the default skin": at most one per kind. A default is owned by everyone
-- and is never an inventory row (AR-31).
CREATE UNIQUE INDEX IF NOT EXISTS shop_items_one_default_idx ON shop_items (kind) WHERE is_default;

-- kind is a copy of the item's kind (held true by the foreign key), there so that "one equipped
-- item per user and kind" can be an index.
CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shop_item_id uuid NOT NULL,
  kind text NOT NULL,
  equipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT app.now(),
  CONSTRAINT inventory_owned_once_key UNIQUE (user_id, shop_item_id),
  CONSTRAINT inventory_item_kind_fkey FOREIGN KEY (shop_item_id, kind) REFERENCES shop_items (id, kind)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_one_equipped_idx ON inventory (user_id, kind) WHERE equipped;

-- shop_item_id: the theme a THEME_UNLOCK perk opened; null for the one-time perks.
CREATE TABLE IF NOT EXISTS perk_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  perk_code text NOT NULL,
  shop_item_id uuid REFERENCES shop_items (id),
  cost int NOT NULL CHECK (cost > 0),
  created_at timestamptz NOT NULL DEFAULT app.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS perk_unlocks_once_idx ON perk_unlocks
  (user_id, perk_code, coalesce(shop_item_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE progression_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE perk_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON progression_state;
CREATE POLICY own_select ON progression_state FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON xp_ledger;
CREATE POLICY own_select ON xp_ledger FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON coin_ledger;
CREATE POLICY own_select ON coin_ledger FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON inventory;
CREATE POLICY own_select ON inventory FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_select ON perk_unlocks;
CREATE POLICY own_select ON perk_unlocks FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);

-- A client reads; it writes none of these (R-03.1): every row comes from a function.
REVOKE ALL ON progression_state, xp_ledger, coin_ledger, level_thresholds, pet_stages, shop_items,
  inventory, perk_unlocks FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON progression_state, xp_ledger, coin_ledger, level_thresholds, pet_stages, shop_items,
  inventory, perk_unlocks TO app_auth;

SELECT meta.expect_table('progression_state', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('progression_state', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('xp_ledger', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('xp_ledger', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('coin_ledger', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('coin_ledger', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('inventory', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('inventory', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('perk_unlocks', 'own_read', '{SELECT}', '{}', 'user_id');
SELECT meta.expect_policy('perk_unlocks', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_table('level_thresholds', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('pet_stages', 'content', '{SELECT}', '{}', NULL);
SELECT meta.expect_table('shop_items', 'content', '{SELECT}', '{}', NULL);

-- ---------------------------------------------------------------------------------------------
-- Internal helpers: EXECUTE for no role. Neither is SECURITY DEFINER: they run with the rights
-- of the function that calls them, so a stray GRANT EXECUTE would still stop at the tables.

-- The one writer of the ledgers. Takes the user's progression_state row FOR UPDATE first, so
-- grants of one user run one after the other and each sees the sums the previous one left
-- (READ COMMITTED: every statement below reads what is committed by then). A non-zero amount
-- becomes one ledger row unless (user, reason, ref) already has one; then nothing is added and
-- the sums are returned as they are. xp_high_water only ever rises.
--   {xpBefore, xpAfter, coinBefore, coinAfter, highWaterBefore, highWaterAfter, applied}
-- applied = this call added at least one row. The rows it added are (xpAfter - xpBefore) XP and
-- (coinAfter - coinBefore) coins under p_reason / p_ref: the route logs those (log.ledger).
CREATE OR REPLACE FUNCTION app._grant(p_user uuid, p_xp int, p_coin int, p_reason text, p_ref text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_high_before int;
  v_high_after int;
  v_xp_before bigint;
  v_coin_before bigint;
  v_xp int := 0;
  v_coin int := 0;
BEGIN
  IF p_user IS NULL OR p_xp IS NULL OR p_coin IS NULL OR p_reason IS NULL OR p_ref IS NULL THEN
    RAISE EXCEPTION 'app._grant: no argument may be null';
  END IF;
  SELECT s.xp_high_water INTO v_high_before
    FROM progression_state s WHERE s.user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app._grant: the user has no progression_state row';
  END IF;
  SELECT coalesce(sum(l.amount), 0) INTO v_xp_before FROM xp_ledger l WHERE l.user_id = p_user;
  SELECT coalesce(sum(l.amount), 0) INTO v_coin_before FROM coin_ledger l WHERE l.user_id = p_user;

  IF p_xp <> 0 THEN
    INSERT INTO xp_ledger (user_id, amount, reason, ref_id) VALUES (p_user, p_xp, p_reason, p_ref)
    ON CONFLICT (user_id, reason, ref_id) DO NOTHING;
    IF FOUND THEN
      v_xp := p_xp;
    END IF;
  END IF;
  IF p_coin <> 0 THEN
    INSERT INTO coin_ledger (user_id, amount, reason, ref_id) VALUES (p_user, p_coin, p_reason, p_ref)
    ON CONFLICT (user_id, reason, ref_id) DO NOTHING;
    IF FOUND THEN
      v_coin := p_coin;
    END IF;
  END IF;

  v_high_after := v_high_before;
  IF v_xp_before + v_xp > v_high_before THEN
    UPDATE progression_state SET xp_high_water = v_xp_before + v_xp
     WHERE user_id = p_user
    RETURNING xp_high_water INTO v_high_after;
  END IF;
  RETURN jsonb_build_object(
    'xpBefore', v_xp_before, 'xpAfter', v_xp_before + v_xp,
    'coinBefore', v_coin_before, 'coinAfter', v_coin_before + v_coin,
    'highWaterBefore', v_high_before, 'highWaterAfter', v_high_after,
    'applied', v_xp <> 0 OR v_coin <> 0);
END $$;

-- The level of the user's current XP sum (not of xp_high_water: an undo can lower it): the
-- highest level whose cumulative_xp is at or below the sum. Level 1 for a user without rows.
-- ponytail: level_thresholds is seeded up to MAX_SEEDED_LEVEL (200, about 22.5 M XP), so this
-- answers 200 above it while levelForXp of the domain keeps counting; seed further if anyone
-- ever gets near.
CREATE OR REPLACE FUNCTION app._level(p_user uuid) RETURNS int
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT coalesce(max(t.level), 1)
    FROM level_thresholds t
   WHERE t.cumulative_xp <= (SELECT coalesce(sum(l.amount), 0) FROM xp_ledger l WHERE l.user_id = p_user)
$$;

REVOKE ALL ON FUNCTION app._grant(uuid, int, int, text, text), app._level(uuid)
  FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._grant(uuid, int, int, text, text)', 'invoker', '{}');
SELECT meta.expect_function('app._level(uuid)', 'invoker', '{}');
