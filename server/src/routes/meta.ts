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

const meta: Route[] = [
  {
    method: 'GET',
    path: '/healthz',
    auth: 'anon',
    // No request transaction: with the database down this still answers 200, `ok: false`.
    direct: async ({ pool, log }) => {
      const db = await withRole(pool, 'app_anon', null, c =>
        c.query('SELECT app.now()'),
      ).then(
        () => true,
        (e: unknown) => {
          log.line({ level: 'error', evt: 'health', ...describeError(e) });
          return false;
        },
      );
      // jobs: filled once the scheduler records its runs
      const body: Health = { ok: db, db, jobs: [] };
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
