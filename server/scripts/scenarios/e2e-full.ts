import { randomUUID } from 'node:crypto';
import { PASSWORD, begin, demoEmail, goTo, playDays } from '../scenarioKit.ts';
import type { Scenario } from '../scenarioKit.ts';

const GUILD = 'Tổ Đầu Cuối';
const RECEIVER = 'e2efullb';

export default {
  name: 'e2e-full',
  describe:
    'the account of the full app suite: three completed days (120 coins, streak 3), leader of a guild with Bình, whose story is not done today and who takes nudges; 13:00 local',
  async run(ctx) {
    await ctx.removeGuild(GUILD);
    const receiver = await begin(ctx, RECEIVER, true, 3);
    await ctx.call('PATCH', '/me', { token: receiver.token, key: randomUUID(), body: { displayName: 'Bình' } });
    const leader = await begin(ctx, 'e2efull', true, 3);
    const { guild } = await ctx.call('POST', '/guilds', { token: leader.token, key: randomUUID(), body: { name: GUILD } });
    await ctx.call('POST', '/guilds/join', { token: receiver.token, key: randomUUID(), body: { inviteCode: guild.inviteCode } });
    await playDays(ctx, leader.token, [true, true, true]);
    // inside the nudge window [12:00, 20:00) of the receiver's wall clock
    await goTo(ctx, leader.token, 13);
    return {
      email: leader.email,
      password: PASSWORD,
      note: `guild "${GUILD}"; the nudge receiver signs in as ${demoEmail(RECEIVER)} with the same password; 13:00 local`,
    };
  },
} satisfies Scenario;
