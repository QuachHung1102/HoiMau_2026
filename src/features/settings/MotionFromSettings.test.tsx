/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo } from 'react-native';
import { useSession } from '../../shared/api/session';
import { useReducedMotion } from '../../shared/motion/useReducedMotion';
import { mountApp } from '../sync/syncTestKit';
import { useMe } from '../auth/api';
import { fireEvent, hold, installTodayTestEnv, openSettings, reads, screen, settingsOf, settle, USER, waitFor, world } from './settingsTestKit';

// The `motion` setting reaches the whole app through App.tsx's MotionFromSettings; the kit mounts the same provider in the same place.
installTodayTestEnv();

const PREFS = `prefs:v1:${USER}`;
/** What `useReducedMotion()` said at every render of the shell, from the first one that has the profile (a screen is drawn from there on). */
const seen: string[] = [];
function ShellProbe() {
  const reduced = useReducedMotion();
  const me = useMe().data;
  if (me) seen.push(reduced ? 'reduced' : 'full');
  return null;
}
beforeEach(() => {
  seen.length = 0;
});
/** The profile takes its time, as a network does: the device's own copy of the preference is long since read. */
const slowProfile = () => {
  world.answer = async request => {
    if (request === 'GET /me') await new Promise(resolve => setTimeout(resolve, 60));
    return undefined;
  };
};
const start = () => mountApp({ landed: false, motion: 'settings', extra: <ShellProbe /> });

describe('a cold start: the preference kept on the device is in force from the first frame of the shell, before the server has been asked', () => {
  test.each([
    ['REDUCED', ['reduced']],
    ['FULL', ['full']],
  ])('%s was kept: the shell never sees another value, while GET /settings is still out', async (word, expected) => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(word === 'REDUCED' ? false : true);
    await AsyncStorage.setItem(PREFS, JSON.stringify({ motion: word }));
    slowProfile();
    const settingsRead = hold('GET /settings');
    const view = await start();
    await screen.findByRole('header', { name: 'Hôm nay' });
    await settle();
    expect(seen.length).toBeGreaterThan(0);
    expect([...new Set(seen)]).toEqual(expected);
    settingsRead.release();
    await settle();
    view.unmount();
  });

  test('while the kept word is still being read the app is static, then it is the word (also for FULL)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await AsyncStorage.setItem(PREFS, JSON.stringify({ motion: 'FULL' }));
    const real = AsyncStorage.getItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key => {
      if (key === PREFS) await new Promise(resolve => setTimeout(resolve, 80));
      return real(key);
    });
    const settingsRead = hold('GET /settings');
    const early: string[] = [];
    function Early() {
      const reduced = useReducedMotion();
      if (useSession().userId) early.push(reduced ? 'reduced' : 'full');
      return null;
    }
    const view = await mountApp({ landed: false, motion: 'settings', extra: <Early /> });
    await waitFor(() => expect(early.at(-1)).toBe('full'));
    expect(early[0]).toBe('reduced');
    expect(early.filter(value => value === 'reduced').length).toBeGreaterThan(0);
    settingsRead.release();
    await settle();
    view.unmount();
  });

  test('nothing kept (the first run): the system decides, as the default of the setting says', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    slowProfile();
    const settingsRead = hold('GET /settings');
    const view = await start();
    await screen.findByRole('header', { name: 'Hôm nay' });
    await settle();
    expect([...new Set(seen)]).toEqual(['full']);
    settingsRead.release();
    view.unmount();
  });

  test('a word that is not one of the three is ignored', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await AsyncStorage.setItem(PREFS, JSON.stringify({ motion: 'LOUD' }));
    slowProfile();
    const settingsRead = hold('GET /settings');
    const view = await start();
    await screen.findByRole('header', { name: 'Hôm nay' });
    await settle();
    expect([...new Set(seen)]).toEqual(['full']);
    settingsRead.release();
    view.unmount();
  });

  test('the server\'s word replaces the kept one once it is read, and the device keeps the new one', async () => {
    await AsyncStorage.setItem(PREFS, JSON.stringify({ motion: 'FULL' }));
    world.settings = settingsOf({ motion: 'REDUCED' });
    const view = await start();
    await screen.findByRole('header', { name: 'Hôm nay' });
    await waitFor(() => expect(seen.at(-1)).toBe('reduced'));
    await waitFor(async () => expect(await AsyncStorage.getItem(PREFS)).toBe('{"motion":"REDUCED"}'));
    view.unmount();
  });

  test('the first run: what the server holds is kept for the next start', async () => {
    world.settings = settingsOf({ motion: 'FULL' });
    const view = await start();
    await screen.findByRole('header', { name: 'Hôm nay' });
    await waitFor(async () => expect(await AsyncStorage.getItem(PREFS)).toBe('{"motion":"FULL"}'));
    view.unmount();
  });

  test('a person who has not finished onboarding is not asked for settings (the route is for an onboarded user)', async () => {
    world.me = { ...world.me, user: { ...world.me.user, onboarded: false }, progression: null, stats: null, pet: null, appearance: null };
    const view = await start();
    await screen.findByRole('header', { name: 'Bắt đầu từ bạn' });
    await settle();
    expect(reads('/settings')).toBe(0);
    expect(await AsyncStorage.getItem(PREFS)).toBeNull();
    view.unmount();
  });
});

describe('sign-out and the preference', () => {
  test('signing out removes what the device kept for that person', async () => {
    world.settings = settingsOf({ motion: 'REDUCED' });
    const view = await openSettings({ motion: 'settings' });
    await waitFor(async () => expect(await AsyncStorage.getItem(PREFS)).toBe('{"motion":"REDUCED"}'));
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByRole('button', { name: 'Bắt đầu hành trình' })).toBeTruthy();
    await settle();
    expect(await AsyncStorage.getItem(PREFS)).toBeNull();
    view.unmount();
  });
});

describe('App.tsx', () => {
  test('mounts it inside the session (it needs the user and the query client) and around the navigators, so every screen is below it', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app/App.tsx'), 'utf8');
    expect(source).toMatch(/<SessionProvider>[\s\S]*<MotionFromSettings>[\s\S]*<AppNavigation>[\s\S]*<\/AppNavigation>[\s\S]*<\/MotionFromSettings>[\s\S]*<\/SessionProvider>/);
  });
});
