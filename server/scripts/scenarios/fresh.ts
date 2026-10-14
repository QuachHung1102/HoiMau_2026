import { PASSWORD, begin } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'fresh',
  describe: 'registered, not onboarded',
  async run(ctx) {
    const { email } = await begin(ctx, 'fresh', false);
    return { email, password: PASSWORD, note: 'signed up and nothing else: the app starts at onboarding' };
  },
} satisfies Scenario;
