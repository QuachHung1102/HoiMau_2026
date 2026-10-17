// Seeds the meal library from content/meals.ts, by code: a meal keeps its id for good, so plans
// and logs keep pointing at it. A meal the content no longer has stays (a plan may name it).
// Idempotent: a second run rewrites no row.
import type { ClientBase } from 'pg';
import { MEALS } from '../../content/meals.ts';

export async function seed(db: ClientBase): Promise<void> {
  await db.query(
    `INSERT INTO meal_plans AS m (code, name, kcal, protein_g, carbs_g, fat_g, meal_slot, tags, portion_text,
                                  description, image_key)
     SELECT x.code, x.name, x.kcal, x."proteinG", x."carbsG", x."fatG", x."mealSlot", x.tags, x."portionText",
            x.description, x."imageKey"
       FROM jsonb_to_recordset($1::jsonb) AS x (
         code text, name text, kcal numeric, "proteinG" numeric, "carbsG" numeric, "fatG" numeric,
         "mealSlot" text, tags text[], "portionText" text, description text, "imageKey" text)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g,
       fat_g = EXCLUDED.fat_g, meal_slot = EXCLUDED.meal_slot, tags = EXCLUDED.tags,
       portion_text = EXCLUDED.portion_text, description = EXCLUDED.description, image_key = EXCLUDED.image_key
      WHERE (m.name, m.kcal, m.protein_g, m.carbs_g, m.fat_g, m.meal_slot, m.tags, m.portion_text, m.description,
             m.image_key)
            IS DISTINCT FROM
            (EXCLUDED.name, EXCLUDED.kcal, EXCLUDED.protein_g, EXCLUDED.carbs_g, EXCLUDED.fat_g, EXCLUDED.meal_slot,
             EXCLUDED.tags, EXCLUDED.portion_text, EXCLUDED.description, EXCLUDED.image_key)`,
    [JSON.stringify(MEALS)],
  );
}
