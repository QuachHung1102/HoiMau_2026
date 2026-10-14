import { PASSWORD, begin } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'day1',
  describe: 'onboarded, nothing recorded, 09:00 local',
  async run(ctx) {
    const { email } = await begin(ctx, 'day1', true);
    return { email, password: PASSWORD, note: 'first morning: streak 0, level 1, no quest started' };
  },
} satisfies Scenario;
