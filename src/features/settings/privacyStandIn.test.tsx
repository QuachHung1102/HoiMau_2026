// The stand-in server of todayTestKit against what the real routes answer for the export and the deletion (server Task 46:
// routes/privacy.ts, readModels/export.ts, sql/61-privacy.sql; the order of the refusals is app.ts). Every mobile test of S44 and S52
// is only as true as these. No app is mounted: the requests go straight to the stubbed fetch.
import { LIMITS } from '../../../domain/validation.ts';
import { newActionId } from '../../shared/api/uuid';
import { fetchMock, installTodayTestEnv, world } from '../dashboard/todayTestKit';

installTodayTestEnv();

const BASE = 'http://localhost:8787/api/v1';
type Answer = { status: number; json: any };
async function send(method: string, path: string, raw?: string, headers: Record<string, string> = { 'Idempotency-Key': newActionId() }): Promise<Answer> {
  const init = { method, headers, ...(raw === undefined ? {} : { body: raw }), signal: new AbortController().signal };
  const response = (await fetchMock(BASE + path, init)) as { status: number; text: () => Promise<string> };
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}
const exportMine = () => send('GET', '/me/export', undefined, {});
const remove = (password: unknown, key?: string) => send('POST', '/me/delete', JSON.stringify({ password }), key ? { 'Idempotency-Key': key } : undefined);
const code = (answer: Answer) => `${answer.status} ${answer.json?.error?.code}`;
const fields = (answer: Answer) => answer.json.error.details.fields;
const PASSWORD = 'mat-khau-dung-1';
const WRONG = 'mat-khau-sai-9';

describe('GET /me/export', () => {
  test('200 with the document: format 1, the instant, the rows by table name', async () => {
    const answer = await exportMine();
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual(world.privacy.document);
    expect(answer.json.formatVersion).toBe(1);
    expect(Object.keys(answer.json.data)).toEqual(expect.arrayContaining(['users', 'journal_entries']));
  });

  test('five an hour: the sixth is 429 RATE_LIMITED and a refused request counts too', async () => {
    const answers = [];
    for (let n = 0; n < 7; n += 1) answers.push(code(await exportMine()));
    expect(answers).toEqual([...Array(5).fill('200 undefined'), '429 RATE_LIMITED', '429 RATE_LIMITED']);
  });

  test('the limit is counted before the onboarding check, as app.ts does', async () => {
    world.me = { ...world.me, progression: null };
    world.privacy.exportCalls = Array(5).fill(Date.now());
    expect(code(await exportMine())).toBe('429 RATE_LIMITED');
  });

  test('a window that is over lets the next one through', async () => {
    world.privacy.exportCalls = Array(5).fill(Date.now() - 61 * 60_000);
    expect((await exportMine()).status).toBe(200);
  });

  test('not onboarded: 409 ONBOARDING_REQUIRED', async () => {
    world.me = { ...world.me, progression: null };
    expect(code(await exportMine())).toBe('409 ONBOARDING_REQUIRED');
  });
});

describe('POST /me/delete', () => {
  test('the Idempotency-Key is read first: missing is 400, not a UUID is 422 on the header, both before the password', async () => {
    expect(code(await send('POST', '/me/delete', '{}', {}))).toBe('400 IDEMPOTENCY_KEY_REQUIRED');
    const badKey = await send('POST', '/me/delete', '{}', { 'Idempotency-Key': 'not-a-uuid' });
    expect(code(badKey)).toBe('422 VALIDATION_FAILED');
    expect(fields(badKey)).toEqual([{ field: 'Idempotency-Key', rule: 'format' }]);
  });

  test('the password: nothing, empty or not text is 422 required; U+0000 is format; more than the maximum (in letters) is max', async () => {
    for (const body of [undefined, '', null, 7, ['x']]) {
      const answer = await remove(body);
      expect([code(answer), fields(answer)]).toEqual(['422 VALIDATION_FAILED', [{ field: 'password', rule: 'required' }]]);
    }
    expect(fields(await remove(`a${String.fromCharCode(0)}b`))).toEqual([{ field: 'password', rule: 'format' }]);
    expect(fields(await remove('a'.repeat(LIMITS.password.max + 1)))).toEqual([{ field: 'password', rule: 'max' }]);
    expect(code(await remove('a'.repeat(LIMITS.password.max)))).toBe('401 INVALID_CREDENTIALS');
    expect(world.privacy.deleted).toBe(false);
  });

  test('a wrong password is 401 INVALID_CREDENTIALS, the account stays, and the same key may be used again (only a 2xx is remembered)', async () => {
    const key = newActionId();
    expect(code(await remove(WRONG, key))).toBe('401 INVALID_CREDENTIALS');
    expect(world.privacy.deleted).toBe(false);
    expect((await remove(PASSWORD, key)).status).toBe(204);
  });

  test('the sixth attempt of fifteen minutes is 401 even with the right password; an attempt older than that no longer counts', async () => {
    const results: string[] = [];
    for (let n = 0; n < 5; n += 1) results.push(code(await remove(WRONG)));
    results.push(code(await remove(PASSWORD)));
    expect(results).toEqual(Array(6).fill('401 INVALID_CREDENTIALS'));
    expect(world.privacy.deleted).toBe(false);
    world.privacy.attempts = world.privacy.attempts.map(at => at - 16 * 60_000);
    expect((await remove(PASSWORD)).status).toBe(204);
  });

  test('204 with no body; the password is compared as NFC, as a login does', async () => {
    world.privacy.password = 'Mật-khẩu-1';
    const answer = await remove('Mật-khẩu-1'.normalize('NFD'));
    expect([answer.status, answer.json]).toEqual([204, undefined]);
    expect(world.privacy.deleted).toBe(true);
  });

  test('it needs a session, not an onboarded profile', async () => {
    world.me = { ...world.me, progression: null };
    expect((await remove(PASSWORD)).status).toBe(204);
  });

  test('the limit of the account: the 11th request of a minute is 429, before the password is looked at', async () => {
    const answers: string[] = [];
    for (let n = 0; n < 11; n += 1) answers.push(code(await remove(n === 10 ? '' : WRONG)));
    expect(answers.slice(0, 5)).toEqual(Array(5).fill('401 INVALID_CREDENTIALS'));
    expect(answers[10]).toBe('429 RATE_LIMITED');
  });

  test('after 204 every session is revoked: any route that needs one is 401 SESSION_INVALID (a write is judged on its key first), the same key included; the timezone list needs none', async () => {
    const key = newActionId();
    expect((await remove(PASSWORD, key)).status).toBe(204);
    expect(code(await remove(PASSWORD, key))).toBe('401 SESSION_INVALID');
    expect(code(await exportMine())).toBe('401 SESSION_INVALID');
    expect(code(await send('GET', '/me', undefined, {}))).toBe('401 SESSION_INVALID');
    expect(code(await send('POST', '/me/delete', '{}', {}))).toBe('400 IDEMPOTENCY_KEY_REQUIRED');
    expect((await send('GET', '/meta/timezones', undefined, {})).status).toBe(200);
  });
});
