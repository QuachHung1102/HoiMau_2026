// What a user reads back about the own profile. Everything here is derived at read time (AR-04):
// XP and coins are ledger sums, the level comes from the XP sum, perk points and the pet from
// xp_high_water, theme, skin and badge from the equipped inventory rows. All of it is read as
// app_auth inside the request transaction, so row level security is the second filter under
// the explicit one.
import type {
  Me,
  Pet,
  PrescriptionResponse,
  Progression,
} from '../../../domain/contract/core.ts';
import { STREAK_MILESTONES } from '../../../domain/economy.ts';
import { petMood, petProgress } from '../../../domain/pet.ts';
import {
  levelForXp,
  perkPointsEarned,
  titleKeyForLevel,
} from '../../../domain/progression.ts';
import { mapStats } from '../../../domain/stats.ts';
import type {
  ActivityLevel,
  Archetype,
  DayOutcome,
  Sex,
} from '../../../domain/types.ts';
import type { Ctx } from '../app.ts';

type Reader = Pick<Ctx, 'db'>;

/** The free change of archetype opens this long after the last change (R-01.1). */
const ARCHETYPE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  email: string;
  display_name: string;
  timezone: string;
  archetype: Archetype | null;
  archetype_set_at: Date | null;
  onboarded: boolean;
  xp_high_water: number;
  streak_current: number;
  streak_best: number;
  streak_before_break: number | null;
  break_date: string | null;
  missed_run: number;
  last_outcome: DayOutcome | null;
  xp: number;
  coin: number;
  perk_spent: number;
  calorie_target: string;
  water_ml: number;
  day_water_ml: number;
  day_calories_in: string;
  bedtime_marked: boolean;
  resistance_minutes: number;
  cardio_minutes: number;
  owned: string[];
  theme: string;
  skin: string;
  badge: string | null;
};

// One statement: one snapshot of the database for everything `Me` shows.
const PROFILE = `
  WITH items AS (
    SELECT i.kind, i.equipped, s.code
      FROM inventory i JOIN shop_items s ON s.id = i.shop_item_id
     WHERE i.user_id = app.current_user_id()
  )
  SELECT u.id, u.email, u.display_name, u.timezone, u.archetype, u.archetype_set_at,
         u.onboarded_at IS NOT NULL AS onboarded,
         g.xp_high_water, g.streak_current, g.streak_best, g.streak_before_break,
         g.break_date::text AS break_date, g.missed_run, g.last_outcome,
         (SELECT coalesce(sum(l.amount), 0)::int FROM xp_ledger l WHERE l.user_id = u.id) AS xp,
         (SELECT coalesce(sum(l.amount), 0)::int FROM coin_ledger l WHERE l.user_id = u.id) AS coin,
         (SELECT coalesce(sum(k.cost), 0)::int FROM perk_unlocks k WHERE k.user_id = u.id) AS perk_spent,
         p.calorie_target, p.water_ml,
         coalesce(t.water_ml, 0) AS day_water_ml, coalesce(t.calories_in, 0) AS day_calories_in,
         t.bedtime_marked_at IS NOT NULL AS bedtime_marked,
         m.resistance_minutes, m.cardio_minutes,
         ARRAY(SELECT code FROM items) AS owned,
         coalesce((SELECT code FROM items WHERE equipped AND kind = 'THEME'),
                  (SELECT code FROM shop_items WHERE is_default AND kind = 'THEME')) AS theme,
         coalesce((SELECT code FROM items WHERE equipped AND kind = 'PET_SKIN'),
                  (SELECT code FROM shop_items WHERE is_default AND kind = 'PET_SKIN')) AS skin,
         (SELECT code FROM items WHERE equipped AND kind = 'BADGE') AS badge
    FROM users u
    LEFT JOIN progression_state g ON g.user_id = u.id
    LEFT JOIN prescriptions p ON p.user_id = u.id
    -- today's log, when the day has one: reading never creates it
    LEFT JOIN daily_logs t ON t.user_id = u.id AND t.logical_date = app.logical_date(app.now(), u.timezone)
    -- the minutes of the sessions of today's logical date and the six before, by modality
   CROSS JOIN LATERAL (
          SELECT coalesce(sum(w.elapsed_sec) FILTER (WHERE w.modality = 'RESISTANCE'), 0)::float8 / 60
                   AS resistance_minutes,
                 coalesce(sum(w.elapsed_sec) FILTER (WHERE w.modality IN ('CARDIO', 'HIIT')), 0)::float8 / 60
                   AS cardio_minutes
            FROM daily_logs d JOIN workout_sessions w ON w.daily_log_id = d.id
           WHERE d.user_id = u.id
             AND d.logical_date BETWEEN app.logical_date(app.now(), u.timezone) - 6
                                    AND app.logical_date(app.now(), u.timezone)) m
   WHERE u.id = app.current_user_id()`;

async function profile({ db }: Reader): Promise<Row> {
  const { rows } = await db.query<Row>(PROFILE);
  if (rows.length !== 1) {
    throw new Error('the session names no user row');
  }
  return rows[0];
}

/** The row of a user who completed onboarding; anything else here is a route without `auth: 'user'`. */
async function onboardedProfile(ctx: Reader): Promise<Row> {
  const row = await profile(ctx);
  if (!row.onboarded) {
    throw new Error('this read model is for an onboarded user');
  }
  return row;
}

