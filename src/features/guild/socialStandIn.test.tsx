// The stand-in server of todayTestKit against what the real routes answer for the weekly ranking, the nudge and the inbox
// (server Tasks 40, 41, 22: routes/leaderboard.ts, routes/nudge.ts, routes/inbox.ts, sql/52-nudge.sql). Every mobile test that
// reads one of these answers is only as true as these. No app is mounted: the requests go straight to the stubbed fetch.
import { newActionId } from '../../shared/api/uuid';
import { fetchMock, inboxItem, installTodayTestEnv, seedGuild, seedInbox, seedOtherGuild, world } from './guildTestKit';

installTodayTestEnv();

const BASE = 'http://localhost:8787/api/v1';
const NUDGE = '/guilds/nudge';
const READ = '/inbox/read';

type Answer = { status: number; json: any };
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
const idOf = (name: string) => world.guild.teams[0].members.find(member => member.displayName === name)?.userId as string;
const TEMPLATE = 'MOVE_TOGETHER';

describe('every route is for an onboarded user', () => {
  test('409 ONBOARDING_REQUIRED before anything else, a bad request included', async () => {
    world.me = { ...world.me, progression: null };
    const answers = [await get('/leaderboard?week=nope'), await get('/guilds/nudge-templates'), await post(NUDGE, {}), await get('/inbox?limit=0')];
    expect(answers.map(code)).toEqual(Array(4).fill('409 ONBOARDING_REQUIRED'));
  });
});

describe('GET /leaderboard', () => {
  test('week is required and is current or previous: 422 with the field, before any board is looked at', async () => {
    const none = await get('/leaderboard');
    expect([code(none), fields(none)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'week', rule: 'required' }]]);
    expect(fields(await get('/leaderboard?week=last'))).toEqual([{ field: 'week', rule: 'format' }]);
    expect(fields(await get('/leaderboard?week='))).toEqual([{ field: 'week', rule: 'format' }]);
  });

  test('the running week: entries ranked from 1 with isMine on the caller\'s guild, mine ranked, not final; the week is the Monday of the stand-in\'s day', async () => {
    seedGuild();
    world.guild.boards.current = {
      updatedAt: '2026-10-14T02:40:00.000Z',
      standings: [
        { guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.86, activeMembers: 5 },
        { guildName: 'Nhịp sống mới', avgCompletion: 0.79, activeMembers: 4 },
      ],
    };
    const answer = await get('/leaderboard?week=current');
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      weekStart: '2026-10-12',
      final: false,
      updatedAt: '2026-10-14T02:40:00.000Z',
      entries: [
        { rank: 1, guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.86, activeMembers: 5, isMine: false },
        { rank: 2, guildName: 'Nhịp sống mới', avgCompletion: 0.79, activeMembers: 4, isMine: true },
      ],
      mine: { ranked: true, rank: 2, avgCompletion: 0.79, activeMembers: 4 },
    });
  });

  test('a guild that is not on the board is unranked: mine has rank null and its own numbers; no guild at all: mine null; entries are never a guild that is not ranked', async () => {
    world.guild.boards.current = { standings: [{ guildName: 'Bước nhỏ mỗi ngày', avgCompletion: 0.86, activeMembers: 5 }] };
    expect((await get('/leaderboard?week=current')).json.mine).toBeNull();
    seedGuild();
    expect((await get('/leaderboard?week=current')).json.mine).toEqual({ ranked: false, rank: null, avgCompletion: 0, activeMembers: 0 });
    world.guild.boards.current.unranked = { avgCompletion: 0.4, activeMembers: 2 };
    const answer = await get('/leaderboard?week=current');
    expect(answer.json.mine).toEqual({ ranked: false, rank: null, avgCompletion: 0.4, activeMembers: 2 });
    expect(answer.json.entries.map((entry: { isMine: boolean }) => entry.isMine)).toEqual([false]);
  });

  test('only the top 50 are entries; a guild below them still has its rank in mine', async () => {
    seedGuild();
    const others = Array.from({ length: 50 }, (_, n) => ({ guildName: `Tổ ${n + 1}`, avgCompletion: 0.9, activeMembers: 4 }));
    world.guild.boards.current = { standings: [...others, { guildName: 'Nhịp sống mới', avgCompletion: 0.3, activeMembers: 3 }] };
    const answer = await get('/leaderboard?week=current');
    expect(answer.json.entries).toHaveLength(50);
    expect(answer.json.entries.some((entry: { isMine: boolean }) => entry.isMine)).toBe(false);
    expect(answer.json.mine).toEqual({ ranked: true, rank: 51, avgCompletion: 0.3, activeMembers: 3 });
  });

  test('the previous week before the rollover stored it: an empty final board as of now, mine null even for a member; once stored it is the stored board, final, a week earlier', async () => {
    seedGuild();
    const empty = await get('/leaderboard?week=previous');
    expect(empty.json).toMatchObject({ weekStart: '2026-10-05', final: true, entries: [], mine: null });
    expect(Math.abs(Date.parse(empty.json.updatedAt) - Date.now())).toBeLessThan(5000);
    world.guild.boards.previous = { updatedAt: '2026-10-12T03:30:00.000Z', standings: [{ guildName: 'Nhịp sống mới', avgCompletion: 0.7, activeMembers: 4 }] };
    const stored = await get('/leaderboard?week=previous');
    expect(stored.json).toEqual({
      weekStart: '2026-10-05',
      final: true,
      updatedAt: '2026-10-12T03:30:00.000Z',
      entries: [{ rank: 1, guildName: 'Nhịp sống mới', avgCompletion: 0.7, activeMembers: 4, isMine: true }],
      mine: { ranked: true, rank: 1, avgCompletion: 0.7, activeMembers: 4 },
    });
  });
});

