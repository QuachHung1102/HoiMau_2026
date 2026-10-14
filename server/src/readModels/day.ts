// What a user reads back about a day: the day with its quests (`GET /day`, and the `day` of every
// `ActionResult`), the summaries of a range of dates and the recorded actions of one date. Read
// as app_auth inside the request transaction: the caller is named explicitly in every statement
// and row level security is the second filter under it. Nothing here writes: a day without any
// action has no daily_logs row and is shown as a day with nothing done.
import type {
  DayDetail,
  DayState,
  DaySummary,
  QuestState,
} from '../../../domain/contract/core.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import { logicalDateOf } from '../../../domain/logicalDate.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { Ctx } from '../app.ts';

type Reader = Pick<Ctx, 'db'>;

/**
 * The instant at which logical day `date` ends in `timeZone`: the first instant whose logical
 * date is a later one. Found with `logicalDateOf` itself, so it is the domain's answer
 * on every day, also where 03:00 local does not exist or comes twice.
 */
export function logicalDayEnd(date: DateLabel, timeZone: string): number {
  // In every zone (UTC-12 to UTC+14) the label at `date` 00:00 UTC is at most `date`, and 48
  // hours later it is past it; in between it only moves forward. Searched in whole seconds: no
  // zone changes its label inside one.
  // ponytail: 18 steps, each one Intl.DateTimeFormat (about a millisecond together, measured);
  // compute it from the zone's offset at 03:00 with one check if this ever shows in a profile.
  let last = Date.parse(`${date}T00:00:00Z`) / 1000;
  let end = last + 48 * 3600;
  while (end - last > 1) {
    const middle = last + Math.floor((end - last) / 2);
    if (logicalDateOf(middle * 1000, timeZone) > date) {
      end = middle;
    } else {
      last = middle;
    }
  }
  return end * 1000;
}

type DayRow = {
  now: Date;
  day: DateLabel;
  timezone: string;
  calories_in: string;
  water_ml: number;
  bedtime_marked_at: Date | null;
  calorie_target: string;
  water_target: number;
  streak_current: number;
  streak_best: number;
  quests: QuestState[];
};

// One statement: one snapshot of the database for everything the day shows. $1: the date, or
// null for the logical date of app.now() in the caller's zone. The hidden quest is locked while
// that day is today and the wall clock is before 18:00 (the hours day_bedtime refuses).
const DAY = `
  WITH me AS (
    SELECT u.id, u.timezone, u.archetype, app.now() AS now,
           app.logical_date(app.now(), u.timezone) AS today,
           coalesce($1::date, app.logical_date(app.now(), u.timezone)) AS day,
           extract(hour FROM app.now() AT TIME ZONE u.timezone)::int AS hour
      FROM users u WHERE u.id = app.current_user_id()
  )
  SELECT me.now, to_char(me.day, 'YYYY-MM-DD') AS day, me.timezone,
         coalesce(d.calories_in, 0) AS calories_in, coalesce(d.water_ml, 0) AS water_ml,
         d.bedtime_marked_at, p.calorie_target, p.water_ml AS water_target,
         g.streak_current, g.streak_best,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'code', q.code, 'category', q.category, 'titleKey', q.title_key,
                   'progress', coalesce(c.progress, 0), 'targetCount', q.target_count,
                   'completed', c.completed_at IS NOT NULL,
                   'xpReward', q.xp_reward, 'coinReward', q.coin_reward,
                   'locked', q.category = 'HIDDEN' AND me.day = me.today AND me.hour BETWEEN 3 AND 17,
                   'lastTick', CASE WHEN q.category = 'DAILY' THEN
                     (SELECT jsonb_build_object('id', t.id, 'at', t.created_at)
                        FROM quest_ticks t
                       WHERE t.daily_log_id = d.id AND t.quest_id = q.id AND t.undone_at IS NULL
                       ORDER BY t.created_at DESC LIMIT 1) END
                 ) ORDER BY q.position, q.code), '[]'::jsonb)
            FROM quests q
            LEFT JOIN quest_completions c ON c.quest_id = q.id AND c.daily_log_id = d.id
           WHERE q.is_active AND me.archetype = ANY (q.archetypes)) AS quests
    FROM me
    JOIN prescriptions p ON p.user_id = me.id
    JOIN progression_state g ON g.user_id = me.id
    LEFT JOIN daily_logs d ON d.user_id = me.id AND d.logical_date = me.day`;

/**
 * The caller's day: today (the logical date of `app.now()` in the caller's zone) unless
 * `logicalDate` names another one. A write route answers with today, whatever day the write
 * landed on: the app takes `ActionResult.day` as the current day. For an onboarded caller.
 *
 * `lastTick.at` is the instant the server recorded the tick: the undo window counts from it.
 * `unreadCount` and `celebrations` are empty until the inbox exists (Task 22).
 */
