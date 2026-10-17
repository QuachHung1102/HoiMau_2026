// Slice 1 through the real app tree against the running dev server (`npm run test:e2e`, see
// docs/testing-and-release.md): no fetch stub, the app's requests reach E2E_BASE_URL; keychain and AsyncStorage are
// the Jest mocks of jest.setup.js. Welcome → sign in as the `fresh` scenario account → onboarding → Today → one
// water tick → quest board → calories → workout catalog → detail → focus session ended past 50 % → result →
// Today with both STORY rows done; then the clock moves past 03:00 through the scenario CLI, day-close runs through
// the jobs CLI, and the journey shows streak 1. Expected numbers come from the server: the calorie band from
// GET /day, the workout length from the catalog, the next 03:00 from `closesAt`.
//
// The device clock (`Date.now`) is set to the server's frozen clock, as a phone used in that week would read it;
// the focus session is "trained" by moving that clock on. The dev database is left as the `fresh` scenario leaves
// it, with the clock off.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { WorkoutCatalog } from '../../domain/contract/content.ts';
import type { DayState } from '../../domain/contract/core.ts';
import App from '../../src/app/App';
import * as onboardingVi from '../../src/shared/i18n/vi/onboarding';
import * as progressionVi from '../../src/shared/i18n/vi/progression';
import * as todayVi from '../../src/shared/i18n/vi/today';
import * as workoutVi from '../../src/shared/i18n/vi/workout';

const BASE = process.env.E2E_BASE_URL;

jest.mock('../../src/shared/api/config', () => ({ API_BASE_URL: process.env.E2E_BASE_URL }));

