// NFR-10 and R-P.4 on the log of a whole flow: a person registers, onboards with planted numbers,
// records three logical days, undoes a tick, writes a journal sentence, buys an item, signs in
// again, asks for a password reset, sends a few requests that fail, and day-close runs.
//
//  1. Every XP and coin ledger row the flow created has exactly one `evt:'ledger'` line, with
//     the same kind, user, amount, reason and ref (the multisets are equal, not only the counts),
//     and a replay of every write adds neither a row nor a line.
//  2. Nothing the person gave the server is in any log line: not the email, the password, the
//     token or its hash, the reset code, the height, weight and birth year, the calories, the
//     meal label, the journal sentence. The check is differential: each planted value is first
//     shown to be in the fixture (in the database, or in what the server answered), the scanner
//     is shown to find it in a line that does leak it, and only then is the real log scanned.
//  3. `job_late` is emitted when day-close has not succeeded for 91 minutes, and not for 90, and
//     never while it succeeds.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Route } from '../src/app.ts';
import { runJob, startScheduler } from '../src/jobs/scheduler.ts';
import type { Job } from '../src/jobs/scheduler.ts';
import { createLogger } from '../src/log.ts';
import { setTestClock } from './helpers.ts';
import { ONBOARDING_INPUT, startTestApp } from './http.ts';
import type { TestApp } from './http.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

type Line = Record<string, unknown>;

// What the person types. Chosen so that no honest log line can contain them by accident: a
// height with a decimal, a weight with a decimal, a year that is no timestamp, a text that is
// no word of ours.
const EMAIL = `obs${randomBytes(6).toString('hex')}@example.com`;
const PASSWORD = `matkhau-${randomBytes(6).toString('hex')}`;
const HEIGHT = 173.4;
const WEIGHT = 67.3;
const BIRTH_YEAR = 1987;
const LABEL = `bun-cha-${randomBytes(4).toString('hex')}`;
const JOURNAL = `Hom nay minh met va buon ${randomBytes(6).toString('hex')}`;

let db: TestDb;
let app: TestApp;
const jobLines: string[] = [];
const jobLog = createLogger(line => jobLines.push(line));

/** The route that fails with everything secret in the message of its error. */
const crashing: Route = {
  method: 'GET',
  path: '/probe/obs-crash',
  auth: 'anon',
  handler: async () => {
    throw new Error(`boom ${EMAIL} ${PASSWORD} ${JOURNAL} ${HEIGHT}`);
  },
};

