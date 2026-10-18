// POST /guilds, POST /guilds/join, GET /guilds/me, POST /guilds/me/leave, POST /guilds/me/transfer
// over HTTP on the real database, and the races of the guild_* functions as transactions of two
// pools of app_conn (the real role switch). Week numbers are compared with the domain functions
// run on the same inputs; logs, tickets and join dates are arranged through the owner connection.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { GUILD_INACTIVE_DAYS, GUILD_MAX_MEMBERS, memberWeek, scoreGuildWeek } from '../../../domain/guild.ts';
import type { MemberWeek } from '../../../domain/guild.ts';
import { BANNED_TERMS } from '../../../domain/language.ts';
import { addDays, daysBetween, localParts, logicalDateOf, weekStartOf } from '../../../domain/logicalDate.ts';
import { asUser, setTestClock } from '../../test/helpers.ts';
import { newOnboardedUser, newUser, serverPool, startTestApp } from '../../test/http.ts';
import type { CallResult, TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

const NOON = '2027-03-10T05:00:00.000Z'; // 12:00 in Asia/Ho_Chi_Minh
const ICT = 'Asia/Ho_Chi_Minh';
const ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

let db: TestDb;
let app: TestApp;
let second: Pool;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
  second = serverPool(db);
  await setTestClock(db.admin, NOON);
});
after(async () => {
  await setTestClock(db.admin, null);
  await second.end();
  await app.close();
  await db.drop();
});

type User = Awaited<ReturnType<typeof newOnboardedUser>>;

