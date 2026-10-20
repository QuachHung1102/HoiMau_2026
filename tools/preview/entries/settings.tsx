import { useEffect } from 'react';
import type { Inventory } from '../../../domain/contract/content.ts';
import type { Me, PrescriptionResponse, Settings } from '../../../domain/contract/core.ts';
import { calculatePrescription } from '../../../domain/energy.ts';
import { SHOP_ITEMS } from '../../../server/content/shopItems.ts';
import { prescriptionKey, timezonesKey } from '../../../src/features/onboarding/api';
import { inventoryKey, petKey } from '../../../src/features/shop/api';
import * as authVi from '../../../src/shared/i18n/vi/auth';
import * as onb from '../../../src/shared/i18n/vi/onboarding';
import * as vi from '../../../src/shared/i18n/vi/settings';
import type { Entries } from '../harness';
import { byText, PressWhen } from './guild';
import { app, dayOf, meOf, pathOf, respond, settingsOf } from './today';

// Settings, notifications, profile editing, display and help of frames S35, S36, S80, S37, S81, S79 and S53, with illustrative
// values (never logic). The data is in the query cache: the screens ask for nothing.
const settings = (more: Partial<Settings> = {}): Settings => ({ ...settingsOf(), ...more });
const DAY = 24 * 3_600_000;

// The measurements of the frame of S37 and the targets the domain gives them.
const BIOMETRICS = { heightCm: 170, weightKg: 65, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT' } as const;
const prescriptionOf = (weightKg: number): PrescriptionResponse => ({
  ...calculatePrescription({ ...BIOMETRICS, weightKg, ageYears: new Date().getFullYear() - BIOMETRICS.birthYear, archetype: 'TANKER' }),
  computedAt: new Date().toISOString(),
  archetype: 'TANKER',
  biometrics: { ...BIOMETRICS, weightKg },
});
const ZONES = ['Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Europe/Paris', 'UTC'];
const profileSeen: [readonly unknown[], unknown][] = [
  [prescriptionKey, prescriptionOf(BIOMETRICS.weightKg)],
  [timezonesKey, { zones: ZONES }],
];
const theme = SHOP_ITEMS.find(item => item.isDefault && item.kind === 'THEME');
const inventory: Inventory = { items: theme ? [{ ...theme, owned: true, equipped: true, locked: false }] : [] };
const displaySeen: [readonly unknown[], unknown][] = [
  [inventoryKey, inventory],
  [petKey, meOf().pet],
];
/** The direction can be changed again in 9 days (the frame of S37). */
const waiting = (): Me => {
  const me = meOf();
  return { ...me, user: { ...me.user, archetypeChangeAvailableAt: new Date(Date.now() + 8.5 * DAY).toISOString() } };
};

/** shot.mjs cannot type: this writes into the field with this label, as a person would. */
function Type({ label, text }: { label: string; text: string }) {
  useEffect(() => {
    const timer = setInterval(() => {
      const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      if (!input) return;
      clearInterval(timer);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 50);
    return () => clearInterval(timer);
  }, [label, text]);
  return null;
}
/** The form is taller than the screen: keep every scroller at its end so that the shot shows the bottom of it. */
function ScrollToEnd() {
  useEffect(() => {
    const timer = setInterval(() => document.querySelectorAll<HTMLElement>('*').forEach(node => node.scrollHeight > node.clientHeight + 40 && getComputedStyle(node).overflowY !== 'visible' && (node.scrollTop = node.scrollHeight)), 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

/** The server of the preview after a save of 70 kg: the new targets, and the reads that follow. */
const afterSave = (url: string, init?: RequestInit) => {
  const path = pathOf(url);
  if (init?.method === 'POST' && path === '/me/biometrics') return respond(200, prescriptionOf(70));
  if (path === '/me') return respond(200, meOf());
  if (path === '/day') return respond(200, dayOf());
  if (path === '/me/prescription') return respond(200, prescriptionOf(70));
  return respond(404);
};

export const entries: Entries = {
  's35-settings': () => app({ route: 'Settings' }),
  // The reminder is off, the nudges are on (the frame of S36); the notice at the top is the S80 layout, with no permission to ask for.
  's36-notifications': () => app({ route: 'NotificationSettings' }),
  // Everything is off: the same screen, so that the notice and the disabled window stand out.
  's80-notifications-notice': () => app({ route: 'NotificationSettings', settings: settings({ nudgesEnabled: false, reminderEnabled: false }) }),
  's36-notifications-reminder-on': () => app({ route: 'NotificationSettings', settings: settings({ reminderEnabled: true, reminderWindow: 'NOON' }) }),
  's37-edit-profile': () => app({ route: 'EditProfile', me: waiting(), queries: profileSeen }),
  // The bottom of the form: the direction, the note, and "Lưu hồ sơ" that waits for a change (with its reason).
  's37-edit-profile-bottom': () => app({ route: 'EditProfile', me: waiting(), queries: profileSeen, extra: <ScrollToEnd /> }),
  // The weight is not a number, the height is out of range and the name is empty: each is said at its field and nothing is sent.
  's37-edit-profile-errors': () =>
    app({
      route: 'EditProfile',
      queries: profileSeen,
      extra: (
        <>
          <Type label={onb.weightLabel} text="abc" />
          <Type label={onb.heightLabel} text="90" />
          <Type label={authVi.displayNameLabel} text="  " />
          <PressWhen find={byText('button', vi.saveProfile)} />
        </>
      ),
    }),
  // 70 kg is saved: the targets of the server follow (no frame of its own).
  's37-edit-profile-saved': () =>
    app({
      route: 'EditProfile',
      queries: profileSeen,
      fetchStub: afterSave,
      extra: (
        <>
          <Type label={onb.weightLabel} text="70" />
          <PressWhen find={byText('button', vi.saveProfile)} />
        </>
      ),
    }),
  // The direction can be changed in 9 days: its row opens S81 at once, without a request.
  's81-archetype-cooldown': () => app({ route: 'EditProfile', me: waiting(), queries: profileSeen, extra: <PressWhen find={byText('button', onb.archetypes.TANKER.name)} /> }),
  's79-display': () => app({ route: 'Display', queries: displaySeen }),
  's79-display-reduced': () => app({ route: 'Display', settings: settings({ motion: 'REDUCED', hideStreak: true }), queries: displaySeen }),
  's53-help': () => app({ route: 'Help' }),
  's53-help-health-sheet': () => app({ route: 'Help', extra: <PressWhen find={byText('button', vi.helpRows.health.title)} /> }),
};
