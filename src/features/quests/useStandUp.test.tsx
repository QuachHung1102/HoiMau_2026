import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AppState } from 'react-native';
import { wipeQueries } from '../../shared/api/session';
import { app, dayOf, installTodayTestEnv, meOf, openToday, queryClient, requested, settle, STAND_UP, USER, world, writes } from '../dashboard/todayTestKit';
import { mountApp } from '../sync/syncTestKit';
import { STAND_UP_INTERVAL_MS } from './standUpTimer';
import { useStandUpHold } from './useStandUp';

installTodayTestEnv();

const MIN = 60_000;
const PROMPT = 'Đến lúc đứng dậy vươn vai một chút';
const ACTION = 'Mình vừa đứng dậy';
const KEY = `standup:v1:${USER}`;
// Timers only: a microtask queued by an unmount is not something that keeps Jest alive.
const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });

const mockedAppState = AppState as unknown as { currentState: unknown };
const appStateAtLoad = mockedAppState.currentState;
let listeners: ((state: string) => void)[] = [];
/** The app in the foreground, and a way to move it to the background and back as the system would. */
function foreground() {
  mockedAppState.currentState = 'active';
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
    listeners.push(listener);
    return { remove: () => {
        listeners = listeners.filter(item => item !== listener);
      },
    };
  }) as never);
}
const system = (state: 'active' | 'background') => act(async () => listeners.forEach(listener => listener(state)));
const pass = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const prompt = () => screen.queryByText(PROMPT);
const stored = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null');
const standUps = () => writes().filter(request => request.path === `/day/quests/${STAND_UP}/progress`);

// A stand-in for the focus flow: a screen that holds the reminder while it is mounted (the real ones are the workout screens).
let focusFlow: (shown: boolean | string) => void = () => undefined;
function Holding() {
  useStandUpHold();
  return null;
}
function FocusFlow() {
  const [shown, setShown] = useState<boolean | string>(false);
  focusFlow = setShown;
  return shown ? <Holding key={String(shown)} /> : null;
}

afterEach(() => {
  mockedAppState.currentState = appStateAtLoad;
  listeners = [];
});

describe('the prompt', () => {
  test('after 60 foreground minutes a snackbar asks for a stand-up, once; not a minute earlier', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(59 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    expect(screen.getByRole('button', { name: ACTION })).toBeTruthy();
    // it is a request, not an alarm: it goes away by itself, and nothing was recorded for the person
    expect(standUps()).toEqual([]);
    await pass(15_000);
    expect(prompt()).toBeNull();
    expect(standUps()).toEqual([]);
    view.unmount();
  });

  test('"Mình vừa đứng dậy" is one STAND_UP tick, with the S11 snackbar and its Undo, and a new hour begins', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(60 * MIN);
    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeTruthy();
    expect(standUps()).toHaveLength(1);
    expect(standUps()[0].body).toEqual({});
    // the server's day has it
    expect(world.day.quests.find(quest => quest.code === STAND_UP)?.progress).toBe(1);

    // a new hour: nothing at 59 minutes, the next prompt at 60
    await pass(59 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });

  test('without the prompt being answered the hour restarts anyway: the next request comes an hour later, not at once', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(60 * MIN);
    expect(prompt()).toBeTruthy();
    await pass(16_000);
    expect(prompt()).toBeNull();
    await pass(59 * MIN - 16_000);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    expect(standUps()).toEqual([]);
    view.unmount();
  });

  test('a quest that is complete is not asked for: the hours pass without a prompt, and without a record', async () => {
    fakeTimers();
    foreground();
    world.day = dayOf();
    world.day.quests = world.day.quests.map(quest => (quest.code === STAND_UP ? { ...quest, progress: 6, completed: true } : quest));
    const view = await openToday();
    await pass(61 * MIN);
    expect(prompt()).toBeNull();
    await pass(120 * MIN);
    expect(prompt()).toBeNull();
    expect(standUps()).toEqual([]);
    view.unmount();
  });

  test('a day without the quest is not asked for either', async () => {
    fakeTimers();
    foreground();
    world.day = dayOf();
    world.day.quests = world.day.quests.filter(quest => quest.code !== STAND_UP);
    const view = await openToday();
    await pass(61 * MIN);
    expect(prompt()).toBeNull();
    view.unmount();
  });

  test('when the app is not in the foreground at all, no countdown runs and no prompt comes', async () => {
    fakeTimers();
    const view = await openToday(); // Jest: AppState.currentState is not 'active'
    await pass(5 * 60 * MIN);
    expect(prompt()).toBeNull();
    expect(await stored()).toBeNull();
    view.unmount();
  });
});

describe('the background', () => {
  test('a 5-minute stay does not pause it: the prompt comes 25 minutes after the return', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(30 * MIN);
    await system('background');
    await pass(5 * MIN);
    expect(prompt()).toBeNull();
    await system('active');
    await pass(24 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });

  test('an 11-minute stay pauses it: the prompt comes 30 minutes after the return, as if the time away had not been', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(30 * MIN);
    await system('background');
    await pass(11 * MIN);
    await system('active');
    await pass(29 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });

  test('nothing is shown while the app is away, even when the hour would have run out there', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(55 * MIN);
    await system('background');
    await pass(9 * MIN);
    expect(prompt()).toBeNull();
    // back after 9 minutes: the hour is up, the prompt is the first thing
    await system('active');
    await pass(0);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });
});

