// The whole product through the real app tree against the running dev server (`npm run test:e2e`, see
// docs/testing-and-release.md), prepared by the `e2e-full` scenario: no fetch stub, keychain and AsyncStorage are the Jest
// mocks of jest.setup.js, the share box is a mock that keeps what it was handed. Sign in → the four tabs → water, calories
// (after a meal swap) and a workout → Mầm → shop: buy and equip a theme, the palette changes → guild: a nudge → a journal
// page and its feedback → tickets and the preview → a setting → export → sign out; then the receiver signs in and finds the
// nudge in the inbox, and signs out. Every screen reached is checked for an error state.
//
// The device clock (`Date.now`) is set to the server's frozen clock (13:00 local, inside the nudge window); the workout is
// "trained" by moving that clock on. The dev database is left as the scenario leaves it, with the clock off.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { WorkoutCatalog } from '../../domain/contract/content.ts';
import type { DayState } from '../../domain/contract/core.ts';
import type { NudgeTemplates } from '../../domain/contract/social.ts';
import App from '../../src/app/App';
import * as commonVi from '../../src/shared/i18n/vi/common';
import * as guildVi from '../../src/shared/i18n/vi/guild';
import * as inboxVi from '../../src/shared/i18n/vi/inbox';
import * as journalVi from '../../src/shared/i18n/vi/journal';
import { tabLabel } from '../../src/shared/i18n/vi/nav';
import * as nutritionVi from '../../src/shared/i18n/vi/nutrition';
import * as petVi from '../../src/shared/i18n/vi/pet';
import * as progressionVi from '../../src/shared/i18n/vi/progression';
import * as settingsVi from '../../src/shared/i18n/vi/settings';
import * as shopVi from '../../src/shared/i18n/vi/shop';
import * as todayVi from '../../src/shared/i18n/vi/today';
import * as workoutVi from '../../src/shared/i18n/vi/workout';
import { shareTextFile } from '../../src/shared/native/hoiMauNative';
import { themes } from '../../src/shared/theme/tokens';

const BASE = process.env.E2E_BASE_URL;

jest.mock('../../src/shared/api/config', () => ({ API_BASE_URL: process.env.E2E_BASE_URL }));
// the share box: what the export hands to it is kept, nothing opens
jest.mock('../../src/shared/native/hoiMauNative', () => ({
  ...jest.requireActual('../../src/shared/native/hoiMauNative'),
  shareTextFile: jest.fn(() => Promise.resolve()),
}));

