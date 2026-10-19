// GET /me/export and POST /me/delete over HTTP on the real database; the jobs run after a
// deletion; the guild a deleted leader leaves (AR-30); nudges to and from a deleted user.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { asJob, setTestClock } from '../../test/helpers.ts';
import { ONBOARDING_INPUT, newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';
import { userDataTables } from '../../checks/attacks/base.ts';
import { loadJobs, runJob } from '../jobs/scheduler.ts';
import { createLogger } from '../log.ts';

const NOON = '2027-03-10T05:00:00.000Z'; // Wednesday 12:00 in Asia/Ho_Chi_Minh
const PASSWORD = 'mật khẩu đủ dài 1';
const quiet = createLogger(() => {});

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  await setTestClock(db.admin, NOON);
});
after(async () => {
  await setTestClock(db.admin, null);
  await app.close();
  await db.drop();
});

type Account = { userId: string; token: string; email: string };

function ok(result: CallResult, status = 200): any {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
const post = (who: { token: string }, path: string, body?: unknown, key: string = randomUUID()) =>
  app.call('POST', path, { token: who.token, key, body });

/** Registered over HTTP with PASSWORD (a real key), onboarded over HTTP. */
async function account(): Promise<Account> {
  const email = `p${randomUUID().slice(0, 12)}@example.com`;
  const made = ok(
    await app.call('POST', '/auth/register', {
      body: { email, password: PASSWORD, displayName: 'Người xóa', acceptedTerms: true },
    }),
    201,
  );
  ok(await post(made, '/onboarding', ONBOARDING_INPUT));
  return { userId: made.userId, token: made.token, email };
}
const remove = (who: Account, password = PASSWORD, key?: string) => post(who, '/me/delete', { password }, key);

/** Every row that leads to the user, by table, as the owner reads them (the catalog's list). */
async function rowsOf(userId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const { name, ofUser } of await userDataTables(db.admin)) {
    const { rows } = await db.admin.query(
      `SELECT to_jsonb(t) AS r FROM public.${name} t WHERE ${ofUser} ORDER BY to_jsonb(t)::text`,
      [userId],
    );
    out[name] = rows.map(row => row.r);
  }
  return out;
}

