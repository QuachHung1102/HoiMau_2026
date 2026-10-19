/* eslint-env jest */
// Test kit for the guild screens (used by *.test.tsx files; never imported by app code). The whole app against the stand-in
// server of the home-tab kit, which holds the guilds (`world.guild`) and answers the guild routes as server Tasks 39 and 41 do.
import { fireEvent, screen } from '@testing-library/react-native';
import words from './guildFixture.json';
import { GUILD_MAX_MEMBERS } from '../../../domain/guild.ts';
import * as vi from '../../shared/i18n/vi/guild';
import { tabLabel } from '../../shared/i18n/vi/nav';
import { mateOf, openToday, settle, USER, world, writes, type Mate, type Team } from '../dashboard/todayTestKit';

export { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
export { openToday } from '../dashboard/todayTestKit';
export { fetchMock, hold, installTodayTestEnv, mateOf, queryClient, refuse, requested, respond, serverAnswer, settle, USER, world, writes } from '../dashboard/todayTestKit';
export type { Mate, Team } from '../dashboard/todayTestKit';

export const CODE = 'NHJPM2K9';
export const NAME = words.guildName;

/** The reads a screen has just asked for have landed inside act(). */
export const landed = async () => {
  await settle();
  await settle();
  await settle();
};

/** The four of frame S27 (illustrative numbers): the caller, a member who is done today, one who can be nudged, one who has muted nudges. */
export const mates = (): Mate[] => [
  { ...mateOf(0, 'An', { level: 5, daysCompleted: 6, daysCounted: 7 }), userId: USER },
  mateOf(1, 'Linh', { level: 7, daysCompleted: 7, daysCounted: 7, storyDone: true }),
  mateOf(2, 'Minh', { level: 3, daysCompleted: 4, daysCounted: 7 }),
  mateOf(3, words.ha, { level: 6, daysCompleted: 5, daysCounted: 7, muted: true }),
];

/** Puts the caller into a guild. `role` is the caller's; `members` replaces the four of the frame (the caller must be among them). */
export function seedGuild(more: Partial<Omit<Team, 'members'>> & { role?: 'LEADER' | 'MEMBER'; members?: Mate[] } = {}): Team {
  const { role = 'MEMBER', members = mates(), ...rest } = more;
  const team: Team = {
    id: '00000000-0000-4000-9000-900000000001',
    name: NAME,
    motto: '',
    inviteCode: CODE,
    weekCompletion: 0.79,
    inactiveDays: 0,
    ...rest,
    members: members.map(mate => (mate.userId === USER ? { ...mate, role } : mate)),
  };
  world.guild.teams.push(team);
  return team;
}
/** A guild the caller is not in, for the code to open. */
export function seedOtherGuild(more: Partial<Team> = {}): Team {
  const team: Team = {
    id: '00000000-0000-4000-9000-900000000002',
    name: words.otherGuildName,
    motto: '',
    inviteCode: 'ABCD2345',
    weekCompletion: 0.5,
    inactiveDays: 0,
    members: [mateOf(21, words.binh, { role: 'LEADER' })],
    ...more,
  };
  world.guild.teams.push(team);
  return team;
}
/** `count` members besides the leader: a guild that is full at 8. */
export const fullTeam = (): Mate[] => Array.from({ length: GUILD_MAX_MEMBERS }, (_, n) => mateOf(30 + n, `${words.friend} ${n + 1}`, n === 0 ? { role: 'LEADER' } : {}));

export const guildTab = () => screen.getByRole('tab', { name: tabLabel.Guild });
const header = (name: string) => screen.findByRole('header', { name });

/** The app on its first tab, then the "Tổ đội" tab: S25 without a guild, S27 with one. */
export async function openGuild(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openToday(options);
  fireEvent.press(guildTab());
  const mine = world.guild.teams.find(team => team.members.some(mate => mate.userId === USER));
  await header(mine ? mine.name : vi.tabTitle);
  await landed();
  return view;
}
/** The guild tab, then "Mời bạn & quản lý nhóm": S54. */
export async function openManage(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openGuild(options);
  fireEvent.press(screen.getByRole('button', { name: vi.inviteAndManage }));
  await header(vi.manageTitle);
  await landed();
  return view;
}
/** The tab of an empty guild, then "Tham gia bằng mã mời": S26. */
export async function openJoin(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openGuild(options);
  fireEvent.press(screen.getByRole('button', { name: vi.joinWithCode }));
  await header(vi.joinTitle);
  return view;
}
/** The tab of an empty guild, then "Tạo tổ đội": S42. */
export async function openCreate(options: Parameters<typeof openToday>[0] = {}) {
  const view = await openGuild(options);
  fireEvent.press(screen.getByRole('button', { name: vi.createGuild }));
  await header(vi.createTitle);
  return view;
}

/** The writes of one route, in order. */
export const writesOf = (path: string) => writes().filter(request => request.path === path);
/** Whether this text is anywhere in what the screen has drawn. */
export const draws = (text: string) => JSON.stringify(screen.toJSON()).includes(text);