function ok(result: CallResult, status = 200): any {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
function refusal(result: CallResult, status: number, code: string, details?: unknown) {
  assert.deepEqual([result.status, result.body?.error?.code], [status, code], JSON.stringify(result.body));
  assert.deepEqual(result.body.error.details, details);
}
const post = (user: User, path: string, body?: unknown, key: string = randomUUID()) =>
  app.call('POST', path, { token: user.token, key, body });
const create = (user: User, name: string, motto?: string) => post(user, '/guilds', { name, motto });
const join = (user: User, inviteCode: string) => post(user, '/guilds/join', { inviteCode });
const leave = (user: User, key: string = randomUUID()) => post(user, '/guilds/me/leave', undefined, key);
const transfer = (user: User, userId: unknown) => post(user, '/guilds/me/transfer', { userId });
const mine = async (user: User) => ok(await app.call('GET', '/guilds/me', { token: user.token }));

const freshName = () => `Tổ ${randomUUID().slice(0, 8)}`;

/** A guild of `size` members: the leader made it, the others joined in order. */
async function guildOf(size: number) {
  const leader = await newOnboardedUser(db);
  const made = ok(await create(leader, freshName()));
  const members: User[] = [];
  for (let i = 1; i < size; i++) {
    const member = await newOnboardedUser(db);
    ok(await join(member, made.guild.inviteCode));
    members.push(member);
  }
  return { leader, members, id: made.guild.id as string, code: made.guild.inviteCode as string, name: made.guild.name };
}

/** The guild rows as the owner reads them: null when the guild is gone. */
async function stored(guildId: string) {
  const { rows } = await db.admin.query(
    `SELECT g.name, ARRAY(SELECT m.user_id || ':' || m.role FROM guild_memberships m
                           WHERE m.guild_id = g.id ORDER BY m.user_id) AS members
       FROM guilds g WHERE g.id = $1`,
    [guildId],
  );
  return rows[0] ?? null;
}
const leaders = async (guildId: string) =>
  Number(
    (await db.admin.query("SELECT count(*) FROM guild_memberships WHERE guild_id = $1 AND role = 'LEADER'", [guildId]))
      .rows[0].count,
  );

/** Runs the calls at once, each a transaction of its own as its user, alternating between the two pools. */
function race(calls: [User, string, unknown[]][]) {
  return Promise.allSettled(
    calls.map(([user, sql, values], i) =>
      asUser(i % 2 === 0 ? db.app : second, user.userId, c => c.query(sql, values)),
    ),
  );
}
const outcome = (result: PromiseSettledResult<unknown>) =>
  result.status === 'fulfilled' ? 'ok' : (result.reason as { message: string }).message;

const ictToday = async () => {
  const { rows } = await db.admin.query<{ now: Date }>('SELECT app.now() AS now');
  return localParts(rows[0].now.getTime(), ICT).date;
};

test('create: the caller is the one LEADER, the code is AR-18, the name and motto trimmed; GET /guilds/me answers the same', async () => {
  const user = await newOnboardedUser(db);
  const name = freshName();
  const body = ok(await create(user, `  ${name} `, '  Cùng nhau khỏe  '));
  const today = await ictToday();
  const joined = { userId: user.userId, joinedDate: today, days: [] };
  assert.match(body.guild.inviteCode, ALPHABET);
  assert.deepEqual(body, {
    guild: {
      id: body.guild.id,
      name,
      motto: 'Cùng nhau khỏe',
      inviteCode: body.guild.inviteCode,
      myRole: 'LEADER',
      weekCompletion: 0,
      inactive: false,
      inactiveDays: 0,
      members: [
        {
          userId: user.userId,
          displayName: 'Người thử',
          level: 1,
          role: 'LEADER',
          isMe: true,
          daysCompletedThisWeek: 0,
          daysCountedThisWeek: memberWeek(joined, weekStartOf(today), today).countedDays,
          storyDoneToday: false,
          nudge: { allowed: false, reason: null },
        },
      ],
    },
  });
  assert.deepEqual(await mine(user), body);
  // without a motto it is the empty string
  const other = ok(await create(await newOnboardedUser(db), freshName()));
  assert.equal(other.guild.motto, '');
  assert.notEqual(other.guild.inviteCode, body.guild.inviteCode);
});

test('create refusals: ALREADY_IN_GUILD, GUILD_NAME_TAKEN in another case, the field rules, NAME_NOT_ALLOWED; nothing is written', async () => {
  const { leader, name } = await guildOf(1);
  const count = async () => Number((await db.admin.query('SELECT count(*) FROM guilds')).rows[0].count);
  const initial = await count();
  refusal(await create(leader, freshName()), 409, 'ALREADY_IN_GUILD');
  const user = await newOnboardedUser(db);
  refusal(await create(user, name.toUpperCase()), 409, 'GUILD_NAME_TAKEN');
  refusal(await create(user, ` ${name.toLowerCase()}  `), 409, 'GUILD_NAME_TAKEN');
  const field = (f: string, rule: string) => ({ fields: [{ field: f, rule }] });
  refusal(await create(user, 'ab'), 422, 'VALIDATION_FAILED', field('name', 'min'));
  refusal(await create(user, '  ab   '), 422, 'VALIDATION_FAILED', field('name', 'min'));
  refusal(await create(user, 'a'.repeat(31)), 422, 'VALIDATION_FAILED', field('name', 'max'));
  refusal(await create(user, '!!!'), 422, 'VALIDATION_FAILED', field('name', 'format'));
  refusal(await post(user, '/guilds', {}), 422, 'VALIDATION_FAILED', field('name', 'required'));
  refusal(await post(user, '/guilds', { name: 7 }), 422, 'VALIDATION_FAILED', field('name', 'format'));
  refusal(await post(user, '/guilds'), 422, 'VALIDATION_FAILED', field('body', 'required'));
  refusal(await create(user, freshName(), 'x'.repeat(81)), 422, 'VALIDATION_FAILED', field('motto', 'max'));
  refusal(await post(user, '/guilds', { name: freshName(), motto: 5 }), 422, 'VALIDATION_FAILED', field('motto', 'format'));
  refusal(await create(user, `Tổ ${BANNED_TERMS[0]}`), 422, 'NAME_NOT_ALLOWED');
  refusal(await create(user, freshName(), `Không ${BANNED_TERMS[1]}`), 422, 'NAME_NOT_ALLOWED');
  // 30 characters once trimmed is fine
  ok(await create(user, ` ${'b'.repeat(29)}C `));
  assert.equal(await count(), initial + 1);
});

test('create refusal order: the body before the guild, ALREADY_IN_GUILD before GUILD_NAME_TAKEN', async () => {
  const { leader, name } = await guildOf(1);
  refusal(await create(leader, name), 409, 'ALREADY_IN_GUILD');
  refusal(await create(leader, 'ab'), 422, 'VALIDATION_FAILED', { fields: [{ field: 'name', rule: 'min' }] });
  refusal(await create(leader, `Tổ ${BANNED_TERMS[0]}`), 422, 'NAME_NOT_ALLOWED');
});

test('create: a body that breaks a field rule AND holds a banned term is VALIDATION_FAILED, not NAME_NOT_ALLOWED', async () => {
  const user = await newOnboardedUser(db);
  refusal(await create(user, `Tổ ${BANNED_TERMS[0]}`, 'x'.repeat(81)), 422, 'VALIDATION_FAILED', {
    fields: [{ field: 'motto', rule: 'max' }],
  });
});

test('names are NFC: the decomposed spelling of a taken name is GUILD_NAME_TAKEN, over HTTP and at guild_create itself; what is stored is NFC', async () => {
  const name = `Tổ Rồng ${randomUUID().slice(0, 6)}`.normalize('NFC');
  const decomposed = name.normalize('NFD');
  assert.notEqual(decomposed, name);
  ok(await create(await newOnboardedUser(db), name));
  const user = await newOnboardedUser(db);
  refusal(await create(user, decomposed), 409, 'GUILD_NAME_TAKEN');
  const direct = await asUser(db.app, user.userId, c => c.query('SELECT guild_create($1, $2)', [decomposed, '']))
    .then(() => 'ok', (e: Error) => e.message);
  assert.equal(direct, 'GUILD_NAME_TAKEN');
  // a fresh decomposed name and motto are stored composed
  const other = `Tổ Rồng ${randomUUID().slice(0, 6)}`;
  const { rows } = await asUser(db.app, user.userId, c =>
    c.query('SELECT guild_create($1, $2) AS id', [other.normalize('NFD'), 'Mỗi ngày'.normalize('NFD')]),
  );
  const saved = (await db.admin.query('SELECT name, motto FROM guilds WHERE id = $1', [rows[0].id])).rows[0];
  assert.deepEqual([saved.name, saved.motto], [other.normalize('NFC'), 'Mỗi ngày'.normalize('NFC')]);
});

test('a caller who is not onboarded gets 409 ONBOARDING_REQUIRED from every guild route, and from every guild_* write called directly', async () => {
  const user = await newUser(db);
  const { code, leader } = await guildOf(1);
  const calls: [string, string, unknown][] = [
    ['POST', '/guilds', { name: freshName() }],
    ['POST', '/guilds/join', { inviteCode: code }],
    ['GET', '/guilds/me', undefined],
    ['POST', '/guilds/me/leave', undefined],
    ['POST', '/guilds/me/transfer', { userId: leader.userId }],
  ];
  for (const [method, path, body] of calls) {
    const key = method === 'POST' ? randomUUID() : undefined;
    refusal(await app.call(method, path, { token: user.token, key, body }), 409, 'ONBOARDING_REQUIRED');
  }
  // the second fence: app._lock_member, before INVITE_CODE_INVALID and NOT_IN_GUILD
  for (const [sql, values] of [
    ['SELECT guild_create($1, $2)', [freshName(), '']],
    ['SELECT guild_join($1)', [code]],
    ['SELECT guild_join($1)', ['ZZZZZZZZ']],
    ['SELECT guild_leave()', []],
    ['SELECT guild_transfer($1)', [leader.userId]],
  ] as [string, unknown[]][]) {
    const got = await asUser(db.app, user.userId, c => c.query(sql, values)).then(() => 'ok', (e: Error) => e.message);
    assert.equal(got, 'ONBOARDING_REQUIRED', `${sql} ${JSON.stringify(values)}`);
  }
  assert.equal((await stored((await mine(leader)).guild.id)).members.length, 1);
});

test('a replayed create answers the same and makes one guild', async () => {
  const user = await newOnboardedUser(db);
  const key = randomUUID();
  const body = { name: freshName() };
  const first = ok(await post(user, '/guilds', body, key));
  assert.deepEqual(ok(await post(user, '/guilds', body, key)), first);
  assert.equal(
    Number((await db.admin.query('SELECT count(*) FROM guild_memberships WHERE user_id = $1', [user.userId])).rows[0].count),
    1,
  );
});

test('an invite code that is taken is drawn again', async () => {
  const definition = (await db.admin.query("SELECT pg_get_functiondef('app._invite_code()'::regprocedure) AS def")).rows[0]
    .def as string;
  await db.admin.query('CREATE SEQUENCE IF NOT EXISTS test_invite_draws');
  // the first two draws give the same code, the next ones another
  await db.admin.query(`CREATE OR REPLACE FUNCTION app._invite_code() RETURNS text LANGUAGE sql VOLATILE
    SET search_path = public, pg_temp
    AS $$ SELECT CASE WHEN nextval('test_invite_draws') <= 2 THEN 'TAKEN234' ELSE 'FREE2345' END $$`);
  try {
    const first = ok(await create(await newOnboardedUser(db), freshName()));
    const next = ok(await create(await newOnboardedUser(db), freshName()));
    assert.deepEqual([first.guild.inviteCode, next.guild.inviteCode], ['TAKEN234', 'FREE2345']);
  } finally {
    await db.admin.query(definition);
    await db.admin.query('DROP SEQUENCE test_invite_draws');
  }
});

test('join: a lower-case code with spaces works; the joiner is a MEMBER and both see two members', async () => {
  const { leader, code, id } = await guildOf(1);
  const user = await newOnboardedUser(db);
  const body = ok(await join(user, `  ${code.toLowerCase()} `));
  assert.equal(body.guild.id, id);
  assert.equal(body.guild.myRole, 'MEMBER');
  assert.deepEqual(
    body.guild.members.map((m: any) => [m.userId, m.role, m.isMe]),
    [
      [leader.userId, 'LEADER', false],
      [user.userId, 'MEMBER', true],
    ],
  );
  const seen = await mine(leader);
  assert.equal(seen.guild.myRole, 'LEADER');
  assert.deepEqual(
    seen.guild.members.map((m: any) => [m.userId, m.isMe]),
    [
      [leader.userId, true],
      [user.userId, false],
    ],
  );
});

test('join refusals: an unknown or malformed code is 404, a second guild and the own guild 409 ALREADY_IN_GUILD, the ninth member 409 GUILD_FULL', async () => {
  const full = await guildOf(GUILD_MAX_MEMBERS);
  const other = await guildOf(1);
  const user = await newOnboardedUser(db);
  for (const code of ['ZZZZZZZZ', 'ABC', `${other.code}X`, 'DECOY000', '']) {
    refusal(await join(user, code), 404, 'INVITE_CODE_INVALID');
  }
  refusal(await post(user, '/guilds/join', {}), 422, 'VALIDATION_FAILED', { fields: [{ field: 'inviteCode', rule: 'required' }] });
  refusal(await post(user, '/guilds/join', { inviteCode: 12345678 }), 422, 'VALIDATION_FAILED', {
    fields: [{ field: 'inviteCode', rule: 'format' }],
  });
  refusal(await join(user, full.code), 409, 'GUILD_FULL');
  assert.equal((await stored(full.id)).members.length, GUILD_MAX_MEMBERS);
  ok(await join(user, other.code));
  refusal(await join(user, other.code), 409, 'ALREADY_IN_GUILD');
  const third = await guildOf(1);
  refusal(await join(user, third.code), 409, 'ALREADY_IN_GUILD');
  assert.equal((await stored(third.id)).members.length, 1);
  assert.deepEqual(await mine(await newOnboardedUser(db)), { guild: null });
});

test('join refusal order: INVITE_CODE_INVALID before ALREADY_IN_GUILD before GUILD_FULL', async () => {
  const full = await guildOf(GUILD_MAX_MEMBERS);
  const { members } = await guildOf(2);
  refusal(await join(members[0], 'ZZZZZZZZ'), 404, 'INVITE_CODE_INVALID');
  refusal(await join(members[0], full.code), 409, 'ALREADY_IN_GUILD');
});

test('join race over HTTP: with 7 members, 5 parallel joins, exactly 1 succeeds', async () => {
  const guild = await guildOf(GUILD_MAX_MEMBERS - 1);
  const users = await Promise.all(Array.from({ length: 5 }, () => newOnboardedUser(db)));
  const results = await Promise.all(users.map(user => join(user, guild.code)));
  assert.deepEqual(results.map(r => r.body?.error?.code ?? r.status).sort(), [
    200,
    'GUILD_FULL',
    'GUILD_FULL',
    'GUILD_FULL',
    'GUILD_FULL',
  ]);
  assert.equal((await stored(guild.id)).members.length, GUILD_MAX_MEMBERS);
});

test('join race on two pools, 5 rounds: with 7 members, 5 joins at once, exactly 1 succeeds, never 9 members', async () => {
  for (let round = 0; round < 5; round++) {
    const guild = await guildOf(GUILD_MAX_MEMBERS - 1);
    const users = await Promise.all(Array.from({ length: 5 }, () => newOnboardedUser(db)));
    const results = await race(users.map(user => [user, 'SELECT guild_join($1)', [guild.code]]));
    assert.deepEqual(results.map(outcome).sort(), ['GUILD_FULL', 'GUILD_FULL', 'GUILD_FULL', 'GUILD_FULL', 'ok']);
    assert.equal((await stored(guild.id)).members.length, GUILD_MAX_MEMBERS);
  }
});

test('leave and transfer: a member leaves; a leader with members must transfer; transfer swaps the roles; the old leader then leaves', async () => {
  const { leader, members, id } = await guildOf(3);
  const [a, b] = members;
  ok(await leave(b), 204);
  assert.deepEqual(await mine(b), { guild: null });
  assert.equal((await stored(id)).members.length, 2);
  refusal(await leave(leader), 409, 'LEADER_MUST_TRANSFER');
  const swapped = ok(await transfer(leader, a.userId));
  assert.equal(swapped.guild.myRole, 'MEMBER');
  assert.deepEqual(
    swapped.guild.members.map((m: any) => [m.userId, m.role]),
    [
      [a.userId, 'LEADER'],
      [leader.userId, 'MEMBER'],
    ],
  );
  assert.equal((await mine(a)).guild.myRole, 'LEADER');
  ok(await leave(leader), 204);
  assert.deepEqual((await stored(id)).members, [`${a.userId}:LEADER`]);
});

test('transfer refusals: a non-member, the caller, an unknown id 422; a member, an outsider 403 NOT_LEADER; a bad body 422; nothing changes', async () => {
  const { leader, members, id } = await guildOf(2);
  const outsider = (await guildOf(2)).members[0];
  const initial = await stored(id);
  for (const target of [outsider.userId, leader.userId, randomUUID()]) {
    refusal(await transfer(leader, target), 422, 'TRANSFER_TARGET_INVALID');
  }
  refusal(await transfer(members[0], leader.userId), 403, 'NOT_LEADER');
  refusal(await transfer(await newOnboardedUser(db), leader.userId), 403, 'NOT_LEADER');
  refusal(await transfer(leader, undefined), 422, 'VALIDATION_FAILED', { fields: [{ field: 'userId', rule: 'required' }] });
  refusal(await transfer(leader, 'abc'), 422, 'VALIDATION_FAILED', { fields: [{ field: 'userId', rule: 'format' }] });
  assert.deepEqual(await stored(id), initial);
});

test('transfer refusal order: NOT_LEADER before TRANSFER_TARGET_INVALID', async () => {
  const { members } = await guildOf(2);
  refusal(await transfer(members[0], randomUUID()), 403, 'NOT_LEADER');
  refusal(await transfer(await newOnboardedUser(db), randomUUID()), 403, 'NOT_LEADER');
});

test('a lone leader leaving deletes the guild: its invite code stops working and its name is free; a replay is 204 again', async () => {
  const { leader, code, id, name } = await guildOf(1);
  const key = randomUUID();
  ok(await leave(leader, key), 204);
  assert.equal(await stored(id), null);
  ok(await leave(leader, key), 204);
  refusal(await leave(leader), 409, 'NOT_IN_GUILD');
  refusal(await join(await newOnboardedUser(db), code), 404, 'INVITE_CODE_INVALID');
  ok(await create(await newOnboardedUser(db), name));
});

test('race on two pools, 10 rounds: two transfers by the leader to two members, one wins, the other is NOT_LEADER, one leader', async () => {
  for (let round = 0; round < 10; round++) {
    const { leader, members, id } = await guildOf(3);
    const results = await race(members.map(m => [leader, 'SELECT guild_transfer($1)', [m.userId]]));
    assert.deepEqual(results.map(outcome).sort(), ['NOT_LEADER', 'ok']);
    assert.equal(await leaders(id), 1);
  }
});

test('race on two pools, 10 rounds: a transfer to a member while that member leaves: one leader, nobody lost', async () => {
  for (let round = 0; round < 10; round++) {
    const { leader, members, id } = await guildOf(2);
    const [toThem, theyLeave] = (
      await race([
        [leader, 'SELECT guild_transfer($1)', [members[0].userId]],
        [members[0], 'SELECT guild_leave()', []],
      ])
    ).map(outcome);
    assert.ok(
      (toThem === 'ok' && theyLeave === 'LEADER_MUST_TRANSFER') ||
        (toThem === 'TRANSFER_TARGET_INVALID' && theyLeave === 'ok'),
      `${toThem} / ${theyLeave}`,
    );
    assert.equal(await leaders(id), 1);
    assert.equal((await stored(id)).members.length, toThem === 'ok' ? 2 : 1);
  }
});

test('race on two pools, 10 rounds: the leader and the only member leave at once: no guild is left without a leader', async () => {
  for (let round = 0; round < 10; round++) {
    const { leader, members, id } = await guildOf(2);
    const [leaderLeaves, memberLeaves] = (
      await race([
        [leader, 'SELECT guild_leave()', []],
        [members[0], 'SELECT guild_leave()', []],
      ])
    ).map(outcome);
    assert.equal(memberLeaves, 'ok');
    const left = await stored(id);
    if (leaderLeaves === 'ok') {
      assert.equal(left, null);
    } else {
      assert.equal(leaderLeaves, 'LEADER_MUST_TRANSFER');
      assert.deepEqual(left.members, [`${leader.userId}:LEADER`]);
    }
  }
});

test('race on two pools, 10 rounds: a lone leader leaves while someone joins: joined, or gone with the code refused', async () => {
  for (let round = 0; round < 10; round++) {
    const { leader, code, id } = await guildOf(1);
    const user = await newOnboardedUser(db);
    const [leaves, joins] = (
      await race([
        [leader, 'SELECT guild_leave()', []],
        [user, 'SELECT guild_join($1)', [code]],
      ])
    ).map(outcome);
    if (leaves === 'ok') {
      assert.equal(joins, 'INVITE_CODE_INVALID');
      assert.equal(await stored(id), null);
    } else {
      assert.deepEqual([leaves, joins], ['LEADER_MUST_TRANSFER', 'ok']);
      assert.equal((await stored(id)).members.length, 2);
      assert.equal(await leaders(id), 1);
    }
  }
});

test('race on two pools, 10 rounds: two users create guilds of one name, one is GUILD_NAME_TAKEN; one user creates two, one is ALREADY_IN_GUILD', async () => {
  for (let round = 0; round < 10; round++) {
    const name = freshName();
    const [a, b] = await Promise.all([newOnboardedUser(db), newOnboardedUser(db)]);
    const sameName = await race([
      [a, 'SELECT guild_create($1, $2)', [name, '']],
      [b, 'SELECT guild_create($1, $2)', [name.toUpperCase(), '']],
    ]);
    assert.deepEqual(sameName.map(outcome).sort(), ['GUILD_NAME_TAKEN', 'ok']);
    const user = await newOnboardedUser(db);
    const twice = await race([
      [user, 'SELECT guild_create($1, $2)', [freshName(), '']],
      [user, 'SELECT guild_create($1, $2)', [freshName(), '']],
    ]);
    assert.deepEqual(twice.map(outcome).sort(), ['ALREADY_IN_GUILD', 'ok']);
  }
});

const FORBIDDEN_KEYS = ['weightKg', 'heightCm', 'calorieTarget', 'caloriesIn', 'bmr', 'tdee', 'waterMl', 'birthYear', 'sex'];
const keysOf = (value: unknown): string[] =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, inner]) => [...(Array.isArray(value) ? [] : [key]), ...keysOf(inner)])
    : [];

