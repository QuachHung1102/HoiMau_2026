import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { calculatePrescription, calorieWindow } from '../../../domain/energy.ts';
import { allowedArchetypes } from '../../../domain/validation.ts';
import { useSession } from '../../shared/api/session';
import { healthVi } from '../../shared/i18n/vi/health';
import { useOnboarding, type Onboarding } from './OnboardingProvider';
import { bornAt, diskText, dotted, draft, focusLog, installOnboardingTestEnv, meOnboarded, mount, never, onStep, press, queryClient, refuse, requests, respond, sent, serve, settle, TITLES, TOKEN, type } from './onboardingTestKit';

installOnboardingTestEnv();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const posts = () => sent().filter(r => r.method === 'POST' && r.path === '/onboarding');
const keys = () => posts().map(r => r.headers['Idempotency-Key']);
const ready = () => onStep(TITLES.OnbTargets);
const finish = () => press('Hoàn tất');
const MAIN = 'Phần này đang được hoàn thiện'; // the main group's notice while no tab root is registered
// what the kit's draft says, as the numbers the domain takes
const person = { heightCm: 171.5, weightKg: 63.25, ageYears: 30, sex: 'MALE', activityLevel: 'LIGHT', archetype: 'TANKER' } as const;

describe('S08: the preview', () => {
  test('the numbers are exactly calculatePrescription for the entered values, each named as an estimate', async () => {
    const expected = calculatePrescription(person);
    const band = calorieWindow(expected.calorieTarget);
    await mount('OnbTargets', { draft });
    expect(await ready()).toBeTruthy();
    expect(screen.getByText('Bắt đầu vừa sức, điều chỉnh khi cần.')).toBeTruthy();
    expect(screen.getByText('Đỡ Đòn')).toBeTruthy();
    expect(screen.getByText('Năng lượng ước tính')).toBeTruthy();
    expect(screen.getByText(`${dotted(expected.calorieTarget)} kcal / ngày`)).toBeTruthy();
    expect(screen.getByText(`Nhiệm vụ dinh dưỡng được tính khi bạn ghi nhận từ ${dotted(band.min)} đến ${dotted(band.max)} kcal.`)).toBeTruthy();
    expect(screen.getByText('Nước ước tính')).toBeTruthy();
    expect(screen.getByText(`${dotted(expected.waterMl)} ml / ngày`)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Phân bổ dinh dưỡng ước tính' })).toBeTruthy();
    expect(screen.getByText(`Đạm ${expected.proteinG} g · Béo ${expected.fatG} g · Carb ${expected.carbsG} g`)).toBeTruthy();
    // an estimate, never a prescription; and the disclaimer of spec 9.2 closes onboarding
    expect(screen.getByText(healthVi.estimate.prescription)).toBeTruthy();
    expect(screen.getByText(healthVi.disclaimer)).toBeTruthy();
    // nothing was adjusted for these values, so nothing claims it was
    expect(expected.safetyClamped).toBe(false);
    expect(screen.queryByText(healthVi.safetyClamped.chip)).toBeNull();
    expect(screen.queryByText(healthVi.safetyClamped.title)).toBeNull();
    expect(screen.queryByText(healthVi.macroAdjusted.title)).toBeNull();
    // the preview costs no request
    expect(sent().every(r => r.method === 'GET')).toBe(true);
  });

  test('the band shown is calorieWindow of the target (the band of the nutrition quest), not one computed here', async () => {
    // a target whose 10 % ends do not round the way a naive "target ± 10 %" of the rounded number might be written
    const expected = calculatePrescription({ ...person, archetype: 'SUPPORTER' });
    await mount('OnbTargets', { draft: { ...draft, archetype: 'SUPPORTER' } });
    await ready();
    const { min, max } = calorieWindow(expected.calorieTarget);
    expect(screen.getByText(new RegExp(`từ ${dotted(min).replace('.', '\\.')} đến ${dotted(max).replace('.', '\\.')} kcal`))).toBeTruthy();
  });

  test('S62: values whose target was raised to the floor say so, with the reason from the health copy', async () => {
    // found with the domain: the first weight, for this person, where the reduce-fat direction is offered and clamped
    const base = { heightCm: 160, ageYears: 40, sex: 'FEMALE', activityLevel: 'SEDENTARY', archetype: 'ASSASSIN' } as const;
    const weightKg = Array.from({ length: 60 }, (_, i) => 45 + i).find(
      w => allowedArchetypes(base.heightCm, w).includes('ASSASSIN') && calculatePrescription({ ...base, weightKg: w }).safetyClamped,
    );
    expect(weightKg).toBeDefined();
    const expected = calculatePrescription({ ...base, weightKg: weightKg as number });
    await mount('OnbTargets', {
      draft: { ...draft, heightCm: '160', weightKg: String(weightKg), birthYear: bornAt(40), sex: 'FEMALE', activityLevel: 'SEDENTARY', archetype: 'ASSASSIN' },
    });
    await ready();
    expect(screen.getByText('Sát Thủ')).toBeTruthy();
    expect(screen.getByText(`${dotted(expected.calorieTarget)} kcal / ngày`)).toBeTruthy();
    expect(screen.getByText(healthVi.safetyClamped.chip)).toBeTruthy();
    expect(screen.getByRole('header', { name: healthVi.safetyClamped.title })).toBeTruthy();
    expect(screen.getByText(healthVi.safetyClamped.body(expected.calorieTarget))).toBeTruthy();
    expect(screen.getByText(new RegExp(`mức nền ${dotted(expected.calorieTarget).replace('.', '\\.')} kcal`))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chỉnh lại hồ sơ' })).toBeTruthy();
  });

  test('"Chỉnh lại hồ sơ" goes back to S05 with the values kept', async () => {
    await mount('OnbTargets', { draft });
    await ready();
    press('Chỉnh lại hồ sơ');
    await onStep(TITLES.OnbProfile);
    expect(screen.getByLabelText('Chiều cao · cm').props.value).toBe('171,5');
    expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe('63.25');
  });

  test('no weight word and no body index anywhere on the screen', async () => {
    await mount('OnbTargets', { draft });
    await ready();
    expect(screen.queryByText(/BMI|thừa cân|thiếu cân|béo phì|gầy|chỉ định của/i)).toBeNull();
  });
});

let onboarding: Onboarding;
let session: ReturnType<typeof useSession>;
function Probe() {
  onboarding = useOnboarding();
  session = useSession();
  return null;
}

describe('"Hoàn tất"', () => {
  test('after a finished onboarding the provider has forgotten the measurements, and not before the answer', async () => {
    let finishRequest!: (response: unknown) => void;
    serve({ 'POST /onboarding': () => new Promise(resolve => (finishRequest = resolve)) });
    await mount('OnbTargets', { draft }, { extra: <Probe /> });
    await ready();
    finish();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(onboarding.draft).toEqual(draft);
    await act(async () => finishRequest(respond(200, meOnboarded)));
    expect(await screen.findByText(MAIN)).toBeTruthy();
    expect(onboarding.draft).toEqual({ birthYear: '', heightCm: '', weightKg: '', sex: null, timezone: null, activityLevel: null, archetype: null });
    expect(onboarding.errors).toEqual({ fields: {} });
  });

  test('an answer that lands after the person has signed out is dropped: no Me in the cache, none on the disk', async () => {
    // a fetch that ignores its signal: the answer still arrives although the screen (and the session) is gone
    let finishRequest!: (response: unknown) => void;
    serve({ 'POST /onboarding': () => new Promise(resolve => (finishRequest = resolve)), 'POST /auth/logout': respond(204) });
    await mount('OnbTargets', { draft }, { extra: <Probe /> });
    await ready();
    finish();
    await waitFor(() => expect(posts()).toHaveLength(1));
    await act(async () => session.signOut());
    await screen.findByRole('button', { name: 'Bắt đầu hành trình' });
    await act(async () => finishRequest(respond(200, meOnboarded)));
    await settle();
    // the next person to sign in on this phone must not be let past onboarding by someone else's answer
    expect(queryClient().getQueryData(['me'])).toBeUndefined();
    expect(await diskText()).not.toMatch(/onboarded[^,}]*true/);
  });

  test('a failed attempt forgets nothing', async () => {
    serve({ 'POST /onboarding': refuse(500, 'INTERNAL') });
    await mount('OnbTargets', { draft }, { extra: <Probe /> });
    await ready();
    finish();
    await screen.findByText('Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.');
    expect(onboarding.draft).toEqual(draft);
  });

  test('sends POST /onboarding once with the seven fields, a fresh key and the session, and the gate moves to the main app', async () => {
    serve({ 'POST /onboarding': respond(200, meOnboarded) });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    expect(await screen.findByText(MAIN)).toBeTruthy();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toEqual({
      heightCm: 171.5,
      weightKg: 63.25,
      birthYear: Number(bornAt(30)),
      sex: 'MALE',
      activityLevel: 'LIGHT',
      timezone: 'Asia/Ho_Chi_Minh',
      archetype: 'TANKER',
    });
    expect(posts()[0].headers['Idempotency-Key']).toMatch(UUID_V4);
    expect(posts()[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(requests('/onboarding')[0][1].signal).toBeInstanceOf(AbortSignal);
    // the server's Me is what the gate now reads; the measurements are nowhere in the mutation cache
    expect(queryClient().getQueryData(['me'])).toEqual(meOnboarded);
    expect(queryClient().getMutationCache().getAll()).toEqual([]);
  });

  test('two presses inside one act() send one request; the button is busy and a third press does nothing', async () => {
    serve({ 'POST /onboarding': never });
    await mount('OnbTargets', { draft });
    await ready();
    const button = screen.getByRole('button', { name: 'Hoàn tất' });
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hoàn tất' }).props.accessibilityState).toMatchObject({ busy: true }));
    fireEvent.press(screen.getByRole('button', { name: 'Hoàn tất' }));
    await act(async () => undefined);
    expect(posts()).toHaveLength(1);
  });

  test('no connection: the error offers a retry, and the retry reuses the same Idempotency-Key', async () => {
    let online = false;
    serve({ 'POST /onboarding': () => (online ? respond(200, meOnboarded) : Promise.reject(new TypeError('Network request failed'))) });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
    // still on S08 with the numbers, nothing lost
    expect(screen.getByRole('header', { name: TITLES.OnbTargets })).toBeTruthy();
    press('Thử lại');
    await waitFor(() => expect(posts()).toHaveLength(2));
    await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.');
    online = true;
    finish(); // the main button retries as well
    expect(await screen.findByText(MAIN)).toBeTruthy();
    expect(keys()).toHaveLength(3);
    expect(keys()[0]).toMatch(UUID_V4);
    expect(new Set(keys()).size).toBe(1);
    expect(new Set(posts().map(r => JSON.stringify(r.body))).size).toBe(1);
  });

  test('no answer for 10 s: the TIMEOUT copy, and the retry reuses the key', async () => {
    jest.useFakeTimers();
    serve({ 'POST /onboarding': never });
    await mount('OnbTargets', { draft });
    await screen.findByRole('header', { name: TITLES.OnbTargets });
    finish();
    await waitFor(() => expect(posts()).toHaveLength(1)); // the request, and with it its 10 s timer, has started
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(await screen.findByText('Kết nối hơi chậm. Bạn thử lại nhé.')).toBeTruthy();
    press('Thử lại');
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(keys()[1]).toBe(keys()[0]);
  });

  test('a changed input is a new attempt: a new key', async () => {
    serve({ 'POST /onboarding': new TypeError('Network request failed') });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.');
    // back to S05 and forward again without touching anything: still the same attempt
    press('Chỉnh lại hồ sơ');
    await onStep(TITLES.OnbProfile);
    press('Tiếp tục');
    await onStep(TITLES.OnbActivity);
    press('Chọn mục tiêu');
    await onStep(TITLES.OnbArchetype);
    press('Xem lộ trình của tôi');
    await ready();
    finish();
    await waitFor(() => expect(posts()).toHaveLength(2));
    await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.');
    expect(keys()[1]).toBe(keys()[0]);
    // now the weight changes
    press('Chỉnh lại hồ sơ');
    await onStep(TITLES.OnbProfile);
    type('Cân nặng · kg', '64');
    press('Tiếp tục');
    await onStep(TITLES.OnbActivity);
    press('Chọn mục tiêu');
    await onStep(TITLES.OnbArchetype);
    press('Xem lộ trình của tôi');
    await ready();
    finish();
    await waitFor(() => expect(posts()).toHaveLength(3));
    await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.');
    expect(keys()[2]).toMatch(UUID_V4);
    expect(keys()[2]).not.toBe(keys()[0]);
    expect(posts()[2].body).toMatchObject({ weightKg: 64 });
  });

  test('offline with an online manager wired: the press still reaches fetch and fails fast', async () => {
    serve({ 'POST /onboarding': new TypeError('Network request failed') });
    await mount('OnbTargets', { draft });
    await ready();
    onlineManager.setOnline(false);
    try {
      finish();
      expect(await screen.findByText('Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.')).toBeTruthy();
      expect(posts()).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Hoàn tất' }).props.accessibilityState).toMatchObject({ busy: false });
    } finally {
      onlineManager.setOnline(true);
    }
  });

  test.each([
    ['RATE_LIMITED', 429, 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.'],
    ['INTERNAL', 500, 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.'],
    ['IDEMPOTENCY_KEY_REUSED', 409, 'Có lỗi xảy ra. Bạn thử lại nhé.'],
  ])('%s stays on S08 with its copy and the mutation cache keeps no measurement', async (code, status, copy) => {
    serve({ 'POST /onboarding': refuse(status, code) });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.getByRole('header', { name: TITLES.OnbTargets })).toBeTruthy();
    expect(queryClient().getMutationCache().getAll()).toEqual([]);
  });
});

describe('a refusal from the server goes back to the step that owns it', () => {
  test('AGE_NOT_ALLOWED: S61 on the profile step, the values kept', async () => {
    serve({ 'POST /onboarding': refuse(422, 'AGE_NOT_ALLOWED') });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    expect(await screen.findByRole('header', { name: healthVi.under16.title })).toBeTruthy();
    expect(screen.getByText(healthVi.under16.body)).toBeTruthy();
    press('Kiểm tra lại năm sinh');
    await onStep(TITLES.OnbProfile);
    expect(screen.getByLabelText('Năm sinh').props.value).toBe(draft.birthYear);
    expect(screen.getByLabelText('Cân nặng · kg').props.value).toBe('63.25');
  });

  test('ARCHETYPE_NOT_ALLOWED: S43 on the direction step, the refused choice dropped, and an allowed one continues', async () => {
    let refused = true;
    serve({ 'POST /onboarding': () => (refused ? refuse(422, 'ARCHETYPE_NOT_ALLOWED') : respond(200, meOnboarded)) });
    await mount('OnbTargets', { draft: { ...draft, archetype: 'ASSASSIN' } });
    await ready();
    finish();
    expect(await screen.findByRole('header', { name: healthVi.blockedArchetype.title })).toBeTruthy();
    expect(screen.getByText(healthVi.blockedArchetype.body)).toBeTruthy();
    expect(screen.getAllByRole('radio').map(card => card.props.accessibilityState.checked)).toEqual([false, false, false]);
    refused = false;
    press('Chọn hướng cân bằng');
    await ready();
    expect(screen.getByText('Hỗ Trợ')).toBeTruthy();
    finish();
    expect(await screen.findByText(MAIN)).toBeTruthy();
    expect(posts().map(r => r.body?.archetype)).toEqual(['ASSASSIN', 'SUPPORTER']);
    // another direction is another attempt
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  test('VALIDATION_FAILED on profile fields: S05 with each message on its field and focus on the first', async () => {
    serve({
      'POST /onboarding': refuse(422, 'VALIDATION_FAILED', {
        fields: [
          { field: 'weightKg', rule: 'max' },
          { field: 'heightCm', rule: 'min' },
        ],
      }),
    });
    const focused = focusLog();
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    await onStep(TITLES.OnbProfile);
    expect(screen.getByLabelText('Chiều cao · cm, lỗi: Chiều cao cần trong khoảng 120–230 cm.')).toBeTruthy();
    expect(screen.getByLabelText('Cân nặng · kg, lỗi: Cân nặng cần trong khoảng 30–250 kg.')).toBeTruthy();
    expect(screen.queryByText('Có lỗi xảy ra. Bạn thử lại nhé.')).toBeNull();
    // form order, not the order of the answer: the height comes first
    expect(focused()).toEqual(['Chiều cao · cm, lỗi: Chiều cao cần trong khoảng 120–230 cm.']);
  });

  test.each([
    ['timezone', 'enum', TITLES.OnbProfile, 'Chọn một múi giờ trong danh sách.'],
    ['activityLevel', 'enum', TITLES.OnbActivity, 'Chọn mức vận động gần với bạn nhất.'],
    ['archetype', 'required', TITLES.OnbArchetype, 'Chọn một mục tiêu để tiếp tục.'],
  ])('VALIDATION_FAILED on %s: the step that owns it', async (field, rule, title, message) => {
    serve({ 'POST /onboarding': refuse(422, 'VALIDATION_FAILED', { fields: [{ field, rule }] }) });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    await onStep(title);
    expect(screen.getByText(message)).toBeTruthy();
  });

  test('a known and an unknown field: the owning step shows the field message and a form-level one', async () => {
    serve({
      'POST /onboarding': refuse(422, 'VALIDATION_FAILED', {
        fields: [
          { field: 'Idempotency-Key', rule: 'format' },
          { field: 'activityLevel', rule: 'required' },
        ],
      }),
    });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    await onStep(TITLES.OnbActivity);
    expect(screen.getByText('Chọn mức vận động gần với bạn nhất.')).toBeTruthy();
    expect(screen.getByText('Có lỗi xảy ra. Bạn thử lại nhé.')).toBeTruthy();
  });

  test.each([
    ['only unknown fields', { fields: [{ field: 'nickname', rule: 'required' }] }],
    ['no usable details', undefined],
  ])('VALIDATION_FAILED with %s stays on S08 with the general message', async (_name, details) => {
    serve({ 'POST /onboarding': refuse(422, 'VALIDATION_FAILED', details) });
    await mount('OnbTargets', { draft });
    await ready();
    finish();
    expect(await screen.findByText('Có lỗi xảy ra. Bạn thử lại nhé.')).toBeTruthy();
    expect(screen.getByRole('header', { name: TITLES.OnbTargets })).toBeTruthy();
  });
});

test('an incomplete draft shows no numbers and can send nothing', async () => {
  await mount('OnbTargets', { draft: { ...draft, weightKg: '' } });
  await waitFor(() => expect(requests('/me')).toHaveLength(1));
  await settle();
  expect(screen.queryByRole('header', { name: 'Đang lấy hành trình' })).toBeNull(); // the gate has let the screen in
  expect(screen.queryByRole('button', { name: 'Hoàn tất' })).toBeNull();
  expect(screen.queryByText(/kcal/)).toBeNull();
});
