import { ApiError } from '../../shared/api/client';
import { displayNameProblem, emailProblem, failure, isResetCode, newPasswordProblem } from './form';

const FIELDS = ['email', 'password'] as const;

describe('failure', () => {
  test.each([
    ['TIMEOUT', 'Kết nối hơi chậm. Bạn thử lại nhé.'],
    ['NETWORK', 'Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.'],
    ['RATE_LIMITED', 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại nhé.'],
    ['INTERNAL', 'Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.'],
    ['INVALID_CREDENTIALS', 'Email hoặc mật khẩu chưa đúng.'],
    ['REGISTRATION_UNAVAILABLE', 'Không thể tạo tài khoản với email này. Bạn thử đăng nhập hoặc lấy lại mật khẩu nhé.'],
    ['RESET_CODE_INVALID', 'Mã chưa đúng hoặc đã hết hạn. Bạn có thể gửi lại mã.'],
    ['NAME_NOT_ALLOWED', 'Tên này chưa phù hợp, bạn chọn tên khác nhé.'],
  ] as const)('%s without an owning field is a form-level message', (code, copy) => {
    expect(failure(new ApiError(0, code), { known: FIELDS })).toEqual({ fields: {}, form: copy });
  });

  test('a code about one field goes under that field and nowhere else', () => {
    expect(failure(new ApiError(401, 'INVALID_CREDENTIALS'), { own: { INVALID_CREDENTIALS: 'password' }, known: FIELDS })).toEqual({
      fields: { password: 'Email hoặc mật khẩu chưa đúng.' },
    });
  });

  test('anything not an ApiError, and codes without copy, are the neutral "something went wrong"', () => {
    expect(failure(new Error('boom'), { known: FIELDS })).toEqual({ fields: {}, form: 'Có lỗi xảy ra. Bạn thử lại nhé.' });
    expect(failure(new ApiError(401, 'SESSION_INVALID'), { known: FIELDS })).toEqual({ fields: {}, form: 'Có lỗi xảy ra. Bạn thử lại nhé.' });
  });

  test('VALIDATION_FAILED: known fields get their copy, unknown ones are skipped, none known falls back', () => {
    const details = { fields: [{ field: 'password', rule: 'required' }, { field: 'email', rule: 'format' }, { field: 'elsewhere', rule: 'min' }] };
    // a field the form has no place for is not dropped silently: the form-level message says something else is wrong
    expect(failure(new ApiError(422, 'VALIDATION_FAILED', details), { known: FIELDS })).toEqual({
      fields: { password: 'Bạn nhập mật khẩu nhé.', email: 'Email chưa đúng định dạng, ví dụ ban@example.com.' },
      form: 'Có lỗi xảy ra. Bạn thử lại nhé.',
    });
    const known = { fields: [{ field: 'password', rule: 'required' }, { field: 'email', rule: 'format' }] };
    expect(failure(new ApiError(422, 'VALIDATION_FAILED', known), { known: FIELDS }).form).toBeUndefined();
    expect(failure(new ApiError(422, 'VALIDATION_FAILED', { fields: [{ field: 'elsewhere', rule: 'min' }] }), { known: FIELDS }).form).toBe('Có lỗi xảy ra. Bạn thử lại nhé.');
    // details of another shape are not trusted
    expect(failure(new ApiError(422, 'VALIDATION_FAILED', { fields: 'email' }), { known: FIELDS }).form).toBe('Có lỗi xảy ra. Bạn thử lại nhé.');
  });
});

describe('the client rules are the domain rules', () => {
  test('emailProblem judges the normalised address', () => {
    expect(emailProblem('  AN@Example.VN ')).toBeUndefined();
    expect(emailProblem('   ')).toBe('Bạn nhập email nhé.');
    expect(emailProblem('an@')).toBe('Email chưa đúng định dạng, ví dụ ban@example.com.');
  });

  test('newPasswordProblem: the LIMITS minimum and maximum in characters, never trimmed', () => {
    expect(newPasswordProblem('1234567')).toBe('Mật khẩu cần ít nhất 8 ký tự.');
    expect(newPasswordProblem('12345678')).toBeUndefined();
    expect(newPasswordProblem(' '.repeat(8))).toBeUndefined();
    expect(newPasswordProblem('a'.repeat(128))).toBeUndefined();
    expect(newPasswordProblem('a'.repeat(129))).toBe('Mật khẩu tối đa 128 ký tự.');
    expect(newPasswordProblem('')).toBe('Bạn nhập mật khẩu nhé.');
    // eight emoji are eight characters, not sixteen
    expect(newPasswordProblem('😀'.repeat(7))).toBe('Mật khẩu cần ít nhất 8 ký tự.');
    expect(newPasswordProblem('😀'.repeat(8))).toBeUndefined();
  });

  test('displayNameProblem judges the trimmed name', () => {
    expect(displayNameProblem('  An  ')).toBeUndefined();
    expect(displayNameProblem(' ')).toBe('Bạn nhập tên hiển thị nhé.');
    expect(displayNameProblem('a'.repeat(41))).toBe('Tên hiển thị tối đa 40 ký tự và không có ký tự ẩn.');
  });

  test('isResetCode: exactly LIMITS.resetCode.length digits', () => {
    expect(isResetCode('12345678')).toBe(true);
    for (const bad of ['1234567', '123456789', '1234567a', '1234 5678', '', '１２３４５６７８']) expect(isResetCode(bad)).toBe(false);
  });
});