test('privacy (R-P.1): another member reads none of the biometric or calorie keys, nor any sentinel value', async () => {
  const { leader, members } = await guildOf(1).then(async g => {
    const member = await newOnboardedUser(db, { heightCm: 177.7, weightKg: 77.7, birthYear: 1979 });
    ok(await join(member, g.code));
    return { leader: g.leader, members: [member] };
  });
  const [b] = members;
  await db.admin.query('UPDATE prescriptions SET calorie_target = 2777 WHERE user_id = $1', [b.userId]);
  ok(await post(b, '/nutrition/log', { kcal: 1777.7 }));
  ok(await post(b, '/day/quests/WATER_8/progress', {}));
  // the sentinels are really stored: otherwise their absence says nothing
  const { rows } = await db.admin.query(
    `SELECT s.height_cm::text, s.weight_kg::text, p.calorie_target::text, d.calories_in::text, d.water_ml
       FROM biometric_snapshots s JOIN prescriptions p USING (user_id) JOIN daily_logs d USING (user_id)
      WHERE s.user_id = $1`,
    [b.userId],
  );
  assert.deepEqual(
    [rows[0].height_cm, rows[0].weight_kg, rows[0].calorie_target, rows[0].calories_in],
    ['177.7', '77.7', '2777', '1777.7'],
  );
  assert.ok(rows[0].water_ml > 0);
  const seen = await mine(leader);
  assert.ok(seen.guild.members.some((m: any) => m.userId === b.userId));
  assert.deepEqual(keysOf(seen).filter(key => FORBIDDEN_KEYS.includes(key)), []);
  // the ids and the invite code are random text that could hold any digits by chance
  let text = JSON.stringify(seen);
  for (const id of [seen.guild.id, seen.guild.inviteCode, ...seen.guild.members.map((m: any) => m.userId)]) {
    text = text.replaceAll(id, '');
  }
  for (const sentinel of ['77.7', '177.7', '2777', '1777', '1979']) {
    assert.ok(!text.includes(sentinel), `${sentinel} in ${text}`);
  }
});

