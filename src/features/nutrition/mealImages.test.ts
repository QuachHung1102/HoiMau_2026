import fs from 'node:fs';
import path from 'node:path';
import { mealImage, mealImageKeys, planHeaderImage, slotIcon } from './mealImages';

const root = path.resolve(__dirname, '../../..');
const keysInContent = () => [...new Set([...fs.readFileSync(path.join(root, 'server/content/meals.ts'), 'utf8').matchAll(/imageKey:\s*'([^']+)'/g)].map(match => match[1]))].sort();
const sources = JSON.parse(fs.readFileSync(path.join(root, 'design/assets/sources.json'), 'utf8')) as { id: string; file: string; kind: string }[];

describe('meal pictures', () => {
  test('the keys of the map are exactly the image keys the meal content uses', () => {
    expect(keysInContent().length).toBeGreaterThan(0);
    expect([...mealImageKeys].sort()).toEqual(keysInContent());
  });

  test('every key has a picture; a null key, or a key this app does not know, has none (the screen shows an icon)', () => {
    for (const key of mealImageKeys) expect(mealImage(key)).toBeDefined();
    expect(mealImage(null)).toBeUndefined();
    expect(mealImage('nope')).toBeUndefined();
    expect(mealImage('constructor')).toBeUndefined();
  });

  test('each picture is a copy of design/assets/<key>.png, byte for byte, and is known to design/assets/sources.json', () => {
    for (const key of [...mealImageKeys, 'b4IYqX']) {
      const copy = fs.readFileSync(path.join(root, 'src/assets/meals', `${key}.png`));
      expect(copy.equals(fs.readFileSync(path.join(root, 'design/assets', `${key}.png`)))).toBe(true);
      expect(sources.find(item => item.id === key)?.file).toBe(`${key}.png`);
    }
    expect(planHeaderImage).toBeDefined();
  });

  test('the pictures to list for licence review are the stock ones: the three meal pictures; the plan header is generated', () => {
    const kind = (key: string) => sources.find(item => item.id === key)?.kind;
    expect(mealImageKeys.map(kind)).toEqual(mealImageKeys.map(() => 'stock-unsplash'));
    expect(kind('b4IYqX')).toBe('ai-generated');
  });

  test('every slot has an icon for a meal without a picture', () => {
    expect(Object.keys(slotIcon).sort()).toEqual(['BREAKFAST', 'DINNER', 'LUNCH', 'SNACK']);
  });
});
