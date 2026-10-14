// What a user reads back about a day: the day with its quests (`GET /day`, and the `day` of every
// `ActionResult`), the summaries of a range of dates and the recorded actions of one date. Read
// as app_auth inside the request transaction: the caller is named explicitly in every statement
// and row level security is the second filter under it. Nothing here writes: a day without any
// action has no daily_logs row and is shown as a day with nothing done.
//
// Every date label and every instant of a day (`logicalDate`, `closesAt`, `locked`) comes from
// SQL: app.logical_date and app.logical_day_end over the caller's stored zone, the functions
// that decide where a write lands. Nothing here asks JavaScript about a time zone: Node and
// PostgreSQL carry two copies of the zone database, and they do not always agree.
import type {
  DayDetail,
  DayState,
  DaySummary,
  InboxItemStreakMilestone,
  QuestState,
} from '../../../domain/contract/core.ts';
import { calorieWindow } from '../../../domain/energy.ts';
import type { DateLabel } from '../../../domain/types.ts';
import type { Ctx } from '../app.ts';

type Reader = Pick<Ctx, 'db'>;

type DayRow = {
  now: Date;
  day: DateLabel;
  closes_at: Date;
  calories_in: string;
  water_ml: number;
  bedtime_marked_at: Date | null;
  calorie_target: string;
  water_target: number;
  streak_current: number;
  streak_best: number;
  quests: QuestState[];
  unread_count: number;
  celebrations: InboxItemStreakMilestone[];
};

// One statement: one snapshot of the database for everything the day shows. $1: the date, or
// null for the logical date of app.now() in the caller's zone. The hidden quest is locked while
// that day is today and the wall clock is before 18:00 (the hours day_bedtime refuses).
// closes_at: the instant the label of today changes, counted from now; for another date, from
// noon of that date on the zone's wall clock (an instant that carries that label).
// unread_count: the caller's unread inbox items; celebrations: the unread STREAK_MILESTONE ones,
// oldest first (the order they were reached in).
const DAY = `
  WITH me AS (
    SELECT u.id, u.timezone, u.archetype, app.now() AS now,
           app.logical_date(app.now(), u.timezone) AS today,
           coalesce($1::date, app.logical_date(app.now(), u.timezone)) AS day,
           extract(hour FROM app.now() AT TIME ZONE u.timezone)::int AS hour
      FROM users u WHERE u.id = app.current_user_id()
  )
  SELECT me.now, to_char(me.day, 'YYYY-MM-DD') AS day,
         app.logical_day_end(
           CASE WHEN me.day = me.today THEN me.now
                ELSE (me.day + time '12:00') AT TIME ZONE me.timezone END,
           me.timezone) AS closes_at,
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
           WHERE q.is_active AND me.archetype = ANY (q.archetypes)) AS quests,
         (SELECT count(*)::int FROM notifications n
           WHERE n.user_id = me.id AND n.read_at IS NULL) AS unread_count,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', n.id, 'kind', n.kind, 'payload', n.payload,
                   'createdAt', n.created_at, 'readAt', n.read_at) ORDER BY n.created_at), '[]'::jsonb)
            FROM notifications n
           WHERE n.user_id = me.id AND n.read_at IS NULL AND n.kind = 'STREAK_MILESTONE') AS celebrations
    FROM me
    JOIN prescriptions p ON p.user_id = me.id
    JOIN progression_state g ON g.user_id = me.id
    LEFT JOIN daily_logs d ON d.user_id = me.id AND d.logical_date = me.day`;

/**
 * The caller's day: today (the logical date of `app.now()` in the caller's zone) unless
 * `logicalDate` names another one. A write route answers with today, whatever day the write
 * landed on: the app takes `ActionResult.day` as the current day. For an onboarded caller.
 *
 * `closesAt` is the earliest instant after now at which the label of today changes
 * (app.logical_day_end): a write sent before it lands on this day, one sent at it on the next.
 * `lastTick.at` is the instant the server recorded the tick: the undo window counts from it.
 * `unreadCount` counts the caller's unread inbox items; `celebrations` are the unread
 * STREAK_MILESTONE items, oldest first, until POST /inbox/read marks them.
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
    closesAt: row.closes_at.toISOString(),
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
    unreadCount: row.unread_count,
    celebrations: row.celebrations.map(item => ({
      ...item,
      createdAt: new Date(item.createdAt).toISOString(),
    })),
  };
}

type SummaryRow = {
  logical_date: DateLabel;
  outcome: DaySummary['outcome'];
  story_done: number;
  story_total: number;
  water_ml: number;
  calories_in: string;
  workout_minutes: number;
  /** Null unless asked for ($3). */
  actions: DayDetail['actions'] | null;
};

