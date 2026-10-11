import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findBannedTerms } from '../../domain/language.ts';
import { NUDGE_TEMPLATES } from './nudgeTemplates.ts';
import { QUESTS } from './quests.ts';
import { SHOP_ITEMS } from './shopItems.ts';

const unique = (values: string[]) => new Set(values).size === values.length;

test('codes are unique within each category', () => {
  assert.ok(unique(QUESTS.map(q => q.code)));
  assert.ok(unique(SHOP_ITEMS.map(i => i.code)));
  assert.ok(unique(NUDGE_TEMPLATES.map(t => t.code)));
});

test('quest rewards are those of the spec (target / XP / coins)', () => {
  const rows = QUESTS.map(q => [
    q.code,
    q.category,
    q.targetCount,
    q.xpReward,
    q.coinReward,
  ]);
  assert.deepEqual(rows, [
    ['WORKOUT_MAIN', 'STORY', 1, 50, 20],
    ['NUTRITION_TARGET', 'STORY', 1, 50, 20],
    ['WATER_8', 'DAILY', 8, 10, 5],
    ['STAND_UP', 'DAILY', 6, 10, 5],
    ['BEDTIME_BEFORE_23', 'HIDDEN', 1, 30, 15],
  ]);
  for (const q of QUESTS) {
    assert.deepEqual(q.archetypes, ['TANKER', 'ASSASSIN', 'SUPPORTER']);
    assert.equal(q.titleKey, q.code);
    assert.equal(q.isActive, true);
  }
});

test('no quest code or title key mentions weight', () => {
  for (const q of QUESTS) {
    assert.doesNotMatch(
      `${q.code} ${q.titleKey}`,
      /weight|kg|can[-_ ]?nang|giam[-_ ]?can/i,
    );
  }
});

test('shop items are cosmetic: kind is THEME, PET_SKIN or BADGE and only catalogue fields exist', () => {
  const fields = [
    'code',
    'name',
    'kind',
    'priceCoin',
    'minLevel',
    'assetKey',
    'purchasable',
    'isDefault',
  ];
  for (const item of SHOP_ITEMS) {
    assert.ok(['THEME', 'PET_SKIN', 'BADGE'].includes(item.kind), item.code);
    assert.deepEqual(Object.keys(item).sort(), [...fields].sort(), item.code);
  }
});

test('exactly one default theme and one default skin, free and not purchasable', () => {
  for (const kind of ['THEME', 'PET_SKIN']) {
    const defaults = SHOP_ITEMS.filter(i => i.kind === kind && i.isDefault);
    assert.equal(defaults.length, 1, kind);
    assert.equal(defaults[0].priceCoin, 0);
    assert.equal(defaults[0].purchasable, false);
  }
  assert.equal(SHOP_ITEMS.filter(i => i.isDefault).length, 2);
});

test('shop catalogue values', () => {
  const byCode = Object.fromEntries(SHOP_ITEMS.map(i => [i.code, i]));
  const row = (code: string) => [
    byCode[code].name,
    byCode[code].priceCoin,
    byCode[code].minLevel,
    byCode[code].assetKey,
    byCode[code].purchasable,
  ];
  assert.deepEqual(row('THEME_DEFAULT'), [
    'Hồi Máu nguyên bản',
    0,
    1,
    'default',
    false,
  ]);
  assert.deepEqual(row('THEME_FOREST'), ['Rừng xanh', 80, 1, 'forest', true]);
  assert.deepEqual(row('THEME_SKY'), ['Bầu trời', 300, 8, 'sky', true]);
  assert.deepEqual(row('SKIN_DEFAULT'), [
    'Mầm nguyên bản',
    0,
    1,
    'none',
    false,
  ]);
  assert.deepEqual(row('SKIN_FOX'), ['Mũ cáo nhỏ', 120, 3, 'fox', true]);
  assert.deepEqual(row('BADGE_NEW_DAY'), [
    'Chào ngày mới',
    60,
    2,
    'new-day',
    true,
  ]);
  assert.deepEqual(row('BADGE_STEP_BY_STEP'), [
    'Từng bước một',
    120,
    5,
    'step-by-step',
    true,
  ]);
  for (const code of [
    'BADGE_STREAK_7',
    'BADGE_STREAK_30',
    'BADGE_STREAK_100',
    'BADGE_GUILD_TOP1',
  ]) {
    assert.equal(byCode[code].kind, 'BADGE');
    assert.equal(byCode[code].purchasable, false, code);
    assert.equal(byCode[code].priceCoin, 0, code);
  }
});

test('nudge templates are the five fixed texts', () => {
  assert.deepEqual(
    NUDGE_TEMPLATES.map(t => [t.code, t.text]),
    [
      ['MOVE_TOGETHER', 'Mình cùng vận động nhé?'],
      ['WATER_BREAK', 'Nghỉ một chút, uống nước nào.'],
      ['HOW_ARE_YOU', 'Hôm nay bạn thế nào?'],
      ['SMALL_STEP', 'Một việc nhỏ thôi cũng được.'],
      ['WITH_YOU', 'Mình ở đây cùng bạn.'],
    ],
  );
});

// Every content module in this folder, including ones later tasks add (meals, exercises, quotes).
test('no string in any content module contains a banned term', async () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const modules = readdirSync(dir).filter(
    f => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object')
      Object.values(value).forEach(collect);
  };
  for (const file of modules) collect(await import(`./${file}`));
  assert.ok(strings.length > 30, `only ${strings.length} strings collected`);
  const hits = strings
    .map(s => [s, findBannedTerms(s)] as const)
    .filter(([, h]) => h.length > 0);
  assert.deepEqual(hits, []);
});