const guildOf = async (leader: Account, ...members: Account[]) => {
  const made = ok(await post(leader, '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` }));
  for (const member of members) {
    ok(await post(member, '/guilds/join', { inviteCode: made.guild.inviteCode }));
  }
  return made.guild.id as string;
};

// ---------------------------------------------------------------------------------------------
// Export

test('export: a key with rows for every own_* table of the registry, the journal text, nudges without the other party; no credential, session or other user', async () => {
  const me = await newOnboardedUser(db);
  const mate = await newOnboardedUser(db);
  const mateName = `Đồng đội ${randomUUID().slice(0, 6)}`;
  await db.admin.query('UPDATE users SET display_name = $2 WHERE id = $1', [mate.userId, mateName]);
  const guildName = `Tổ ${randomUUID().slice(0, 8)}`;
  const made = ok(await post(me, '/guilds', { name: guildName }));
  ok(await post(mate, '/guilds/join', { inviteCode: made.guild.inviteCode }));

  ok(await post(me, '/day/quests/WATER_8/progress', {}));
  const plan = ok(await app.call('GET', '/nutrition/plan', { token: me.token }));
  const slot = plan.slots.find((s: { meal: unknown }) => s.meal !== null).mealSlot;
  ok(await post(me, '/nutrition/log', { mealSlot: slot }));
  const item = (await db.admin.query('SELECT id, duration_sec FROM exercise_items ORDER BY code LIMIT 1')).rows[0];
  ok(await post(me, '/workout/complete', { exerciseItemId: item.id, elapsedSec: item.duration_sec }));
  const journalText = `Hôm nay mình đã cố gắng ${randomUUID()}`;
  ok(await post(me, '/journal', { body: journalText }));
  ok(await post(mate, '/guilds/nudge', { receiverId: me.userId, templateCode: 'MOVE_TOGETHER' }));
  ok(await post(me, '/guilds/nudge', { receiverId: mate.userId, templateCode: 'MOVE_TOGETHER' }));
  // inventory and a perk: arranged by the owner (a purchase needs coins and levels)
  await db.admin.query(
    `INSERT INTO inventory (user_id, shop_item_id, kind)
       SELECT $1, s.id, s.kind FROM shop_items s WHERE s.code = 'THEME_FOREST'`,
    [me.userId],
  );
  await db.admin.query(
    `INSERT INTO perk_unlocks (user_id, perk_code, shop_item_id, cost)
       SELECT $1, 'THEME_UNLOCK', s.id, 1 FROM shop_items s WHERE s.code = 'THEME_FOREST'`,
    [me.userId],
  );

  const res = await app.call('GET', '/me/export', { token: me.token });
  const doc = ok(res);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(doc.formatVersion, 1);
  assert.equal(doc.exportedAt, NOON);

  const { rows: own } = await db.admin.query<{ name: string }>(
    "SELECT name FROM meta.expected_tables WHERE class IN ('own_read', 'own_rw') ORDER BY name",
  );
  assert.ok(own.length > 0);
  for (const { name } of own) {
    if (name === 'idempotency_keys') {
      continue;
    }
    assert.ok(Array.isArray(doc.data[name]), `no key ${name}`);
    assert.ok(doc.data[name].length > 0, `no row in ${name}: the test arranged nothing there`);
    for (const row of doc.data[name]) {
      assert.equal(row.user_id ?? row.id, me.userId, `${name}: a row of another user`);
    }
  }
  assert.equal(doc.data.idempotency_keys, undefined);
  assert.deepEqual(doc.data.journal_entries.map((e: { text: string }) => e.text), [journalText]);
  assert.equal(doc.data.inventory[0].itemCode, 'THEME_FOREST');
  assert.equal(doc.data.guild_memberships[0].guildName, guildName);
  assert.deepEqual(
    // one frozen instant: the two are ordered by id, so sorted here
    doc.data.nudge_events.map((n: Record<string, unknown>) => [n.direction, n.templateCode, Object.keys(n).sort()]).sort(),
    [
      ['RECEIVED', 'MOVE_TOGETHER', ['direction', 'sentAt', 'templateCode']],
      ['SENT', 'MOVE_TOGETHER', ['direction', 'sentAt', 'templateCode']],
    ],
  );
  const text = JSON.stringify(doc);
  assert.ok(text.includes('MOVE_TOGETHER'));
  for (const secret of [mateName, mate.userId, me.token, 'body_encrypted', 'token_hash', 'code_hash', 'request_hash', '"salt"', '"key"']) {
    assert.ok(!text.includes(secret), `the export holds ${secret}`);
  }
  // not logged: one line for the request, without a value of it
  assert.ok(!app.logText().includes(journalText));
});

test('export: the sixth within an hour is 429 RATE_LIMITED', async () => {
  const limited = await startTestApp(db, { rateLimits: true });
  try {
    const me = await newOnboardedUser(db);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await limited.call('GET', '/me/export', { token: me.token })).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  } finally {
    await limited.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Delete

test('delete: a wrong password is 401 INVALID_CREDENTIALS, nothing changes but the attempt, which a login sees', async () => {
  const me = await account();
  const untouched = await rowsOf(me.userId);
  const res = await remove(me, 'sai mật khẩu');
  assert.deepEqual([res.status, res.body.error.code], [401, 'INVALID_CREDENTIALS']);
  const now = await rowsOf(me.userId);
  // the key is given back on a refusal; nothing else moved
  assert.deepEqual(now, untouched);
  const { rows } = await db.admin.query('SELECT count FROM auth_throttle WHERE key = $1', [`login:${me.email}`]);
  assert.deepEqual(rows, [{ count: 1 }]);
  ok(await app.call('GET', '/me', { token: me.token }));
  // an empty password never reaches the database
  const empty = await remove(me, '');
  assert.deepEqual([empty.status, empty.body.error.details], [422, { fields: [{ field: 'password', rule: 'required' }] }]);
});

test('delete: the sixth attempt of 15 minutes fails even with the right password, as a login would', async () => {
  const me = await account();
  for (let i = 0; i < 5; i++) {
    assert.equal((await remove(me, 'sai')).status, 401);
  }
  assert.equal((await remove(me)).status, 401);
  const { rows } = await db.admin.query('SELECT deleted_at FROM users WHERE id = $1', [me.userId]);
  assert.deepEqual(rows, [{ deleted_at: null }]);
  const login = await app.call('POST', '/auth/login', { body: { email: me.email, password: PASSWORD } });
  assert.equal(login.status, 401);
});

test('delete: the password is NFC-normalised as at registration', async () => {
  const email = `n${randomUUID().slice(0, 12)}@example.com`;
  const composed = 'mật khẩu tiếng Việt';
  const made = ok(
    await app.call('POST', '/auth/register', {
      body: { email, password: composed, displayName: 'NFC', acceptedTerms: true },
    }),
    201,
  );
  const decomposed = composed.normalize('NFD');
  assert.notEqual(decomposed, composed);
  assert.equal((await post(made, '/me/delete', { password: decomposed })).status, 204);
});

test('delete: 204, then login fails uniformly, the token is dead, the email stays taken, teammates no longer see the user', async () => {
  const me = await account();
  const mate = await account();
  await guildOf(mate, me);
  const unknownLogin = await app.call('POST', '/auth/login', {
    body: { email: `nobody-${randomUUID()}@example.com`, password: PASSWORD },
  });

  const res = await remove(me);
  assert.equal(res.status, 204);
  const { rows } = await db.admin.query(
    `SELECT deleted_at = $2::timestamptz AS at_now, purge_after = deleted_at + interval '30 days' AS thirty,
            (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS live
       FROM users u WHERE u.id = $1`,
    [me.userId, NOON],
  );
  assert.deepEqual(rows, [{ at_now: true, thirty: true, live: 0 }]);

  const login = await app.call('POST', '/auth/login', { body: { email: me.email, password: PASSWORD } });
  assert.deepEqual([login.status, login.body], [unknownLogin.status, unknownLogin.body]);
  const old = await app.call('GET', '/me', { token: me.token });
  assert.deepEqual([old.status, old.body.error.code], [401, 'SESSION_INVALID']);
  const again = await app.call('POST', '/auth/register', {
    body: { email: me.email, password: PASSWORD, displayName: 'Lại', acceptedTerms: true },
  });
  assert.deepEqual([again.status, again.body.error.code], [409, 'REGISTRATION_UNAVAILABLE']);
  const guild = ok(await app.call('GET', '/guilds/me', { token: mate.token }));
  assert.deepEqual(guild.guild.members.map((m: { userId: string }) => m.userId), [mate.userId]);
});

test('delete: the nudges of the sender leave the inboxes of the receivers at once (its display name does not outlive the deletion); a nudge another member sent stays', async () => {
  const me = await account();
  const mate = await account();
  const other = await account();
  await guildOf(mate, me, other);
  ok(await post(me, '/guilds/nudge', { receiverId: mate.userId, templateCode: 'MOVE_TOGETHER' }));
  ok(await post(mate, '/guilds/nudge', { receiverId: other.userId, templateCode: 'MOVE_TOGETHER' }));
  const nudges = async (who: Account) =>
    ok(await app.call('GET', '/inbox', { token: who.token })).items.filter((i: { kind: string }) => i.kind === 'NUDGE').length;
  assert.deepEqual([await nudges(mate), await nudges(other)], [1, 1]);
  assert.equal((await remove(me)).status, 204);
  assert.deepEqual([await nudges(mate), await nudges(other)], [0, 1]);
  const { rows } = await db.admin.query(
    `SELECT count(*)::int AS n FROM notifications n JOIN nudge_events e ON n.dedupe_key = e.id::text
      WHERE n.kind = 'NUDGE' AND e.sender_id = $1`,
    [me.userId],
  );
  assert.equal(rows[0].n, 0);
});

test('delete: a session whose account is deleted between the session check and the salt (a concurrent delete) is 401 SESSION_INVALID, not 500', async () => {
  const me = await account();
  const route = (await import('./privacy.ts')).default.find(r => r.path === '/me/delete');
  assert.ok(route?.prepare);
  await db.admin.query('UPDATE users SET deleted_at = $2 WHERE id = $1', [me.userId, NOON]);
  await assert.rejects(
    route.prepare({ body: { password: PASSWORD }, pool: db.app, userId: me.userId } as never),
    (e: { code?: string }) => e.code === 'SESSION_INVALID',
  );
});

test('delete of a leader: with two other members the earliest-joined becomes LEADER; alone, the guild disappears', async () => {
  const leader = await account();
  const first = await account();
  const second = await account();
  const guild = await guildOf(leader, first, second);
  // joined in order, but the earliest join wins, not the order of the ids
  await db.admin.query("UPDATE guild_memberships SET joined_at = joined_at - interval '1 day' WHERE user_id = $1", [second.userId]);
  assert.equal((await remove(leader)).status, 204);
  const { rows } = await db.admin.query(
    'SELECT user_id, role FROM guild_memberships WHERE guild_id = $1 ORDER BY role, user_id',
    [guild],
  );
  assert.deepEqual(rows, [
    { user_id: second.userId, role: 'LEADER' },
    { user_id: first.userId, role: 'MEMBER' },
  ]);

  const alone = await account();
  const lonely = await guildOf(alone);
  assert.equal((await remove(alone)).status, 204);
  const gone = await db.admin.query('SELECT 1 FROM guilds WHERE id = $1', [lonely]);
  assert.equal(gone.rowCount, 0);
});

test('nudges: a receiver or sender with deleted_at set, still listed in the guild, is in no guild', async () => {
  const sender = await newOnboardedUser(db);
  const receiver = await newOnboardedUser(db);
  const made = ok(await post(sender, '/guilds', { name: `Tổ ${randomUUID().slice(0, 8)}` }));
  ok(await post(receiver, '/guilds/join', { inviteCode: made.guild.inviteCode }));
  // a deletion by some other path than account_delete: the membership is still there
  await db.admin.query('UPDATE users SET deleted_at = now() WHERE id = $1', [receiver.userId]);
  const res = await post(sender, '/guilds/nudge', { receiverId: receiver.userId, templateCode: 'MOVE_TOGETHER' });
  assert.deepEqual([res.status, res.body.error.code], [403, 'NUDGE_NOT_SAME_GUILD']);
  const { rows } = await db.admin.query(
    `SELECT app._nudge_block_reason($1, $2) AS sender_live,
            app._nudge_block_reason($2, $1) AS sender_deleted`,
    [sender.userId, receiver.userId],
  );
  assert.deepEqual([rows[0].sender_live, rows[0].sender_deleted], ['NUDGE_NOT_SAME_GUILD', 'NOT_IN_GUILD']);
  const events = await db.admin.query('SELECT 1 FROM nudge_events WHERE receiver_id = $1', [receiver.userId]);
  assert.equal(events.rowCount, 0);
});

test('after delete no job processes the account: every row of it is unchanged, while a twin arranged alike is processed', async () => {
  const MONDAY = '2027-03-15T05:00:00.000Z'; // a week whose jobs nothing else in this file touches
  await setTestClock(db.admin, MONDAY);
  try {
    const gone = await account();
    const twin = await account();
    // one ranked guild (four active members) holds both: the leaderboard input has a reason to name gone
    const [third, fourth] = [await account(), await account()];
    await guildOf(twin, gone, third, fourth);
    for (const who of [gone, twin, third, fourth]) {
      ok(await post(who, '/day/quests/WATER_8/progress', {}));
      ok(await post(who, '/journal', { body: 'một dòng' }));
      await db.admin.query(
        "UPDATE user_settings SET reminder_enabled = true, reminder_window = 'EVENING' WHERE user_id = $1",
        [who.userId],
      );
    }
    assert.equal((await remove(gone)).status, 204);
    // a weekly ticket left undecided for both: what ticket-grant would decide
    await db.admin.query('DELETE FROM freeze_tickets WHERE user_id = ANY($1)', [[gone.userId, twin.userId]]);
    await db.admin.query('DELETE FROM ticket_grant_weeks WHERE user_id = ANY($1)', [[gone.userId, twin.userId]]);

    const goneBefore = await rowsOf(gone.userId);
    const twinBefore = await rowsOf(twin.userId);
    // Tuesday 18:30 ICT: Monday is over (day-close), the evening window is open (reminders)
    const now = new Date('2027-03-16T11:30:00.000Z');
    await setTestClock(db.admin, now.toISOString());
    const names = (await loadJobs()).map(job => job.name).filter(name => name !== 'housekeeping');
    assert.ok(names.includes('day-close') && names.includes('reminder-dispatch') && names.includes('ticket-grant'));
    for (const name of names) {
      await runJob(name, db.app, now, quiet);
    }
    assert.deepEqual(await rowsOf(gone.userId), goneBefore);
    const twinAfter = await rowsOf(twin.userId);
    const changed = Object.keys(twinAfter).filter(t => JSON.stringify(twinAfter[t]) !== JSON.stringify(twinBefore[t]));
    for (const table of ['notifications', 'progression_state', 'ticket_grant_weeks']) {
      assert.ok(changed.includes(table), `the jobs did nothing to the twin's ${table}: the comparison proves nothing`);
    }
    // and the leaderboard input never names it
    const inputs = await asJob(db.app, c =>
      c.query('SELECT job_guild_week_inputs($1, $2) AS x', ['2027-03-15', '2027-03-21']),
    );
    assert.ok(JSON.stringify(inputs.rows).includes(twin.userId), 'the input names nobody of the guild: the check proves nothing');
    assert.ok(!JSON.stringify(inputs.rows).includes(gone.userId));
  } finally {
    await setTestClock(db.admin, NOON);
  }
});
