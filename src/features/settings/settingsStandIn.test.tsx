// The stand-in server of todayTestKit against what the real routes answer for the settings and the profile (server Task 14:
// routes/settings.ts, routes/me.ts, readModels/me.ts, sql/21-profile.sql; routes/meta.ts). Every mobile test that reads one of these
// answers is only as true as these. No app is mounted: the requests go straight to the stubbed fetch.
import { calculatePrescription } from '../../../domain/energy.ts';
import { ageFrom } from '../../../domain/validation.ts';
import { newActionId } from '../../shared/api/uuid';
import { fetchMock, installTodayTestEnv, meOf, settingsOf, world } from '../dashboard/todayTestKit';
import { ZONES } from '../onboarding/onboardingTestKit';

installTodayTestEnv();

const BASE = 'http://localhost:8787/api/v1';
const DAY = 24 * 60 * 60 * 1000;

type Answer = { status: number; json: any };
async function send(method: string, path: string, raw?: string, headers: Record<string, string> = { 'Idempotency-Key': newActionId() }): Promise<Answer> {
  const init = { method, headers, ...(raw === undefined ? {} : { body: raw }), signal: new AbortController().signal };
  const response = (await fetchMock(BASE + path, init)) as { status: number; text: () => Promise<string> };
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}
const patch = (path: string, body: unknown, key?: string) => send('PATCH', path, JSON.stringify(body), key ? { 'Idempotency-Key': key } : undefined);
const post = (path: string, body: unknown, key?: string) => send('POST', path, JSON.stringify(body), key ? { 'Idempotency-Key': key } : undefined);
const get = (path: string) => send('GET', path, undefined, {});
const code = (answer: Answer) => `${answer.status} ${answer.json?.error?.code}`;
const fields = (answer: Answer) => answer.json.error.details.fields;
const only = (field: string, rule: string) => [{ field, rule }];

const bio = { heightCm: 170, weightKg: 65, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT' } as const;
const LIGHT_KG = 50; // 170 cm: BMI 17.3, ASSASSIN is ruled out
const year = new Date().getFullYear();
const noCooldown = () => {
  world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: null } };
};
const cooldownOver = () => {
  world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: new Date(Date.now() - DAY).toISOString() } };
};

describe('every route is for an onboarded user', () => {
  test('409 ONBOARDING_REQUIRED before anything is judged, a bad body included', async () => {
    world.me = { ...world.me, progression: null };
    const answers = [
      await get('/settings'),
      await patch('/settings', { motion: 'LOUD' }),
      await get('/me/prescription'),
      await patch('/me', { displayName: '' }),
      await post('/me/biometrics', {}),
      await patch('/me/archetype', {}),
    ];
    expect(answers.map(code)).toEqual(Array(6).fill('409 ONBOARDING_REQUIRED'));
  });

  test('the Idempotency-Key is read first: missing is 400 IDEMPOTENCY_KEY_REQUIRED, not a UUID is 422 on the header, both before the onboarding check', async () => {
    world.me = { ...world.me, progression: null };
    for (const [path, method] of [['/settings', 'PATCH'], ['/me', 'PATCH'], ['/me/biometrics', 'POST'], ['/me/archetype', 'PATCH']] as const) {
      expect(code(await send(method, path, '{}', {}))).toBe('400 IDEMPOTENCY_KEY_REQUIRED');
      expect(code(await send(method, path, '{}', { 'Idempotency-Key': '' }))).toBe('400 IDEMPOTENCY_KEY_REQUIRED');
      const badKey = await send(method, path, '{}', { 'Idempotency-Key': 'not-a-uuid' });
      expect(code(badKey)).toBe('422 VALIDATION_FAILED');
      expect(fields(badKey)).toEqual(only('Idempotency-Key', 'format'));
    }
  });

  test('GET /meta/timezones needs no sign-in and answers the list the pickers are given', async () => {
    world.me = { ...world.me, progression: null };
    const answer = await get('/meta/timezones');
    expect([answer.status, answer.json]).toEqual([200, { zones: ZONES }]);
  });
});

