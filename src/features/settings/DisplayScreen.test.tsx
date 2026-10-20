import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, Animated, AppState } from 'react-native';
import { forget, navigated } from '../guild/navigationSpy';
import { act, fireEvent, hold, installTodayTestEnv, MotionProbe, motionNow, openDisplay, openSettings, refuse, screen, settingsOf, settingsPatches, settle, switchOf, USER, waitFor, world } from './settingsTestKit';

// The real registry, every `navigate` recorded.
jest.mock('../../app/screens', () => require('../guild/navigationSpy').spied(jest.requireActual('../../app/screens')));

installTodayTestEnv();
beforeEach(forget);

const open = (options: Parameters<typeof openDisplay>[0] = {}) => openDisplay({ motion: 'settings', extra: <MotionProbe />, ...options });
const segment = (name: string) => screen.getByRole('radio', { name });
const prefs = () => AsyncStorage.getItem(`prefs:v1:${USER}`);
const PATCH = 'PATCH /settings';

describe('S79', () => {
  test('the words of the frame: the three headings, the segmented control, the two notes, the streak switch and the theme in use', async () => {
    const view = await open();
    expect(screen.getByRole('header', { name: 'Hiển thị & chuyển động' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Chuyển động' })).toBeTruthy();
    expect(screen.getByLabelText('Chuyển động')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Theo hệ thống', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Giảm', checked: false })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Đầy đủ', checked: false })).toBeTruthy();
    expect(screen.getByText('Khi giảm chuyển động, mọi thông tin vẫn hiện bằng chữ.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Chuỗi ngày' })).toBeTruthy();
    expect(switchOf('Ẩn số ngày chuỗi').props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText('Chuỗi vẫn được tính, chỉ ẩn con số trên Hôm nay.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Chủ đề' })).toBeTruthy();
    view.unmount();
  });

  test('the motion setting the server holds is the one chosen on arrival', async () => {
    world.settings = settingsOf({ motion: 'FULL' });
    const view = await open();
    expect(screen.getByRole('radio', { name: 'Đầy đủ', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Theo hệ thống', checked: false })).toBeTruthy();
    view.unmount();
  });

  test('"Chủ đề" shows the theme in use and opens the inventory', async () => {
    const view = await open();
    const row = screen.getByRole('button', { name: 'Hồi Máu nguyên bản. Đang dùng' });
    navigated.length = 0;
    fireEvent.press(row);
    expect(navigated).toEqual([['Inventory']]);
    expect(await screen.findByRole('header', { name: 'Kho đồ của bạn' })).toBeTruthy();
    view.unmount();
  });
});

describe('choosing the motion', () => {
  test('"Giảm": one PATCH { motion: "REDUCED" }, a child component reads useReducedMotion() as true, and the choice is kept on the device', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    world.settings = settingsOf({ motion: 'FULL' });
    const view = await open();
    expect(motionNow()).toBe('full');
    fireEvent.press(segment('Giảm'));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ motion: 'REDUCED' });
    await settle();
    expect(motionNow()).toBe('reduced');
    expect(screen.getByRole('radio', { name: 'Giảm', checked: true })).toBeTruthy();
    expect(world.settings.motion).toBe('REDUCED');
    expect(await prefs()).toBe('{"motion":"REDUCED"}');
    view.unmount();
  });

  test('"Đầy đủ" turns it back: false for the child, and the device keeps FULL', async () => {
    world.settings = settingsOf({ motion: 'REDUCED' });
    const view = await open();
    expect(motionNow()).toBe('reduced');
    fireEvent.press(segment('Đầy đủ'));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ motion: 'FULL' });
    await settle();
    expect(motionNow()).toBe('full');
    expect(await prefs()).toBe('{"motion":"FULL"}');
    view.unmount();
  });

  test.each([
    [true, 'reduced'],
    [false, 'full'],
  ])('"Theo hệ thống" follows the phone: the system says reduce = %s, the child reads %s; the PATCH is { motion: "SYSTEM" }', async (system, expected) => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(system);
    world.settings = settingsOf({ motion: system ? 'FULL' : 'REDUCED' });
    const view = await open();
    fireEvent.press(segment('Theo hệ thống'));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ motion: 'SYSTEM' });
    await settle();
    expect(motionNow()).toBe(expected);
    expect(await prefs()).toBe('{"motion":"SYSTEM"}');
    view.unmount();
  });

  test('choosing what is already chosen sends nothing', async () => {
    const view = await open();
    fireEvent.press(segment('Theo hệ thống'));
    await settle();
    expect(settingsPatches()).toEqual([]);
    view.unmount();
  });

  test('the new choice is on screen and in force before the server has answered', async () => {
    const gate = hold(PATCH);
    world.settings = settingsOf({ motion: 'FULL' });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const view = await open();
    fireEvent.press(segment('Giảm'));
    await settle();
    expect(screen.getByRole('radio', { name: 'Giảm', checked: true })).toBeTruthy();
    expect(motionNow()).toBe('reduced');
    await act(async () => gate.release());
    await settle();
    view.unmount();
  });

  test('refused (a 500): the control, the app and what the device keeps all go back to what the server holds, with a message', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    world.settings = settingsOf({ motion: 'FULL' });
    let release!: (answer: unknown) => void;
    const gate = new Promise<unknown>(resolve => (release = resolve));
    const view = await openDisplay({ motion: 'settings', extra: <MotionProbe /> });
    world.answer = request => (request === PATCH ? gate : undefined);
    await settle();
    expect(await prefs()).toBe('{"motion":"FULL"}');
    fireEvent.press(segment('Giảm'));
    await settle();
    expect(motionNow()).toBe('reduced');
    await act(async () => release(refuse(500, 'INTERNAL')));
    expect(await screen.findByText('Chưa lưu được thay đổi này, nên mình đã để lại như cũ. Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
    await settle();
    expect(screen.getByRole('radio', { name: 'Đầy đủ', checked: true })).toBeTruthy();
    expect(motionNow()).toBe('full');
    await waitFor(async () => expect(await prefs()).toBe('{"motion":"FULL"}'));
    view.unmount();
  });
});

