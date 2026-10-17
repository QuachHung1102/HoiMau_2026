import { randomUUID } from 'node:crypto';
import { cumulativeXpForLevel } from '../../../domain/progression.ts';
import { PASSWORD, begin } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'rich',
  describe:
    'level 8, 500 coins, 3 perk points, 09:00 local; the XP and coins are granted through app._grant by the superuser (ctx.grant), not earned',
  async run(ctx) {
    const { email, token } = await begin(ctx, 'rich', true);
    await ctx.grant(email, cumulativeXpForLevel(8), 500);
    // level 8 earns 7 points: 4 are spent through the API, so MEAL_SWAP_PLUS and one theme are left
    for (const body of [{ perkCode: 'TICKET_CAP_PLUS' }, { perkCode: 'THEME_UNLOCK', itemCode: 'THEME_FOREST' }]) {
      await ctx.call('POST', '/perks/unlock', { token, key: randomUUID(), body });
    }
    return {
      email,
      password: PASSWORD,
      note: 'level 8, 500 coins, 3 perk points (TICKET_CAP_PLUS and THEME_FOREST already unlocked): every shop item is affordable or unlockable',
    };
  },
} satisfies Scenario;
