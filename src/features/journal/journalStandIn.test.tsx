// The stand-in server of todayTestKit against what the real routes answer for the journal and the freeze tickets (server Task 44:
// routes/journal.ts, routes/tickets.ts, readModels/tickets.ts, sql/60-journal.sql). Every mobile test that reads one of these
// answers is only as true as these. No app is mounted: the requests go straight to the stubbed fetch.
import { QUOTES } from '../../../server/content/quotes.ts';
import { newActionId } from '../../shared/api/uuid';
import { breakStreak, fetchMock, giveTickets, installTodayTestEnv, nearLevelUp, seedJournal, world, type JournalRow } from '../dashboard/todayTestKit';

installTodayTestEnv();

const BASE = 'http://localhost:8787/api/v1';
const TODAY = '2026-10-14'; // the stand-in's logical day (a Wednesday); its week starts 2026-10-12
const YESTERDAY = '2026-10-13';
const MONDAY = '2026-10-12';

type Answer = { status: number; json: any };
async function send(method: string, path: string, raw?: string, key = newActionId()): Promise<Answer & { key: string }> {
  const init = { method, headers: { 'Idempotency-Key': key }, ...(raw === undefined ? {} : { body: raw }), signal: new AbortController().signal };
  const response = (await fetchMock(BASE + path, init)) as { status: number; text: () => Promise<string> };
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined, key };
}
const post = (path: string, body: unknown, key?: string) => send('POST', path, body === undefined ? undefined : JSON.stringify(body), key);
const get = (path: string) => send('GET', path);
const write = (body: unknown, key?: string) => post('/journal', { body }, key);
const use = (date: unknown, key?: string) => post('/freeze-tickets/use', { date }, key);
const code = (answer: Answer) => `${answer.status} ${answer.json?.error?.code}`;
const fields = (answer: Answer) => answer.json.error.details.fields;

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const row = (more: Partial<JournalRow> = {}): JournalRow => ({ id: uuid(), createdAt: minutesAgo(5), body: 'Một trang.', quoteCode: 'Q001', logicalDate: YESTERDAY, ...more });

describe('every route is for an onboarded user', () => {
  test('409 ONBOARDING_REQUIRED before anything else, a bad request included', async () => {
    world.me = { ...world.me, progression: null };
    const answers = [await get('/journal?limit=0'), await get(`/journal/${uuid()}`), await write(''), await get('/freeze-tickets'), await use('nope')];
    expect(answers.map(code)).toEqual(Array(5).fill('409 ONBOARDING_REQUIRED'));
  });

  test('the 11th POST /journal of a minute is 429 RATE_LIMITED, refused requests count, and it comes before the onboarding check', async () => {
    for (let calls = 0; calls < 10; calls += 1) expect((await write('   ')).status).toBe(422);
    expect(code(await write('Một trang.'))).toBe('429 RATE_LIMITED');
    world.me = { ...world.me, progression: null };
    expect(code(await write('Một trang.'))).toBe('429 RATE_LIMITED');
    expect(world.journal.rows).toEqual([]);
  });
});