describe('the Mầm preview', () => {
  // Jest's AppState has no real state: the loops of the app only run while it says "active".
  const mockedAppState = AppState as unknown as { currentState: unknown };
  const appStateAtLoad = mockedAppState.currentState;
  beforeEach(() => {
    mockedAppState.currentState = 'active';
    // no flame on the home tab, and its Mầm is not on the screen in focus: what loops after this screen opens is the preview
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), streakCurrent: 0 } };
    world.day = { ...world.day, streak: { current: 0, best: 9 } };
  });
  afterEach(() => {
    mockedAppState.currentState = appStateAtLoad;
  });
  const loops = () => {
    const stop = jest.fn();
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() } as never);
    return { loop, stop };
  };
  /** Settings, then the display row: what starts from here on is counted. */
  async function openCounting(spies: ReturnType<typeof loops>) {
    const view = await openSettings({ motion: 'settings', extra: <MotionProbe /> });
    spies.loop.mockClear();
    spies.stop.mockClear();
    fireEvent.press(screen.getByRole('button', { name: /^Hiển thị & chuyển động/ }));
    await screen.findByRole('header', { name: 'Hiển thị & chuyển động' });
    await settle();
    await settle();
    return view;
  }

  test('with motion on the preview moves', async () => {
    world.settings = settingsOf({ motion: 'FULL' });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const spies = loops();
    const view = await openCounting(spies);
    expect(spies.loop).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('reduced from the start: the preview starts no animation at all; choosing "Đầy đủ" starts it, and "Giảm" stops it again', async () => {
    world.settings = settingsOf({ motion: 'REDUCED' });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const spies = loops();
    const view = await openCounting(spies);
    expect(spies.loop).not.toHaveBeenCalled();
    fireEvent.press(segment('Đầy đủ'));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    await settle();
    expect(spies.loop).toHaveBeenCalledTimes(1);
    expect(spies.stop).not.toHaveBeenCalled();
    fireEvent.press(segment('Giảm'));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    await settle();
    expect(spies.stop).toHaveBeenCalledTimes(1);
    expect(spies.loop).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('"Theo hệ thống" with the phone asking for reduced motion: the preview stands still', async () => {
    world.settings = settingsOf({ motion: 'SYSTEM' });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const spies = loops();
    const view = await openCounting(spies);
    expect(motionNow()).toBe('reduced');
    expect(spies.loop).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('"Ẩn số ngày chuỗi"', () => {
  test('one PATCH { hideStreak: true }, shown at once; again: { hideStreak: false }', async () => {
    const view = await open();
    fireEvent.press(switchOf('Ẩn số ngày chuỗi'));
    await settle();
    expect(switchOf('Ẩn số ngày chuỗi').props.accessibilityState).toMatchObject({ checked: true });
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ hideStreak: true });
    expect(world.settings.hideStreak).toBe(true);
    fireEvent.press(switchOf('Ẩn số ngày chuỗi'));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    expect(settingsPatches()[1].body).toEqual({ hideStreak: false });
    view.unmount();
  });

  test('refused: the switch goes back and says why', async () => {
    world.answer = request => (request === PATCH ? refuse(500, 'INTERNAL') : undefined);
    const view = await open();
    fireEvent.press(switchOf('Ẩn số ngày chuỗi'));
    expect(await screen.findByText('Chưa lưu được thay đổi này', { exact: false })).toBeTruthy();
    await settle();
    expect(switchOf('Ẩn số ngày chuỗi').props.accessibilityState).toMatchObject({ checked: false });
    view.unmount();
  });
});

test('Settings is where S79 opens from: "Hiển thị & chuyển động" says the choice, and the screen opens', async () => {
  world.settings = settingsOf({ motion: 'REDUCED' });
  const view = await openSettings();
  fireEvent.press(screen.getByRole('button', { name: 'Hiển thị & chuyển động. Giảm chuyển động' }));
  expect(await screen.findByRole('header', { name: 'Hiển thị & chuyển động' })).toBeTruthy();
  view.unmount();
});
