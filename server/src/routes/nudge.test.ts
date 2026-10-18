// POST /guilds/nudge and GET /guilds/nudge-templates over HTTP on the real database, the nudge
// reason of GET /guilds/me, and the races of nudge_send as transactions of two pools of app_conn
// (the real role switch) against each other, a leave, a transfer, a join and the weekly apply.
// Logs, settings rows and join dates are arranged through the owner connection; the clock is the
// test clock. 2027-03-10 is a Wednesday, before any daylight-saving change of the zones used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { addDays } from '../../../domain/logicalDate.ts';
import { NUDGE_TEMPLATES } from '../../content/nudgeTemplates.ts';
import { asJob, asUser, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, serverPool, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { settleWeek } from '../jobs/weeklyRollover.ts';

const ICT_NOON = '2027-03-10T05:00:00.000Z'; // 12:00 Asia/Ho_Chi_Minh, 05:00 Europe/London
const TEMPLATE = NUDGE_TEMPLATES[0];

let db: TestDb;
let app: TestApp;
let second: Pool;
let story: { id: string; target_count: number }[];
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  second = serverPool(db);
  story = (
    await db.admin.query(
      "SELECT id, target_count FROM quests WHERE category = 'STORY' AND is_active AND 'SUPPORTER' = ANY (archetypes)",
    )
  ).rows;
  assert.ok(story.length > 0);
});
after(async () => {
  await setTestClock(db.admin, null);
  await second.end();
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;

const clock = (iso: string) => setTestClock(db.admin, iso);

/** A guild: the first user (the leader) made it, the others joined in order; each in its zone. */
async function guildOf(...zones: string[]): Promise<User[]> {
  const users: User[] = [];
  for (const timezone of zones) {
    users.push(await newOnboardedUser(db, { timezone }));
  }
  const made = await app.call('POST', '/guilds', {
    token: users[0].token,
    key: randomUUID(),
    body: { name: `Tổ ${randomUUID().slice(0, 8)}` },
  });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  for (const user of users.slice(1)) {
    const joined = await app.call('POST', '/guilds/join', {
      token: user.token,
      key: randomUUID(),
      body: { inviteCode: made.body.guild.inviteCode },
    });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  return users;
}
const ict = (n: number) => guildOf(...Array.from({ length: n }, () => 'Asia/Ho_Chi_Minh'));

const send = (from: User, to: string, templateCode: unknown = TEMPLATE.code, key: string = randomUUID(), extra = {}) =>
  app.call('POST', '/guilds/nudge', { token: from.token, key, body: { receiverId: to, templateCode, ...extra } });
const outcome = (result: CallResult) => (result.status === 200 ? 'ok' : result.body?.error?.code);
const settled = (result: PromiseSettledResult<unknown>) =>
  result.status === 'fulfilled' ? 'ok' : (result.reason as { message: string }).message;
const sendSql = (to: string) => (c: PoolClient) =>
  c.query('SELECT nudge_send($1, $2, $3) AS r', [to, TEMPLATE.code, randomUUID()]);

const mute = (user: User) => db.admin.query('UPDATE user_settings SET nudges_enabled = false WHERE user_id = $1', [user.userId]);

/** Every STORY quest of `date` done for `user`, as the quest functions leave it. */
async function storyDone(user: User, date: string): Promise<void> {
  const log = (
    await db.admin.query(
      'INSERT INTO daily_logs (user_id, logical_date, story_completed) VALUES ($1, $2, true) RETURNING id',
      [user.userId, date],
    )
  ).rows[0].id;
  for (const quest of story) {
    await db.admin.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
       VALUES ($1, $2, $3, $4, app.now())`,
      [user.userId, log, quest.id, quest.target_count],
    );
  }
}

const eventsOf = async (user: User) =>
  (
    await db.admin.query(
      `SELECT id, sender_id, receiver_id, template_code, sender_date::text, receiver_date::text, sent_at
         FROM nudge_events WHERE sender_id = $1 OR receiver_id = $1 ORDER BY sent_at, id`,
      [user.userId],
    )
  ).rows;
const nudgesOf = async (user: User) =>
  (
    await db.admin.query("SELECT payload, dedupe_key FROM notifications WHERE user_id = $1 AND kind = 'NUDGE' ORDER BY created_at", [
      user.userId,
    ])
  ).rows;

test('happy path: the event is stored, the receiver inbox gains one NUDGE item with the template text, senderRemainingToday 2; a free-text field is read by nobody', async () => {
  await clock(ICT_NOON);
  const [a, b] = await ict(2);
  await db.admin.query("UPDATE users SET display_name = 'An' WHERE id = $1", [a.userId]);
  const key = randomUUID();
  const sent = await send(a, b.userId, TEMPLATE.code, key, { message: 'chữ tự do', text: 'chữ tự do' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.body, { sentAt: ICT_NOON, senderRemainingToday: 2 });
  const events = await eventsOf(b);
  assert.deepEqual(events.map(e => ({ ...e, sent_at: e.sent_at.toISOString() })), [
    {
      id: key,
      sender_id: a.userId,
      receiver_id: b.userId,
      template_code: TEMPLATE.code,
      sender_date: '2027-03-10',
      receiver_date: '2027-03-10',
      sent_at: ICT_NOON,
    },
  ]);
  const inbox = await app.call('GET', '/inbox', { token: b.token });
  assert.equal(inbox.status, 200);
  assert.deepEqual(
    inbox.body.items.map((item: any) => [item.kind, item.payload]),
    [['NUDGE', { senderName: 'An', templateCode: TEMPLATE.code, text: TEMPLATE.text }]],
  );
  assert.deepEqual((await nudgesOf(b)).map(n => n.dedupe_key), [key]);
  assert.equal((await nudgesOf(a)).length, 0);
  const seen = JSON.stringify(await db.admin.query('SELECT * FROM notifications WHERE user_id = $1', [b.userId]));
  assert.ok(!seen.includes('chữ tự do') && !seen.includes(a.userId) && !seen.includes(a.email));
});

test('GET /guilds/nudge-templates lists the seeded templates', async () => {
  const user = await newOnboardedUser(db);
  const got = await app.call('GET', '/guilds/nudge-templates', { token: user.token });
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { templates: [...NUDGE_TEMPLATES].sort((x, y) => (x.code < y.code ? -1 : 1)) });
});

test('refusals, each with its code and status, and none writes a row: other guild, self, no guild, muted, STORY done, the 4th of the sender, a second for the receiver, unknown template', async () => {
  await clock(ICT_NOON);
  const [a, b, c, d, e, f, g] = await ict(7);
  const [outsider] = await ict(1);
  const loner = await newOnboardedUser(db);
  await mute(c);
  await storyDone(d, '2027-03-10');
  const stored = (await db.admin.query('SELECT count(*)::int AS n FROM nudge_events')).rows[0].n;
  const refused: [CallResult, number, string][] = [
    [await send(a, outsider.userId), 403, 'NUDGE_NOT_SAME_GUILD'],
    [await send(a, a.userId), 403, 'NUDGE_NOT_SAME_GUILD'],
    [await send(loner, a.userId), 409, 'NOT_IN_GUILD'],
    [await send(a, c.userId), 409, 'NUDGE_RECEIVER_MUTED'],
    [await send(a, d.userId), 409, 'NUDGE_NOT_NEEDED'],
    [await send(a, b.userId, 'NO_SUCH_TEMPLATE'), 422, 'NUDGE_TEMPLATE_UNKNOWN'],
  ];
  assert.deepEqual(
    refused.map(([r]) => [r.status, outcome(r)]),
    refused.map(([, status, code]) => [status, code]),
  );
  assert.equal((await db.admin.query('SELECT count(*)::int AS n FROM nudge_events')).rows[0].n, stored);
  assert.equal((await nudgesOf(c)).length + (await nudgesOf(d)).length + (await nudgesOf(outsider)).length, 0);
  // the sender's 4th of the day; a second nudge to one receiver from another sender
  assert.deepEqual([outcome(await send(a, b.userId)), outcome(await send(a, e.userId)), outcome(await send(a, f.userId))], ['ok', 'ok', 'ok']);
  const fourth = await send(a, g.userId);
  assert.deepEqual([fourth.status, outcome(fourth)], [409, 'NUDGE_SENDER_LIMIT']);
  const again = await send(g, b.userId);
  assert.deepEqual([again.status, outcome(again)], [409, 'NUDGE_RECEIVER_LIMIT']);
  assert.equal((await eventsOf(g)).length, 0);
  assert.equal((await nudgesOf(b)).length, 1);
});

test("the window is the receiver's [12:00, 20:00): London 11:59 and Tokyo 20:00 refused while it is 18:59 and 18:00 for the sender; London 12:00 and Tokyo 19:59 succeed, and so does London 14:00 while it is 21:00 for the sender", async () => {
  await clock(ICT_NOON); // the sessions are made at the test clock
  const [s, l1, l2, l3, t1, t2] = await guildOf(
    'Asia/Ho_Chi_Minh', 'Europe/London', 'Europe/London', 'Europe/London', 'Asia/Tokyo', 'Asia/Tokyo',
  );
  const probe = async (iso: string, to: User) => {
    await clock(iso);
    return outcome(await send(s, to.userId));
  };
  assert.deepEqual(
    [
      await probe('2027-03-10T11:59:00.000Z', l1), // London 11:59, sender 18:59
      await probe('2027-03-10T11:00:00.000Z', t1), // Tokyo 20:00, sender 18:00
      await probe('2027-03-10T12:00:00.000Z', l2), // London 12:00, sender 19:00
      await probe('2027-03-10T10:59:00.000Z', t2), // Tokyo 19:59, sender 17:59
      await probe('2027-03-10T14:00:00.000Z', l3), // London 14:00, sender 21:00
    ],
    ['NUDGE_OUTSIDE_WINDOW', 'NUDGE_OUTSIDE_WINDOW', 'ok', 'ok', 'ok'],
  );
});

// Each pair: both refusals hold, the earlier one of the order is the answer.
const ORDER: [string, () => Promise<[CallResult, number, string]>][] = [
  [
    'ONBOARDING_REQUIRED (route) before VALIDATION_FAILED',
    async () => {
      const user = await newUser(db);
      return [await send(user as User, 'not-a-uuid', 7), 409, 'ONBOARDING_REQUIRED'];
    },
  ],
  [
    'VALIDATION_FAILED (route) before NUDGE_TEMPLATE_UNKNOWN',
    async () => {
      const [a] = await ict(1);
      return [await send(a, 'not-a-uuid', 'NO_SUCH_TEMPLATE'), 422, 'VALIDATION_FAILED'];
    },
  ],
  [
    'NUDGE_TEMPLATE_UNKNOWN before NOT_IN_GUILD',
    async () => {
      const loner = await newOnboardedUser(db);
      return [await send(loner, randomUUID(), 'NO_SUCH_TEMPLATE'), 422, 'NUDGE_TEMPLATE_UNKNOWN'];
    },
  ],
  [
    'NOT_IN_GUILD before NUDGE_NOT_SAME_GUILD',
    async () => {
      const loner = await newOnboardedUser(db);
      const [other] = await ict(1);
      return [await send(loner, other.userId), 409, 'NOT_IN_GUILD'];
    },
  ],
  [
    'NUDGE_NOT_SAME_GUILD before NUDGE_RECEIVER_MUTED',
    async () => {
      const [a] = await ict(1);
      const [, other] = await ict(2);
      await mute(other);
      return [await send(a, other.userId), 403, 'NUDGE_NOT_SAME_GUILD'];
    },
  ],
  [
    'NUDGE_RECEIVER_MUTED before NUDGE_NOT_NEEDED',
    async () => {
      const [a, b] = await ict(2);
      await mute(b);
      await storyDone(b, '2027-03-10');
      return [await send(a, b.userId), 409, 'NUDGE_RECEIVER_MUTED'];
    },
  ],
  [
    'NUDGE_RECEIVER_MUTED before NUDGE_OUTSIDE_WINDOW (London 05:00)',
    async () => {
      const [a, b] = await guildOf('Asia/Ho_Chi_Minh', 'Europe/London');
      await mute(b);
      return [await send(a, b.userId), 409, 'NUDGE_RECEIVER_MUTED'];
    },
  ],
  [
    'NUDGE_NOT_NEEDED before NUDGE_OUTSIDE_WINDOW',
    async () => {
      const [a, b] = await guildOf('Asia/Ho_Chi_Minh', 'Europe/London');
      await storyDone(b, '2027-03-10');
      return [await send(a, b.userId), 409, 'NUDGE_NOT_NEEDED'];
    },
  ],
  [
    'NUDGE_OUTSIDE_WINDOW before NUDGE_RECEIVER_LIMIT',
    async () => {
      const [a, b, x] = await guildOf('Asia/Ho_Chi_Minh', 'Europe/London', 'Asia/Ho_Chi_Minh');
      await clock('2027-03-10T12:00:00.000Z'); // London 12:00
      assert.equal(outcome(await send(x, b.userId)), 'ok');
      await clock('2027-03-10T20:00:00.000Z'); // London 20:00, the same logical day there
      return [await send(a, b.userId), 409, 'NUDGE_OUTSIDE_WINDOW'];
    },
  ],
  [
    'NUDGE_RECEIVER_LIMIT before NUDGE_SENDER_LIMIT',
    async () => {
      const [a, r1, r2, r3, b, x] = await ict(6);
      for (const r of [r1, r2, r3]) {
        assert.equal(outcome(await send(a, r.userId)), 'ok');
      }
      assert.equal(outcome(await send(x, b.userId)), 'ok');
      return [await send(a, b.userId), 409, 'NUDGE_RECEIVER_LIMIT'];
    },
  ],
];
for (const [name, arrange] of ORDER) {
  test(`order: ${name}`, async () => {
    await clock(ICT_NOON);
    const [result, status, code] = await arrange();
    assert.deepEqual([result.status, outcome(result)], [status, code], JSON.stringify(result.body));
  });
}

test('order in SQL: NUDGE_TEMPLATE_UNKNOWN before ONBOARDING_REQUIRED before NOT_IN_GUILD, for a caller who is not onboarded', async () => {
  await clock(ICT_NOON);
  const user = await newUser(db);
  const call = (template: string) =>
    asUser(db.app, user.userId, c => c.query('SELECT nudge_send($1, $2, $3)', [randomUUID(), template, randomUUID()])).then(
      () => 'ok',
      (e: Error) => e.message,
    );
  assert.deepEqual([await call('NO_SUCH_TEMPLATE'), await call(TEMPLATE.code)], ['NUDGE_TEMPLATE_UNKNOWN', 'ONBOARDING_REQUIRED']);
});

test('race: 5 senders nudge one receiver at once: exactly 1 succeeds, 4 get NUDGE_RECEIVER_LIMIT; one sender nudges 5 receivers at once: exactly 3 succeed', async () => {
  await clock(ICT_NOON);
  {
    const [r, ...senders] = await ict(6);
    const results = await Promise.all(senders.map(s => send(s, r.userId)));
    assert.deepEqual(results.map(outcome).sort(), ['NUDGE_RECEIVER_LIMIT', 'NUDGE_RECEIVER_LIMIT', 'NUDGE_RECEIVER_LIMIT', 'NUDGE_RECEIVER_LIMIT', 'ok']);
    assert.equal((await eventsOf(r)).length, 1);
    assert.equal((await nudgesOf(r)).length, 1);
  }
  {
    const [s, ...receivers] = await ict(6);
    const results = await Promise.all(receivers.map(r => send(s, r.userId)));
    assert.deepEqual(results.map(outcome).sort(), ['NUDGE_SENDER_LIMIT', 'NUDGE_SENDER_LIMIT', 'ok', 'ok', 'ok']);
    assert.deepEqual(results.filter(r => r.status === 200).map(r => r.body.senderRemainingToday).sort(), [0, 1, 2]);
    assert.equal((await eventsOf(s)).length, 3);
  }
});

test('replay with the same idempotency key: the same answer, one event, one notification, the limits counted once', async () => {
  await clock(ICT_NOON);
  const [a, b, c] = await ict(3);
  const key = randomUUID();
  const first = await send(a, b.userId, TEMPLATE.code, key);
  await clock('2027-03-10T05:00:07.000Z');
  const replay = await send(a, b.userId, TEMPLATE.code, key);
  assert.deepEqual([replay.status, replay.body], [first.status, first.body]);
  assert.deepEqual(first.body, { sentAt: ICT_NOON, senderRemainingToday: 2 });
  assert.equal((await eventsOf(b)).length, 1);
  assert.equal((await nudgesOf(b)).length, 1);
  const next = await send(a, c.userId);
  assert.equal(next.body.senderRemainingToday, 1);
});

test("each party's own logical date: a sender in Los Angeles is limited until 03:00 there, then fresh; the next day the receiver is fresh too", async () => {
  await clock(ICT_NOON);
  const [s, r1, r2, r3, r4, x] = await guildOf(
    'America/Los_Angeles', 'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh',
  );
  await clock('2027-03-10T06:00:00.000Z'); // 13:00 for the receivers, 22:00 of the 9th in Los Angeles
  assert.deepEqual(
    [await send(s, r1.userId), await send(s, r2.userId), await send(s, r3.userId)].map(r => r.body.senderRemainingToday),
    [2, 1, 0],
  );
  await clock('2027-03-10T10:30:00.000Z'); // 02:30 in Los Angeles: still the 9th
  assert.equal(outcome(await send(s, r4.userId)), 'NUDGE_SENDER_LIMIT');
  await clock('2027-03-10T11:30:00.000Z'); // 03:30 in Los Angeles: the 10th
  const fresh = await send(s, r4.userId);
  assert.deepEqual([outcome(fresh), fresh.body.senderRemainingToday], ['ok', 2]);
  assert.equal(outcome(await send(x, r1.userId)), 'NUDGE_RECEIVER_LIMIT');
  await clock('2027-03-11T05:00:00.000Z'); // the 11th, 12:00 for the receivers
  assert.equal(outcome(await send(x, r1.userId)), 'ok');
  assert.equal(outcome(await send(s, r2.userId)), 'ok');
  const rows = (rs: string[][]) => rs.map(r => r.join(' ')).sort();
  assert.deepEqual(
    rows((await eventsOf(s)).map(e => [e.receiver_id, e.sender_date, e.receiver_date])),
    rows([
      [r1.userId, '2027-03-09', '2027-03-10'],
      [r2.userId, '2027-03-09', '2027-03-10'],
      [r3.userId, '2027-03-09', '2027-03-10'],
      [r4.userId, '2027-03-10', '2027-03-10'],
      [r2.userId, '2027-03-10', '2027-03-11'],
    ]),
  );
});

test('GET /guilds/me shows for each member the reason nudge_send raises: allowed, muted, STORY done, outside the window, the receiver limit, then the sender limit; the own row is {allowed: false, reason: null}', async () => {
  await clock(ICT_NOON);
  const [s, ok1, muted, done, away, got, x] = await guildOf(
    'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh', 'Europe/London', 'Asia/Ho_Chi_Minh',
    'Asia/Ho_Chi_Minh',
  );
  await mute(muted);
  await storyDone(done, '2027-03-10');
  assert.equal(outcome(await send(x, got.userId)), 'ok');
  const shown = async () => {
    const body = (await app.call('GET', '/guilds/me', { token: s.token })).body;
    return new Map<string, { allowed: boolean; reason: string | null }>(body.guild.members.map((m: any) => [m.userId, m.nudge]));
  };
  const view = await shown();
  assert.deepEqual(
    [s, ok1, muted, done, away, got, x].map(u => view.get(u.userId)),
    [
      { allowed: false, reason: null },
      { allowed: true, reason: null },
      { allowed: false, reason: 'NUDGE_RECEIVER_MUTED' },
      { allowed: false, reason: 'NUDGE_NOT_NEEDED' },
      { allowed: false, reason: 'NUDGE_OUTSIDE_WINDOW' },
      { allowed: false, reason: 'NUDGE_RECEIVER_LIMIT' },
      { allowed: true, reason: null },
    ],
  );
  for (const u of [muted, done, away, got, ok1]) {
    const nudge = view.get(u.userId)!;
    assert.equal(outcome(await send(s, u.userId)), nudge.reason ?? 'ok', u.userId);
  }
  // two more sent today (arranged): x is now refused for the sender limit, shown and raised
  for (const other of [await newOnboardedUser(db), await newOnboardedUser(db)]) {
    await db.admin.query(
      `INSERT INTO nudge_events (id, sender_id, receiver_id, template_code, sender_date, receiver_date)
       VALUES (gen_random_uuid(), $1, $2, $3, '2027-03-10', '2027-03-10')`,
      [s.userId, other.userId, TEMPLATE.code],
    );
  }
  assert.deepEqual((await shown()).get(x.userId), { allowed: false, reason: 'NUDGE_SENDER_LIMIT' });
  assert.equal(outcome(await send(s, x.userId)), 'NUDGE_SENDER_LIMIT');
});

test('rate limit: the 11th POST /guilds/nudge of one account within a minute is 429 RATE_LIMITED', async () => {
  const limited = await startTestApp(db, { rateLimits: true });
  try {
    const user = await newOnboardedUser(db);
    const call = () =>
      limited.call('POST', '/guilds/nudge', {
        token: user.token,
        key: randomUUID(),
        body: { receiverId: randomUUID(), templateCode: TEMPLATE.code },
      });
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await call()).status);
    }
    assert.deepEqual(statuses, Array(10).fill(409)); // NOT_IN_GUILD, counted all the same
    const eleventh = await call();
    assert.deepEqual([eleventh.status, eleventh.body.error.code], [429, 'RATE_LIMITED']);
    assert.ok(Number(eleventh.headers.get('retry-after')) > 0);
  } finally {
    await limited.close();
  }
});

test('guild_overview of 52-nudge.sql answers what that of 50-guild.sql answers, but for the nudge field, for every member of a guild with logs, a frozen day, another zone and a late join', async () => {
  await clock(ICT_NOON);
  const [a, b, c] = await guildOf('Asia/Ho_Chi_Minh', 'America/New_York', 'Asia/Ho_Chi_Minh');
  // b joined Tuesday 05:00 UTC (its Tuesday 00:00, logical Monday); c has a frozen Monday
  await db.admin.query("UPDATE guild_memberships SET joined_at = '2027-03-09T05:00:00Z' WHERE user_id = $1", [b.userId]);
  await storyDone(a, '2027-03-08');
  await storyDone(b, '2027-03-09');
  const half = (await db.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2) RETURNING id', [c.userId, '2027-03-08'])).rows[0].id;
  await db.admin.query(
    'INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at) VALUES ($1, $2, $3, $4, app.now())',
    [c.userId, half, story[0].id, story[0].target_count],
  );
  await db.admin.query(
    "INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date) VALUES ($1, '2027-03-08', app.now(), '2027-03-08')",
    [c.userId],
  );
  await storyDone(c, '2027-03-10');
  await storyDone(b, '2027-03-14'); // the Sunday of the week: the last day the days read
  const sql50 = await readFile(new URL('../../sql/50-guild.sql', import.meta.url), 'utf8');
  const from = sql50.indexOf('CREATE OR REPLACE FUNCTION guild_overview()');
  const body50 = sql50.slice(from, sql50.indexOf('$$;', from) + 3);
  assert.ok(from > 0 && body50.includes("'members'"));
  const owner = await db.admin.connect();
  try {
    await owner.query(body50.replace('FUNCTION guild_overview()', 'FUNCTION pg_temp.overview_50()'));
    for (const viewer of [a, b, c]) {
      await owner.query("SELECT set_config('app.user_id', $1, false)", [viewer.userId]);
      const { rows } = await owner.query('SELECT guild_overview() AS now, pg_temp.overview_50() AS old');
      const { now, old } = rows[0];
      assert.equal(now.guild.members.length, 3);
      for (const member of now.guild.members) {
        assert.ok('nudge' in member);
        delete member.nudge;
      }
      assert.ok(old.guild.members.every((m: object) => !('nudge' in m)));
      assert.deepEqual(now, old);
    }
  } finally {
    owner.release(true);
  }
});

// ---------------------------------------------------------------------------------------------
// Races with the rest of the lock order. Two pools of app_conn; an owner transaction holds a
// lock to force one interleaving.

const waitForLockWaiters = async (n = 1) => {
  for (let i = 0; i < 300; i++) {
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (rows[0].n >= n) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`fewer than ${n} wait for a lock`);
};

/** A transaction that ran `first` and stays open until release() is called. */
function held(run: (work: (x: PoolClient) => Promise<void>) => Promise<void>, first: (x: PoolClient) => Promise<unknown>) {
  let release!: () => void;
  let ready!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const started = new Promise<void>(resolve => (ready = resolve));
  const done = run(async x => {
    await first(x);
    ready();
    await gate;
  });
  return { started, release, done };
}

/** An owner transaction holding the progression_state rows of `users` FOR UPDATE until the returned function is called. */
async function holdProgression(users: User[]) {
  const owner = await db.admin.connect();
  await owner.query('BEGIN');
  await owner.query('SELECT 1 FROM progression_state WHERE user_id = ANY ($1) FOR UPDATE', [users.map(u => u.userId)]);
  return async () => {
    await owner.query('COMMIT');
    owner.release();
  };
}

test('race: A nudges B while B nudges A, both past their users locks and waiting for their progression_state: both succeed, no deadlock; 5 free rounds likewise', async () => {
  await clock(ICT_NOON);
  {
    const [a, b] = await ict(2);
    const release = await holdProgression([a, b]);
    const ab = asUser(db.app, a.userId, sendSql(b.userId));
    const ba = asUser(second, b.userId, sendSql(a.userId));
    await waitForLockWaiters(2);
    await release();
    assert.deepEqual((await Promise.allSettled([ab, ba])).map(settled), ['ok', 'ok']);
    assert.equal((await nudgesOf(a)).length + (await nudgesOf(b)).length, 2);
  }
  for (let round = 0; round < 5; round++) {
    const [a, b] = await ict(2);
    const results = await Promise.allSettled([
      asUser(round % 2 === 0 ? db.app : second, a.userId, sendSql(b.userId)),
      asUser(round % 2 === 0 ? second : db.app, b.userId, sendSql(a.userId)),
    ]);
    assert.deepEqual(results.map(settled), ['ok', 'ok'], `round ${round}`);
  }
});

test('race: the receiver leaves while the nudge waits: NUDGE_NOT_SAME_GUILD, nothing written; the nudge first: the leave waits and succeeds, the nudge stays', async () => {
  await clock(ICT_NOON);
  {
    const [, a, b] = await ict(3);
    const leave = held(work => asUser(second, b.userId, work), c => c.query('SELECT guild_leave()'));
    await leave.started;
    const nudging = asUser(db.app, a.userId, sendSql(b.userId)).then(() => 'ok', (e: Error) => e.message);
    await waitForLockWaiters();
    leave.release();
    await leave.done;
    assert.equal(await nudging, 'NUDGE_NOT_SAME_GUILD');
    assert.deepEqual([(await eventsOf(b)).length, (await nudgesOf(b)).length], [0, 0]);
  }
  {
    const [, a, b] = await ict(3);
    const nudge = held(work => asUser(db.app, a.userId, work), sendSql(b.userId));
    await nudge.started;
    const leaving = asUser(second, b.userId, c => c.query('SELECT guild_leave()'));
    await waitForLockWaiters();
    nudge.release();
    await Promise.all([nudge.done, leaving]);
    assert.deepEqual([(await eventsOf(b)).length, (await nudgesOf(b)).length], [1, 1]);
  }
});

test('race: the receiver hands over leadership while the nudge waits: both succeed', async () => {
  await clock(ICT_NOON);
  const [b, a, c] = await ict(3);
  const transfer = held(work => asUser(second, b.userId, work), x => x.query('SELECT guild_transfer($1)', [c.userId]));
  await transfer.started;
  const nudging = asUser(db.app, a.userId, sendSql(b.userId)).then(() => 'ok', (e: Error) => e.message);
  await waitForLockWaiters();
  transfer.release();
  await transfer.done;
  assert.equal(await nudging, 'ok');
  const roles = (await db.admin.query('SELECT user_id, role FROM guild_memberships WHERE user_id = ANY ($1)', [[b.userId, c.userId]])).rows;
  assert.deepEqual(new Map(roles.map(r => [r.user_id, r.role])), new Map([[b.userId, 'MEMBER'], [c.userId, 'LEADER']]));
});

test('race: the receiver joins the sender guild after the nudge locked the users rows: NUDGE_NOT_SAME_GUILD (the receiver row was not locked), nothing written', async () => {
  await clock(ICT_NOON);
  const [a] = await ict(1);
  const c = await newOnboardedUser(db);
  const code = (await db.admin.query('SELECT g.invite_code FROM guilds g JOIN guild_memberships m ON m.guild_id = g.id WHERE m.user_id = $1', [a.userId])).rows[0].invite_code;
  const release = await holdProgression([a]);
  const nudging = asUser(db.app, a.userId, sendSql(c.userId)).then(() => 'ok', (e: Error) => e.message);
  await waitForLockWaiters();
  await asUser(second, c.userId, x => x.query('SELECT guild_join($1)', [code]));
  await release();
  assert.equal(await nudging, 'NUDGE_NOT_SAME_GUILD');
  assert.deepEqual([(await eventsOf(c)).length, (await nudgesOf(c)).length], [0, 0]);
});

let raceWeek = 0;
/** A guild of three active members in a week of its own (2029: no test clock gets there), ranked when settled. */
async function rankedGuild() {
  const ws = addDays('2029-01-01', 7 * raceWeek++);
  const users = await ict(3);
  for (const user of users) {
    await storyDone(user, ws);
  }
  return { ws, users };
}
const paid = async (ws: string) =>
  (await db.admin.query("SELECT user_id FROM coin_ledger WHERE reason = 'GUILD_WEEKLY' AND ref_id = $1 ORDER BY user_id", [ws])).rows.map(
    r => r.user_id,
  );

test('race: a nudge while the weekly apply runs, either first, and the apply waiting on a nudge that holds both users rows: never a deadlock, all paid, the nudge sent', async () => {
  await clock(ICT_NOON);
  // the apply holds the users rows; the nudge waits
  {
    const { ws, users } = await rankedGuild();
    const [x, y] = users;
    const settle = held(work => asJob(db.app, work), c => settleWeek(c, ws));
    await settle.started;
    const nudging = asUser(second, x.userId, sendSql(y.userId)).then(() => 'ok', (e: Error) => e.message);
    await waitForLockWaiters();
    settle.release();
    await settle.done;
    assert.equal(await nudging, 'ok');
    assert.deepEqual(await paid(ws), users.map(u => u.userId).sort());
  }
  // the nudge holds them; the apply waits
  {
    const { ws, users } = await rankedGuild();
    const [x, y] = users;
    const nudge = held(work => asUser(second, x.userId, work), sendSql(y.userId));
    await nudge.started;
    const settling = asJob(db.app, c => settleWeek(c, ws));
    await waitForLockWaiters();
    nudge.release();
    await nudge.done;
    assert.equal((await settling).applied, true);
    assert.deepEqual(await paid(ws), users.map(u => u.userId).sort());
  }
  // the sender has the larger id: the nudge holds both users rows and waits for its
  // progression_state, the apply waits for the receiver's users row
  {
    const { ws, users } = await rankedGuild();
    const [receiver, , sender] = [...users].sort((p, q) => (p.userId < q.userId ? -1 : 1));
    const release = await holdProgression([sender]);
    const nudging = asUser(second, sender.userId, sendSql(receiver.userId)).then(() => 'ok', (e: Error) => e.message);
    await waitForLockWaiters();
    const settling = asJob(db.app, c => settleWeek(c, ws)).then(r => r.applied, (e: Error) => e.message);
    await waitForLockWaiters(2);
    await release();
    assert.deepEqual([await nudging, await settling], ['ok', true]);
    assert.deepEqual(await paid(ws), users.map(u => u.userId).sort());
  }
});
