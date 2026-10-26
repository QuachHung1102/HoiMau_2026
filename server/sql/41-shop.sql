-- The shop, the inventory and the perks: spending coins on a cosmetic item, equipping an item,
-- spending perk points. No new table (the tables are those of 20-progression.sql). Re-runnable.
--
-- Rules for whoever edits this file (those of 20-progression.sql hold here too):
--   * every function first takes app._lock_progression: the caller's users row (FOR NO KEY
--     UPDATE, the first lock of every write of the user, 30-day.sql) and then the
--     progression_state row FOR UPDATE. Every balance, level, ownership and point is read
--     after it, so two requests of one user run one after the other and the second sees what
--     the first wrote: that lock is what makes "never overspend" true, not a CHECK;
--   * a purchase writes no XP row and touches no streak or guild data (R-10.1);
--   * a refusal is raised with SQLSTATE HM000; time is app.now() only.

-- ---------------------------------------------------------------------------------------------
-- Internal helper: EXECUTE for no role, not SECURITY DEFINER.

-- ONBOARDING_REQUIRED for a caller who is not a live, onboarded user.
CREATE OR REPLACE FUNCTION app._lock_progression(p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM users u
   WHERE u.id = p_user AND u.deleted_at IS NULL AND u.onboarded_at IS NOT NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  PERFORM 1 FROM progression_state s WHERE s.user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_REQUIRED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
END $$;

REVOKE ALL ON FUNCTION app._lock_progression(uuid) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._lock_progression(uuid)', 'invoker', '{}');

-- ---------------------------------------------------------------------------------------------
-- The three functions the server calls. The caller is app.current_user_id(); none takes a user
-- id, a price or a cost.

-- Buys p_item_code with coins. In this order: ITEM_NOT_FOUND; ITEM_NOT_PURCHASABLE (an earned
-- badge, a default item); ITEM_LOCKED_LEVEL {minLevel} (the level of the current XP sum);
-- ALREADY_OWNED; INSUFFICIENT_COINS {price, coin}. Then the coins go through app._grant with
-- reason PURCHASE and ref = the item code (an item is paid for once ever) and the
-- inventory row is added, in this one transaction (R-10.2).
--   the result of app._grant + {reason, ref}
-- p_action_id names no row: a replay is the idempotency layer's.
CREATE OR REPLACE FUNCTION shop_purchase(p_item_code text, p_action_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_coin bigint;
  v_grant jsonb;
  i shop_items;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'shop_purchase: the action id is required';
  END IF;
  PERFORM app._lock_progression(v_user);
  SELECT x.* INTO i FROM shop_items x WHERE x.code = p_item_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF NOT i.purchasable OR i.is_default THEN
    RAISE EXCEPTION 'ITEM_NOT_PURCHASABLE' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  IF app._level(v_user) < i.min_level THEN
    RAISE EXCEPTION 'ITEM_LOCKED_LEVEL' USING ERRCODE = 'HM000',
      DETAIL = jsonb_build_object('minLevel', i.min_level)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM inventory v WHERE v.user_id = v_user AND v.shop_item_id = i.id) THEN
    RAISE EXCEPTION 'ALREADY_OWNED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT coalesce(sum(l.amount), 0) INTO v_coin FROM coin_ledger l WHERE l.user_id = v_user;
  IF v_coin < i.price_coin THEN
    RAISE EXCEPTION 'INSUFFICIENT_COINS' USING ERRCODE = 'HM000',
      DETAIL = jsonb_build_object('price', i.price_coin, 'coin', v_coin)::text;
  END IF;
  v_grant := app._grant(v_user, 0, -i.price_coin, 'PURCHASE', i.code);
  IF i.price_coin > 0 AND NOT (v_grant ->> 'applied')::boolean THEN
    -- paid for once already, yet not in the inventory: never happens while both are written here
    RAISE EXCEPTION 'shop_purchase: % was paid for before', i.code;
  END IF;
  INSERT INTO inventory (user_id, shop_item_id, kind) VALUES (v_user, i.id, i.kind);
  RETURN v_grant || jsonb_build_object('reason', 'PURCHASE', 'ref', i.code);
END $$;

-- Equips p_item_code: ITEM_NOT_OWNED unless the item is the caller's or a default (an unknown
-- code included). Every inventory row of the item's kind is un-equipped, then the item's row is
-- equipped; a default item has no row, so equipping it leaves that kind with none equipped,
-- which is what shows the default.
CREATE OR REPLACE FUNCTION inventory_equip(p_item_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  i shop_items;
BEGIN
  PERFORM app._lock_progression(v_user);
  SELECT x.* INTO i FROM shop_items x WHERE x.code = p_item_code;
  IF NOT FOUND OR NOT (i.is_default OR EXISTS (
       SELECT 1 FROM inventory v WHERE v.user_id = v_user AND v.shop_item_id = i.id)) THEN
    RAISE EXCEPTION 'ITEM_NOT_OWNED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  UPDATE inventory SET equipped = false WHERE user_id = v_user AND kind = i.kind AND equipped;
  UPDATE inventory SET equipped = true WHERE user_id = v_user AND shop_item_id = i.id;
END $$;

-- Spends perk points (PERKS of domain/economy.ts: MEAL_SWAP_PLUS 2, TICKET_CAP_PLUS 3,
-- THEME_UNLOCK 1). VALIDATION_FAILED (perkCode) for another code. MEAL_SWAP_PLUS and
-- TICKET_CAP_PLUS once each (PERK_ALREADY_UNLOCKED). THEME_UNLOCK takes the theme p_item_code,
-- whatever its price: ITEM_NOT_FOUND (not a theme, or the default one), ALREADY_OWNED,
-- ITEM_LOCKED_LEVEL {minLevel}; it adds the inventory row. Then PERK_POINTS_INSUFFICIENT unless
-- the points available cover the cost: (the highest level whose cumulative_xp is at or below
-- xp_high_water) - 1 - the costs spent. Points come from the high-water mark: an undo never
-- takes one back.
CREATE OR REPLACE FUNCTION perk_unlock(p_perk_code text, p_item_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_cost int;
  v_points int;
  i shop_items;
BEGIN
  v_cost := CASE p_perk_code WHEN 'MEAL_SWAP_PLUS' THEN 2 WHEN 'TICKET_CAP_PLUS' THEN 3
                             WHEN 'THEME_UNLOCK' THEN 1 END;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'HM000',
      DETAIL = '{"fields":[{"field":"perkCode","rule":"enum"}]}';
  END IF;
  PERFORM app._lock_progression(v_user);
  IF p_perk_code = 'THEME_UNLOCK' THEN
    SELECT x.* INTO i FROM shop_items x WHERE x.code = p_item_code AND x.kind = 'THEME' AND NOT x.is_default;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    IF EXISTS (SELECT 1 FROM inventory v WHERE v.user_id = v_user AND v.shop_item_id = i.id) THEN
      RAISE EXCEPTION 'ALREADY_OWNED' USING ERRCODE = 'HM000', DETAIL = '{}';
    END IF;
    IF app._level(v_user) < i.min_level THEN
      RAISE EXCEPTION 'ITEM_LOCKED_LEVEL' USING ERRCODE = 'HM000',
        DETAIL = jsonb_build_object('minLevel', i.min_level)::text;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM perk_unlocks k WHERE k.user_id = v_user AND k.perk_code = p_perk_code) THEN
    RAISE EXCEPTION 'PERK_ALREADY_UNLOCKED' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  SELECT (SELECT coalesce(max(t.level), 1) FROM level_thresholds t WHERE t.cumulative_xp <= s.xp_high_water) - 1
         - (SELECT coalesce(sum(k.cost), 0) FROM perk_unlocks k WHERE k.user_id = v_user)
    INTO v_points
    FROM progression_state s WHERE s.user_id = v_user;
  IF v_points < v_cost THEN
    RAISE EXCEPTION 'PERK_POINTS_INSUFFICIENT' USING ERRCODE = 'HM000', DETAIL = '{}';
  END IF;
  INSERT INTO perk_unlocks (user_id, perk_code, shop_item_id, cost) VALUES (v_user, p_perk_code, i.id, v_cost);
  IF i.id IS NOT NULL THEN
    INSERT INTO inventory (user_id, shop_item_id, kind) VALUES (v_user, i.id, i.kind);
  END IF;
END $$;

REVOKE ALL ON FUNCTION
  shop_purchase(text, uuid), inventory_equip(text), perk_unlock(text, text)
  FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION
  shop_purchase(text, uuid), inventory_equip(text), perk_unlock(text, text)
  TO app_auth;
SELECT meta.expect_function('shop_purchase(text, uuid)', 'definer', '{app_auth}');
SELECT meta.expect_function('inventory_equip(text)', 'definer', '{app_auth}');
SELECT meta.expect_function('perk_unlock(text, text)', 'definer', '{app_auth}');