describe('PATCH /settings', () => {
  test('GET answers the settings; each member changes alone or several at once, the rest stay, and the answer is the whole row', async () => {
    expect((await get('/settings')).json).toEqual(settingsOf());
    const one = await patch('/settings', { reminderEnabled: true });
    expect([one.status, one.json]).toEqual([200, settingsOf({ reminderEnabled: true })]);
    const two = await patch('/settings', { reminderWindow: 'MORNING', motion: 'REDUCED', hideStreak: true, nudgesEnabled: false });
    expect(two.json).toEqual(settingsOf({ reminderEnabled: true, reminderWindow: 'MORNING', motion: 'REDUCED', hideStreak: true, nudgesEnabled: false }));
    expect((await get('/settings')).json).toEqual(two.json);
  });

  test('a wrong member is named (every wrong one, in the route order); nothing is written; soundEnabled is refused whatever its value', async () => {
    const answer = await patch('/settings', { nudgesEnabled: 'yes', reminderEnabled: 1, reminderWindow: 'NIGHT', hideStreak: null, motion: 'LOUD', soundEnabled: false, excludedMealTags: 'x' });
    expect(code(answer)).toBe('422 VALIDATION_FAILED');
    expect(fields(answer)).toEqual([
      { field: 'nudgesEnabled', rule: 'format' },
      { field: 'reminderEnabled', rule: 'format' },
      { field: 'reminderWindow', rule: 'enum' },
      { field: 'hideStreak', rule: 'format' },
      { field: 'soundEnabled', rule: 'format' },
      { field: 'motion', rule: 'enum' },
      { field: 'excludedMealTags', rule: 'format' },
    ]);
    expect(code(await patch('/settings', { soundEnabled: true }))).toBe('422 VALIDATION_FAILED');
    expect((await get('/settings')).json).toEqual(settingsOf());
  });

  test('nothing, an array and a member the server does not know change nothing and are 200', async () => {
    for (const body of [{}, [], { colour: 'red', xp: 5 }]) expect([(await patch('/settings', body)).status, world.settings]).toEqual([200, settingsOf()]);
    expect((await send('PATCH', '/settings')).status).toBe(200);
  });

  test('the same key is answered again without applying it twice, the same key for another body is 409 IDEMPOTENCY_KEY_REUSED, a refusal is not remembered', async () => {
    const key = newActionId();
    const first = await patch('/settings', { reminderEnabled: true }, key);
    world.settings = settingsOf({ reminderEnabled: false }); // something else changed it since
    const again = await patch('/settings', { reminderEnabled: true }, key);
    expect([again.status, again.json]).toEqual([first.status, first.json]);
    expect(world.settings.reminderEnabled).toBe(false);
    expect(code(await patch('/settings', { reminderEnabled: false }, key))).toBe('409 IDEMPOTENCY_KEY_REUSED');
    const refused = newActionId();
    expect(code(await patch('/settings', { motion: 'LOUD' }, refused))).toBe('422 VALIDATION_FAILED');
    expect((await patch('/settings', { motion: 'FULL' }, refused)).status).toBe(200);
  });
});

describe('PATCH /me', () => {
  test('the name (trimmed) and the zone change, each alone or both; nothing, and members it does not know, change nothing; the answer is Me', async () => {
    const named = await patch('/me', { displayName: '  Lan Anh  ' });
    expect([named.status, named.json.user.displayName, named.json.user.timezone]).toEqual([200, 'Lan Anh', 'Asia/Ho_Chi_Minh']);
    expect((await patch('/me', { timezone: 'Europe/Paris' })).json.user).toMatchObject({ displayName: 'Lan Anh', timezone: 'Europe/Paris' });
    expect((await patch('/me', { displayName: 'Minh', timezone: 'UTC' })).json.user).toMatchObject({ displayName: 'Minh', timezone: 'UTC' });
    const unknown = await patch('/me', { email: 'x@y.vn', archetype: 'ASSASSIN', onboarded: false, xp: 100000 });
    expect([unknown.status, unknown.json]).toEqual([200, world.me]);
    expect(world.me.user).toMatchObject({ displayName: 'Minh', timezone: 'UTC', archetype: 'TANKER', onboarded: true, email: meOf().user.email });
    expect((await patch('/me', {})).status).toBe(200);
  });

  test('the rules of a name, a zone the list does not have, banned wording judged last, and several wrong members named together', async () => {
    const nameRule = (rule: string) => only('displayName', rule);
    const cases: [unknown, string, unknown?][] = [
      [{ displayName: '' }, '422 VALIDATION_FAILED', nameRule('required')],
      [{ displayName: '   ' }, '422 VALIDATION_FAILED', nameRule('required')],
      [{ displayName: null }, '422 VALIDATION_FAILED', nameRule('required')],
      [{ displayName: 7 }, '422 VALIDATION_FAILED', nameRule('required')],
      [{ displayName: 'x'.repeat(41) }, '422 VALIDATION_FAILED', nameRule('max')],
      [{ displayName: 'Lan­Anh' }, '422 VALIDATION_FAILED', nameRule('format')],
      [{ displayName: '🦊' }, '422 VALIDATION_FAILED', nameRule('format')],
      [{ displayName: 'Kẻ lười' }, '422 NAME_NOT_ALLOWED'],
      [{ timezone: 'Mars/Olympus_Mons' }, '422 VALIDATION_FAILED', only('timezone', 'format')],
      // Intl reads it, the server's list does not have it
      [{ timezone: 'CET' }, '422 VALIDATION_FAILED', only('timezone', 'format')],
      [{ timezone: 'America/New_York' }, '422 VALIDATION_FAILED', only('timezone', 'format')],
      [{ timezone: '' }, '422 VALIDATION_FAILED', only('timezone', 'required')],
      [{ timezone: null }, '422 VALIDATION_FAILED', only('timezone', 'required')],
      [{ displayName: 'Kẻ lười', timezone: 'Nowhere' }, '422 VALIDATION_FAILED', only('timezone', 'format')],
      [{ displayName: '', timezone: 'Nowhere' }, '422 VALIDATION_FAILED', [...nameRule('required'), ...only('timezone', 'format')]],
    ];
    for (const [body, expected, details] of cases) {
      const answer = await patch('/me', body);
      expect([JSON.stringify(body), code(answer)]).toEqual([JSON.stringify(body), expected]);
      if (details) expect(fields(answer)).toEqual(details);
    }
    expect(world.me.user).toMatchObject({ displayName: 'An', timezone: 'Asia/Ho_Chi_Minh' });
    // 40 code points as the database counts them: a letter and 39 emoji are 79 UTF-16 units and fit, one more does not
    const longest = `A${'🦊'.repeat(39)}`;
    expect((await patch('/me', { displayName: longest })).json.user.displayName).toBe(longest);
    expect(fields(await patch('/me', { displayName: `${longest}🦊` }))).toEqual(nameRule('max'));
  });
});

