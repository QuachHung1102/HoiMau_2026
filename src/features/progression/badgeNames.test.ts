/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { STREAK_MILESTONES } from '../../../domain/economy.ts';
import { badgeNames } from '../../shared/i18n/vi/progression';

// The names on S66 are the ones the shop has for the same badges (server/content/shopItems.ts): they must not drift.
test('every streak badge has the name the server\'s content gives it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../server/content/shopItems.ts'), 'utf8');
  for (const { badgeCode } of STREAK_MILESTONES) {
    expect(badgeNames[badgeCode]).toBeTruthy();
    expect(source).toContain(`item('${badgeCode}', '${badgeNames[badgeCode]}'`);
  }
});