export async function buildDay(
  { db }: Reader,
  logicalDate?: DateLabel,
): Promise<DayState> {
  const { rows } = await db.query<DayRow>(DAY, [logicalDate ?? null]);
  if (rows.length !== 1) {
    throw new Error('this read model is for an onboarded user');
  }
  const row = rows[0];
  const quests = row.quests.map(quest => ({
    ...quest,
    lastTick: quest.lastTick && {
      id: quest.lastTick.id,
      at: new Date(quest.lastTick.at).toISOString(),
    },
  }));
  const story = quests.filter(quest => quest.category === 'STORY');
  return {
    logicalDate: row.day,
    serverTime: row.now.toISOString(),
    closesAt: new Date(logicalDayEnd(row.day, row.timezone)).toISOString(),
    caloriesIn: Number(row.calories_in),
    waterMl: row.water_ml,
    waterTargetMl: row.water_target,
    bedtimeMarkedAt: row.bedtime_marked_at?.toISOString() ?? null,
    calorieWindow: calorieWindow(Number(row.calorie_target)),
    quests,
    story: {
      done: story.filter(quest => quest.completed).length,
      total: story.length,
    },
    streak: { current: row.streak_current, best: row.streak_best },
    unreadCount: 0,
    celebrations: [],
  };
}

type SummaryRow = {
  logical_date: DateLabel;
  outcome: DaySummary['outcome'];
  story_done: number;
  story_total: number;
  water_ml: number;
  calories_in: string;
};

// A date before the user's first day is NONE; one the day-close job has not processed is OPEN;
// a closed one is COMPLETED when its log says the story was done, else MISSED (a missed day
// needs no log). Task 22 adds FROZEN, Task 21 the workout minutes.
const SUMMARIES = `
  SELECT to_char(g.day, 'YYYY-MM-DD') AS logical_date,
         CASE WHEN g.day < s.onboard_date THEN 'NONE'
              WHEN s.last_closed_date IS NULL OR g.day > s.last_closed_date THEN 'OPEN'
              WHEN d.story_completed THEN 'COMPLETED'
              ELSE 'MISSED' END AS outcome,
         k.story_done, k.story_total,
         coalesce(d.water_ml, 0) AS water_ml, coalesce(d.calories_in, 0) AS calories_in
    FROM users u
    JOIN progression_state s ON s.user_id = u.id
   CROSS JOIN LATERAL (SELECT $1::date + n AS day FROM generate_series(0, $2::date - $1::date) n) g
    LEFT JOIN daily_logs d ON d.user_id = u.id AND d.logical_date = g.day
   CROSS JOIN LATERAL (
          SELECT count(c.completed_at)::int AS story_done, count(*)::int AS story_total
            FROM quests q
            LEFT JOIN quest_completions c ON c.quest_id = q.id AND c.daily_log_id = d.id
           WHERE q.category = 'STORY' AND q.is_active AND u.archetype = ANY (q.archetypes)) k
   WHERE u.id = app.current_user_id()
   ORDER BY g.day`;

/** One summary per date from `from` to `to`, both included, oldest first. For an onboarded caller. */
export async function buildDaySummaries(
  { db }: Reader,
  from: DateLabel,
  to: DateLabel,
): Promise<DaySummary[]> {
  const { rows } = await db.query<SummaryRow>(SUMMARIES, [from, to]);
  return rows.map(row => ({
    logicalDate: row.logical_date,
    outcome: row.outcome,
    storyDone: row.story_done,
    storyTotal: row.story_total,
    waterMl: row.water_ml,
    caloriesIn: Number(row.calories_in),
    workoutMinutes: 0,
  }));
}

type ActionRow = {
  id: string;
  kind: DayDetail['actions'][number]['kind'];
  happened: Date;
  label: string | null;
  undone: boolean;
};

// TICK: every tick of the day, the undone ones marked. BEDTIME: the mark is a column of the log,
// so the log's id stands for it. Task 21 adds NUTRITION and WORKOUT.
const ACTIONS = `
  SELECT t.id, 'TICK' AS kind, t.occurred_at AS happened, q.code AS label, t.undone_at IS NOT NULL AS undone,
         t.created_at AS recorded
    FROM daily_logs d
    JOIN quest_ticks t ON t.daily_log_id = d.id
    JOIN quests q ON q.id = t.quest_id
   WHERE d.user_id = app.current_user_id() AND d.logical_date = $1::date
  UNION ALL
  SELECT d.id, 'BEDTIME', d.bedtime_marked_at, NULL, false, d.bedtime_marked_at
    FROM daily_logs d
   WHERE d.user_id = app.current_user_id() AND d.logical_date = $1::date
     AND d.bedtime_marked_at IS NOT NULL
   ORDER BY happened DESC, recorded DESC, id`;

/** The summary of `date` and what was recorded on it, newest first. For an onboarded caller. */
export async function buildDayDetail(
  ctx: Reader,
  date: DateLabel,
): Promise<DayDetail> {
  const [summary] = await buildDaySummaries(ctx, date, date);
  if (summary === undefined) {
    throw new Error('this read model is for an onboarded user');
  }
  const { rows } = await ctx.db.query<ActionRow>(ACTIONS, [date]);
  return {
    summary,
    actions: rows.map(row => ({
      id: row.id,
      kind: row.kind,
      at: row.happened.toISOString(),
      mealSlot: null,
      label: row.label,
      value: null,
      undone: row.undone,
    })),
  };
}
