// The stand-in server of todayTestKit against what the real guild routes answer (server Tasks 39 and 41: routes/guild.ts,
// sql/50-guild.sql, readModels/guild.ts, sql/52-nudge.sql). Every mobile test that reads a guild answer is only as true as
// these. No app is mounted: the requests go straight to the stubbed fetch.
import { newActionId } from '../../shared/api/uuid';
import { fetchMock, fullTeam, installTodayTestEnv, seedGuild, seedOtherGuild, world } from './guildTestKit';

installTodayTestEnv();

const BASE = 'http://localhost:8787/api/v1';
const GUILDS = '/guilds';
const JOIN = '/guilds/join';
const ME = '/guilds/me';
const LEAVE = '/guilds/me/leave';
const TRANSFER = '/guilds/me/transfer';

type Answer = { status: number; json: any };
type Row = { displayName: string; nudge: { allowed: boolean; reason: string | null }; isMe: boolean; role: string };
/** One request to the stand-in, with a text body as written on the wire (`undefined` = no body). */
async function send(method: string, path: string, raw?: string, key = newActionId()): Promise<Answer & { key: string }> {
  const init = { method, headers: { 'Idempotency-Key': key }, ...(raw === undefined ? {} : { body: raw }), signal: new AbortController().signal };
  const response = (await fetchMock(BASE + path, init)) as { status: number; text: () => Promise<string> };
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined, key };
}
const post = (path: string, body: unknown, key?: string) => send('POST', path, body === undefined ? undefined : JSON.stringify(body), key);
const get = (path: string) => send('GET', path);
const code = (answer: Answer) => `${answer.status} ${answer.json?.error?.code}`;
const fields = (answer: Answer) => answer.json.error.details.fields;
const rows = (answer: Answer) => answer.json.guild.members as Row[];
const nudgeOf = async (name: string) => rows(await get(ME)).find(member => member.displayName === name)?.nudge;
const reasonOf = async (name: string) => (await nudgeOf(name))?.reason;

describe('every route is for an onboarded user', () => {
  test('409 ONBOARDING_REQUIRED before anything else, a bad body included', async () => {
    world.me = { ...world.me, progression: null };
    for (const answer of [await get(ME), await post(GUILDS, {}), await post(JOIN, {}), await post(LEAVE, undefined), await post(TRANSFER, {})]) expect(code(answer)).toBe('409 ONBOARDING_REQUIRED');
  });

  test('outside a guild GET answers { guild: null }', async () => {
    const answer = await get(ME);
    expect([answer.status, answer.json]).toEqual([200, { guild: null }]);
  });
});

describe('POST /guilds', () => {
  test('the body first (every wrong field named, in the order name, motto), banned words after it, then ALREADY_IN_GUILD, then GUILD_NAME_TAKEN', async () => {
    const none = await post(GUILDS, {});
    expect([code(none), fields(none)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'name', rule: 'required' }]]);
    const both = await post(GUILDS, { name: 'ab', motto: 'x'.repeat(81) });
    expect([code(both), fields(both)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'name', rule: 'min' }, { field: 'motto', rule: 'max' }]]);
    expect(fields(await post(GUILDS, { name: 'x'.repeat(31) }))).toEqual([{ field: 'name', rule: 'max' }]);
    expect(fields(await post(GUILDS, { name: '!!!' }))).toEqual([{ field: 'name', rule: 'format' }]);
    expect(fields(await post(GUILDS, { name: 5 }))).toEqual([{ field: 'name', rule: 'format' }]);
    expect(fields(await post(GUILDS, { name: 'Tên ổn', motto: 'ẩn​ký' }))).toEqual([{ field: 'motto', rule: 'format' }]);
    // a banned word is judged last: a body that breaks a field rule too is VALIDATION_FAILED
    expect(code(await post(GUILDS, { name: 'Kẻ lười', motto: 'x'.repeat(81) }))).toBe('422 VALIDATION_FAILED');
    expect(code(await post(GUILDS, { name: 'Kẻ lười' }))).toBe('422 NAME_NOT_ALLOWED');
    expect(code(await post(GUILDS, { name: 'Tên ổn', motto: 'thất bại' }))).toBe('422 NAME_NOT_ALLOWED');
    expect(world.guild.teams).toEqual([]);
    seedOtherGuild({ name: 'Tổ Khác' });
    expect(code(await post(GUILDS, { name: 'tổ khác' }))).toBe('409 GUILD_NAME_TAKEN');
    seedGuild({ id: '00000000-0000-4000-9000-900000000003', name: 'Nhóm đã có', inviteCode: 'KLMN4567' });
    // in a guild already AND the name is taken: ALREADY_IN_GUILD comes first
    expect(code(await post(GUILDS, { name: 'tổ khác' }))).toBe('409 ALREADY_IN_GUILD');
  });

  test('the name is NFC (a decomposed spelling of a taken name is taken, what is stored is NFC) and trimmed; the answer is the guild with the caller as LEADER', async () => {
    seedOtherGuild({ name: 'Nhịp sống mới' });
    expect(code(await post(GUILDS, { name: 'Nhịp sống mới'.normalize('NFD') }))).toBe('409 GUILD_NAME_TAKEN');
    const made = await post(GUILDS, { name: '  Tổ mới  '.normalize('NFD'), motto: '  Cùng nhau ' });
    expect(made.status).toBe(200);
    expect(made.json.guild).toMatchObject({ name: 'Tổ mới'.normalize('NFC'), motto: 'Cùng nhau', myRole: 'LEADER', weekCompletion: 0, inactive: false, inactiveDays: 0 });
    expect(made.json.guild.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(rows(made)).toMatchObject([{ displayName: 'An', isMe: true, role: 'LEADER', nudge: { allowed: false, reason: null } }]);
    expect(made.json.guild.name).toBe(made.json.guild.name.normalize('NFC'));
  });
});

