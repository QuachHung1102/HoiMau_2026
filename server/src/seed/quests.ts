// Seeds quests from content/quests.ts, by code: a quest keeps its id for good, so completions and
// ticks keep pointing at it. position is the place in the content file. Idempotent: a second run
// rewrites no row.
import type { ClientBase } from 'pg';
import { QUESTS } from '../../content/quests.ts';

export async function seed(db: ClientBase): Promise<void> {
  await db.query(
    `INSERT INTO quests AS q (code, title_key, category, target_count, xp_reward, coin_reward, archetypes,
                              is_active, position)
     SELECT x.code, x."titleKey", x.category, x."targetCount", x."xpReward", x."coinReward", x.archetypes,
            x."isActive", x.position
       FROM jsonb_to_recordset($1::jsonb) AS x (
         code text, "titleKey" text, category text, "targetCount" int, "xpReward" int, "coinReward" int,
         archetypes text[], "isActive" boolean, position int)
     ON CONFLICT (code) DO UPDATE SET
       title_key = EXCLUDED.title_key, category = EXCLUDED.category, target_count = EXCLUDED.target_count,
       xp_reward = EXCLUDED.xp_reward, coin_reward = EXCLUDED.coin_reward, archetypes = EXCLUDED.archetypes,
       is_active = EXCLUDED.is_active, position = EXCLUDED.position
      WHERE (q.title_key, q.category, q.target_count, q.xp_reward, q.coin_reward, q.archetypes, q.is_active,
             q.position)
            IS DISTINCT FROM
            (EXCLUDED.title_key, EXCLUDED.category, EXCLUDED.target_count, EXCLUDED.xp_reward,
             EXCLUDED.coin_reward, EXCLUDED.archetypes, EXCLUDED.is_active, EXCLUDED.position)`,
    [JSON.stringify(QUESTS.map((quest, position) => ({ ...quest, position })))],
  );
}