const ROOT = path.resolve(__dirname, '../..');
/** One server CLI (`npm --prefix server run <args>`), as a person at the terminal would run it. */
const cli = (args: string) => execSync(`npm --prefix server run ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const line = (output: string, name: string) => {
  const found = new RegExp(`^${name}:\\s+(\\S+)`, 'm').exec(output);
  if (!found) throw new Error(`no "${name}:" line in:\n${output}`);
  return found[1];
};

/** What the app has stored as the session password: the bearer token. */
async function token() {
  const stored = await Keychain.getGenericPassword();
  if (!stored) throw new Error('not signed in');
  return stored.password;
}
/** A read straight from the server, for the numbers the test expects. */
async function server<T>(pathname: string): Promise<T> {
  const response = await fetch(`${BASE}${pathname}`, { headers: { authorization: `Bearer ${await token()}` } });
  if (!response.ok) throw new Error(`GET ${pathname}: ${response.status}`);
  return (await response.json()) as T;
}

const MINUTE = 60_000;
/** Everything but `Date` stays real: the device clock is set, timers and the network run as they do. */
const REAL = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;
/** The device clock reads `iso` now and runs on from there. */
const deviceClockAt = (iso: string) => jest.setSystemTime(Date.parse(iso));

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const type = (label: string | RegExp, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const header = (name: string | RegExp) => screen.findByRole('header', { name });

// a skipped describe prints nothing without --verbose: say why here
if (!BASE) console.log('slice1.e2e: SKIPPED, E2E_BASE_URL is unset (see docs/testing-and-release.md)');
const suite = BASE ? describe : describe.skip;
suite(BASE ? 'slice 1 through the real app' : 'slice 1 through the real app: SKIPPED, E2E_BASE_URL is unset (see docs/testing-and-release.md)', () => {
  let account: { email: string; password: string; clock: string };
  const active: ((state: string) => void)[] = [];

  beforeAll(() => {
    configure({ asyncUtilTimeout: 15_000 });
    // the account and the server's clock come from the scenario itself
    const output = cli('scenario -- fresh');
    account = { email: line(output, 'email'), password: line(output, 'password'), clock: line(output, 'clock') };
  }, MINUTE);
  afterAll(() => {
    // as found: the fresh account again, and real time
    cli('scenario -- fresh');
    cli('scenario -- clock off');
  }, MINUTE);
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: [...REAL], advanceTimers: true, now: Date.parse(account.clock) });
    // the device's zone is the demo account's
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function zone(this: Intl.DateTimeFormat) {
      return { ...resolved.call(this), timeZone: 'Asia/Ho_Chi_Minh' };
    });
    // every "back to the app" listener (AppState is a Jest mock), to bring the app to the foreground after the clock moved
    jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
      active.push(args[1] as (state: string) => void);
      return { remove: () => undefined };
    });
    // the OS "reduce motion" value stays unknown, so the app renders its static (reduced) state, as in App.test.tsx
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
  });

  test('sign in, onboard, record both STORY quests, and see streak 1 after the night', async () => {
    render(<App />);
    // Welcome → sign in
    fireEvent.press(await screen.findByRole('button', { name: 'Tôi đã có tài khoản' }));
    await header('Chào bạn trở lại');
    type('Email', account.email);
    type('Mật khẩu', account.password);
    press('Đăng nhập');

    // the four onboarding steps
    await header(onboardingVi.profileTitle);
    type('Năm sinh', '1995');
    type('Chiều cao · cm', '168');
    type('Cân nặng · kg', '62');
    fireEvent.press(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Chọn' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Nữ' }));
    press('Tiếp tục');
    await header(onboardingVi.activityTitle);
    fireEvent.press(screen.getByRole('radio', { name: /^Vận động nhẹ/ }));
    press(onboardingVi.activityNext);
    await header(onboardingVi.archetypeTitle);
    fireEvent.press(screen.getByRole('radio', { name: /^Cân bằng lại nhịp sống/ }));
    press(onboardingVi.archetypeNext);
    await header(onboardingVi.targetsTitle);
    press('Đến Hôm nay');

    // Today: one water tick, confirmed by the server
    fireEvent.press(await screen.findByRole('button', { name: /^Nước hôm nay\. 0 \/ 8 phần\./ }));
    expect(await screen.findByRole('button', { name: 'Nước hôm nay. 1 / 8 phần. Chạm để ghi thêm một phần.' })).toBeTruthy();

    // the quest board → calories inside the band the server gives
    press('Xem tất cả nhiệm vụ');
    await header('Nhiệm vụ hôm nay');
    fireEvent.press(await screen.findByRole('button', { name: /^Bữa ăn theo mục tiêu/ }));
    await header('Ghi bữa ăn');
    const { calorieWindow } = await server<DayState>('/day');
    type(/^Số kcal/, String(Math.round((calorieWindow.min + calorieWindow.max) / 2)));
    press('Ghi món đã ăn');
    expect(await screen.findByText('Bữa ăn theo mục tiêu đã xong', { exact: false })).toBeTruthy();
    // a confirmed meal takes the person back to the board by itself
    await header('Nhiệm vụ hôm nay');

    // the workout catalog → detail → a focus session ended through the dialog past half its length
    fireEvent.press(await screen.findByRole('button', { name: /^Buổi tập chính/ }));
    await header(workoutVi.catalogTitle);
    const card = await screen.findByRole('button', { name: /^Xem hướng dẫn: / });
    const name = String(card.props.accessibilityLabel).replace(/^Xem hướng dẫn: /, '');
    const { items } = await server<WorkoutCatalog>('/workout/catalog');
    const { durationSec } = items.find(item => item.name === name)!;
    fireEvent.press(card);
    await header(name);
    press('Bắt đầu tập');
    await header(workoutVi.focusTitle);
    jest.setSystemTime(Date.now() + Math.ceil(durationSec * 0.6) * 1000);
    press('Kết thúc buổi tập');
    fireEvent.press(await screen.findByRole('button', { name: 'Kết thúc và lưu' }));
    await header(workoutVi.completedTitle);
    press('Về Hôm nay');

    // back on Today: both STORY rows are done
    expect(await screen.findByRole('button', { name: /^Vận động vừa sức\..*\. Đã xong$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ăn đủ cho mục tiêu\..*\. Đã xong$/ })).toBeTruthy();

    // the night: the clock past 03:00 (16 past, as the scheduler would run), day-close, the app back in front
    const { closesAt } = await server<DayState>('/day');
    const morning = new Date(Date.parse(closesAt) + 16 * 60_000).toISOString();
    cli(`scenario -- clock ${morning}`);
    // the jobs CLI prints its result as the last line
    const run = JSON.parse(cli('jobs -- day-close').trim().split(/\r?\n/).at(-1)!);
    expect(run.result).toMatchObject({ failed: 0, skipped: 0 });
    expect(run.result.applied).toBeGreaterThanOrEqual(1);
    deviceClockAt(morning);
    await act(async () => active.forEach(listener => listener('active')));
    // a new day on Today, and the streak of the day before
    expect(await screen.findByRole('button', { name: /^Nước hôm nay\. 0 \/ 8 phần\./ })).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: todayVi.statsLink }));
    expect(await screen.findByText(/chuỗi 1 ngày\.$/)).toBeTruthy();
    press('Quay lại');
    fireEvent.press(await screen.findByRole('tab', { name: 'Cá nhân' }));
    fireEvent.press(await screen.findByRole('button', { name: /^Hành trình & chỉ số/ }));
    expect(await screen.findByText(progressionVi.streakRunning)).toBeTruthy();
    expect(screen.getByText(progressionVi.record(1))).toBeTruthy();
    screen.unmount();
  }, 3 * MINUTE);
});