describe('kept on this device', () => {
  test('the countdown is saved under standup:v1:<userId>, timing only', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(20 * MIN);
    await system('background');
    await settle();
    // 40 minutes left, less the few milliseconds the mount itself took on the fake clock
    const kept = await stored();
    expect(kept).toEqual({ remainingMs: expect.any(Number), at: expect.any(Number), running: false });
    expect(kept.remainingMs).toBeGreaterThan(40 * MIN - 1000);
    expect(kept.remainingMs).toBeLessThanOrEqual(40 * MIN);
    expect(Object.keys(await stored()).sort()).toEqual(['at', 'remainingMs', 'running']);
    view.unmount();
  });

  test('a restart of the app does not give a free hour', async () => {
    fakeTimers();
    foreground();
    const first = await openToday();
    await pass(20 * MIN);
    await system('background');
    await settle();
    first.unmount();
    await pass(2 * MIN);
    // the app is opened again 2 minutes later, in the foreground
    foreground();
    const second = await openToday();
    await pass(37 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    second.unmount();
  });

  test('after a long absence the saved time is where it was left (the time away is not counted)', async () => {
    fakeTimers();
    foreground();
    const first = await openToday();
    await pass(20 * MIN);
    await system('background');
    await settle();
    first.unmount();
    await pass(8 * 60 * MIN);
    foreground();
    const second = await openToday();
    await pass(39 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    second.unmount();
  });

  test('a countdown saved while it was running was last known at its start: the time since is away, not foreground', async () => {
    fakeTimers();
    foreground();
    const now = Date.now();
    await AsyncStorage.setItem(KEY, JSON.stringify({ remainingMs: 30 * MIN, at: now - 5 * MIN, running: true }));
    const view = await openToday();
    // 5 minutes since: a short stay, counted: 25 minutes left
    await pass(24 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });

  test('what cannot be read is not used: a corrupted or implausible value starts a fresh hour', async () => {
    fakeTimers();
    foreground();
    await AsyncStorage.setItem(KEY, JSON.stringify({ remainingMs: -5, at: 'x', running: 1 }));
    const view = await openToday();
    await pass(59 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    expect(STAND_UP_INTERVAL_MS).toBe(60 * MIN);
    view.unmount();
  });
});

describe('leaving', () => {
  test('unmounting leaves no timer of the reminder behind', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(MIN);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    // the queries are dropped as sign-out does (their own garbage-collection timers would be left otherwise)
    wipeQueries(queryClient());
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('where the reminder lives: the signed-in, onboarded shell', () => {
  test('another tab on top: the prompt still comes', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    fireEvent.press(screen.getByRole('tab', { name: 'Lộ trình' }));
    expect(await screen.findByRole('tab', { name: 'Lộ trình', selected: true })).toBeTruthy();
    await pass(60 * MIN);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });

  test('a detail screen on top: the prompt still comes, and its action records the tick', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    fireEvent.press(screen.getByRole('button', { name: 'Xem tất cả nhiệm vụ' }));
    await screen.findByRole('header', { name: 'Nhiệm vụ hôm nay' });
    await pass(60 * MIN);
    expect(prompt()).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    expect(await screen.findByText('Đã ghi nhận · +10 XP')).toBeTruthy();
    expect(standUps()).toHaveLength(1);
    view.unmount();
  });

  test('a focus-flow screen holds the reminder: no prompt over it when the hour runs out; once it has left, a new hour begins', async () => {
    fakeTimers();
    foreground();
    const view = await openToday({ extra: <FocusFlow /> });
    await pass(50 * MIN);
    act(() => focusFlow(true));
    // the hour runs out ten minutes into the hold
    await pass(20 * MIN);
    expect(prompt()).toBeNull();
    act(() => focusFlow(false));
    // not at once either: the person has just been moving
    expect(prompt()).toBeNull();
    await pass(59 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    expect(standUps()).toEqual([]);
    view.unmount();
  });

  test('a prompt that is on screen when the focus flow begins is taken away', async () => {
    fakeTimers();
    foreground();
    const view = await openToday({ extra: <FocusFlow /> });
    await pass(60 * MIN);
    expect(prompt()).toBeTruthy();
    act(() => focusFlow(true));
    expect(prompt()).toBeNull();
    view.unmount();
  });

  test('two focus-flow screens in a row (the session, then its result) are one hold', async () => {
    fakeTimers();
    foreground();
    const view = await openToday({ extra: <FocusFlow /> });
    await pass(55 * MIN);
    act(() => focusFlow(true));
    await pass(10 * MIN);
    // the first screen is replaced by the second in one step
    act(() => focusFlow('result'));
    await pass(10 * MIN);
    expect(prompt()).toBeNull();
    act(() => focusFlow(false));
    await pass(59 * MIN);
    expect(prompt()).toBeNull();
    await pass(MIN);
    expect(prompt()).toBeTruthy();
    view.unmount();
  });

  test('a person who has not finished onboarding has no reminder: nothing is read, kept or armed', async () => {
    fakeTimers();
    foreground();
    world.me = meOf({ user: { ...meOf().user, onboarded: false } });
    const view = await mountApp({ landed: false });
    await screen.findByText('Bắt đầu từ bạn');
    await pass(3 * 60 * MIN);
    expect(prompt()).toBeNull();
    expect(requested('/day')).toBe(0);
    expect(await stored()).toBeNull();
    view.unmount();
    wipeQueries(queryClient());
    expect(jest.getTimerCount()).toBe(0);
  });

  test('after sign-out nothing is armed, nothing is kept, and nothing is left running', async () => {
    fakeTimers();
    foreground();
    const view = await openToday();
    await pass(20 * MIN);
    await system('background');
    await settle();
    expect(await stored()).not.toBeNull();
    await system('active');
    await act(() => app.session.signOut());
    await settle();
    expect(await stored()).toBeNull();
    await pass(3 * 60 * MIN);
    expect(prompt()).toBeNull();
    view.unmount();
    wipeQueries(queryClient());
    expect(jest.getTimerCount()).toBe(0);
    // and it was not written back after the wipe
    expect(await stored()).toBeNull();
  });
});
