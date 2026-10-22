import { PASSWORD, begin, goTo, playDays } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'broken',
  describe: 'streak 5, then yesterday missed and closed, 09:00 local: inside the rescue window',
  async run(ctx) {
    const { email, token } = await begin(ctx, 'broken', true, 6);
    await playDays(ctx, token, [true, true, true, true, true, false]);
    await goTo(ctx, token, 9);
    return { email, password: PASSWORD, note: 'streak 5 broke yesterday: break notice with previous 5' };
  },
} satisfies Scenario;
