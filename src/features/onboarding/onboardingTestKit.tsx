/* eslint-env jest */
// Test kit for the onboarding screens (used by their *.test.tsx files; never imported by app code).
// A signed-in, not-yet-onboarded user inside the real providers and navigators, against the stubbed `fetch` of the
// auth kit, which records every request.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as Keychain from 'react-native-keychain';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Me } from '../../../domain/contract/core.ts';
import { localParts } from '../../../domain/logicalDate.ts';
import { AppNavigation } from '../../app/navigation';
import { SessionProvider, wipeQueries } from '../../shared/api/session';
// titles come from the i18n module: only *.test.tsx files may spell Vietnamese out (sourceGuards)
import * as vi from '../../shared/i18n/vi/onboarding';
import { MotionPreferenceProvider, resetSystemMotionForTests } from '../../shared/motion/useReducedMotion';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { fetchMock, me, respond, settle, TOKEN, USER } from '../auth/authTestKit';
import { OnboardingProvider, type OnboardingDraft, type OnboardingState } from './OnboardingProvider';

export { fetchMock, me, refuse, respond, sent, settle, TOKEN, USER, watchFocus } from '../auth/authTestKit';

const BASE = 'http://localhost:8787/api/v1';
/** What `GET /meta/timezones` answers in these tests. `CET` is deliberately absent: Intl reads it, the server does not. */
export const ZONES = ['Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Europe/Paris', 'UTC'];
export const meOnboarded: Me = { ...me, user: { ...me.user, archetype: 'TANKER', onboarded: true } };

/** The current year where the tests' default zone is, so "age 15" stays true whenever the suite runs. */
export const thisYear = () => Number(localParts(Date.now(), 'Asia/Ho_Chi_Minh').date.slice(0, 4));
export const bornAt = (age: number) => String(thisYear() - age);

/** 1500 -> "1.500", written independently of the app's own grouping. */
export const dotted = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

type Init = Parameters<typeof fetchMock>[1];
type Answer = unknown | Error | ((init: Init) => unknown);
/**
 * Answers by "METHOD /path"; an Error is thrown (no connection), a function is called per request, anything
 * unlisted is a 404. `GET /me` (not onboarded) and the zone list are answered unless overridden.
 */
export function serve(routes: Record<string, Answer> = {}) {
  const all: Record<string, Answer> = { 'GET /me': respond(200, me), 'GET /meta/timezones': respond(200, { zones: ZONES }), ...routes };
  fetchMock.mockImplementation(async (url, init) => {
    const answer = all[`${init.method} ${url.replace(BASE, '')}`];
    if (answer === undefined) return respond(404);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? (answer as (init: Init) => unknown)(init) : answer;
  });
}

/** An answer that never comes; like a real fetch it ends when its signal aborts (so the client's timer is released). */
export const never = (init: Init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted'))));

const real = Intl.DateTimeFormat.prototype.resolvedOptions;
/** The device reports this zone (Intl is otherwise untouched). */
export function deviceZone(zone: string) {
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolved(this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: zone };
  });
}

const STEPS = ['OnbProfile', 'OnbActivity', 'OnbArchetype', 'OnbTargets'] as const;
export type Step = (typeof STEPS)[number];
/** A complete, valid draft: an adult whose every direction is allowed. */
export const draft: OnboardingDraft = {
  birthYear: bornAt(30),
  heightCm: '171,5',
  weightKg: '63.25',
  sex: 'MALE',
  timezone: 'Asia/Ho_Chi_Minh',
  activityLevel: 'LIGHT',
  archetype: 'TANKER',
};

let client: QueryClient | undefined;
export const queryClient = () => client as QueryClient;

type Initial = Partial<Omit<OnboardingState, 'draft'>> & { draft?: Partial<OnboardingDraft> };
/** Signs the user in and opens onboarding on `step`, with the earlier steps underneath (so Back and "go back to" work). */
export async function mount(step: Step = 'OnbProfile', initial?: Initial, { extra, motion = 'REDUCED' }: { extra?: ReactNode; motion?: 'REDUCED' | 'FULL' } = {}) {
  await Keychain.setGenericPassword(USER, TOKEN);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const routes = STEPS.slice(0, STEPS.indexOf(step) + 1).map(name => ({ name }));
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <MotionPreferenceProvider value={motion}>
          <QueryClientProvider client={client}>
            <SessionProvider>
              <OnboardingProvider initial={initial}>
                <AppNavigation initialState={{ routes, index: routes.length - 1 }} />
                {extra}
              </OnboardingProvider>
            </SessionProvider>
          </QueryClientProvider>
        </MotionPreferenceProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

export const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
export const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
export const choose = (name: string | RegExp) => fireEvent.press(screen.getByRole('radio', { name }));
/** The step with this title is on screen and the requests it started have landed. */
export async function onStep(title: string) {
  const header = await screen.findByRole('header', { name: title });
  await settle();
  return header;
}
export const TITLES = { OnbProfile: vi.profileTitle, OnbActivity: vi.activityTitle, OnbArchetype: vi.archetypeTitle, OnbTargets: vi.targetsTitle } as const;
/** Picks an option of a `SelectField` whose combobox currently reads `field`. */
export function select(field: string, option: string) {
  fireEvent.press(screen.getByRole('combobox', { name: field }));
  fireEvent.press(screen.getByRole('radio', { name: option }));
}
/**
 * The labels of the inputs that receive `focus()` from now on, in order. For inputs that are not on screen yet
 * (`watchFocus` needs a mounted one): every input of the Jest mock shares one recorded `focus`.
 */
export function focusLog(): () => string[] {
  const { TextInput } = require('react-native');
  const focus = jest.spyOn(TextInput.prototype, 'focus');
  const before = focus.mock.calls.length;
  return () => focus.mock.contexts.slice(before).map(input => (input as { props: { accessibilityLabel: string } }).props.accessibilityLabel);
}
export const requests = (path: string) => fetchMock.mock.calls.filter(([url]) => url.replace(BASE, '') === path);

/** Every key and value AsyncStorage holds, as one string to search. */
export async function diskText() {
  return JSON.stringify(Object.entries(await AsyncStorage.getMany(await AsyncStorage.getAllKeys())));
}

const realFetch = globalThis.fetch;
let errors: jest.SpyInstance;

/** beforeEach / afterEach for an onboarding test file; the console must stay silent. */
export function installOnboardingTestEnv() {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    serve();
    deviceZone('Asia/Ho_Chi_Minh');
    // The OS "reduce motion" value stays unknown, so anything outside the REDUCED provider is static too.
    const { AccessibilityInfo } = require('react-native');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise<boolean>(() => undefined));
    errors = jest.spyOn(console, 'error');
  });
  afterEach(async () => {
    const complaints = errors.mock.calls
      // bottom-tabs clears its previous screen on a 32 ms timer of its own (see src/app/navigation.test.tsx)
      .filter(call => !(String(call[0]).includes('not wrapped in act') && call[1] === 'BottomTabView'))
      .map(call => String(call[0]));
    // RNTL has already unmounted the tree: only now is it safe to drop the cache (never while screens are mounted).
    if (client) wipeQueries(client);
    client = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
    resetSystemMotionForTests();
    await Keychain.resetGenericPassword();
    await AsyncStorage.clear();
    globalThis.fetch = realFetch;
    expect(complaints).toEqual([]);
  });
}