describe('GET /me/prescription and POST /me/biometrics', () => {
  test('the targets in effect, the direction they were computed for and the latest measurements; the numbers are the domain\'s', async () => {
    const answer = await get('/me/prescription');
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({
      ...calculatePrescription({ ...bio, ageYears: ageFrom(bio.birthYear, Date.now(), 'Asia/Ho_Chi_Minh'), archetype: 'TANKER' }),
      computedAt: expect.any(String),
      archetype: 'TANKER',
      biometrics: bio,
    });
  });

  test('new numbers replace the measurements and the targets; the answer is what GET reads afterwards; the direction in effect stays and no cooldown starts', async () => {
    const heavier = { ...bio, weightKg: 70.5, activityLevel: 'MODERATE' };
    const before = world.me.user.archetypeChangeAvailableAt;
    const answer = await post('/me/biometrics', heavier);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ archetype: 'TANKER', biometrics: heavier, ...calculatePrescription({ ...heavier, ageYears: ageFrom(heavier.birthYear, Date.now(), 'Asia/Ho_Chi_Minh'), archetype: 'TANKER' }) });
    expect((await get('/me/prescription')).json).toEqual(answer.json);
    expect(world.me.user).toMatchObject({ archetype: 'TANKER', archetypeChangeAvailableAt: before });
  });

  test('refusals: every wrong member in one 422 (the direction first), else AGE_NOT_ALLOWED, else ARCHETYPE_NOT_ALLOWED; nothing is written', async () => {
    const before = JSON.stringify(world.profile);
    const cases: [unknown, string, unknown?][] = [
      [{ birthYear: year - 10 }, '422 AGE_NOT_ALLOWED'],
      [{ birthYear: year - 91 }, '422 VALIDATION_FAILED', only('birthYear', 'min')],
      [{ heightCm: 119.9 }, '422 VALIDATION_FAILED', only('heightCm', 'min')],
      [{ weightKg: 250.1 }, '422 VALIDATION_FAILED', only('weightKg', 'max')],
      [{ sex: 'OTHER' }, '422 VALIDATION_FAILED', only('sex', 'enum')],
      [{ activityLevel: undefined }, '422 VALIDATION_FAILED', only('activityLevel', 'required')],
      [{ heightCm: '170' }, '422 VALIDATION_FAILED', only('heightCm', 'required')],
      [{ archetype: 'MAGE' }, '422 VALIDATION_FAILED', only('archetype', 'enum')],
      [{ archetype: 'MAGE', birthYear: year - 10, heightCm: 500 }, '422 VALIDATION_FAILED', [...only('archetype', 'enum'), ...only('heightCm', 'max')]],
      [{ birthYear: year - 10, archetype: 'ASSASSIN', weightKg: LIGHT_KG }, '422 AGE_NOT_ALLOWED'],
      [{ archetype: 'ASSASSIN', weightKg: LIGHT_KG }, '422 ARCHETYPE_NOT_ALLOWED', { allowed: ['TANKER', 'SUPPORTER'] }],
    ];
    for (const [over, expected, details] of cases) {
      const answer = await post('/me/biometrics', { ...bio, ...(over as object) });
      expect([JSON.stringify(over), code(answer)]).toEqual([JSON.stringify(over), expected]);
      if (Array.isArray(details)) expect(fields(answer)).toEqual(details);
      else if (details) expect(answer.json.error.details).toEqual(details);
    }
    expect(JSON.stringify(world.profile)).toBe(before);
    const empty = await post('/me/biometrics', [bio]);
    expect(fields(empty).map((item: { field: string }) => item.field)).toEqual(['heightCm', 'weightKg', 'birthYear', 'sex', 'activityLevel']);
  });

  test('numbers that rule the direction in effect out: 422 with what is allowed, then accepted with a replacement, which starts a new cooldown', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetype: 'ASSASSIN' } };
    world.profile = { ...world.profile, prescription: calculatePrescription({ ...bio, ageYears: 25, archetype: 'ASSASSIN' }) };
    const lighter = { ...bio, weightKg: LIGHT_KG };
    const refused = await post('/me/biometrics', lighter);
    expect([code(refused), refused.json.error.details]).toEqual(['422 ARCHETYPE_NOT_ALLOWED', { allowed: ['TANKER', 'SUPPORTER'] }]);
    expect(world.profile.biometrics).toEqual(bio);
    const before = Date.now();
    const done = await post('/me/biometrics', { ...lighter, archetype: 'SUPPORTER' });
    expect([done.status, done.json.archetype]).toEqual([200, 'SUPPORTER']);
    expect(world.me.user.archetype).toBe('SUPPORTER');
    const opens = Date.parse(world.me.user.archetypeChangeAvailableAt as string);
    expect(opens - before).toBeGreaterThanOrEqual(14 * DAY);
    expect(opens - Date.now()).toBeLessThanOrEqual(14 * DAY);
  });

  test('a direction sent along with numbers that still allow the current one is not applied: the cooldown cannot be walked around', async () => {
    const before = world.me.user.archetypeChangeAvailableAt;
    const answer = await post('/me/biometrics', { ...bio, weightKg: 66, archetype: 'SUPPORTER' });
    expect([answer.status, answer.json.archetype]).toEqual([200, 'TANKER']);
    expect(world.me.user).toMatchObject({ archetype: 'TANKER', archetypeChangeAvailableAt: before });
  });
});

