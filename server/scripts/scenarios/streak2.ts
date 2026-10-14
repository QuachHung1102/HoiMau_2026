import { PASSWORD, begin, goTo, playDays } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'streak2',
  describe: 'two completed closed days, today open at 20:00 local with nothing recorded',
  async run(ctx) {
    const { email, token } = await begin(ctx, 'streak2', true);
    await playDays(ctx, token, [true, true]);
    await goTo(ctx, token, 20);
    return { email, password: PASSWORD, note: 'streak 2: one good day from the flame' };
  },
} satisfies Scenario;
