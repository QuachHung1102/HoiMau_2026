import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INGREDIENT_TAGS, STYLE_TAGS } from './types.ts';

test('tag vocabularies are the plan lists', () => {
  assert.deepEqual(STYLE_TAGS, ['chay', 'khong-thit', 'it-nau', 'ngoai-hang']);
  assert.deepEqual(INGREDIENT_TAGS, [
    'co:thit-do',
    'co:gia-cam',
    'co:hai-san',
    'co:trung',
    'co:sua',
    'co:dau-phong',
    'co:gluten',
    'co:dau-nanh',
  ]);
});