before(async () => {
  db = await createTestDb();
  app = await startTestApp(db, { routes: [crashing] });
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

const clock = (iso: string) => setTestClock(db.admin, iso);
// Asia/Ho_Chi_Minh is UTC+7 all year: 12:00 local is 05:00 UTC.
const local = (date: string, time: string) => new Date(`${date}T${time}+07:00`).toISOString();
const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Write = { path: string; key: string; body: unknown; answer: unknown };
const writes: Write[] = [];

/** One person's HTTP calls; each keyed write is kept for the replay. */
function person(token: string) {
  const ok = (what: string, result: Awaited<ReturnType<TestApp['call']>>) => {
    assert.equal(result.status, 200, `${what}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  return {
    get: async (path: string) => ok(`GET ${path}`, await app.call('GET', path, { token })),
    async post(path: string, body: unknown) {
      const key = randomUUID();
      const answer = ok(`POST ${path}`, await app.call('POST', path, { token, key, body }));
      writes.push({ path, key, body, answer });
      return answer;
    },
    replay: (write: Write) => app.call('POST', write.path, { token, key: write.key, body: write.body }),
  };
}

type Ledger = { kind: string; userId: string; amount: number; reason: string; refId: string };
const ledgerKey = (row: Ledger) => `${row.kind}|${row.userId}|${row.amount}|${row.reason}|${row.refId}`;

/** Every ledger row of the database as the owner, in the shape of a ledger log line. */
async function ledgerRows(): Promise<Ledger[]> {
  const { rows } = await db.admin.query<Ledger>(
    `SELECT 'xp' AS kind, user_id AS "userId", amount, reason, ref_id AS "refId" FROM xp_ledger
     UNION ALL
     SELECT 'coin', user_id, amount, reason, ref_id FROM coin_ledger`,
  );
  return rows;
}

/** The ledger lines of the app and of the jobs, as they were written. */
const ledgerLines = (): Ledger[] =>
  [...app.logs, ...jobLines.map(line => JSON.parse(line) as Line)]
    .filter(line => line.evt === 'ledger')
    .map(({ kind, userId, amount, reason, refId }) => ({ kind, userId, amount, reason, refId }) as Ledger);

const sorted = (rows: Ledger[]) => rows.map(ledgerKey).sort();

const state: {
  token: string;
  secondToken: string;
  userId: string;
  mealKcal: number;
  calorieTarget: number;
  resetCode: string;
  journalId: string;
  journalReadBack: boolean;
  before: Ledger[];
  after: Ledger[];
} = {} as never;

test('the slice-1 flow: one ledger line per ledger row, none for a replay', async () => {
  state.before = await ledgerRows();
  const firstDay = '2027-03-10';
  await clock(local(firstDay, '09:00'));

  const registered = await app.call('POST', '/auth/register', {
    body: { email: EMAIL, password: PASSWORD, displayName: 'An', acceptedTerms: true },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  state.token = registered.body.token;
  const me = person(state.token);
  const onboarded = await me.post('/onboarding', {
    ...ONBOARDING_INPUT,
    heightCm: HEIGHT,
    weightKg: WEIGHT,
    birthYear: BIRTH_YEAR,
  });
  state.userId = onboarded.user.id;
  state.calorieTarget = (await me.get('/me/prescription')).calorieTarget;
  const { items } = await me.get('/workout/catalog');
  const workout = [...items].sort((a: { durationSec: number }, b: { durationSec: number }) => a.durationSec - b.durationSec)[0];

  for (const n of [0, 1, 2]) {
    const date = plusDays(firstDay, n);
    await clock(local(date, '12:00'));
    const day = await me.get('/day');
    assert.equal(day.logicalDate, date);
    for (let tick = 1; tick <= 8; tick++) {
      await me.post('/day/quests/WATER_8/progress', {});
    }
    state.mealKcal = day.calorieWindow.min;
    await me.post('/nutrition/log', n === 0 ? { kcal: state.mealKcal, label: LABEL } : { kcal: state.mealKcal });
    const session = await me.post('/workout/complete', {
      exerciseItemId: workout.id,
      elapsedSec: Math.ceil(workout.durationSec / 2),
    });
    assert.deepEqual([session.day.story.done, session.day.story.total], [2, 2]);
    // just after 03:00 local, as the server names it
    const closeAt = new Date(Date.parse(session.day.closesAt) + 60_000);
    await clock(closeAt.toISOString());
    const counts = await runJob('day-close', db.app, closeAt, jobLog);
    assert.deepEqual([counts.failed, counts.skipped], [0, 0]);
  }
  assert.equal((await me.get('/progression')).streakCurrent, 3);

  // a tick and its undo: a ledger row with the opposite sign and its own line
  await clock(local(plusDays(firstDay, 3), '12:00'));
  const tick = await me.post('/day/quests/WATER_8/progress', {});
  await me.post('/day/quests/WATER_8/undo', { tickId: tick.actionId });

  // a journal sentence (XP), then the first item the person can buy (coins)
  const journal = await me.post('/journal', { body: JOURNAL });
  state.journalId = journal.entry.id;
  state.journalReadBack = (await me.get(`/journal/${journal.entry.id}`)).body === JOURNAL;
  const shop = await me.get('/shop');
  const item = shop.items.find((i: { purchasable: boolean }) => i.purchasable);
  assert.ok(item, 'three recorded days pay for something');
  await me.post(`/shop/${item.code}/purchase`, undefined);

  // sign in again with a wrong and with the right password; ask for and use a reset code
  const wrong = await app.call('POST', '/auth/login', { body: { email: EMAIL, password: `${PASSWORD}-x` } });
  assert.equal(wrong.status, 401);
  const login = await app.call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  state.secondToken = login.body.token;
  assert.equal((await app.call('POST', '/auth/password/forgot', { body: { email: EMAIL } })).status, 202);
  const mail = app.mail.find(message => message.to === EMAIL);
  assert.ok(mail, 'the reset mail was handed to the mailer');
  state.resetCode = /([0-9]{8})/.exec(mail.text)?.[1] as string;
  assert.ok(state.resetCode, 'the mail carries the code');

  // requests that fail, with the secrets in the path, the query and the body
  assert.equal((await app.call('GET', `/nowhere/${EMAIL}?token=${state.token}&pw=${PASSWORD}`)).status, 404);
  assert.equal((await app.call('GET', '/probe/obs-crash')).status, 500);

  // a replay of every keyed write adds no ledger row and no ledger line
  const rowsBefore = sorted(await ledgerRows());
  const linesBefore = sorted(ledgerLines());
  for (const write of writes) {
    const again = await me.replay(write);
    assert.equal(again.status, 200, `replay ${write.path}`);
    assert.deepEqual(again.body, write.answer, `replay ${write.path}`);
  }
  assert.deepEqual(sorted(await ledgerRows()), rowsBefore);
  assert.deepEqual(sorted(ledgerLines()), linesBefore);
  // the reset itself revokes the sessions, so it comes after the replays
  assert.equal(
    (await app.call('POST', '/auth/password/reset', { body: { email: EMAIL, code: state.resetCode, newPassword: `${PASSWORD}-new` } })).status,
    204,
  );

  // the claim itself
  state.after = await ledgerRows();
  const created = state.after.length - state.before.length;
  assert.ok(created > 50, `the flow wrote ledger rows (${created})`);
  const lines = ledgerLines();
  assert.equal(lines.length, created, 'one ledger line per ledger row created');
  const known = new Set(sorted(state.before));
  const fresh = sorted(state.after.filter(row => !known.has(ledgerKey(row))));
  assert.equal(fresh.length, created, 'every new row is a new key');
  assert.deepEqual(sorted(lines), fresh, 'the lines are the rows: kind, user, amount, reason and ref');
  // both kinds and a negative amount of each (the undo and the purchase) are in the flow
  for (const wanted of ['xp', 'coin']) {
    assert.ok(lines.some(l => l.kind === wanted && l.amount > 0), `a ${wanted} credit`);
  }
  assert.ok(lines.some(l => l.kind === 'xp' && l.amount < 0 && l.reason === 'QUEST_TICK_UNDO'), 'the undo');
  assert.ok(lines.some(l => l.kind === 'coin' && l.amount < 0 && l.reason === 'PURCHASE'), 'the purchase');
});

type Planted = { name: string; needle: string | number; inFixture: () => Promise<boolean> };

const hex = (digest: Buffer) => digest.toString('hex');
const sha = (text: string) => createHash('sha256').update(text).digest();

const exists = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rowCount === 1;

const planted = (): Planted[] => [
  { name: 'email', needle: EMAIL, inFixture: () => exists('SELECT 1 FROM users WHERE email = $1', [EMAIL]) },
  {
    name: 'password',
    needle: PASSWORD,
    // the proof that it is the real one: the server signed the person in with it (the login above)
    inFixture: async () => state.secondToken !== undefined,
  },
  {
    name: 'token',
    needle: state.token,
    inFixture: () => exists('SELECT 1 FROM sessions WHERE token_hash = $1', [sha(state.token)]),
  },
  {
    name: 'second token',
    needle: state.secondToken,
    inFixture: () => exists('SELECT 1 FROM sessions WHERE token_hash = $1', [sha(state.secondToken)]),
  },
  {
    name: 'token hash (hex)',
    needle: hex(sha(state.token)),
    inFixture: () => exists("SELECT 1 FROM sessions WHERE encode(token_hash, 'hex') = $1", [hex(sha(state.token))]),
  },
  {
    name: 'token hash (base64url)',
    needle: sha(state.token).toString('base64url'),
    inFixture: () => exists("SELECT 1 FROM sessions WHERE translate(rtrim(encode(token_hash, 'base64'), '='), '+/', '-_') = $1", [sha(state.token).toString('base64url')]),
  },
  { name: 'reset code', needle: state.resetCode, inFixture: async () => app.mail.some(m => m.text.includes(state.resetCode)) },
  { name: 'height', needle: HEIGHT, inFixture: () => exists('SELECT 1 FROM biometric_snapshots WHERE user_id = $1 AND height_cm = $2', [state.userId, HEIGHT]) },
  { name: 'weight', needle: WEIGHT, inFixture: () => exists('SELECT 1 FROM biometric_snapshots WHERE user_id = $1 AND weight_kg = $2', [state.userId, WEIGHT]) },
  { name: 'birth year', needle: BIRTH_YEAR, inFixture: () => exists('SELECT 1 FROM biometric_snapshots WHERE user_id = $1 AND birth_year = $2', [state.userId, BIRTH_YEAR]) },
  { name: 'calories of a meal', needle: state.mealKcal, inFixture: () => exists('SELECT 1 FROM nutrition_logs WHERE user_id = $1 AND kcal = $2 LIMIT 1', [state.userId, state.mealKcal]) },
  { name: 'calorie target', needle: state.calorieTarget, inFixture: () => exists('SELECT 1 FROM prescriptions WHERE user_id = $1 AND calorie_target = $2', [state.userId, state.calorieTarget]) },
  { name: 'meal label', needle: LABEL, inFixture: () => exists('SELECT 1 FROM nutrition_logs WHERE user_id = $1 AND label = $2', [state.userId, LABEL]) },
  {
    name: 'journal sentence',
    needle: JOURNAL,
    // stored encrypted: the fixture is the person's own read of it, made right after the write
    inFixture: async () => state.journalReadBack,
  },
];

/**
 * Whether a log line carries `needle`. Text is looked for anywhere in the line. A number is looked
 * for in the values of the line's fields except the clock (`ts`, `ms`, `status`): as a number, and
 * as a word inside a text value (not as a piece of one: "1987" is also a piece of a uuid).
 */
function leaks(line: string, needle: string | number): boolean {
  if (typeof needle === 'string') {
    // a code of digits is also a piece of a uuid: it counts when no word character is next to it
    return /^[0-9]+$/.test(needle)
      ? new RegExp(`(?<![0-9A-Za-z-])${needle}(?![0-9A-Za-z-])`).test(line)
      : line.includes(needle);
  }
  // inside a text it counts when no letter, digit or dash is before it (a uuid group) and no letter,
  // digit or decimals follow it: "boom 173.4." and "kcal 512 over" are leaks, "-1987-" is not
  const inText = new RegExp(`(?<![0-9A-Za-z-]|[0-9]\\.)${String(needle).replace('.', '\\.')}(?![0-9A-Za-z]|\\.[0-9])`);
  const found = (value: unknown, key?: string): boolean => {
    if (key === 'ts' || key === 'ms' || key === 'status') {
      return false;
    }
    if (typeof value === 'number') {
      return value === needle;
    }
    if (typeof value === 'string') {
      return inText.test(value);
    }
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).some(([k, v]) => found(v, k));
    }
    return false;
  };
  return found(JSON.parse(line));
}

test('no log line carries anything the person gave the server', async () => {
  const everything = [...app.logs.map(line => JSON.stringify(line)), ...jobLines];
  assert.ok(everything.length > 100, `the flow wrote a log (${everything.length} lines)`);
  const values = planted();
  for (const { name, needle, inFixture } of values) {
    // 1. the value is in the fixture
    assert.equal(await inFixture(), true, `${name} is in the fixture`);
    // 2. the scanner sees it in a line that leaks it: as a field, inside a longer text, and (a
    // number) as a field that holds text
    const leakingFields: Record<string, unknown>[] = [{ note: needle }, { note: `kcal ${needle} over target` }, { note: `boom ${needle}.` }];
    if (typeof needle === 'number') {
      leakingFields.push({ note: String(needle) });
    }
    for (const fields of leakingFields) {
      let caught = '';
      createLogger(line => {
        caught = line;
      }).line({ evt: 'x', ...fields });
      assert.equal(leaks(caught, needle), true, `the scanner finds ${name} in ${caught}`);
    }
    // 3. and no real line has it
    const hit = everything.find(line => leaks(line, needle));
    assert.equal(hit, undefined, `${name} is in a log line: ${hit}`);
  }
  // the failing requests are in the log, by pattern only
  const routes = new Set(app.logs.map(line => line.route));
  assert.ok(routes.has(null), 'the unknown path is logged with route null');
  assert.ok(app.logs.some(line => line.status === 500 && line.route === '/probe/obs-crash'), 'the crash is logged');
  assert.ok(app.logs.every(line => typeof line.route !== 'string' || !line.route.includes('@')), 'a route is a pattern');
});

test('the scanner does not call an honest number a leak (a uuid that contains the digits is no hit)', () => {
  const line = JSON.stringify({ evt: 'ledger', userId: '0000a1987b00-0000-0000-0000-000000000000', amount: 10, ms: 1987, status: 200 });
  assert.equal(leaks(line, 1987), false);
  assert.equal(leaks(JSON.stringify({ amount: 1987 }), 1987), true);
  // a four-digit group of a uuid, a longer number and a longer decimal are not the value
  const honest = [{ userId: '0f3a1c2b-1987-4abc-8def-001122334455' }, { note: 'order 19871' }, { note: 'x1987' }, { note: '2027-03-10' }];
  for (const fields of honest) {
    assert.equal(leaks(JSON.stringify({ evt: 'x', ...fields }), 1987), false, JSON.stringify(fields));
  }
  assert.equal(leaks(JSON.stringify({ note: 'height 173.45' }), 173.4), false);
  assert.equal(leaks(JSON.stringify({ note: 'height 173.4 cm' }), 173.4), true);
  assert.equal(leaks(JSON.stringify({ note: '1173.4' }), 173.4), false);
});

// ---------------------------------------------------------------------------------------------
// job_late

/** A job named like the real day-close, so the scheduler's late check applies to it, that succeeds or fails as the test says. */
function dayCloseThat(succeeds: boolean): Job {
  return {
    name: 'day-close',
    due: () => true,
    run: async () => {
      if (!succeeds) {
        throw new Error(`day-close failed ${EMAIL}`);
      }
      return { users: 0 };
    },
  };
}

/** Ticks a scheduler (clock set by hand) at the given minutes after 10:15 and returns its lines. */
async function ticks(job: Job, minutes: number[]): Promise<Line[]> {
  const lines: Line[] = [];
  const clockNow = { at: new Date('2027-03-10T10:15:00.000Z') };
  const scheduler = await startScheduler({
    pool: db.app,
    log: createLogger(line => lines.push(JSON.parse(line) as Line)),
    jobs: [job],
    now: async () => clockNow.at,
    intervalMs: 3_600_000,
  });
  try {
    for (const minute of minutes) {
      clockNow.at = new Date(Date.parse('2027-03-10T10:15:00.000Z') + minute * 60_000);
      await scheduler.tick();
    }
  } finally {
    await scheduler.stop();
  }
  return lines;
}

const alerts = (lines: Line[]) => lines.filter(line => line.evt === 'job_late');

test('job_late: emitted when day-close has not succeeded for 91 minutes, not for 90, and not while it succeeds', async () => {
  const failing = dayCloseThat(false);
  const at90 = await ticks(failing, [0, 45, 90]);
  assert.deepEqual(alerts(at90), [], 'no alert at 90 minutes');
  assert.ok(at90.some(line => line.evt === 'job' && line.ok === false), 'the failures were logged');
  const at91 = await ticks(failing, [0, 45, 91]);
  assert.deepEqual(
    alerts(at91).map(({ level, evt, job }) => ({ level, evt, job })),
    [{ level: 'alert', evt: 'job_late', job: 'day-close' }],
  );
  // a day-close that succeeds at every tick for 25 hours is never late
  const fine = await ticks(dayCloseThat(true), Array.from({ length: 51 }, (_, i) => i * 30));
  assert.deepEqual(alerts(fine), []);
  // the failing run's error message (it names an email) is not in its log
  assert.equal(JSON.stringify(at91).includes(EMAIL), false);
});
