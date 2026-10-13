import { act, render, screen } from '@testing-library/react-native';
import { useSession } from '../../shared/api/session';
import { bornAt, diskText, draft, installOnboardingTestEnv, me, mount, onStep, press, respond, select, sent, serve, settle, TITLES, TOKEN, type, USER } from './onboardingTestKit';
import { requestOf, useOnboarding, type Onboarding } from './OnboardingProvider';

installOnboardingTestEnv();

let onboarding: Onboarding;
let session: ReturnType<typeof useSession>;
function Probe() {
  onboarding = useOnboarding();
  session = useSession();
  return null;
}
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const empty = { birthYear: '', heightCm: '', weightKg: '', sex: null, timezone: null, activityLevel: null, archetype: null };

test('it starts empty, keeps the numbers as typed, and requestOf reads them once everything is there', async () => {
  await mount('OnbProfile', undefined, { extra: <Probe /> });
  await onStep(TITLES.OnbProfile);
  expect(onboarding.draft).toEqual(empty);
  expect(requestOf(onboarding.draft)).toBeNull();
  act(() => onboarding.edit({ ...draft, heightCm: '171,5' }));
  expect(onboarding.draft.heightCm).toBe('171,5');
  expect(requestOf(onboarding.draft)).toEqual({
    heightCm: 171.5,
    weightKg: 63.25,
    birthYear: Number(bornAt(30)),
    sex: 'MALE',
    activityLevel: 'LIGHT',
    timezone: 'Asia/Ho_Chi_Minh',
    archetype: 'TANKER',
  });
  act(() => onboarding.edit({ weightKg: '6 3' }));
  expect(requestOf(onboarding.draft)).toBeNull();
});

test('a real change clears the errors of the fields it touches and the form message; an unchanged value clears nothing', async () => {
  await mount('OnbProfile', { draft }, { extra: <Probe /> });
  await onStep(TITLES.OnbProfile);
  act(() => onboarding.fail({ fields: { heightCm: 'h', weightKg: 'w' }, form: 'f' }));
  expect(onboarding.focusRequest).toBe(1);
  act(() => onboarding.edit({ heightCm: draft.heightCm }));
  expect(onboarding.errors).toEqual({ fields: { heightCm: 'h', weightKg: 'w' }, form: 'f' });
  act(() => onboarding.edit({ heightCm: '180' }));
  expect(onboarding.errors).toEqual({ fields: { weightKg: 'w' } });
});

test('one Idempotency-Key per attempt: the same until an input really changes, new after a reset', async () => {
  await mount('OnbProfile', { draft }, { extra: <Probe /> });
  await onStep(TITLES.OnbProfile);
  const first = onboarding.attemptKey();
  expect(first).toMatch(UUID_V4);
  expect(onboarding.attemptKey()).toBe(first);
  act(() => onboarding.edit({ weightKg: draft.weightKg, timezone: draft.timezone }));
  expect(onboarding.attemptKey()).toBe(first);
  act(() => onboarding.setBlock('archetype'));
  act(() => onboarding.fail({ fields: { archetype: 'x' } }));
  expect(onboarding.attemptKey()).toBe(first);
  act(() => onboarding.edit({ weightKg: '64' }));
  const second = onboarding.attemptKey();
  expect(second).toMatch(UUID_V4);
  expect(second).not.toBe(first);
  act(() => onboarding.reset());
  expect(onboarding.draft).toEqual(empty);
  expect(onboarding.block).toBeNull();
  expect(onboarding.attemptKey()).not.toBe(second);
});

test('a second person on the same phone starts empty: nothing of the first one is shown, kept or reused', async () => {
  const OTHER = '9a1b7c3d-2e4f-4a6b-8c0d-1e2f3a4b5c6d';
  const meOf = (id: string) => ({ ...me, user: { ...me.user, id } });
  serve({
    'GET /me': (init: { headers: Record<string, string> }) => respond(200, meOf(init.headers.Authorization === `Bearer ${TOKEN}` ? USER : OTHER)),
    'POST /auth/logout': respond(204),
  });
  await mount('OnbProfile', undefined, { extra: <Probe /> });
  await onStep(TITLES.OnbProfile);
  type('Năm sinh', '1988');
  type('Chiều cao · cm', '182,5');
  type('Cân nặng · kg', '91.75');
  select('Giới tính dùng trong công thức, Chọn', 'Nữ');
  press('Tiếp tục');
  await onStep(TITLES.OnbActivity);
  act(() => onboarding.fail({ fields: { activityLevel: 'left over' }, form: 'left over' }));
  const firstKey = onboarding.attemptKey();
  expect(onboarding.draft).toMatchObject({ birthYear: '1988', heightCm: '182,5', weightKg: '91.75', sex: 'FEMALE', timezone: 'Asia/Ho_Chi_Minh' });

  await act(async () => session.signOut());
  await screen.findByRole('button', { name: 'Bắt đầu hành trình' });
  // gone as soon as the first person has left, not only when the next one arrives
  expect(onboarding.draft).toEqual(empty);
  await act(async () => session.signIn('tok-second-person', OTHER));
  await onStep(TITLES.OnbProfile);

  for (const label of ['Năm sinh', 'Chiều cao · cm', 'Cân nặng · kg']) expect(screen.getByLabelText(label).props.value).toBe('');
  expect(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Chọn' })).toBeTruthy();
  expect(screen.queryByText('left over')).toBeNull();
  expect(onboarding.draft).toEqual(empty);
  expect(onboarding.errors).toEqual({ fields: {} });
  expect(onboarding.attemptKey()).not.toBe(firstKey);
  // and none of it ever reached the disk or a request
  const disk = await diskText();
  for (const value of ['1988', '182', '91.75', '91,75']) expect(disk).not.toContain(value);
  expect(sent().filter(r => r.body !== undefined)).toEqual([]);
  await settle();
});

test('useOnboarding needs its provider', () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Probe />)).toThrow('useOnboarding needs an OnboardingProvider above it');
  errors.mockClear(); // React reports the render error it has just rethrown
});