describe('POST /journal', () => {
  test('the body: nothing / not an object 422 on body, then body required, format, min after the trim, max after the trim in code points', async () => {
    expect(fields(await post('/journal', undefined))).toEqual([{ field: 'body', rule: 'required' }]);
    expect(fields(await post('/journal', []))).toEqual([{ field: 'body', rule: 'format' }]);
    expect(fields(await post('/journal', {}))).toEqual([{ field: 'body', rule: 'required' }]);
    expect(fields(await post('/journal', { body: null }))).toEqual([{ field: 'body', rule: 'required' }]);
    expect(fields(await write(5))).toEqual([{ field: 'body', rule: 'format' }]);
    expect(fields(await write(' \n\t '))).toEqual([{ field: 'body', rule: 'min' }]);
    expect(fields(await write('a'.repeat(5001)))).toEqual([{ field: 'body', rule: 'max' }]);
    // code points, not UTF-16 units: 5000 emoji are 10000 units and fit, 5001 do not; the trim comes first
    expect((await write('😀'.repeat(5000))).status).toBe(200);
    expect(fields(await write('😀'.repeat(5001)))).toEqual([{ field: 'body', rule: 'max' }]);
    expect((await write(`  ${'b'.repeat(5000)}  `)).status).toBe(200);
    expect(world.journal.rows).toHaveLength(2); // a refusal leaves no row
  });

  test('the first entry of the day: 200 with the entry (id = the key, trimmed text kept), a quote of the library, 15 XP, the week\'s ticket', async () => {
    const xpBefore = world.me.progression?.xp as number;
    const answer = await write('  Hôm nay mình đã chậm lại.  ');
    expect(answer.status).toBe(200);
    const { entry, quote, xpAwarded, ticket, delta } = answer.json;
    expect(entry.id).toBe(answer.key);
    expect(Date.parse(entry.createdAt)).toBeGreaterThan(Date.now() - 5000);
    expect(QUOTES.some(item => item.code === quote.code && item.text === quote.text && item.author === quote.author)).toBe(true);
    expect([xpAwarded, ticket, delta]).toEqual([15, { outcome: 'GRANTED', available: 1, cap: 2 }, { xp: 15, coin: 0, events: [] }]);
    expect(world.me.progression?.xp).toBe(xpBefore + 15);
    expect(world.journal.rows).toEqual([expect.objectContaining({ id: answer.key, body: 'Hôm nay mình đã chậm lại.', quoteCode: quote.code, logicalDate: TODAY })]);
  });

  test('a second entry the same day pays nothing and the week is decided already', async () => {
    await write('Một.');
    const xpAfterFirst = world.me.progression?.xp;
    const second = await write('Hai.');
    expect([second.json.xpAwarded, second.json.delta.xp, second.json.ticket]).toEqual([0, 0, { outcome: 'ALREADY_DECIDED', available: 1, cap: 2 }]);
    expect(world.me.progression?.xp).toBe(xpAfterFirst);
    // another day's entry pays again
    world.journal.rows = [row({ logicalDate: YESTERDAY })];
    expect((await write('Ba.')).json.xpAwarded).toBe(15);
  });

  test('the XP can level the person up: LEVEL_UP rides in the delta', async () => {
    nearLevelUp(5);
    const { events } = (await write('Một.')).json.delta;
    expect(events).toEqual([expect.objectContaining({ type: 'LEVEL_UP', level: 6 })]);
  });

  test('the weekly ticket: GRANTED below the cap, AT_CAP at it (the week is forfeited for good), the perk raises the cap, a ticket already of this week is the grant', async () => {
    giveTickets(2);
    const full = await write('Một.');
    expect(full.json.ticket).toEqual({ outcome: 'AT_CAP', available: 2, cap: 2 });
    expect(world.tickets.decided).toEqual({ [MONDAY]: false });
    // the decision stands: a ticket used later in the week does not bring the grant back
    world.tickets.list[0].usedFor = TODAY;
    expect((await write('Hai.')).json.ticket).toEqual({ outcome: 'ALREADY_DECIDED', available: 1, cap: 2 });
    expect(world.tickets.list).toHaveLength(2);
  });

  test('TICKET_CAP_PLUS: three places, so the third ticket is granted', async () => {
    giveTickets(2);
    world.shop.unlocked.push({ perk: 'TICKET_CAP_PLUS', cost: 3 });
    expect((await write('Một.')).json.ticket).toEqual({ outcome: 'GRANTED', available: 3, cap: 3 });
  });

  test('a ticket that already belongs to this week is the grant, even at the cap', async () => {
    world.tickets.list.push({ grantWeek: MONDAY, usedFor: null }, { grantWeek: '2026-10-05', usedFor: null });
    expect((await write('Một.')).json.ticket).toEqual({ outcome: 'GRANTED', available: 2, cap: 2 });
    expect(world.tickets.list).toHaveLength(2);
  });

  test('the quote: one not received in the last 30 days; when every one was, the one received longest ago', async () => {
    const codes = QUOTES.map(quote => quote.code);
    // every quote but the last received within 30 days
    world.journal.rows = codes.slice(0, -1).map((quoteCode, at) => row({ quoteCode, createdAt: minutesAgo(10 + at) }));
    expect((await write('Một.')).json.quote.code).toBe(codes.at(-1));
    // now all were received: the oldest of them (the first, 10 minutes ago, is not the oldest; the one with the largest age is)
    world.journal.rows = codes.map((quoteCode, at) => row({ quoteCode, createdAt: minutesAgo(100 - at) }));
    expect((await write('Hai.')).json.quote.code).toBe(codes[0]);
    // one received 31 days ago does not count as recent
    world.journal.rows = codes.map((quoteCode, at) => row({ quoteCode, createdAt: quoteCode === codes[3] ? minutesAgo(31 * 24 * 60) : minutesAgo(10 + at) }));
    expect((await write('Ba.')).json.quote.code).toBe(codes[3]);
  });

  test('the same key and body again is the same answer and one entry; the same key with another body is 409 IDEMPOTENCY_KEY_REUSED; a refusal is not remembered', async () => {
    const first = await write('Một.');
    const again = await write('Một.', first.key);
    expect(again.json).toEqual(first.json);
    expect(world.journal.rows).toHaveLength(1);
    expect(code(await write('Khác.', first.key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    const key = newActionId();
    expect((await write('', key)).status).toBe(422);
    expect((await write('Đã sửa.', key)).status).toBe(200);
  });

  test('a key that is already an entry (its stored answer gone) is 409 IDEMPOTENCY_KEY_REUSED and writes nothing', async () => {
    const taken = row({ createdAt: minutesAgo(60 * 24 * 40) });
    seedJournal([taken]);
    expect(code(await write('Một.', taken.id))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    expect(world.journal.rows).toEqual([taken]);
  });
});

describe('GET /journal', () => {
  test('limit 1..50 first (format, min, max), then before as a UUID: 422 with the field', async () => {
    expect(fields(await get('/journal?limit=x&before=nope'))).toEqual([{ field: 'limit', rule: 'format' }]);
    expect(fields(await get('/journal?limit=0'))).toEqual([{ field: 'limit', rule: 'min' }]);
    expect(fields(await get('/journal?limit=51'))).toEqual([{ field: 'limit', rule: 'max' }]);
    expect(fields(await get('/journal?before=nope'))).toEqual([{ field: 'before', rule: 'format' }]);
    expect(fields(await get('/journal?before='))).toEqual([{ field: 'before', rule: 'format' }]);
    expect((await get('/journal?limit=50')).status).toBe(200);
  });

  test('no entry: an empty page, no cursor (not an error, not a refusal)', async () => {
    expect((await get('/journal')).json).toEqual({ entries: [], nextBefore: null });
  });

  test('newest first, an equal time broken by the larger id; the preview is the first 80 code points; only the caller\'s own entries', async () => {
    const at = minutesAgo(10);
    const a = row({ id: '00000000-0000-4000-8000-0000000000aa', createdAt: at, body: '😀'.repeat(100) });
    const b = row({ id: '00000000-0000-4000-8000-0000000000bb', createdAt: at, body: 'Bằng nhau.' });
    const newest = row({ createdAt: minutesAgo(1), body: 'Mới nhất.' });
    const stranger = row({ createdAt: minutesAgo(0), owner: '00000000-0000-4000-9000-000000000009', body: 'Của người khác.' });
    seedJournal([a, newest, stranger, b]);
    const { entries } = (await get('/journal')).json;
    expect(entries.map((entry: { id: string }) => entry.id)).toEqual([newest.id, b.id, a.id]);
    expect(entries[2]).toEqual({ id: a.id, createdAt: at, preview: '😀'.repeat(80), quoteCode: 'Q001' });
    expect(JSON.stringify(entries)).not.toContain('Của người khác');
  });

  test('paging by the cursor: nextBefore is the id of the last row of a page when more follow, null on the last; exactly the limit is a last page', async () => {
    const rows = [1, 2, 3].map(age => row({ createdAt: minutesAgo(age * 10) }));
    seedJournal(rows);
    const first = (await get('/journal?limit=2')).json;
    expect([first.entries.map((entry: { id: string }) => entry.id), first.nextBefore]).toEqual([[rows[0].id, rows[1].id], rows[1].id]);
    const second = (await get(`/journal?limit=2&before=${first.nextBefore}`)).json;
    expect([second.entries.map((entry: { id: string }) => entry.id), second.nextBefore]).toEqual([[rows[2].id], null]);
    expect((await get('/journal?limit=3')).json.nextBefore).toBeNull();
  });

  test('an entry the server cannot open is left out of the page but not of the count: a short page can still have a cursor', async () => {
    const rows = [1, 2, 3].map(age => row({ createdAt: minutesAgo(age * 10), corrupt: age === 1 }));
    seedJournal(rows);
    const first = (await get('/journal?limit=2')).json;
    expect(first.entries.map((entry: { id: string }) => entry.id)).toEqual([rows[1].id]);
    expect(first.nextBefore).toBe(rows[1].id);
    expect((await get(`/journal?limit=2&before=${first.nextBefore}`)).json.entries.map((entry: { id: string }) => entry.id)).toEqual([rows[2].id]);
    // a whole page of them is an empty page with a cursor
    world.journal.rows = [1, 2, 3].map(age => row({ createdAt: minutesAgo(age * 10), corrupt: age < 3 }));
    const empty = (await get('/journal?limit=2')).json;
    expect([empty.entries, empty.nextBefore]).toEqual([[], world.journal.rows[1].id]);
  });

  test('a cursor that is not one of the caller\'s entries gives an empty page, not an error', async () => {
    const stranger = row({ owner: '00000000-0000-4000-9000-000000000009' });
    seedJournal([row(), stranger]);
    expect((await get(`/journal?before=${uuid()}`)).json).toEqual({ entries: [], nextBefore: null });
    expect((await get(`/journal?before=${stranger.id}`)).json).toEqual({ entries: [], nextBefore: null });
  });
});

describe('GET /journal/{id}', () => {
  test('the entry whole, with its quote', async () => {
    const mine = row({ body: 'Cả trang.\nHai dòng.', quoteCode: 'Q002' });
    seedJournal([mine]);
    const quote = QUOTES.find(item => item.code === 'Q002');
    expect(await get(`/journal/${mine.id}`)).toMatchObject({ status: 200, json: { id: mine.id, createdAt: mine.createdAt, body: 'Cả trang.\nHai dòng.', quote: { code: 'Q002', text: quote?.text, author: quote?.author ?? null } } });
  });

  test('422 for an id that is not a UUID, 404 NOT_FOUND for an unknown one and for another account\'s (the same answer), 500 INTERNAL for one that does not open', async () => {
    const stranger = row({ owner: '00000000-0000-4000-9000-000000000009' });
    const broken = row({ corrupt: true });
    seedJournal([stranger, broken]);
    expect(fields(await get('/journal/nope'))).toEqual([{ field: 'id', rule: 'format' }]);
    expect([await get(`/journal/${uuid()}`), await get(`/journal/${stranger.id}`)].map(code)).toEqual(['404 NOT_FOUND', '404 NOT_FOUND']);
    expect(code(await get(`/journal/${broken.id}`))).toBe('500 INTERNAL');
  });
});

describe('GET /freeze-tickets', () => {
  test('the whole answer for today only (the evening): the server\'s clock, the tickets, the one eligible date with its deadline and preview, the profile', async () => {
    giveTickets(1);
    const answer = await get('/freeze-tickets');
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      serverTime: '2026-10-14T12:00:00.000Z', // 19:00 in Asia/Ho_Chi_Minh
      available: 1,
      cap: 2,
      eligible: [{ date: TODAY, target: 'TODAY', deadline: '2026-10-15T08:00:00.000Z', needed: true, withoutTicket: 0, withTicket: 4, alreadyUsed: false }],
      progression: world.me.progression,
    });
  });

  test('yesterday is eligible from 03:00 to 15:00 only, today always, newest first; the deadline is 15:00 of the day after the date', async () => {
    const datesAt = async (hour: number) => {
      world.hour = hour;
      return (await get('/freeze-tickets')).json.eligible.map((entry: { date: string; target: string }) => `${entry.target} ${entry.date}`);
    };
    expect(await datesAt(2)).toEqual([`TODAY ${TODAY}`]); // 02:00 is still the logical day of yesterday's calendar date
    expect(await datesAt(3)).toEqual([`TODAY ${TODAY}`, `YESTERDAY ${YESTERDAY}`]);
    expect(await datesAt(14)).toEqual([`TODAY ${TODAY}`, `YESTERDAY ${YESTERDAY}`]);
    expect(await datesAt(15)).toEqual([`TODAY ${TODAY}`]);
    world.hour = 9;
    world.tickets.minute = 20;
    const { serverTime, eligible } = (await get('/freeze-tickets')).json;
    expect(serverTime).toBe('2026-10-14T02:20:00.000Z');
    expect(eligible.map((entry: { deadline: string }) => entry.deadline)).toEqual(['2026-10-15T08:00:00.000Z', '2026-10-14T08:00:00.000Z']);
    // the hour after midnight belongs to the logical day that began the day before: its clock is the next calendar day
    world.hour = 2;
    world.tickets.minute = 0;
    expect((await get('/freeze-tickets')).json.serverTime).toBe('2026-10-14T19:00:00.000Z');
  });

  test('needed and the numbers: an open day with a streak, a streak of 0, a finished story', async () => {
    const today = async () => (await get('/freeze-tickets')).json.eligible[0];
    expect(await today()).toMatchObject({ needed: true, withoutTicket: 0, withTicket: 4 });
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), streakCurrent: 0 } };
    expect(await today()).toMatchObject({ needed: false, withoutTicket: 0, withTicket: 0 });
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), streakCurrent: 4 } };
    world.day = { ...world.day, quests: world.day.quests.map(quest => (quest.category === 'STORY' ? { ...quest, completed: true } : quest)), story: { done: 2, total: 2 } };
    expect(await today()).toMatchObject({ needed: false });
  });

  test('between 03:00 and the day-close both dates can be eligible: with yesterday still open and missed, today protects nothing but yesterday is needed', async () => {
    world.hour = 9;
    world.tickets.closed = '2026-10-12'; // the close has not run for yesterday yet
    const { eligible } = (await get('/freeze-tickets')).json;
    expect(eligible).toEqual([
      // the streak the close leaves after a missed yesterday is 0
      expect.objectContaining({ date: TODAY, target: 'TODAY', needed: false, withoutTicket: 0, withTicket: 0 }),
      expect.objectContaining({ date: YESTERDAY, target: 'YESTERDAY', needed: true, withoutTicket: 0, withTicket: 4 }),
    ]);
    // yesterday finished: nothing to protect there, and today counts the streak it brought
    world.tickets.stories[YESTERDAY] = true;
    expect((await get('/freeze-tickets')).json.eligible).toEqual([
      expect.objectContaining({ date: TODAY, needed: true, withoutTicket: 0, withTicket: 5 }),
      expect.objectContaining({ date: YESTERDAY, needed: false }),
    ]);
  });

  test('a closed yesterday that broke the streak: needed, the preview is the break (the streak before it comes back); today then has 0 to protect', async () => {
    world.hour = 9;
    breakStreak(12);
    const { eligible } = (await get('/freeze-tickets')).json;
    expect(eligible).toEqual([
      expect.objectContaining({ date: TODAY, needed: false, withoutTicket: 0, withTicket: 0 }),
      expect.objectContaining({ date: YESTERDAY, needed: true, withoutTicket: 0, withTicket: 12 }),
    ]);
  });
});