// One row per date from $1 to $2. A date before the user's first day is NONE; one the day-close
// job has not processed is OPEN; a closed one is COMPLETED when its log says the story was
// done, else FROZEN when a ticket was used for it, else MISSED (a missed day needs no log): the
// order closeDays decides in (AR-10). workout_minutes: the seconds of the date's sessions / 60.
// With $3 the row also carries the recorded actions of its date, newest first, read in this
// same statement: the summary and the list are one snapshot. TICK: every tick, the undone ones
// marked. NUTRITION: every log, its kcal and slot (null for a manual entry). WORKOUT: every
// session, the workout's name and the seconds spent. BEDTIME: the mark is a column of the log,
// so the log's id stands for it.
const SUMMARIES = `
  SELECT to_char(g.day, 'YYYY-MM-DD') AS logical_date,
         CASE WHEN g.day < s.onboard_date THEN 'NONE'
              WHEN s.last_closed_date IS NULL OR g.day > s.last_closed_date THEN 'OPEN'
              WHEN d.story_completed THEN 'COMPLETED'
              WHEN EXISTS (SELECT 1 FROM freeze_tickets t
                            WHERE t.user_id = u.id AND t.used_for_date = g.day) THEN 'FROZEN'
              ELSE 'MISSED' END AS outcome,
         k.story_done, k.story_total,
         coalesce(d.water_ml, 0) AS water_ml, coalesce(d.calories_in, 0) AS calories_in,
         coalesce((SELECT sum(w.elapsed_sec)::float8 / 60 FROM workout_sessions w
                    WHERE w.daily_log_id = d.id), 0) AS workout_minutes,
         CASE WHEN $3::boolean THEN (
           SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id, 'kind', a.kind, 'at', a.happened, 'mealSlot', a.meal_slot,
                    'label', a.label, 'value', a.value, 'undone', a.undone)
                    ORDER BY a.happened DESC, a.recorded DESC, a.id), '[]'::jsonb)
             FROM (SELECT t.id, 'TICK' AS kind, t.occurred_at AS happened, NULL AS meal_slot,
                          q.code AS label, NULL::numeric AS value,
                          t.undone_at IS NOT NULL AS undone, t.created_at AS recorded
                     FROM quest_ticks t JOIN quests q ON q.id = t.quest_id
                    WHERE t.daily_log_id = d.id
                   UNION ALL
                   SELECT n.id, 'NUTRITION', n.occurred_at, n.meal_slot, n.label, n.kcal, false, n.created_at
                     FROM nutrition_logs n
                    WHERE n.daily_log_id = d.id
                   UNION ALL
                   SELECT w.id, 'WORKOUT', w.occurred_at, NULL, i.name, w.elapsed_sec, false, w.created_at
                     FROM workout_sessions w JOIN exercise_items i ON i.id = w.exercise_item_id
                    WHERE w.daily_log_id = d.id
                   UNION ALL
                   SELECT d.id, 'BEDTIME', d.bedtime_marked_at, NULL, NULL, NULL, false, d.bedtime_marked_at
                    WHERE d.bedtime_marked_at IS NOT NULL) a) END AS actions
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

const summaryOf = (row: SummaryRow): DaySummary => ({
  logicalDate: row.logical_date,
  outcome: row.outcome,
  storyDone: row.story_done,
  storyTotal: row.story_total,
  waterMl: row.water_ml,
  caloriesIn: Number(row.calories_in),
  workoutMinutes: row.workout_minutes,
});

/** One summary per date from `from` to `to`, both included, oldest first. For an onboarded caller. */
export async function buildDaySummaries(
  { db }: Reader,
  from: DateLabel,
  to: DateLabel,
): Promise<DaySummary[]> {
  const { rows } = await db.query<SummaryRow>(SUMMARIES, [from, to, false]);
  return rows.map(summaryOf);
}

/**
 * The summary of `date` and what was recorded on it, newest first, from ONE statement: a tick
 * committed while this runs is in both or in neither. For an onboarded caller.
 */
export async function buildDayDetail(
  { db }: Reader,
  date: DateLabel,
): Promise<DayDetail> {
  const { rows } = await db.query<SummaryRow>(SUMMARIES, [date, date, true]);
  if (rows.length !== 1 || rows[0].actions === null) {
    throw new Error('this read model is for an onboarded user');
  }
  return {
    summary: summaryOf(rows[0]),
    actions: rows[0].actions.map(action => ({
      ...action,
      at: new Date(action.at).toISOString(),
    })),
  };
}