test('outsiders: GET /guilds/me is {guild: null}; guild_overview takes no argument and reads no private table or column', async () => {
  await guildOf(3);
  assert.deepEqual(await mine(await newOnboardedUser(db)), { guild: null });
  const { rows } = await db.admin.query(
    `SELECT pronargs, prosrc FROM pg_proc WHERE oid = 'guild_overview()'::regprocedure`,
  );
  assert.equal(rows[0].pronargs, 0);
  for (const name of ['biometric_snapshots', 'prescriptions', 'nutrition_logs', 'journal_entries', 'calories_in', 'water_ml']) {
    assert.ok(!rows[0].prosrc.includes(name), `guild_overview reads ${name}`);
  }
});

test('week numbers equal memberWeek and scoreGuildWeek on the same inputs: joined Monday 3 full days and a half, joined Thursday, another zone', async () => {
  await setTestClock(db.admin, '2027-03-14T05:00:00.000Z');
  try {
    const today = await ictToday();
    const weekStart = weekStartOf(today);
    assert.equal(daysBetween(weekStart, today), 6, 'the clock of this test is on a Sunday in Asia/Ho_Chi_Minh');
    const day = (n: number) => addDays(weekStart, n);
    const { leader: a, members } = await guildOf(2);
    const b = members[0];
    const c = await newOnboardedUser(db, { timezone: 'America/Los_Angeles' });
    ok(await join(c, (await mine(a)).guild.inviteCode));
    const quests = (
      await db.admin.query(
        "SELECT id, target_count FROM quests WHERE category = 'STORY' AND is_active AND 'SUPPORTER' = ANY (archetypes) ORDER BY code",
      )
    ).rows;
    const total = quests.length;
    assert.ok(total >= 2);
    const half = Math.floor(total / 2);

    type Arranged = { user: User; joined: string; logs: { date: string; done: number; ticketWeek?: string }[] };
    const arranged: Arranged[] = [
      {
        user: a,
        joined: day(0),
        logs: [
          { date: day(-1), done: total }, // last week: not counted
          { date: day(0), done: total },
          { date: day(1), done: total },
          { date: day(2), done: total },
          { date: day(3), done: half },
        ],
      },
      {
        user: b,
        joined: day(3),
        logs: [
          { date: day(2), done: total }, // before joining: not counted
          { date: day(3), done: total, ticketWeek: day(0) }, // a ticket on a completed day: not frozen (AR-10)
          { date: day(4), done: half },
          { date: day(5), done: 0, ticketWeek: day(-7) }, // frozen
        ],
      },
      // Los Angeles: at 12:00 Sunday in Asia/Ho_Chi_Minh it is still Saturday's logical day there
      { user: c, joined: day(-3), logs: [{ date: day(5), done: total }] },
    ];
    for (const { user, joined, logs } of arranged) {
      await db.admin.query('UPDATE guild_memberships SET joined_at = $2 WHERE user_id = $1', [user.userId, `${joined}T05:00:00Z`]);
      for (const { date, done, ticketWeek } of logs) {
        const log = (
          await db.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2) RETURNING id', [user.userId, date])
        ).rows[0].id;
        for (const quest of quests.slice(0, done)) {
          await db.admin.query(
            `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
             VALUES ($1, $2, $3, $4, app.now())`,
            [user.userId, log, quest.id, quest.target_count],
          );
        }
        if (ticketWeek !== undefined) {
          await db.admin.query(
            'INSERT INTO freeze_tickets (user_id, grant_week, used_at, used_for_date) VALUES ($1, $2, app.now(), $3)',
            [user.userId, ticketWeek, date],
          );
        }
      }
    }
    const weeks: MemberWeek[] = arranged.map(({ user, joined, logs }) => ({
      userId: user.userId,
      joinedDate: joined,
      days: logs.map(({ date, done, ticketWeek }) => ({
        date,
        storyDone: done,
        storyTotal: total,
        frozen: ticketWeek !== undefined && done < total,
      })),
    }));
    const got = (await mine(b)).guild;
    assert.equal(got.weekCompletion, scoreGuildWeek(weeks, weekStart, today).avgCompletion);
    assert.ok(got.weekCompletion > 0 && got.weekCompletion < 1);
    const byId = new Map(got.members.map((m: any) => [m.userId, m]));
    const counts = weeks.map(week => {
      const member: any = byId.get(week.userId);
      return [member.daysCompletedThisWeek, member.daysCountedThisWeek, member.storyDoneToday];
    });
    const expected = weeks.map(week => {
      const from = week.joinedDate > weekStart ? week.joinedDate : weekStart;
      return [
        week.days.filter(d => d.date >= from && d.date <= today && d.storyDone === total).length,
        memberWeek(week, weekStart, today).countedDays,
        // only C's own logical day (Saturday in Los Angeles) has a log, done, today
        week.userId === c.userId,
      ];
    });
    assert.deepEqual(counts, expected);
    // A: three full days and a half; B, joined Thursday, is counted from Thursday
    assert.equal(counts[0][0], 3);
    assert.equal(expected[1][1], daysBetween(day(3), today) + 1);
  } finally {
    await setTestClock(db.admin, NOON);
  }
});

