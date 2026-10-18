import { randomUUID } from 'node:crypto';
import { PASSWORD, begin, goTo, playDays } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

export default {
  name: 'ticket',
  describe:
    'broken (streak 5, yesterday missed and closed, 09:00 local) plus one unused freeze ticket, granted by a journal entry written this morning',
  async run(ctx) {
    const { email, token } = await begin(ctx, 'ticket', true);
    await playDays(ctx, token, [true, true, true, true, true, false]);
    await goTo(ctx, token, 9);
    const { ticket } = await ctx.call('POST', '/journal', {
      token,
      key: randomUUID(),
      body: { body: 'Hôm qua mình lỡ một ngày. Sáng nay viết vài dòng.' },
    });
    if (ticket.outcome !== 'GRANTED' || ticket.available !== 1) {
      throw new Error(`the journal entry did not grant the week's ticket (${ticket.outcome}, ${ticket.available})`);
    }
    return { email, password: PASSWORD, note: 'streak 5 broke yesterday, one ticket in hand: rescue it before 15:00 local' };
  },
} satisfies Scenario;