describe('PATCH /me/archetype', () => {
  test('the member: nothing, null, a name that is none, an array, a body that is not an object: 422 on archetype', async () => {
    for (const [body, rule] of [[{}, 'required'], [{ archetype: null }, 'required'], [{ archetype: 'MAGE' }, 'enum'], [{ archetype: ['TANKER'] }, 'enum'], [['TANKER'], 'required']] as const) {
      const answer = await patch('/me/archetype', body);
      expect([code(answer), fields(answer)]).toEqual(['422 VALIDATION_FAILED', only('archetype', rule)]);
    }
  });

  test('inside the cooldown another direction is 409 with details.availableAt; after it 200 with Me, the targets of the new direction and a new cooldown; nothing else of Me moves', async () => {
    const opens = new Date(Date.now() + 9 * DAY).toISOString();
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: opens } };
    const blocked = await patch('/me/archetype', { archetype: 'SUPPORTER' });
    expect([code(blocked), blocked.json.error.details]).toEqual(['409 ARCHETYPE_COOLDOWN', { availableAt: opens }]);
    expect(world.me.user.archetype).toBe('TANKER');
    cooldownOver();
    const before = world.me;
    const done = await patch('/me/archetype', { archetype: 'SUPPORTER' });
    expect(done.status).toBe(200);
    expect(done.json.user).toMatchObject({ archetype: 'SUPPORTER' });
    expect(done.json.progression).toEqual(before.progression);
    expect(Date.parse(done.json.user.archetypeChangeAvailableAt) - Date.now()).toBeGreaterThan(13 * DAY);
    expect((await get('/me/prescription')).json).toMatchObject({ archetype: 'SUPPORTER', ...calculatePrescription({ ...bio, ageYears: ageFrom(bio.birthYear, Date.now(), 'Asia/Ho_Chi_Minh'), archetype: 'SUPPORTER' }) });
  });

  test('"not allowed" is said before "wait", inside the cooldown too; the direction in effect is accepted at any time and starts no cooldown', async () => {
    world.profile = { ...world.profile, biometrics: { ...bio, weightKg: LIGHT_KG } };
    const opens = new Date(Date.now() + 9 * DAY).toISOString();
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: opens } };
    const refused = await patch('/me/archetype', { archetype: 'ASSASSIN' });
    expect([code(refused), refused.json.error.details]).toEqual(['422 ARCHETYPE_NOT_ALLOWED', { allowed: ['TANKER', 'SUPPORTER'] }]);
    const same = await patch('/me/archetype', { archetype: 'TANKER' });
    expect([same.status, same.json.user.archetypeChangeAvailableAt]).toEqual([200, opens]);
    noCooldown();
    expect((await patch('/me/archetype', { archetype: 'TANKER' })).json.user.archetypeChangeAvailableAt).toBeNull();
  });
});