test("storyDoneToday follows the member's own logical day also when that day is in the previous Asia/Ho_Chi_Minh week", async () => {
  const monday = '2027-03-15T05:00:00.000Z';
  await setTestClock(db.admin, monday);
  try {
    const today = await ictToday();
    const theirs = logicalDateOf(Date.parse(monday), 'America/Los_Angeles');
    assert.ok(theirs < weekStartOf(today), 'Los Angeles is still in the previous week');
    const { leader } = await guildOf(1);
    const la = await newOnboardedUser(db, { timezone: 'America/Los_Angeles' });
    ok(await join(la, (await mine(leader)).guild.inviteCode));
    const log = (
      await db.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2) RETURNING id', [la.userId, theirs])
    ).rows[0].id;
    await db.admin.query(
      `INSERT INTO quest_completions (user_id, daily_log_id, quest_id, progress, completed_at)
       SELECT $1, $2, q.id, q.target_count, app.now() FROM quests q
        WHERE q.category = 'STORY' AND q.is_active AND 'SUPPORTER' = ANY (q.archetypes)`,
      [la.userId, log],
    );
    const member = (await mine(leader)).guild.members.find((m: any) => m.userId === la.userId);
    assert.deepEqual([member.storyDoneToday, member.daysCompletedThisWeek], [true, 0]);
  } finally {
    await setTestClock(db.admin, NOON);
  }
});

