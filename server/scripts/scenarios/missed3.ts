import { PASSWORD, begin, goTo, playDays } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'missed3',
  describe: 'three closed missed days, today open at 09:00 local: the pet is tired',
  async run(ctx) {
    const { email, token } = await begin(ctx, 'missed3', true, 3);
    await playDays(ctx, token, [false, false, false]);
    await goTo(ctx, token, 9);
    return { email, password: PASSWORD, note: 'three days missed in a row: pet TIRED' };
  },
} satisfies Scenario;