describe('POST /freeze-tickets/use', () => {
  test('the body: nothing / not an object, date required, a date that is a string and a calendar date', async () => {
    expect(fields(await post('/freeze-tickets/use', undefined))).toEqual([{ field: 'body', rule: 'required' }]);
    expect(fields(await post('/freeze-tickets/use', []))).toEqual([{ field: 'body', rule: 'format' }]);
    expect(fields(await post('/freeze-tickets/use', {}))).toEqual([{ field: 'date', rule: 'required' }]);
    expect(fields(await use(null))).toEqual([{ field: 'date', rule: 'required' }]);
    expect(fields(await use(''))).toEqual([{ field: 'date', rule: 'required' }]);
    expect(fields(await use(20261014))).toEqual([{ field: 'date', rule: 'format' }]);
    // not a string is a bad format even when it is falsy (routes/tickets.ts checks the type before it asks for the date)
    for (const falsy of [0, false]) expect(fields(await use(falsy))).toEqual([{ field: 'date', rule: 'format' }]);
    expect(fields(await use([]))).toEqual([{ field: 'date', rule: 'format' }]);
    expect(fields(await use('2026-02-30'))).toEqual([{ field: 'date', rule: 'format' }]);
    expect(fields(await use('0000-01-01'))).toEqual([{ field: 'date', rule: 'format' }]);
  });

  test('the refusals in the server\'s order: not eligible, already used, no ticket, not needed (all 409)', async () => {
    // not eligible comes first, even with no ticket and nothing to protect
    expect(code(await use(YESTERDAY))).toBe('409 TICKET_DATE_NOT_ELIGIBLE'); // 19:00: yesterday is out of its window
    expect(code(await use('2026-10-15'))).toBe('409 TICKET_DATE_NOT_ELIGIBLE');
    // no ticket before not needed
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), streakCurrent: 0 } };
    expect(code(await use(TODAY))).toBe('409 NO_TICKET');
    giveTickets(1);
    expect(code(await use(TODAY))).toBe('409 TICKET_NOT_NEEDED');
    expect(world.tickets.list.map(ticket => ticket.usedFor)).toEqual([null]);
    // already used before no ticket: the only ticket goes to today, and today again says so
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), streakCurrent: 4 } };
    expect((await use(TODAY)).status).toBe(200);
    expect(code(await use(TODAY))).toBe('409 TICKET_ALREADY_USED_FOR_DATE');
  });

  test('today: the oldest ticket gets the date, the answer is the tickets as they now are; the day stays open and the streak waits for the close', async () => {
    giveTickets(2);
    const answer = await use(TODAY);
    expect(answer.status).toBe(200);
    expect(answer.json.available).toBe(1);
    expect(answer.json.eligible).toEqual([expect.objectContaining({ date: TODAY, alreadyUsed: true })]);
    expect(world.tickets.list.map(ticket => ticket.usedFor)).toEqual([TODAY, null]);
    expect(world.me.progression?.streakCurrent).toBe(4);
    expect((await get(`/day/history/${TODAY}`)).json.summary.outcome).toBe('OPEN');
  });

  test('yesterday still open: the ticket marks it, and today is judged on the streak that survives', async () => {
    world.hour = 9;
    world.tickets.closed = '2026-10-12';
    giveTickets(1);
    expect((await use(YESTERDAY)).status).toBe(200);
    const { eligible } = (await get('/freeze-tickets')).json;
    expect(eligible).toEqual([
      expect.objectContaining({ date: TODAY, needed: true, withTicket: 4, alreadyUsed: false }),
      expect.objectContaining({ date: YESTERDAY, alreadyUsed: true }),
    ]);
  });

  test('a closed day that broke the streak is rescued: the streak before the break is back, the break is gone, the day is FROZEN in the history', async () => {
    world.hour = 9;
    breakStreak(12);
    giveTickets(1);
    expect((await get(`/day/history/${YESTERDAY}`)).json.summary.outcome).toBe('NONE');
    const answer = await use(YESTERDAY);
    expect(answer.status).toBe(200);
    expect(answer.json.progression).toMatchObject({ streakCurrent: 12, lastOutcome: 'FROZEN', breakNotice: null });
    expect(world.tickets).toMatchObject({ breakDate: null, beforeBreak: null, missedRun: 0 });
    expect((await get(`/day/history/${YESTERDAY}`)).json.summary.outcome).toBe('FROZEN');
    expect(code(await use(YESTERDAY))).toBe('409 TICKET_ALREADY_USED_FOR_DATE');
  });

  test('the same key again is the same answer and one ticket; a refusal is not remembered', async () => {
    giveTickets(2);
    const first = await use(TODAY);
    const again = await use(TODAY, first.key);
    expect(again.json).toEqual(first.json);
    expect(world.tickets.list.filter(ticket => ticket.usedFor !== null)).toHaveLength(1);
    expect(code(await use(TODAY))).toBe('409 TICKET_ALREADY_USED_FOR_DATE');
  });
});