test(`inactive: ${GUILD_INACTIVE_DAYS} days after the last log of any member true, one day fewer false; without logs counted from creation`, async () => {
  try {
    const { leader, members } = await guildOf(2);
    const today = await ictToday();
    await db.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2), ($3, $4)', [
      leader.userId,
      addDays(today, -3),
      members[0].userId,
      today,
    ]);
    const lonely = await guildOf(1);
    const state = async (user: User) => {
      const { guild } = await mine(user);
      return [guild.inactive, guild.inactiveDays];
    };
    assert.deepEqual(await state(leader), [false, 0]);
    await setTestClock(db.admin, `${addDays(today, GUILD_INACTIVE_DAYS - 1)}T05:00:00.000Z`);
    assert.deepEqual(await state(leader), [false, GUILD_INACTIVE_DAYS - 1]);
    assert.deepEqual(await state(lonely.leader), [false, GUILD_INACTIVE_DAYS - 1]);
    await setTestClock(db.admin, `${addDays(today, GUILD_INACTIVE_DAYS)}T05:00:00.000Z`);
    assert.deepEqual(await state(leader), [true, GUILD_INACTIVE_DAYS]);
    assert.deepEqual(await state(lonely.leader), [true, GUILD_INACTIVE_DAYS]);
  } finally {
    await setTestClock(db.admin, NOON);
  }
});

