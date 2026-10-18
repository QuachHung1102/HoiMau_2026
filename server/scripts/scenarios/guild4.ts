import { randomUUID } from 'node:crypto';
import { PASSWORD, begin, closeDay, completeStory, demoEmail, getDay, goTo } from '../scenarioKit.ts';
import type { Scenario, ScenarioCtx } from '../scenarioKit.ts';

const GUILD = 'Tổ Bốn Mùa';
const MEMBERS = [
  { name: 'guild4b', displayName: 'Bình' },
  { name: 'guild4c', displayName: 'Chi' },
  { name: 'guild4d', displayName: 'Dũng' },
];

async function logMealOnly(ctx: ScenarioCtx, token: string) {
  const { calorieWindow } = await getDay(ctx, token);
  await ctx.call('POST', '/nutrition/log', {
    token,
    key: randomUUID(),
    body: { kcal: Math.round((calorieWindow.min + calorieWindow.max) / 2) },
  });
}

export default {
  name: 'guild4',
  describe:
    'a guild of four (An leads; Bình, Chi, Dũng); Monday: An and Bình complete the story, Chi half; Tuesday 12:00 local: An completes it again; Dũng records nothing and has nudges muted',
  async run(ctx) {
    // the guild of a previous run, whole, leaderless or empty (deleting the accounts alone would
    // leave it holding the name); refused, loudly, if anyone but a demo account is in it
    await ctx.removeGuild(GUILD);
    const leader = await begin(ctx, 'guild4', true);
    const members: string[] = [];
    for (const { name, displayName } of MEMBERS) {
      const { token } = await begin(ctx, name, true);
      await ctx.call('PATCH', '/me', { token, key: randomUUID(), body: { displayName } });
      members.push(token);
    }
    const [binh, chi, dung] = members;
    const { guild } = await ctx.call('POST', '/guilds', {
      token: leader.token,
      key: randomUUID(),
      body: { name: GUILD, motto: 'Mỗi ngày một chút' },
    });
    for (const token of members) {
      await ctx.call('POST', '/guilds/join', { token, key: randomUUID(), body: { inviteCode: guild.inviteCode } });
    }
    await ctx.call('PATCH', '/settings', { token: dung, key: randomUUID(), body: { nudgesEnabled: false } });

    await goTo(ctx, leader.token, 12);
    await completeStory(ctx, leader.token);
    await completeStory(ctx, binh);
    await logMealOnly(ctx, chi);
    await closeDay(ctx, leader.token);
    await goTo(ctx, leader.token, 12);
    await completeStory(ctx, leader.token);
    return {
      email: leader.email,
      password: PASSWORD,
      note: `guild "${GUILD}", code ${guild.inviteCode}; the members sign in as ${MEMBERS.map(m => demoEmail(m.name)).join(', ')} with the same password; Tuesday 12:00 local`,
    };
  },
} satisfies Scenario;
