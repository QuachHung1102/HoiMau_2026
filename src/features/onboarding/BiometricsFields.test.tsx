import { LIMITS } from '../../../domain/validation.ts';
import { defaultTimezone } from './api';
import { checkBiometrics, fieldMessage, parseDecimal, parseYear, timezoneProblem, type BiometricsText } from './BiometricsFields';

// 1 July 2026, 12:00 in Việt Nam
const nowMs = Date.UTC(2026, 6, 1, 5);
const at = { nowMs, timeZone: 'Asia/Ho_Chi_Minh' };
const adult: BiometricsText = { birthYear: '1996', heightCm: '170', weightKg: '65', sex: 'FEMALE' };

describe('parseDecimal', () => {
  test.each([
    ['170', 170],
    ['170,5', 170.5],
    ['170.5', 170.5],
    ['0,25', 0.25],
    ['065', 65],
  ])('%s is read as %d', (text, value) => expect(parseDecimal(text)).toBe(value));

  test.each(['', ' ', '1,2,3', '1.2.3', '1,2.3', '1e2', '1E2', ' 170', '170 ', '1 70', '+170', '-170', '170,', ',5', '.5', '170.', 'abc', '１７０', '0x10', 'Infinity', 'NaN'])(
    '"%s" is not a number',
    text => expect(parseDecimal(text)).toBeNull(),
  );

  test('a number too long to be finite is refused', () => expect(parseDecimal('9'.repeat(400))).toBeNull());
});

test('parseYear takes digits only', () => {
  expect(parseYear('1999')).toBe(1999);
  for (const text of ['', '19.9', '1999,0', '1 999', '-1999', '１９９９', '9'.repeat(30)]) expect(parseYear(text)).toBeNull();
});

describe('checkBiometrics', () => {
  test('valid text becomes the numbers that are sent, with the age the domain computes', () => {
    expect(checkBiometrics({ ...adult, heightCm: '170,5', weightKg: '65.25' }, at)).toEqual({
      ok: true,
      biometrics: { heightCm: 170.5, weightKg: 65.25, birthYear: 1996, sex: 'FEMALE' },
      ageYears: 30,
    });
  });

  test('the range messages are built from LIMITS', () => {
    const result = checkBiometrics({ ...adult, heightCm: '300', weightKg: '10', birthYear: '1900' }, at);
    expect(result).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
      fields: {
        heightCm: `Chiều cao cần trong khoảng ${LIMITS.heightCm.min}–${LIMITS.heightCm.max} cm.`,
        weightKg: `Cân nặng cần trong khoảng ${LIMITS.weightKg.min}–${LIMITS.weightKg.max} kg.`,
        birthYear: `Hồi Máu tính mục tiêu cho người từ ${LIMITS.age.min} đến ${LIMITS.age.max} tuổi. Bạn xem lại năm sinh nhé.`,
      },
    });
  });

  test('empty, unreadable and missing values each get their own message', () => {
    expect(checkBiometrics({ birthYear: '', heightCm: '1,7,0', weightKg: '', sex: null }, at)).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
      fields: {
        birthYear: 'Nhập năm sinh của bạn.',
        heightCm: 'Nhập chiều cao bằng số, trong khoảng 120–230 cm.',
        weightKg: 'Nhập cân nặng của bạn.',
        sex: 'Chọn giới tính dùng trong công thức.',
      },
    });
  });

  test('the age rule comes after the fields: under 16 with an invalid field reports the field', () => {
    const young = { ...adult, birthYear: '2011' }; // 15 in 2026
    expect(checkBiometrics(young, at)).toEqual({ ok: false, code: 'AGE_NOT_ALLOWED' });
    expect(checkBiometrics({ ...young, weightKg: '10' }, at)).toMatchObject({ code: 'VALIDATION_FAILED', fields: { weightKg: expect.any(String) } });
    expect(checkBiometrics({ ...adult, birthYear: '2010' }, at)).toMatchObject({ ok: true, ageYears: 16 });
  });

  test('the age is counted in the given zone: on New Year the year has already turned in Việt Nam, not yet in UTC', () => {
    const newYear = Date.UTC(2026, 11, 31, 18); // 01:00 on 1 January 2027 in Việt Nam
    const born = { ...adult, birthYear: '2011' };
    expect(checkBiometrics(born, { nowMs: newYear, timeZone: 'Asia/Ho_Chi_Minh' })).toMatchObject({ ok: true, ageYears: 16 });
    expect(checkBiometrics(born, { nowMs: newYear, timeZone: 'UTC' })).toEqual({ ok: false, code: 'AGE_NOT_ALLOWED' });
  });

  test('a zone the domain cannot read never throws: the age is counted in the default zone', () => {
    expect(() => checkBiometrics(adult, { nowMs, timeZone: 'Mars/Olympus' })).not.toThrow();
    expect(checkBiometrics(adult, { nowMs, timeZone: 'Mars/Olympus' })).toMatchObject({ ok: true, ageYears: 30 });
    expect(checkBiometrics(adult, { nowMs, timeZone: '' })).toMatchObject({ ok: true });
  });

  test('the activity level plays no part here, chosen or not', () => {
    expect(checkBiometrics(adult, at)).toEqual(checkBiometrics(adult, { ...at, activityLevel: 'VERY_ACTIVE' }));
  });
});

test('fieldMessage knows the seven contract fields and nothing else', () => {
  for (const field of ['birthYear', 'heightCm', 'weightKg', 'sex', 'timezone', 'activityLevel', 'archetype']) {
    for (const rule of ['required', 'min', 'max', 'format', 'enum'] as const) expect(fieldMessage(field, rule)).toEqual(expect.any(String));
  }
  expect(fieldMessage('email', 'required')).toBeUndefined();
  expect(fieldMessage('heightCm', 'max')).toBe('Chiều cao cần trong khoảng 120–230 cm.');
});

describe('the time zone', () => {
  const zones = ['Asia/Ho_Chi_Minh', 'Europe/Paris', 'UTC'];

  test('default: the device zone only when the server list has it', () => {
    expect(defaultTimezone(zones, 'Europe/Paris')).toBe('Europe/Paris');
    // names Intl reads but the server refuses
    for (const device of ['CET', 'EST', '+07:00', 'Etc/GMT+7']) expect(defaultTimezone(zones, device)).toBe('Asia/Ho_Chi_Minh');
    // no list yet (loading or failed), or no device zone
    expect(defaultTimezone(undefined, 'Europe/Paris')).toBe('Asia/Ho_Chi_Minh');
    expect(defaultTimezone(zones, undefined)).toBe('Asia/Ho_Chi_Minh');
  });

  test('a zone outside the list, or one Intl cannot read, is a field error', () => {
    expect(timezoneProblem('Europe/Paris', zones)).toBeUndefined();
    expect(timezoneProblem('Asia/Ho_Chi_Minh', undefined)).toBeUndefined();
    expect(timezoneProblem('CET', zones)).toBe('Chọn một múi giờ trong danh sách.');
    expect(timezoneProblem('Mars/Olympus', undefined)).toBe('Chọn một múi giờ trong danh sách.');
  });
});
