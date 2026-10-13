// GET and PATCH /settings over HTTP, on the real database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Settings } from '../../../domain/contract/core.ts';
import { INGREDIENT_TAGS } from '../../../domain/types.ts';
import { newOnboardedUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await app.close();
  await db.drop();
});

const DEFAULTS: Settings = {
  nudgesEnabled: true,
  reminderEnabled: false,
  reminderWindow: 'EVENING',
  hideStreak: false,
  soundEnabled: false,
  motion: 'SYSTEM',
  excludedMealTags: [],
};

const get = (token: string) => app.call('GET', '/settings', { token });
const patch = (token: string, body: unknown) =>
  app.call('PATCH', '/settings', { token, body, key: randomUUID() });
const fields = (...pairs: [string, string][]) => ({
  fields: pairs.map(([field, rule]) => ({ field, rule })),
});

test('GET /settings after onboarding: the defaults', async () => {
  const user = await newOnboardedUser(db);
  const result = await get(user.token);
  assert.deepEqual([result.status, result.body], [200, DEFAULTS]);
});

test('PATCH /settings changes each field alone, and several at once', async () => {
  const user = await newOnboardedUser(db);
  let expected = DEFAULTS;
  const changes: Partial<Settings>[] = [
    { nudgesEnabled: false },
    { reminderEnabled: true },
    { reminderWindow: 'MORNING' },
    { reminderWindow: 'NOON' },
    { hideStreak: true },
    { motion: 'REDUCED' },
    { motion: 'FULL' },
    { excludedMealTags: ['co:sua', 'co:gluten'] },
    { excludedMealTags: [...INGREDIENT_TAGS] },
    { excludedMealTags: [] },
    { nudgesEnabled: true, reminderEnabled: false, reminderWindow: 'EVENING', hideStreak: false, motion: 'SYSTEM' },
  ];
  for (const change of changes) {
    expected = { ...expected, ...change };
    const result = await patch(user.token, change);
    assert.deepEqual([result.status, result.body], [200, expected], JSON.stringify(change));
    assert.deepEqual((await get(user.token)).body, expected);
  }
  assert.deepEqual(expected, DEFAULTS);

  // tags are kept once each, in the order of INGREDIENT_TAGS
  const tags = await patch(user.token, { excludedMealTags: ['co:sua', 'co:thit-do', 'co:sua'] });
  assert.deepEqual(tags.body.excludedMealTags, ['co:thit-do', 'co:sua']);
  // nothing to change, and a member the server does not know: 200, as it was
  for (const body of [{}, { theme: 'dark' }, null, ['hideStreak']]) {
    const result = await patch(user.token, body);
    assert.deepEqual(
      [result.status, result.body],
      [200, { ...DEFAULTS, excludedMealTags: ['co:thit-do', 'co:sua'] }],
    );
  }
});

test('PATCH /settings refusals: wrong types, unknown enum values and tags, and soundEnabled; nothing is written', async () => {
  const user = await newOnboardedUser(db);
  await patch(user.token, { hideStreak: true });
  const earlier = (await get(user.token)).body;
  const cases: [unknown, [string, string][]][] = [
    [{ nudgesEnabled: 'yes' }, [['nudgesEnabled', 'format']]],
    [{ nudgesEnabled: null }, [['nudgesEnabled', 'format']]],
    [{ reminderEnabled: 1 }, [['reminderEnabled', 'format']]],
    [{ hideStreak: 'false' }, [['hideStreak', 'format']]],
    [{ reminderWindow: 'NIGHT' }, [['reminderWindow', 'enum']]],
    [{ reminderWindow: 'evening' }, [['reminderWindow', 'enum']]],
    [{ reminderWindow: null }, [['reminderWindow', 'enum']]],
    [{ motion: 'OFF' }, [['motion', 'enum']]],
    [{ motion: true }, [['motion', 'enum']]],
    [{ excludedMealTags: ['co:sua', 'co:ca-heo'] }, [['excludedMealTags', 'enum']]],
    // a style tag is a tag, but not one a user may exclude
    [{ excludedMealTags: ['chay'] }, [['excludedMealTags', 'enum']]],
    [{ excludedMealTags: [7] }, [['excludedMealTags', 'enum']]],
    [{ excludedMealTags: [null] }, [['excludedMealTags', 'enum']]],
    [{ excludedMealTags: 'co:sua' }, [['excludedMealTags', 'format']]],
    [{ excludedMealTags: null }, [['excludedMealTags', 'format']]],
    // read-only in this build, whatever value is sent
    [{ soundEnabled: true }, [['soundEnabled', 'format']]],
    [{ soundEnabled: false }, [['soundEnabled', 'format']]],
    // one bad member refuses the whole patch, and every bad member is named
    [{ nudgesEnabled: false, soundEnabled: true }, [['soundEnabled', 'format']]],
    [
      { nudgesEnabled: 0, reminderEnabled: 0, reminderWindow: 0, hideStreak: 0, soundEnabled: 0, motion: 0, excludedMealTags: 0 },
      [
        ['nudgesEnabled', 'format'],
        ['reminderEnabled', 'format'],
        ['reminderWindow', 'enum'],
        ['hideStreak', 'format'],
        ['soundEnabled', 'format'],
        ['motion', 'enum'],
        ['excludedMealTags', 'format'],
      ],
    ],
  ];
  for (const [body, pairs] of cases) {
    const result = await patch(user.token, body);
    assert.deepEqual(
      [result.status, result.body?.error?.code, result.body?.error?.details],
      [422, 'VALIDATION_FAILED', fields(...pairs)],
      JSON.stringify(body),
    );
  }
  assert.deepEqual((await get(user.token)).body, earlier);
  const { rows } = await db.admin.query(
    'SELECT sound_enabled, nudges_enabled FROM user_settings WHERE user_id = $1',
    [user.userId],
  );
  assert.deepEqual(rows, [{ sound_enabled: false, nudges_enabled: true }]);
});

test('settings belong to one user: a patch changes the own row only', async () => {
  const [a, b] = [await newOnboardedUser(db), await newOnboardedUser(db)];
  await patch(b.token, { motion: 'REDUCED', excludedMealTags: ['co:trung'] });
  const changed = await patch(a.token, { hideStreak: true, userId: b.userId, user_id: b.userId });
  assert.deepEqual(changed.body, { ...DEFAULTS, hideStreak: true });
  assert.deepEqual((await get(a.token)).body, { ...DEFAULTS, hideStreak: true });
  assert.deepEqual((await get(b.token)).body, {
    ...DEFAULTS,
    motion: 'REDUCED',
    excludedMealTags: ['co:trung'],
  });
});