describe('GET /guilds/nudge-templates', () => {
  test('the fixed texts of the content, ordered by code', async () => {
    const answer = await get('/guilds/nudge-templates');
    expect(answer.status).toBe(200);
    const codes = answer.json.templates.map((template: { code: string }) => template.code);
    expect(codes).toEqual([...codes].sort());
    expect(answer.json.templates[0]).toEqual({ code: 'HOW_ARE_YOU', text: expect.any(String) });
    expect(answer.json.templates).toHaveLength(5);
  });
});

describe('POST /guilds/nudge', () => {
  test('the body first (receiverId then templateCode, both named), then the template (422), then NOT_IN_GUILD (409) before NUDGE_NOT_SAME_GUILD (403: oneself, a stranger)', async () => {
    const none = await post(NUDGE, {});
    expect([code(none), fields(none)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'receiverId', rule: 'required' }, { field: 'templateCode', rule: 'required' }]]);
    expect(fields(await post(NUDGE, { receiverId: 'nope', templateCode: 5 }))).toEqual([{ field: 'receiverId', rule: 'format' }, { field: 'templateCode', rule: 'format' }]);
    // a template nobody has is judged before the guild: no guild and no such template is the template's refusal
    expect(code(await post(NUDGE, { receiverId: newActionId(), templateCode: 'NO_SUCH' }))).toBe('422 NUDGE_TEMPLATE_UNKNOWN');
    expect(code(await post(NUDGE, { receiverId: newActionId(), templateCode: TEMPLATE }))).toBe('409 NOT_IN_GUILD');
    seedGuild();
    expect(code(await post(NUDGE, { receiverId: newActionId(), templateCode: TEMPLATE }))).toBe('403 NUDGE_NOT_SAME_GUILD');
    expect(code(await post(NUDGE, { receiverId: idOf('An'), templateCode: TEMPLATE }))).toBe('403 NUDGE_NOT_SAME_GUILD');
    expect(world.guild.sent).toEqual([]);
  });

  test('the reasons in the order of app._nudge_block_reason: muted, done today, outside the window, the receiver\'s limit, the sender\'s limit', async () => {
    seedGuild();
    const [, , minh, ha] = world.guild.teams[0].members;
    const ask = async (name: string) => code(await post(NUDGE, { receiverId: idOf(name), templateCode: TEMPLATE }));
    // muted before done
    ha.storyDone = true;
    expect(await ask('Hà')).toBe('409 NUDGE_RECEIVER_MUTED');
    // done before the window
    ha.muted = false;
    world.hour = 20;
    expect(await ask('Hà')).toBe('409 NUDGE_NOT_NEEDED');
    // the window before the receiver's limit
    ha.storyDone = false;
    ha.nudgedToday = true;
    expect(await ask('Hà')).toBe('409 NUDGE_OUTSIDE_WINDOW');
    world.hour = 19;
    expect(await ask('Hà')).toBe('409 NUDGE_RECEIVER_LIMIT');
    // the receiver's limit before the sender's
    world.guild.nudgesSent = 3;
    expect(await ask('Hà')).toBe('409 NUDGE_RECEIVER_LIMIT');
    expect(await ask('Minh')).toBe('409 NUDGE_SENDER_LIMIT');
    expect(minh.nudgedToday).toBe(false);
    expect(world.guild.sent).toEqual([]);
  });

  test('a nudge: 200 { sentAt, senderRemainingToday }, the receiver is nudged for the day, the third leaves 0, the fourth is the sender\'s limit', async () => {
    seedGuild();
    const [, linh, minh, ha] = world.guild.teams[0].members;
    linh.storyDone = false;
    ha.muted = false;
    const first = await post(NUDGE, { receiverId: minh.userId, templateCode: TEMPLATE });
    expect(first.status).toBe(200);
    expect(Object.keys(first.json).sort()).toEqual(['senderRemainingToday', 'sentAt']);
    expect(first.json.senderRemainingToday).toBe(2);
    expect(new Date(first.json.sentAt).toISOString()).toBe(first.json.sentAt);
    expect(world.guild.sent).toEqual([{ receiverId: minh.userId, templateCode: TEMPLATE }]);
    expect(code(await post(NUDGE, { receiverId: minh.userId, templateCode: TEMPLATE }))).toBe('409 NUDGE_RECEIVER_LIMIT');
    expect((await post(NUDGE, { receiverId: linh.userId, templateCode: TEMPLATE })).json.senderRemainingToday).toBe(1);
    expect((await post(NUDGE, { receiverId: ha.userId, templateCode: TEMPLATE })).json.senderRemainingToday).toBe(0);
    seedOtherGuild();
    world.guild.teams[0].members.push({ ...world.guild.teams[0].members[2], userId: '00000000-0000-4000-9000-0000000000aa', displayName: 'Thêm', nudgedToday: false });
    expect(code(await post(NUDGE, { receiverId: '00000000-0000-4000-9000-0000000000aa', templateCode: TEMPLATE }))).toBe('409 NUDGE_SENDER_LIMIT');
    // the member row says the same afterwards
    const row = (await get('/guilds/me')).json.guild.members.find((member: { displayName: string }) => member.displayName === 'Minh');
    expect(row.nudge).toEqual({ allowed: false, reason: 'NUDGE_RECEIVER_LIMIT' });
  });

  test('the key: the same key and body replays the answer and sends once, another receiver under it is IDEMPOTENCY_KEY_REUSED, a refusal is not remembered', async () => {
    seedGuild();
    const minh = idOf('Minh');
    const key = newActionId();
    const first = await post(NUDGE, { receiverId: minh, templateCode: TEMPLATE }, key);
    const again = await post(NUDGE, { receiverId: minh, templateCode: TEMPLATE }, key);
    expect([first.status, again.status, world.guild.sent.length]).toEqual([200, 200, 1]);
    expect(again.json).toEqual(first.json);
    expect(code(await post(NUDGE, { receiverId: idOf('Linh'), templateCode: TEMPLATE }, key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    const refusedKey = newActionId();
    expect(code(await post(NUDGE, { receiverId: minh, templateCode: TEMPLATE }, refusedKey))).toBe('409 NUDGE_RECEIVER_LIMIT');
    world.guild.teams[0].members[2].nudgedToday = false;
    expect((await post(NUDGE, { receiverId: minh, templateCode: TEMPLATE }, refusedKey)).status).toBe(200);
  });

  test('the rate limit: the 11th request of a minute is 429 RATE_LIMITED, refused ones counted, the minute lets go after 60 s', async () => {
    const calls = async () => {
      const statuses: number[] = [];
      for (let n = 0; n < 11; n++) statuses.push((await post(NUDGE, { receiverId: newActionId(), templateCode: TEMPLATE })).status);
      return statuses;
    };
    expect(await calls()).toEqual([...Array(10).fill(409), 429]);
    world.guild.nudgeCalls = world.guild.nudgeCalls.map(at => at - 61_000);
    expect((await post(NUDGE, { receiverId: newActionId(), templateCode: TEMPLATE })).status).toBe(409);
  });
});

describe('GET /inbox', () => {
  const kinds = (answer: Answer) => answer.json.items.map((item: { id: string }) => item.id);
  const many = (count: number) => Array.from({ length: count }, (_, n) => inboxItem(n + 1, 'QUEST_REMINDER', {}));

  test('newest first with the unread count of the whole inbox; the shape is the contract\'s (id, kind, payload, createdAt, readAt)', async () => {
    seedInbox([inboxItem(2, 'PET_TIRED', {}, { read: true }), inboxItem(1, 'NUDGE', { senderName: 'Linh', templateCode: TEMPLATE, text: 'Mình cùng vận động nhé?' }), inboxItem(3, 'QUEST_REMINDER', {})]);
    const answer = await get('/inbox');
    expect(answer.status).toBe(200);
    expect(answer.json.items.map((item: { kind: string }) => item.kind)).toEqual(['NUDGE', 'PET_TIRED', 'QUEST_REMINDER']);
    expect(answer.json.unreadCount).toBe(2);
    expect(answer.json.nextBefore).toBeNull();
    expect(Object.keys(answer.json.items[0]).sort()).toEqual(['createdAt', 'id', 'kind', 'payload', 'readAt']);
    expect(answer.json.items[1].readAt).toBe(answer.json.items[1].createdAt);
    expect(answer.json.items[0].readAt).toBeNull();
  });

  test('20 by default; before = nextBefore gives the rest, none twice, none lost; the cursor is the last item\'s time to the microsecond', async () => {
    seedInbox(many(45));
    const first = await get('/inbox');
    expect([first.json.items.length, first.json.unreadCount]).toEqual([20, 45]);
    expect(first.json.nextBefore).toMatch(/^2026-10-14T11:\d\d:00\.000000Z$/);
    expect(first.json.nextBefore).toBe(`${first.json.items[19].createdAt.slice(0, 23)}000Z`);
    const second = await get(`/inbox?before=${encodeURIComponent(first.json.nextBefore)}`);
    const third = await get(`/inbox?before=${encodeURIComponent(second.json.nextBefore)}`);
    expect([second.json.items.length, third.json.items.length, third.json.nextBefore]).toEqual([20, 5, null]);
    expect([...kinds(first), ...kinds(second), ...kinds(third)]).toEqual(world.inbox.map(item => item.id));
    // the cursor is "older than", not "not newer than": the item it names is not on the next page
    expect(kinds(second)).not.toContain(first.json.items[19].id);
  });

  test('limit 1..50 (422 format, min, max), then before an instant that exists (422 format); one field named, never two', async () => {
    seedInbox(many(3));
    expect((await get('/inbox?limit=50')).status).toBe(200);
    expect((await get('/inbox?limit=1')).json.nextBefore).not.toBeNull();
    for (const [query, field, rule] of [['limit=51', 'limit', 'max'], ['limit=0', 'limit', 'min'], ['limit=99999999999999999999', 'limit', 'max'], ['limit=abc', 'limit', 'format'], ['limit=-1', 'limit', 'format'], ['limit=1.5', 'limit', 'format'], ['before=yesterday', 'before', 'format'], ['before=2026-02-30T00:00:00Z', 'before', 'format'], ['before=2026-10-14', 'before', 'format']] as const) {
      const answer = await get(`/inbox?${query}`);
      expect([query, code(answer), fields(answer)]).toEqual([query, '422 VALIDATION_FAILED', [{ field, rule }]]);
    }
    // the limit is judged first
    expect(fields(await get('/inbox?limit=0&before=nope'))).toEqual([{ field: 'limit', rule: 'min' }]);
    // before an instant before everything: an empty page, and an offset is read
    expect((await get('/inbox?before=1969-12-31T00:00:00Z')).json.items).toEqual([]);
    expect((await get(`/inbox?before=${encodeURIComponent('2026-10-14T19:00:00+07:00')}`)).json.items).toHaveLength(3);
  });
});

describe('POST /inbox/read', () => {
  test('with ids marks those, without marks every unread item; the answer is the unread count; the day counts the same; an unknown id changes nothing', async () => {
    const items = [inboxItem(1, 'QUEST_REMINDER', {}), inboxItem(2, 'PET_TIRED', {}), inboxItem(3, 'NUDGE', { senderName: 'Linh', templateCode: TEMPLATE, text: 'x' }), inboxItem(4, 'PET_TIRED', {}, { read: true })];
    seedInbox(items);
    expect(world.day.unreadCount).toBe(3);
    const some = await post(READ, { ids: [items[0].id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] });
    expect([some.status, some.json]).toEqual([200, { unreadCount: 2 }]);
    expect(world.day.unreadCount).toBe(2);
    const page = (await get('/inbox')).json;
    expect(page.items.map((item: { readAt: string | null }) => item.readAt !== null)).toEqual([true, false, false, true]);
    const stamped = page.items[0].readAt;
    // an item that is read already keeps its time
    await post(READ, { ids: [items[0].id, items[1].id] });
    expect((await get('/inbox')).json.items.map((item: { readAt: string | null }) => item.readAt)[0]).toBe(stamped);
    const all = await post(READ, {});
    expect([all.status, all.json]).toEqual([200, { unreadCount: 0 }]);
    expect(world.day.unreadCount).toBe(0);
    expect((await get('/inbox')).json.unreadCount).toBe(0);
  });

  test('the body is an object and ids an array of UUIDs: 422 on ids; a body that is none is 422 on body; the key replays', async () => {
    seedInbox([inboxItem(1, 'QUEST_REMINDER', {})]);
    for (const ids of ['x', [1], ['not-a-uuid'], null]) {
      const answer = await post(READ, { ids });
      expect([code(answer), fields(answer)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'ids', rule: 'format' }]]);
    }
    expect(fields(await post(READ, undefined))).toEqual([{ field: 'body', rule: 'required' }]);
    expect((await get('/inbox')).json.unreadCount).toBe(1);
    const key = newActionId();
    const first = await post(READ, { ids: [world.inbox[0].id] }, key);
    expect((await post(READ, { ids: [world.inbox[0].id] }, key)).json).toEqual(first.json);
    expect(code(await post(READ, {}, key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
  });
});
