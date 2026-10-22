import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculatePrescription } from '../../../domain/energy.ts';
import { ageFrom } from '../../../domain/validation.ts';
import { dotted } from '../onboarding/onboardingTestKit';
import { act, fetchMock, fireEvent, hold, installTodayTestEnv, openEditProfile, openProfile, refuse, respond, reads, screen, sent, settle, waitFor, world } from './settingsTestKit';

installTodayTestEnv();
// the whole app is mounted for each test and some of them walk through several steps
jest.setTimeout(20_000);

const DAY = 24 * 60 * 60 * 1000;
/** The input of this label (once it has an error its label goes on with ", lỗi: ..."). */
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`));
const type = (label: string, text: string) => fireEvent.changeText(field(label), text);
const save = () => fireEvent.press(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
const saveButton = () => screen.getByRole('button', { name: 'Lưu hồ sơ' });
const select = (current: RegExp | string, option: string) => {
  fireEvent.press(screen.getByRole('combobox', { name: current }));
  fireEvent.press(screen.getByRole('radio', { name: option }));
};
const patchMe = () => sent('PATCH', '/me');
const biometrics = () => sent('POST', '/me/biometrics');
const archetype = () => sent('PATCH', '/me/archetype');
const saved = () => screen.findByRole('header', { name: 'Đã lưu hồ sơ' });
const LIGHT_KG = '50';
const youngAt = (age: number) => String(new Date().getFullYear() - age);
const kcalOf = (weightKg: number, level: 'LIGHT' | 'MODERATE' = 'LIGHT', who: 'TANKER' | 'SUPPORTER' | 'ASSASSIN' = 'TANKER') =>
  calculatePrescription({ heightCm: 170, weightKg, ageYears: ageFrom(1999, Date.now(), 'Asia/Ho_Chi_Minh'), sex: 'MALE', activityLevel: level, archetype: who }).calorieTarget;
/** Choosing the direction the server did not offer: the current one is ruled out by the new numbers. */
const assassinAt = (weightKg: string) => {
  world.me = { ...world.me, user: { ...world.me.user, archetype: 'ASSASSIN', archetypeChangeAvailableAt: null } };
  world.profile = { ...world.profile, biometrics: { ...world.profile.biometrics, weightKg: 70 } };
  return weightKg;
};

describe('S37: the form', () => {
  test('it is filled from the profile and the latest measurements, in the order of the frame, with the note and the save button off while nothing changed', async () => {
    const view = await openEditProfile();
    expect(screen.getByRole('header', { name: 'Hồ sơ & mục tiêu' })).toBeTruthy();
    expect(screen.getByText('Cập nhật khi cơ thể hoặc nhịp sống thay đổi.')).toBeTruthy();
    expect(field('Tên hiển thị').props.value).toBe('An');
    expect(field('Năm sinh').props.value).toBe('1999');
    expect(field('Chiều cao · cm').props.value).toBe('170');
    expect(field('Cân nặng · kg').props.value).toBe('65');
    expect(screen.getByRole('combobox', { name: 'Giới tính dùng trong công thức, Nam' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Mức vận động, Vận động nhẹ' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Múi giờ, Asia/Ho_Chi_Minh' })).toBeTruthy();
    expect(screen.getByText('Số đo mới được lưu vào lịch sử. Đổi mục tiêu không xóa XP hoặc chuỗi đã có.')).toBeTruthy();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('Chưa có thay đổi nào để lưu.')).toBeTruthy();
    view.unmount();
  });

  test('the direction row: its name and "Có thể đổi" when the date has passed, "Có thể đổi sau N ngày" while it is ahead (N rounded up)', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: new Date(Date.now() - DAY).toISOString() } };
    const open = await openEditProfile();
    expect(screen.getByRole('button', { name: 'Đỡ Đòn. Có thể đổi' })).toBeTruthy();
    open.unmount();
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: new Date(Date.now() + 8.5 * DAY).toISOString() } };
    const again = await openEditProfile();
    expect(screen.getByRole('button', { name: 'Đỡ Đòn. Có thể đổi sau 9 ngày' })).toBeTruthy();
    again.unmount();
  });

  test('it asks the server for the profile and the targets once each, and for the list of zones', async () => {
    const view = await openEditProfile();
    expect(reads('/me/prescription')).toBe(1);
    expect(reads('/meta/timezones')).toBe(1);
    view.unmount();
  });

  test('typing a value and typing the old one back leaves nothing to save', async () => {
    const view = await openEditProfile();
    type('Cân nặng · kg', '66');
    expect(saveButton()).not.toBeDisabled();
    type('Cân nặng · kg', '65');
    expect(saveButton()).toBeDisabled();
    type('Tên hiển thị', '  An  ');
    expect(saveButton()).toBeDisabled();
    view.unmount();
  });

  test('the profile is not on screen until it is known: a failed read offers "Thử lại", and the form comes with the answer', async () => {
    world.answer = request => (request === 'GET /me/prescription' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openEditProfile();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByLabelText('Tên hiển thị')).toBeNull();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByLabelText('Tên hiển thị')).toBeTruthy();
    view.unmount();
  });
});

describe('"Lưu hồ sơ" sends only what changed', () => {
  test('the name only: one PATCH /me with the trimmed name, no POST /me/biometrics; the targets are shown, and the name is the new one on the profile', async () => {
    const view = await openEditProfile();
    type('Tên hiển thị', '  Lan Anh  ');
    save();
    await saved();
    expect(patchMe().map(request => request.body)).toEqual([{ displayName: 'Lan Anh' }]);
    expect(biometrics()).toEqual([]);
    expect(world.me.user.displayName).toBe('Lan Anh');
    expect(screen.getByText(`${dotted(kcalOf(65))} kcal / ngày`)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Xong' }));
    expect(await screen.findByRole('header', { name: 'Cài đặt' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Lan Anh')).toBeTruthy();
    view.unmount();
  });

  test('the zone only: one PATCH /me with the zone and nothing else', async () => {
    const view = await openEditProfile();
    select(/^Múi giờ/, 'Europe/Paris');
    save();
    await saved();
    expect(patchMe().map(request => request.body)).toEqual([{ timezone: 'Europe/Paris' }]);
    expect(biometrics()).toEqual([]);
    expect(world.me.user.timezone).toBe('Europe/Paris');
    view.unmount();
  });

  test('the weight only: one POST /me/biometrics with all five numbers (the comma is read as a point), no PATCH /me; the targets of the server are shown', async () => {
    const view = await openEditProfile();
    type('Cân nặng · kg', '70,5');
    save();
    await saved();
    expect(biometrics().map(request => request.body)).toEqual([{ heightCm: 170, weightKg: 70.5, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT' }]);
    expect(patchMe()).toEqual([]);
    expect(world.profile.biometrics.weightKg).toBe(70.5);
    expect(screen.getByText(`${dotted(kcalOf(70.5))} kcal / ngày`)).toBeTruthy();
    expect(screen.getByText('Đỡ Đòn')).toBeTruthy();
    view.unmount();
  });

  test('the level of activity only: one POST /me/biometrics', async () => {
    const view = await openEditProfile();
    select(/^Mức vận động/, 'Vận động vừa');
    save();
    await saved();
    expect(biometrics().map(request => request.body)).toEqual([{ heightCm: 170, weightKg: 65, birthYear: 1999, sex: 'MALE', activityLevel: 'MODERATE' }]);
    expect(patchMe()).toEqual([]);
    expect(screen.getByText(`${dotted(kcalOf(65, 'MODERATE'))} kcal / ngày`)).toBeTruthy();
    view.unmount();
  });

  test('the name and a measurement: both, the name first, once each', async () => {
    const view = await openEditProfile();
    type('Tên hiển thị', 'Minh');
    type('Chiều cao · cm', '171');
    save();
    await saved();
    expect(patchMe().map(request => request.body)).toEqual([{ displayName: 'Minh' }]);
    expect(biometrics().map(request => request.body)).toEqual([{ heightCm: 171, weightKg: 65, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT' }]);
    const order = fetchMock.mock.calls.filter(([, init]) => init.method !== 'GET').map(([url]) => url.replace(/^.*\/api\/v1/, ''));
    expect(order).toEqual(['/me', '/me/biometrics']);
    view.unmount();
  });

  test('the targets shown are what the server answered, not what this device would work out', async () => {
    world.answer = request => {
      if (request !== 'POST /me/biometrics') return undefined;
      const answer = { ...calculatePrescription({ heightCm: 170, weightKg: 70, ageYears: 25, sex: 'MALE', activityLevel: 'LIGHT', archetype: 'TANKER' }), calorieTarget: 2222, computedAt: new Date().toISOString(), archetype: 'TANKER', biometrics: { ...world.profile.biometrics, weightKg: 70 } };
      return respond(200, answer);
    };
    const view = await openEditProfile();
    type('Cân nặng · kg', '70');
    save();
    await saved();
    expect(screen.getByText('2.222 kcal / ngày')).toBeTruthy();
    view.unmount();
  });

  test('the new numbers reach the places that depend on them: the day and the plan are read again', async () => {
    const view = await openEditProfile();
    const dayReads = reads('/day');
    type('Cân nặng · kg', '70');
    save();
    await saved();
    await waitFor(() => expect(reads('/day')).toBeGreaterThan(dayReads));
    view.unmount();
  });

  test('a new zone makes what is dated stale: the day is read again', async () => {
    const view = await openEditProfile();
    const dayReads = reads('/day');
    select(/^Múi giờ/, 'Europe/Paris');
    save();
    await saved();
    await waitFor(() => expect(reads('/day')).toBeGreaterThan(dayReads));
    view.unmount();
  });

  test('a new name alone does not: the day is not read again', async () => {
    const view = await openEditProfile();
    const dayReads = reads('/day');
    type('Tên hiển thị', 'Minh');
    save();
    await saved();
    await settle();
    await settle();
    expect(reads('/day')).toBe(dayReads);
    view.unmount();
  });

  test('every write carries an Idempotency-Key (a UUID), a different one for each', async () => {
    const view = await openEditProfile();
    type('Tên hiển thị', 'Minh');
    type('Chiều cao · cm', '171');
    save();
    await saved();
    const keys = [patchMe()[0].key, biometrics()[0].key];
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(keys[0]).not.toBe(keys[1]);
    view.unmount();
  });

  test('one request per press: a second press while the first is out sends nothing', async () => {
    const gate = hold('PATCH /me');
    const view = await openEditProfile();
    type('Tên hiển thị', 'Minh');
    save();
    save();
    await settle();
    expect(patchMe()).toHaveLength(1);
    await act(async () => gate.release());
    await saved();
    expect(patchMe()).toHaveLength(1);
    view.unmount();
  });

  test('the measurements are on screen and in memory only: nothing of them reaches the disk', async () => {
    const view = await openEditProfile();
    type('Cân nặng · kg', '70,5');
    save();
    await saved();
    const disk = JSON.stringify(await AsyncStorage.getMany(await AsyncStorage.getAllKeys()));
    for (const secret of ['70.5', 'weightKg', 'heightCm', 'birthYear', 'activityLevel']) expect(disk).not.toContain(secret);
    view.unmount();
  });
});

describe('S60: what the rules refuse is said at the field, and nothing is sent', () => {
  test.each([
    ['Cân nặng · kg', 'abc', 'Nhập cân nặng bằng số, trong khoảng 30–250 kg.'],
    ['Cân nặng · kg', '300', 'Cân nặng cần trong khoảng 30–250 kg.'],
    ['Chiều cao · cm', '', 'Nhập chiều cao của bạn.'],
    ['Chiều cao · cm', '90', 'Chiều cao cần trong khoảng 120–230 cm.'],
    ['Năm sinh', '19x9', 'Nhập năm sinh bằng số, đủ bốn chữ số.'],
    ['Năm sinh', youngAt(10), 'Hồi Máu tính mục tiêu cho người từ 16 đến 90 tuổi. Bạn xem lại năm sinh nhé.'],
    ['Tên hiển thị', '   ', 'Bạn nhập tên hiển thị nhé.'],
    ['Tên hiển thị', 'x'.repeat(41), 'Tên hiển thị tối đa 40 ký tự và không có ký tự ẩn.'],
  ])('%s = "%s": "%s"', async (label, text, message) => {
    const view = await openEditProfile();
    type(label as string, text as string);
    save();
    expect(await screen.findByText(message as string)).toBeTruthy();
    expect(patchMe()).toEqual([]);
    expect(biometrics()).toEqual([]);
    expect(screen.getByLabelText(new RegExp(`^${label}, lỗi`))).toBeTruthy();
    view.unmount();
  });

  test('several fields wrong: each says so, the first one gets focus, and a fix clears only its own message', async () => {
    const view = await openEditProfile();
    type('Cân nặng · kg', 'abc');
    type('Chiều cao · cm', '90');
    const focus = jest.spyOn(require('react-native').TextInput.prototype, 'focus');
    save();
    expect(await screen.findByText('Chiều cao cần trong khoảng 120–230 cm.')).toBeTruthy();
    expect(screen.getByText('Nhập cân nặng bằng số, trong khoảng 30–250 kg.')).toBeTruthy();
    // form order: the height before the weight
    expect((focus.mock.contexts.at(-1) as { props: { accessibilityLabel: string } }).props.accessibilityLabel).toMatch(/^Chiều cao/);
    type('Chiều cao · cm', '170');
    expect(screen.queryByText('Chiều cao cần trong khoảng 120–230 cm.')).toBeNull();
    expect(screen.getByText('Nhập cân nặng bằng số, trong khoảng 30–250 kg.')).toBeTruthy();
    view.unmount();
  });
});

describe('what the server refuses', () => {
  test('a banned name: said at the name field, the text kept; no targets', async () => {
    const view = await openEditProfile();
    type('Tên hiển thị', 'Kẻ lười');
    save();
    expect(await screen.findByText('Tên này chưa phù hợp, bạn chọn tên khác nhé.')).toBeTruthy();
    expect(field('Tên hiển thị, lỗi: Tên này chưa phù hợp, bạn chọn tên khác nhé.').props.value).toBe('Kẻ lười');
    expect(world.me.user.displayName).toBe('An');
    expect(screen.queryByRole('header', { name: 'Đã lưu hồ sơ' })).toBeNull();
    view.unmount();
  });

  test('422 on named fields: each message at its field (name, zone), the others untouched', async () => {
    world.answer = request => (request === 'PATCH /me' ? refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'displayName', rule: 'format' }, { field: 'timezone', rule: 'format' }] }) : undefined);
    const view = await openEditProfile();
    type('Tên hiển thị', 'Lan');
    select(/^Múi giờ/, 'UTC');
    save();
    expect(await screen.findByText('Tên hiển thị tối đa 40 ký tự và không có ký tự ẩn.')).toBeTruthy();
    expect(screen.getByText('Chọn một múi giờ trong danh sách.')).toBeTruthy();
    view.unmount();
  });

  test('422 on the measurements: heightCm "max" and birthYear "min" each at its field, in the words of S60', async () => {
    world.answer = request => (request === 'POST /me/biometrics' ? refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'heightCm', rule: 'max' }, { field: 'birthYear', rule: 'min' }] }) : undefined);
    const view = await openEditProfile();
    type('Cân nặng · kg', '70');
    save();
    expect(await screen.findByText('Chiều cao cần trong khoảng 120–230 cm.')).toBeTruthy();
    expect(screen.getByText('Hồi Máu tính mục tiêu cho người từ 16 đến 90 tuổi. Bạn xem lại năm sinh nhé.')).toBeTruthy();
    expect(field('Cân nặng · kg').props.value).toBe('70');
    view.unmount();
  });

  test('AGE_NOT_ALLOWED from the server: at the birth year', async () => {
    world.answer = request => (request === 'POST /me/biometrics' ? refuse(422, 'AGE_NOT_ALLOWED') : undefined);
    const view = await openEditProfile();
    type('Cân nặng · kg', '70');
    save();
    expect(await screen.findByText('Hồi Máu tính mục tiêu cho người từ 16 đến 90 tuổi. Bạn xem lại năm sinh nhé.')).toBeTruthy();
    view.unmount();
  });

  test('a field this form has no place for is not lost silently: a message above the button, with "Thử lại"', async () => {
    world.answer = request => (request === 'POST /me/biometrics' ? refuse(422, 'VALIDATION_FAILED', { fields: [{ field: 'archetype', rule: 'enum' }] }) : undefined);
    const view = await openEditProfile();
    type('Cân nặng · kg', '70');
    save();
    expect(await screen.findByText(/^Chưa lưu được hồ sơ\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    view.unmount();
  });

  test('a 500 or no connection: the reason above the button, what was typed kept, "Thử lại" sends again; the same request repeats its key only after a lost connection', async () => {
    const view = await openEditProfile();
    type('Cân nặng · kg', '70');
    world.down = true;
    save();
    expect(await screen.findByText(/^Chưa lưu được hồ sơ\. Không kết nối được mạng/)).toBeTruthy();
    expect(field('Cân nặng · kg').props.value).toBe('70');
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await saved();
    expect(biometrics()).toHaveLength(2);
    expect(biometrics()[1].key).toBe(biometrics()[0].key);
    view.unmount();
  });

  test('after the server has answered (a refusal included) a new try is a new action: a new key', async () => {
    world.answer = request => (request === 'POST /me/biometrics' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openEditProfile();
    type('Cân nặng · kg', '70');
    save();
    expect(await screen.findByText(/^Chưa lưu được hồ sơ\./)).toBeTruthy();
    world.answer = undefined;
    save();
    await saved();
    expect(biometrics()).toHaveLength(2);
    expect(biometrics()[1].key).not.toBe(biometrics()[0].key);
    view.unmount();
  });

  test('the name was saved and the numbers were refused: trying again sends only the numbers (the name is the server\'s now)', async () => {
    world.answer = request => (request === 'POST /me/biometrics' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openEditProfile();
    type('Tên hiển thị', 'Minh');
    type('Cân nặng · kg', '70');
    save();
    expect(await screen.findByText(/^Chưa lưu được hồ sơ\./)).toBeTruthy();
    expect(patchMe()).toHaveLength(1);
    world.answer = undefined;
    save();
    await saved();
    expect(patchMe()).toHaveLength(1);
    expect(biometrics()).toHaveLength(2);
    expect(world.me.user.displayName).toBe('Minh');
    view.unmount();
  });
});

describe('ARCHETYPE_NOT_ALLOWED: the safety sheet, and the choice goes along with the numbers', () => {
  test('the new weight rules the direction in effect out: the sheet offers the two that are allowed; choosing one resubmits the same numbers with it, and its targets are shown', async () => {
    assassinAt(LIGHT_KG);
    const view = await openEditProfile();
    type('Cân nặng · kg', LIGHT_KG);
    save();
    expect(await screen.findByRole('header', { name: 'Chọn mục tiêu an toàn' })).toBeTruthy();
    // the direction that is ruled out is not offered: two ways to go on, and none of them is it
    expect(screen.getAllByRole('button', { name: /^Chọn hướng/ })).toHaveLength(2);
    expect(biometrics().map(request => request.body)).toEqual([{ heightCm: 170, weightKg: 50, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT' }]);
    expect(world.profile.biometrics.weightKg).toBe(70);
    fireEvent.press(screen.getByRole('button', { name: 'Chọn hướng cân bằng' }));
    await saved();
    expect(biometrics().map(request => request.body)).toEqual([
      { heightCm: 170, weightKg: 50, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT' },
      { heightCm: 170, weightKg: 50, birthYear: 1999, sex: 'MALE', activityLevel: 'LIGHT', archetype: 'SUPPORTER' },
    ]);
    expect(world.me.user.archetype).toBe('SUPPORTER');
    expect(screen.getByText('Hỗ Trợ')).toBeTruthy();
    expect(screen.getByText(`${dotted(kcalOf(50, 'LIGHT', 'SUPPORTER'))} kcal / ngày`)).toBeTruthy();
    view.unmount();
  });

  test('a refusal that does not say what is allowed: the sheet still offers only the directions the numbers allow (the same rule, applied here)', async () => {
    assassinAt(LIGHT_KG);
    let refused = false;
    world.answer = request => {
      if (request !== 'POST /me/biometrics' || refused) return undefined;
      refused = true;
      return refuse(422, 'ARCHETYPE_NOT_ALLOWED');
    };
    const view = await openEditProfile();
    type('Cân nặng · kg', LIGHT_KG);
    save();
    expect(await screen.findByRole('header', { name: 'Chọn mục tiêu an toàn' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Chọn hướng/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Chọn hướng tăng sức mạnh' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chọn hướng cân bằng' })).toBeTruthy();
    view.unmount();
  });

  test('"Kiểm tra lại hồ sơ" closes the sheet, keeps what was typed and sends nothing more', async () => {
    assassinAt(LIGHT_KG);
    const view = await openEditProfile();
    type('Cân nặng · kg', LIGHT_KG);
    save();
    await screen.findByRole('header', { name: 'Chọn mục tiêu an toàn' });
    fireEvent.press(screen.getByRole('button', { name: 'Kiểm tra lại hồ sơ' }));
    expect(screen.queryByRole('header', { name: 'Chọn mục tiêu an toàn' })).toBeNull();
    expect(field('Cân nặng · kg').props.value).toBe(LIGHT_KG);
    expect(biometrics()).toHaveLength(1);
    expect(world.me.user.archetype).toBe('ASSASSIN');
    view.unmount();
  });
});

describe('S81 and the change of direction', () => {
  const OPENS = '2026-10-29T03:30:00.000Z'; // 10:30 on 29/10/2026 in Asia/Ho_Chi_Minh

  test('the date is ahead in `Me`: the dialog opens at once with the date and the note, and not one request is sent', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: new Date(Date.now() + 40 * DAY).toISOString() } };
    const view = await openEditProfile();
    const before = fetchMock.mock.calls.length;
    fireEvent.press(screen.getByRole('button', { name: /^Đỡ Đòn\./ }));
    expect(await screen.findByRole('header', { name: 'Chưa đến lúc đổi hướng' })).toBeTruthy();
    expect(screen.getByText(/^Bạn có thể đổi hướng từ \d\d:\d\d ngày \d\d\/\d\d\/\d{4}\.$/)).toBeTruthy();
    expect(screen.getByText('Mỗi lần đổi cách nhau 14 ngày để lộ trình kịp phát huy tác dụng. XP, cấp độ và chuỗi của bạn luôn được giữ.')).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(screen.queryByRole('radio', { name: /Sát Thủ/ })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect(screen.queryByRole('header', { name: 'Chưa đến lúc đổi hướng' })).toBeNull();
    expect(archetype()).toEqual([]);
    view.unmount();
  });

  test('the date shown is the one of `Me`, at the hour of the person\'s own zone', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: OPENS } };
    jest.useFakeTimers({ now: Date.parse('2026-10-14T03:00:00.000Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate'] });
    const view = await openEditProfile();
    fireEvent.press(screen.getByRole('button', { name: /^Đỡ Đòn\./ }));
    expect(await screen.findByText('Bạn có thể đổi hướng từ 10:30 ngày 29/10/2026.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đỡ Đòn. Có thể đổi sau 16 ngày' })).toBeTruthy();
    view.unmount();
    jest.useRealTimers();
  });

  test('the server says "not yet" while `Me` said the date had passed: 409 opens the same dialog with the server\'s date, and the sheet is gone', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: new Date(Date.now() - DAY).toISOString() } };
    world.answer = request => (request === 'PATCH /me/archetype' ? refuse(409, 'ARCHETYPE_COOLDOWN', { availableAt: OPENS }) : undefined);
    const view = await openEditProfile();
    fireEvent.press(screen.getByRole('button', { name: /^Đỡ Đòn\./ }));
    fireEvent.press(await screen.findByRole('radio', { name: /^Hỗ Trợ/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Đổi hướng' }));
    expect(await screen.findByRole('header', { name: 'Chưa đến lúc đổi hướng' })).toBeTruthy();
    expect(screen.getByText('Bạn có thể đổi hướng từ 10:30 ngày 29/10/2026.')).toBeTruthy();
    expect(archetype()).toHaveLength(1);
    expect(screen.queryByRole('header', { name: 'Đổi hướng' })).toBeNull();
    view.unmount();
  });

  test('the sheet: three directions, the current one marked; confirming another is one PATCH /me/archetype, and the row shows the new one with a new wait', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: new Date(Date.now() - DAY).toISOString() } };
    const view = await openEditProfile();
    fireEvent.press(screen.getByRole('button', { name: /^Đỡ Đòn\./ }));
    expect(await screen.findByRole('header', { name: 'Đổi hướng' })).toBeTruthy();
    expect(screen.getByText('Chọn hướng bạn muốn theo từ bây giờ. XP, cấp độ và chuỗi của bạn luôn được giữ.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Đỡ Đòn/, checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Sát Thủ/ })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /^Hỗ Trợ/, checked: false })).toBeTruthy();
    // nothing chosen yet, or the current one: nothing to confirm
    expect(screen.getByRole('button', { name: 'Đổi hướng' })).toBeDisabled();
    fireEvent.press(screen.getByRole('radio', { name: /^Hỗ Trợ/ }));
    expect(screen.getByRole('radio', { name: /^Hỗ Trợ/, checked: true })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đổi hướng' }));
    await waitFor(() => expect(screen.queryByRole('header', { name: 'Đổi hướng' })).toBeNull());
    expect(archetype().map(request => request.body)).toEqual([{ archetype: 'SUPPORTER' }]);
    expect(await screen.findByRole('button', { name: 'Hỗ Trợ. Có thể đổi sau 14 ngày' })).toBeTruthy();
    expect(world.me.user.archetype).toBe('SUPPORTER');
    // XP and the streak are the profile's own and did not move
    expect(world.me.progression?.streakCurrent).toBe(4);
    view.unmount();
  });

  test('a direction the numbers rule out is listed, disabled, with the reason, and cannot be chosen', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: null } };
    world.profile = { ...world.profile, biometrics: { ...world.profile.biometrics, weightKg: 50 } };
    const view = await openEditProfile();
    fireEvent.press(screen.getByRole('button', { name: /^Đỡ Đòn\./ }));
    const blocked = await screen.findByRole('radio', { name: /^Sát Thủ/ });
    expect(blocked).toBeDisabled();
    expect(screen.getByText('Mục tiêu giảm mỡ không được áp dụng cho hồ sơ này. Bạn có thể chọn hướng tăng sức mạnh hoặc cân bằng.')).toBeTruthy();
    fireEvent.press(blocked);
    expect(screen.getByRole('button', { name: 'Đổi hướng' })).toBeDisabled();
    expect(archetype()).toEqual([]);
    view.unmount();
  });

  test('a refusal of the change keeps the sheet and says why; "Để lúc khác" closes it without a request', async () => {
    world.me = { ...world.me, user: { ...world.me.user, archetypeChangeAvailableAt: null } };
    world.answer = request => (request === 'PATCH /me/archetype' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openEditProfile();
    fireEvent.press(screen.getByRole('button', { name: /^Đỡ Đòn\./ }));
    fireEvent.press(await screen.findByRole('radio', { name: /^Hỗ Trợ/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Đổi hướng' }));
    expect(await screen.findByText(/^Chưa đổi được hướng\./)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Đổi hướng' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Để lúc khác' }));
    expect(screen.queryByRole('header', { name: 'Đổi hướng' })).toBeNull();
    expect(archetype()).toHaveLength(1);
    view.unmount();
  });
});

describe('from the profile tab', () => {
  test('the profile tab reaches S37 through "Cài đặt" and "Hồ sơ & mục tiêu", and Back returns', async () => {
    const view = await openProfile();
    fireEvent.press(screen.getByRole('button', { name: /^Cài đặt\./ }));
    fireEvent.press(await screen.findByRole('button', { name: /^Hồ sơ & mục tiêu\./ }));
    expect(await screen.findByRole('header', { name: 'Hồ sơ & mục tiêu' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('header', { name: 'Cài đặt' })).toBeTruthy();
    view.unmount();
  });
});