test(`inactive: counted from the creation day when every log is older: a guild made today is active; ${GUILD_INACTIVE_DAYS} days later with no new log it is not`, async () => {
  try {
    const { leader, members } = await guildOf(2);
    const today = await ictToday();
    await db.admin.query('INSERT INTO daily_logs (user_id, logical_date) VALUES ($1, $2), ($3, $2)', [
      leader.userId,
      addDays(today, -20),
      members[0].userId,
    ]);
    const state = async () => {
      const { guild } = await mine(leader);
      return [guild.inactive, guild.inactiveDays];
    };
    assert.deepEqual(await state(), [false, 0]);
    await setTestClock(db.admin, `${addDays(today, GUILD_INACTIVE_DAYS - 1)}T05:00:00.000Z`);
    assert.deepEqual(await state(), [false, GUILD_INACTIVE_DAYS - 1]);
    await setTestClock(db.admin, `${addDays(today, GUILD_INACTIVE_DAYS)}T05:00:00.000Z`);
    assert.deepEqual(await state(), [true, GUILD_INACTIVE_DAYS]);
  } finally {
    await setTestClock(db.admin, NOON);
  }
});

test('the members carry level from the XP sum and storyDoneToday; a member who left is gone from the list', async () => {
  const { leader, members } = await guildOf(3);
  await db.admin.query("SELECT app._grant($1, 1000, 0, 'TEST', $2)", [members[0].userId, randomUUID()]);
  const level = (await app.call('GET', '/progression', { token: members[0].token })).body.level;
  assert.ok(level > 1);
  ok(await leave(members[1]), 204);
  const { guild } = await mine(leader);
  assert.deepEqual(
    guild.members.map((m: any) => [m.userId, m.level]),
    [
      [leader.userId, 1],
      [members[0].userId, level],
    ],
  );
});