function progressionOf(row: Row): Progression {
  const { level, xpIntoLevel, xpForNextLevel } = levelForXp(row.xp);
  return {
    xp: row.xp,
    level,
    titleKey: titleKeyForLevel(level),
    xpIntoLevel,
    xpForNextLevel,
    coin: row.coin,
    streakCurrent: row.streak_current,
    streakBest: row.streak_best,
    // earned on the high-water mark: an undo never takes a point back
    perkPointsAvailable: perkPointsEarned(row.xp_high_water) - row.perk_spent,
    milestones: STREAK_MILESTONES.map(({ days, badgeCode }) => ({
      days,
      achieved: row.owned.includes(badgeCode),
    })),
    lastOutcome: row.last_outcome,
    breakNotice:
      row.streak_before_break !== null && row.break_date !== null
        ? { previous: row.streak_before_break, date: row.break_date }
        : null,
  };
}

function petOf(row: Row): Pet {
  return {
    ...petProgress(row.xp_high_water),
    mood: petMood({
      streakCurrent: row.streak_current,
      lastOutcome: row.last_outcome,
      missedRun: row.missed_run,
    }),
    skinCode: row.skin,
  };
}

/** `GET /me`: before onboarding the four parts after `user` are null. */
export async function buildMe(ctx: Reader): Promise<Me> {
  const row = await profile(ctx);
  const user: Me['user'] = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    timezone: row.timezone,
    archetype: row.archetype,
    archetypeChangeAvailableAt:
      row.archetype_set_at === null
        ? null
        : new Date(
            row.archetype_set_at.getTime() + ARCHETYPE_COOLDOWN_MS,
          ).toISOString(),
    onboarded: row.onboarded,
  };
  if (!row.onboarded) {
    return {
      user,
      progression: null,
      stats: null,
      pet: null,
      appearance: null,
    };
  }
  return {
    user,
    progression: progressionOf(row),
    // Water, bedtime and calories are those of today's log (zero on a day without one); the
    // minutes are those of the sessions of the last seven logical dates.
    stats: mapStats({
      waterMl: row.day_water_ml,
      waterTargetMl: row.water_ml,
      bedtimeMarked: row.bedtime_marked,
      streakCurrent: row.streak_current,
      caloriesIn: Number(row.day_calories_in),
      calorieTarget: Number(row.calorie_target),
      resistanceMinutes7d: row.resistance_minutes,
      cardioMinutes7d: row.cardio_minutes,
    }),
    pet: petOf(row),
    appearance: {
      themeCode: row.theme,
      petSkinCode: row.skin,
      badgeCode: row.badge,
    },
  };
}

/** For an onboarded caller (`auth: 'user'` routes). */
export async function buildProgression(ctx: Reader): Promise<Progression> {
  return progressionOf(await onboardedProfile(ctx));
}

/** For an onboarded caller (`auth: 'user'` routes). */
export async function buildPet(ctx: Reader): Promise<Pet> {
  return petOf(await onboardedProfile(ctx));
}

type PrescriptionRow = {
  bmr: string;
  tdee: string;
  calorie_target: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  water_ml: number;
  safety_clamped: boolean;
  macro_adjusted: boolean;
  computed_at: Date;
  archetype: Archetype;
  height_cm: string;
  weight_kg: string;
  birth_year: number;
  sex: Sex;
  activity_level: ActivityLevel;
};

/**
 * The targets in effect, the archetype they were computed for and the caller's latest snapshot
 * (`GET /me/prescription`, `POST /me/biometrics`). The only answer that carries body
 * measurements: never log it, never put it into another response. For an onboarded caller.
 */
export async function buildPrescription({
  db,
}: Reader): Promise<PrescriptionResponse> {
  const { rows } = await db.query<PrescriptionRow>(
    `SELECT p.bmr, p.tdee, p.calorie_target, p.protein_g, p.carbs_g, p.fat_g, p.water_ml,
            p.safety_clamped, p.macro_adjusted, p.computed_at, u.archetype,
            s.height_cm, s.weight_kg, s.birth_year, s.sex, s.activity_level
       FROM users u
       JOIN prescriptions p ON p.user_id = u.id
       JOIN LATERAL (SELECT b.* FROM biometric_snapshots b
                      WHERE b.user_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) s ON true
      WHERE u.id = app.current_user_id()`,
  );
  if (rows.length !== 1) {
    throw new Error('this read model is for an onboarded user');
  }
  const row = rows[0];
  return {
    bmr: Number(row.bmr),
    tdee: Number(row.tdee),
    calorieTarget: Number(row.calorie_target),
    proteinG: Number(row.protein_g),
    carbsG: Number(row.carbs_g),
    fatG: Number(row.fat_g),
    waterMl: row.water_ml,
    safetyClamped: row.safety_clamped,
    macroAdjusted: row.macro_adjusted,
    computedAt: row.computed_at.toISOString(),
    archetype: row.archetype,
    biometrics: {
      heightCm: Number(row.height_cm),
      weightKg: Number(row.weight_kg),
      birthYear: row.birth_year,
      sex: row.sex,
      activityLevel: row.activity_level,
    },
  };
}
