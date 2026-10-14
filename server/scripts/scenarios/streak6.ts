import { PASSWORD, begin, goTo, playDays } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'streak6',
  describe: 'six completed closed days, today open at 20:00 local',
  async run(ctx) {
    const { email, token } = await begin(ctx, 'streak6', true);
    await playDays(ctx, token, [true, true, true, true, true, true]);
    await goTo(ctx, token, 20);
    return { email, password: PASSWORD, note: 'streak 6: completing today and closing it reaches the 7-day milestone' };
  },
} satisfies Scenario;