const ROOT = path.resolve(__dirname, '../..');
/** One server CLI (`npm --prefix server run <args>`), as a person at the terminal would run it. */
const cli = (args: string) => execSync(`npm --prefix server run ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const line = (output: string, name: string) => {
  const found = new RegExp(`^${name}:\\s+(\\S+)`, 'm').exec(output);
  if (!found) throw new Error(`no "${name}:" line in:\n${output}`);
  return found[1];
};

/** A read straight from the server as the signed-in account, for the numbers the test expects. */
async function server<T>(pathname: string): Promise<T> {
  const stored = await Keychain.getGenericPassword();
  if (!stored) throw new Error('not signed in');
  const response = await fetch(`${BASE}${pathname}`, { headers: { authorization: `Bearer ${stored.password}` } });
  if (!response.ok) throw new Error(`GET ${pathname}: ${response.status}`);
  return (await response.json()) as T;
}

const MINUTE = 60_000;
/** Everything but `Date` stays real: the device clock is set, timers and the network run as they do. */
const REAL = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const pressSoon = async (name: string | RegExp) => fireEvent.press(await screen.findByRole('button', { name }));
const type = (label: string | RegExp, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const back = () => press('Quay lại');
/** The screen titled `name` is up, and it is not an error state (the load-failure card or a "Thử lại"). */
async function reached(name: string | RegExp) {
  await screen.findByRole('header', { name });
  expect(screen.queryByText(commonVi.loadFailedTitle)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
}
/** A tab, at the root of its stack: Back until the tab bar shows (details hide it), then the tab (pressed again on the selected one, which pops its stack). */
async function tab(name: keyof typeof tabLabel, root: string) {
  while (!screen.queryByRole('tab', { name: tabLabel[name] })) {
    back();
    await act(async () => undefined);
  }
  fireEvent.press(screen.getByRole('tab', { name: tabLabel[name] }));
  if (!screen.queryByRole('header', { name: root })) fireEvent.press(screen.getByRole('tab', { name: tabLabel[name] }));
  await reached(root);
}
/** The whole rendered tree as text, for the palette colours it carries. */
const tree = () => JSON.stringify(screen.toJSON());

async function signIn(email: string, password: string) {
  fireEvent.press(await screen.findByRole('button', { name: 'Tôi đã có tài khoản' }));
  await reached('Chào bạn trở lại');
  type('Email', email);
  type('Mật khẩu', password);
  press('Đăng nhập');
  await reached(tabLabel.Today);
}
async function signOut() {
  await tab('Profile', tabLabel.Profile);
  await pressSoon(new RegExp(`^${progressionVi.profileRows.settings.title}`));
  await reached(settingsVi.title);
  await pressSoon('Đăng xuất');
  await screen.findByRole('button', { name: 'Tôi đã có tài khoản' });
}

// a skipped describe prints nothing without --verbose: say why here
if (!BASE) console.log('full.e2e: SKIPPED, E2E_BASE_URL is unset (see docs/testing-and-release.md)');
const suite = BASE ? describe : describe.skip;
suite(BASE ? 'the whole product through the real app' : 'the whole product through the real app: SKIPPED, E2E_BASE_URL is unset (see docs/testing-and-release.md)', () => {
  let account: { email: string; password: string; receiver: string; clock: string };
  const active: ((state: string) => void)[] = [];

  beforeAll(() => {
    configure({ asyncUtilTimeout: 15_000 });
    const output = cli('scenario -- e2e-full');
    account = {
      email: line(output, 'email'),
      password: line(output, 'password'),
      receiver: /signs in as (\S+)/.exec(output)![1],
      clock: line(output, 'clock'),
    };
  }, 2 * MINUTE);
  afterAll(() => {
    cli('scenario -- clock off');
  }, MINUTE);
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: [...REAL], advanceTimers: true, now: Date.parse(account.clock) });
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function zone(this: Intl.DateTimeFormat) {
      return { ...resolved.call(this), timeZone: 'Asia/Ho_Chi_Minh' };
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
      active.push(args[1] as (state: string) => void);
      return { remove: () => undefined };
    });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
  });

  test('a day of the whole app, then the receiver reads the nudge', async () => {
    render(<App />);
    await signIn(account.email, account.password);

    // the four tabs
    await tab('Plan', tabLabel.Plan);
    await tab('Guild', 'Tổ Đầu Cuối');
    await tab('Profile', tabLabel.Profile);

    // a journal page, its feedback (the week's ticket), the tickets and the preview of one for today, while today's story is
    // still open (once it is done, today needs no ticket and the preview stays shut)
    press(new RegExp(`^${progressionVi.profileRows.journal.title}`));
    await reached(journalVi.writeTitle);
    type(journalVi.fieldLabel, 'Hôm nay mình đã đi bộ và uống đủ nước.');
    press(journalVi.save);
    await reached(journalVi.feedbackTitle);
    expect(screen.getByText(journalVi.ticketGranted)).toBeTruthy();
    press(new RegExp(`^${journalVi.seeTicket}`));
    await reached(journalVi.ticketsTitle);
    fireEvent.press(await screen.findByRole('combobox', { name: new RegExp(`^${journalVi.dateField}`) }));
    fireEvent.press(await screen.findByRole('radio', { name: journalVi.todayWord }));
    press(journalVi.previewAction);
    await reached(journalVi.previewTitle('TODAY'));
    await tab('Today', tabLabel.Today);

    // water
    await pressSoon(/^Nước hôm nay\. 0 \/ 8 phần\./);
    expect(await screen.findByRole('button', { name: /^Nước hôm nay\. 1 \/ 8 phần\./ })).toBeTruthy();

    // the meal plan: a swap of lunch, then calories inside the band the server gives
    await tab('Plan', tabLabel.Plan);
    press(new RegExp(`^${workoutVi.planMeal}`));
    await reached(nutritionVi.planTitle);
    await pressSoon(/^Bữa trưa\./);
    await pressSoon(nutritionVi.swapOther);
    await reached(nutritionVi.swapTitle('LUNCH'));
    const [first] = await screen.findAllByRole('radio');
    fireEvent.press(first);
    press(nutritionVi.chooseMeal);
    await screen.findByRole('button', { name: nutritionVi.swapOther });
    expect(screen.queryByRole('header', { name: nutritionVi.swapTitle('LUNCH') })).toBeNull();
    back();
    await reached(nutritionVi.planTitle);
    await pressSoon('Ghi món đã ăn');
    await reached('Ghi bữa ăn');
    const { calorieWindow } = await server<DayState>('/day');
    type(/^Số kcal/, String(Math.round((calorieWindow.min + calorieWindow.max) / 2)));
    press('Ghi món đã ăn');
    expect(await screen.findByText('Bữa ăn theo mục tiêu đã xong', { exact: false })).toBeTruthy();
    await reached(nutritionVi.planTitle);
    back();
    await reached(tabLabel.Plan);

    // a workout past half its length
    press(new RegExp(`^${workoutVi.planWorkout}`));
    await reached(workoutVi.catalogTitle);
    const card = await screen.findByRole('button', { name: /^Xem hướng dẫn: / });
    const name = String(card.props.accessibilityLabel).replace(/^Xem hướng dẫn: /, '');
    const { items } = await server<WorkoutCatalog>('/workout/catalog');
    const { durationSec } = items.find(item => item.name === name)!;
    fireEvent.press(card);
    await reached(name);
    press('Bắt đầu tập');
    await reached(workoutVi.focusTitle);
    jest.setSystemTime(Date.now() + Math.ceil(durationSec * 0.6) * 1000);
    press('Kết thúc buổi tập');
    await pressSoon('Kết thúc và lưu');
    await reached(workoutVi.completedTitle);
    press('Về Hôm nay');
    expect(await screen.findByRole('button', { name: /^Vận động vừa sức\..*\. Đã xong$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ăn đủ cho mục tiêu\..*\. Đã xong$/ })).toBeTruthy();

    // Mầm → the shop: buy the forest theme and use it; the palette is the forest one once the server says so
    await tab('Profile', tabLabel.Profile);
    press(new RegExp(`^${progressionVi.profileRows.pet.title}`));
    await reached(petVi.petTitle);
    await pressSoon(petVi.visitShop);
    await reached(shopVi.shopTitle);
    await pressSoon('Xem Rừng xanh');
    await reached(shopVi.itemTitle('THEME', 'Rừng xanh'));
    // the screen is the default palette (its preview card already shows the forest one)
    expect(tree().includes(themes.default.bg)).toBe(true);
    press(shopVi.confirmBuy);
    await reached(shopVi.isYours('Rừng xanh'));
    press(shopVi.useNow);
    await reached(shopVi.inventoryTitle);
    await waitFor(() => expect(tree().includes(themes.default.bg)).toBe(false));
    expect(tree().includes(themes.forest.bg)).toBe(true);

    // the guild: a nudge for Bình
    await tab('Guild', 'Tổ Đầu Cuối');
    await pressSoon(/^Bình\./);
    await reached(guildVi.nudgeTitle);
    const [template] = await screen.findAllByRole('radio');
    const templateText = String(within(template).getAllByText(/./)[0].props.children);
    expect((await server<NudgeTemplates>('/guilds/nudge-templates')).templates.map(t => t.text)).toContain(templateText);
    fireEvent.press(template);
    press(guildVi.nudgeSend('Bình'));
    expect(await screen.findByRole('button', { name: guildVi.nudgeSent })).toBeTruthy();
    await tab('Guild', 'Tổ Đầu Cuối');

    // a setting: nudges from the guild off, as the server stores it
    await tab('Profile', tabLabel.Profile);
    press(new RegExp(`^${progressionVi.profileRows.settings.title}`));
    await reached(settingsVi.title);
    press(new RegExp(`^${settingsVi.rows.notifications.title}`));
    await reached(settingsVi.notificationsTitle);
    fireEvent.press(await screen.findByRole('switch', { name: settingsVi.nudgesLabel }));
    await waitFor(() => expect(screen.getByRole('switch', { name: settingsVi.nudgesLabel })).not.toBeChecked());
    await waitFor(async () => expect((await server<{ nudgesEnabled: boolean }>('/settings')).nudgesEnabled).toBe(false));
    back();

    // export: the share box is handed the document as JSON
    await reached(settingsVi.title);
    press(new RegExp(`^${settingsVi.rows.privacy.title}`));
    await reached(settingsVi.privacyTitle);
    press(new RegExp(`^${settingsVi.exportRow.title}`));
    expect(await screen.findByText(settingsVi.exportedTitle)).toBeTruthy();
    const share = jest.mocked(shareTextFile);
    expect(share).toHaveBeenCalledTimes(1);
    const [fileName, mimeType, content] = share.mock.calls[0];
    expect([fileName, mimeType]).toEqual([expect.stringMatching(/^hoi-mau-du-lieu-.*\.json$/), 'application/json']);
    expect(JSON.parse(content)).toMatchObject({ formatVersion: 1 });
    expect(content).toContain('Hôm nay mình đã đi bộ và uống đủ nước.');
    back();

    // sign out; the receiver signs in and finds the nudge in the inbox
    await reached(settingsVi.title);
    await pressSoon('Đăng xuất');
    await signIn(account.receiver, account.password);
    await pressSoon(todayVi.inboxUnread);
    await reached(inboxVi.title);
    expect(await screen.findByText(templateText, { exact: false })).toBeTruthy();
    await signOut();
    screen.unmount();
  }, 5 * MINUTE);
});