describe('POST /guilds/join', () => {
  test('the body (422), INVITE_CODE_INVALID (404: unknown, or not 8 characters of the alphabet) before ALREADY_IN_GUILD before GUILD_FULL', async () => {
    const missing = await post(JOIN, {});
    expect([code(missing), fields(missing)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'inviteCode', rule: 'required' }]]);
    expect(fields(await post(JOIN, { inviteCode: 5 }))).toEqual([{ field: 'inviteCode', rule: 'format' }]);
    const full = seedOtherGuild({ inviteCode: 'ABCD2345', members: fullTeam() });
    // I, O, 0 and 1 are not in the alphabet; neither is a code of another length
    for (const bad of ['', 'ABCD234', 'ABCD23456', 'ABCDEFGI', 'ABCD2301', 'ZZZZ2222']) expect(code(await post(JOIN, { inviteCode: bad }))).toBe('404 INVITE_CODE_INVALID');
    expect(code(await post(JOIN, { inviteCode: ' abcd2345 ' }))).toBe('409 GUILD_FULL');
    // in a guild already: ALREADY_IN_GUILD before GUILD_FULL, INVITE_CODE_INVALID before both
    seedGuild({ id: '00000000-0000-4000-9000-900000000003', name: 'Nhóm đã có', inviteCode: 'KLMN4567' });
    expect(code(await post(JOIN, { inviteCode: 'ABCD2345' }))).toBe('409 ALREADY_IN_GUILD');
    expect(code(await post(JOIN, { inviteCode: 'ZZZZ2222' }))).toBe('404 INVITE_CODE_INVALID');
    expect(full.members).toHaveLength(8);
  });

  test('a lower-case code with spaces joins; the answer is the guild with the caller as a MEMBER', async () => {
    seedOtherGuild({ inviteCode: 'ABCD2345' });
    const joined = await post(JOIN, { inviteCode: '  abcd2345 ' });
    expect(joined.status).toBe(200);
    expect(joined.json.guild).toMatchObject({ name: 'Tổ khác', myRole: 'MEMBER' });
    expect(rows(joined).map(member => [member.displayName, member.isMe])).toEqual([['Bình', false], ['An', true]]);
  });
});

describe('GET /guilds/me', () => {
  test('the nudge of each row is what nudge_send would raise, in the order of app._nudge_block_reason; the own row is { false, null }', async () => {
    seedGuild();
    const [, linh, minh, ha] = world.guild.teams[0].members;
    expect(await nudgeOf('An')).toEqual({ allowed: false, reason: null });
    expect([await nudgeOf('Linh'), await nudgeOf('Minh'), await nudgeOf('Hà')]).toEqual([
      { allowed: false, reason: 'NUDGE_NOT_NEEDED' },
      { allowed: true, reason: null },
      { allowed: false, reason: 'NUDGE_RECEIVER_MUTED' },
    ]);
    // each rule wins over the ones after it
    linh.muted = true;
    expect(await reasonOf('Linh')).toBe('NUDGE_RECEIVER_MUTED');
    ha.storyDone = true;
    expect(await reasonOf('Hà')).toBe('NUDGE_RECEIVER_MUTED');
    ha.muted = false;
    world.hour = 10;
    expect(await reasonOf('Hà')).toBe('NUDGE_NOT_NEEDED');
    ha.storyDone = false;
    minh.nudgedToday = true;
    expect(await reasonOf('Hà')).toBe('NUDGE_OUTSIDE_WINDOW');
    // the window is [12:00, 20:00)
    for (const [hour, reason] of [[11, 'NUDGE_OUTSIDE_WINDOW'], [12, 'NUDGE_RECEIVER_LIMIT'], [19, 'NUDGE_RECEIVER_LIMIT'], [20, 'NUDGE_OUTSIDE_WINDOW']] as const) {
      world.hour = hour;
      expect(await reasonOf('Minh')).toBe(reason);
    }
    world.hour = 19;
    minh.nudgedToday = false;
    world.guild.nudgesSent = 3;
    expect(await reasonOf('Minh')).toBe('NUDGE_SENDER_LIMIT');
    minh.nudgedToday = true;
    expect(await reasonOf('Minh')).toBe('NUDGE_RECEIVER_LIMIT');
    world.guild.nudgesSent = 2;
    minh.nudgedToday = false;
    expect(await nudgeOf('Minh')).toEqual({ allowed: true, reason: null });
  });

  test('inactive is the server\'s rule on the days: 13 is not, 14 is', async () => {
    seedGuild({ inactiveDays: 13 });
    const before = (await get(ME)).json.guild;
    expect([before.inactive, before.inactiveDays]).toEqual([false, 13]);
    world.guild.teams[0].inactiveDays = 14;
    expect((await get(ME)).json.guild.inactive).toBe(true);
  });
});

