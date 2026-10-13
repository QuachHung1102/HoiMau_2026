// Seeds level_thresholds and pet_stages from the domain: the numbers live in TypeScript once,
// SQL only looks them up (AR-04). Idempotent: a second run rewrites no row.
import type { ClientBase } from 'pg';
import { PET_STAGES } from '../../../domain/pet.ts';
import {
  MAX_SEEDED_LEVEL,
  cumulativeXpForLevel,
} from '../../../domain/progression.ts';

export async function seed(db: ClientBase): Promise<void> {
  const levels = Array.from({ length: MAX_SEEDED_LEVEL }, (_, i) => i + 1);
  await db.query(
    `INSERT INTO level_thresholds AS t (level, cumulative_xp)
     SELECT * FROM unnest($1::int[], $2::int[])
     ON CONFLICT (level) DO UPDATE SET cumulative_xp = EXCLUDED.cumulative_xp
      WHERE t.cumulative_xp <> EXCLUDED.cumulative_xp`,
    [levels, levels.map(cumulativeXpForLevel)],
  );
  await db.query(
    `INSERT INTO pet_stages AS p (stage, ord, size_xp)
     SELECT * FROM unnest($1::text[], $2::int[], $3::int[])
     ON CONFLICT (stage) DO UPDATE SET ord = EXCLUDED.ord, size_xp = EXCLUDED.size_xp
      WHERE (p.ord, p.size_xp) IS DISTINCT FROM (EXCLUDED.ord, EXCLUDED.size_xp)`,
    [
      PET_STAGES.map(({ stage }) => stage),
      PET_STAGES.map((_, ord) => ord),
      PET_STAGES.map(({ sizeXp }) => sizeXp),
    ],
  );
}
