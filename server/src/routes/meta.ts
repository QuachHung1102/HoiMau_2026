import type { Pool } from 'pg';
import type { Health, TimezoneList } from '../../../domain/contract/core.ts';
import type { Route } from '../app.ts';
import { withRole } from '../db.ts';
import { describeError } from '../log.ts';

const intlAccepts = (zone: string): boolean => {
  try {
    return Boolean(new Intl.DateTimeFormat('en', { timeZone: zone }));
  } catch {
    return false;
  }
};

let zones: Promise<string[]> | undefined;

/**
 * The names `users.timezone` accepts (table `timezones`: Area/City names and UTC) that
 * JavaScript knows as well. `Intl.supportedValuesOf('timeZone')` is not that list: it has
 * 'Asia/Saigon' and no 'Asia/Ho_Chi_Minh'. Read once per process: the table changes only in a
 * migration. `timezones` is content without row level security, readable by app_auth alone,
 * hence that role with no user; a failed read is not kept.
 */
function timezones(pool: Pool): Promise<string[]> {
  zones ??= withRole(pool, 'app_auth', null, db =>
    db.query<{ name: string }>('SELECT name FROM timezones'),
  ).then(
    ({ rows }) =>
      rows
        .map(row => row.name)
        .filter(intlAccepts)
        .sort(),
    (e: unknown) => {
      zones = undefined;
      throw e;
    },
  );
  return zones;
}

/** A health check is an answer about now: one that takes longer than this is "no". */
const HEALTH_TIMEOUT_MS = 2000;
class HealthTimeout extends Error {}

const meta: Route[] = [
  {
    method: 'GET',
    path: '/healthz',
    auth: 'anon',
    // No request transaction: with the database down, silent, or with no pooled client free,
    // this still answers 200 with `ok: false`, within HEALTH_TIMEOUT_MS.
    direct: async ({ pool, log }) => {
      const check = withRole(pool, 'app_anon', null, c =>
        c.query('SELECT app.now()'),
      ).then(
        () => null,
        (e: unknown) => e,
      );
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<Error>(resolve => {
        timer = setTimeout(resolve, HEALTH_TIMEOUT_MS, new HealthTimeout());
      });
      const failure = await Promise.race([check, late]);
      clearTimeout(timer);
      if (failure !== null) {
        log.line({ level: 'error', evt: 'health', ...describeError(failure) });
      }
      // jobs: filled once the scheduler records its runs
      const body: Health = {
        ok: failure === null,
        db: failure === null,
        jobs: [],
      };
      return { status: 200, body };
    },
  },
  {
    method: 'GET',
    path: '/meta/timezones',
    auth: 'anon',
    direct: async ({ pool }) => {
      const body: TimezoneList = { zones: await timezones(pool) };
      return { status: 200, body };
    },
  },
];

export default meta;