describe('POST /guilds/me/leave', () => {
  test('204: NOT_IN_GUILD; a leader with others LEADER_MUST_TRANSFER; a lone leader takes the guild and its code with them; a member goes and the others stay', async () => {
    expect(code(await post(LEAVE, undefined))).toBe('409 NOT_IN_GUILD');
    seedGuild({ role: 'LEADER' });
    expect(code(await post(LEAVE, undefined))).toBe('409 LEADER_MUST_TRANSFER');
    world.guild.teams[0].members = world.guild.teams[0].members.slice(0, 1);
    seedOtherGuild({ inviteCode: 'ABCD2345' });
    const left = await post(LEAVE, undefined);
    expect([left.status, left.json]).toEqual([204, undefined]);
    expect(world.guild.teams.map(team => team.name)).toEqual(['Tổ khác']);
    expect(code(await post(JOIN, { inviteCode: 'NHJPM2K9' }))).toBe('404 INVITE_CODE_INVALID');
    world.guild.teams = [];
    seedGuild();
    expect((await post(LEAVE, undefined)).status).toBe(204);
    expect(world.guild.teams[0].members.map(member => member.displayName)).toEqual(['Linh', 'Minh', 'Hà']);
    expect((await get(ME)).json).toEqual({ guild: null });
  });
});

describe('POST /guilds/me/transfer', () => {
  test('the body (422), NOT_LEADER (403; in no guild too) before TRANSFER_TARGET_INVALID (422: oneself, a stranger); the roles swap', async () => {
    const missing = await post(TRANSFER, {});
    expect([code(missing), fields(missing)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'userId', rule: 'required' }]]);
    expect(fields(await post(TRANSFER, { userId: 'not-a-uuid' }))).toEqual([{ field: 'userId', rule: 'format' }]);
    const someone = newActionId();
    // in no guild: NOT_LEADER, even for a target that exists nowhere
    expect(code(await post(TRANSFER, { userId: someone }))).toBe('403 NOT_LEADER');
    seedGuild();
    const [me, linh] = world.guild.teams[0].members;
    expect(code(await post(TRANSFER, { userId: linh.userId }))).toBe('403 NOT_LEADER');
    me.role = 'LEADER';
    expect(code(await post(TRANSFER, { userId: me.userId }))).toBe('422 TRANSFER_TARGET_INVALID');
    expect(code(await post(TRANSFER, { userId: someone }))).toBe('422 TRANSFER_TARGET_INVALID');
    const done = await post(TRANSFER, { userId: linh.userId });
    expect(done.status).toBe(200);
    expect(done.json.guild.myRole).toBe('MEMBER');
    expect(rows(done).find(member => member.displayName === 'Linh')?.role).toBe('LEADER');
    // the old leader is a member now: a second transfer is NOT_LEADER, and leaving works
    expect(code(await post(TRANSFER, { userId: linh.userId }))).toBe('403 NOT_LEADER');
    expect((await post(LEAVE, undefined)).status).toBe(204);
  });
});

describe('what a key remembers', () => {
  test('the same key and body replays the answer, the same key with another body is IDEMPOTENCY_KEY_REUSED, a refusal is not remembered', async () => {
    const key = newActionId();
    const first = await post(GUILDS, { name: 'Tổ một' }, key);
    const again = await post(GUILDS, { name: 'Tổ một' }, key);
    expect([first.status, again.status, world.guild.teams.length]).toEqual([200, 200, 1]);
    expect(again.json).toEqual(first.json);
    expect(code(await post(GUILDS, { name: 'Tổ hai' }, key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    // a refusal is run again under its key: the cause goes, the same key now succeeds
    world.guild.teams = [];
    seedOtherGuild({ name: 'Tổ ba' });
    const refusedKey = newActionId();
    expect(code(await post(GUILDS, { name: 'Tổ ba' }, refusedKey))).toBe('409 GUILD_NAME_TAKEN');
    world.guild.teams = [];
    expect((await post(GUILDS, { name: 'Tổ ba' }, refusedKey)).status).toBe(200);
  });
});
