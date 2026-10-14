// What scenario files share: the contract types and the steps every scenario is made of. A
// scenario builds its state by calling the running server's HTTP API and the real jobs while
// stepping the test clock (ctx.setClock); it never writes a business row itself.
//
// This file is not in scripts/scenarios/ on purpose: every file there is a scenario.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export type CallOptions = {
  token?: string;
  body?: unknown;
  /** Sent as `Idempotency-Key`: the writes whose contract asks for one pass it. */
  key?: string;
};

export type ScenarioCtx = {
  /** `path` is relative to /api/v1. Resolves to the parsed JSON body; any status outside 2xx throws. */
  call(method: string, path: string, opts?: CallOptions): Promise<any>;
  /** Read-only (SELECT): only `setClock` and `reset` write through the superuser. */
  admin: pg.Pool;
  /** An ISO instant with a zone, or null to return to real time. */
  setClock(iso: string | null): Promise<void>;
  /** Runs the job once for `SELECT app.now()` and resolves to its counts. */
  runJob(name: string): Promise<unknown>;
  /** Hard-deletes the demo user with this email (and everything that cascades from it). */
  reset(email: string): Promise<void>;
};

export type Scenario = {
  /** The CLI word; also the middle of the demo email. */
  name: string;
  describe: string;
  run(ctx: ScenarioCtx): Promise<{ email: string; password: string; note: string }>;
};

export const PASSWORD = 'matkhau123';
export const DISPLAY_NAME = 'An';
/** 09:00 on 2027-03-01 in Asia/Ho_Chi_Minh (UTC+7 all year): where every scenario starts. */
export const START = '2027-03-01T02:00:00.000Z';

const HOUR_MS = 3_600_000;
const ONBOARDING = {
  timezone: 'Asia/Ho_Chi_Minh',
  archetype: 'SUPPORTER',
  heightCm: 168,
  weightKg: 62,
  birthYear: 1995,
  sex: 'FEMALE',
  activityLevel: 'LIGHT',
};

export const demoEmail = (name: string) => `demo-${name}@hoimau.test`;

/**
 * The instant of local hour `hour` (3 to 26: 24 is midnight, 28 would be 04:00) of the logical
 * day that closes at `closesAt` (03:00 local the next day, as `GET /day` says).
 * ponytail: fixed offsets only; the demo users live in Asia/Ho_Chi_Minh (no daylight saving).
 * Any other zone: ask the server for each instant instead.
 */
export const localHour = (closesAt: string, hour: number) =>
  new Date(Date.parse(closesAt) + (hour - 27) * HOUR_MS).toISOString();

export const getDay = (ctx: ScenarioCtx, token: string) =>
  ctx.call('GET', '/day', { token });

/**
 * A clean start: the demo user of this name deleted, the clock at START, a new account
 * registered and, with `onboard`, onboarded. Returns what the later steps need.
 */
export async function begin(ctx: ScenarioCtx, name: string, onboard: boolean) {
  const email = demoEmail(name);
  await ctx.reset(email);
  await ctx.setClock(START);
  const session = await ctx.call('POST', '/auth/register', {
    body: { email, password: PASSWORD, displayName: DISPLAY_NAME, acceptedTerms: true },
  });
  if (onboard) {
    await ctx.call('POST', '/onboarding', {
      token: session.token,
      key: randomUUID(),
      body: ONBOARDING,
    });
  }
  return { email, token: session.token as string };
}

/** Moves the clock to local hour `hour` of the user's current logical day. */
export async function goTo(ctx: ScenarioCtx, token: string, hour: number) {
  await ctx.setClock(localHour((await getDay(ctx, token)).closesAt, hour));
}

/**
 * Completes both STORY quests of today at the current instant: a meal whose total is inside the
 * band the server reports, and the shortest workout of the real catalog, done in full.
 */
export async function completeStory(ctx: ScenarioCtx, token: string) {
  const { calorieWindow } = await getDay(ctx, token);
  await ctx.call('POST', '/nutrition/log', {
    token,
    key: randomUUID(),
    body: { kcal: Math.round((calorieWindow.min + calorieWindow.max) / 2) },
  });
  const { items } = await ctx.call('GET', '/workout/catalog', { token });
  const workout = [...items].sort((a, b) => a.durationSec - b.durationSec)[0];
  await ctx.call('POST', '/workout/complete', {
    token,
    key: randomUUID(),
    body: { exerciseItemId: workout.id, elapsedSec: workout.durationSec },
  });
  const day = await getDay(ctx, token);
  if (day.story.done !== day.story.total) {
    throw new Error(`the story of ${day.logicalDate} is ${day.story.done}/${day.story.total}, not done`);
  }
}

/** Steps the clock to 04:00 local of the next day, past the 03:00 close, and runs `day-close`. */
export async function closeDay(ctx: ScenarioCtx, token: string) {
  await goTo(ctx, token, 28);
  const counts = (await ctx.runJob('day-close')) as { failed?: number };
  if (counts.failed !== 0) {
    throw new Error(`day-close failed for ${counts.failed} user(s)`);
  }
}

/**
 * Lives one day per entry from the current day: true = the story is completed at noon, false =
 * nothing is recorded; each day is then closed.
 */
export async function playDays(ctx: ScenarioCtx, token: string, days: boolean[]) {
  for (const done of days) {
    if (done) {
      await goTo(ctx, token, 12);
      await completeStory(ctx, token);
    }
    await closeDay(ctx, token);
  }
}
