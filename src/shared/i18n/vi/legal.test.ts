import { legalVi } from './legal';

const text = [legalVi.title, legalVi.intro, ...legalVi.sections.flatMap(s => [s.heading, s.body])].join('\n');

test('formal text speaks as "Hồi Máu", never "chúng tôi"', () => {
  expect(text).not.toMatch(/chúng tôi/i);
});

test('it keeps to what the product can promise', () => {
  // no absolute claim about third parties: the reset code goes out through an email service
  expect(text).not.toMatch(/không chia sẻ cho bên thứ ba/i);
  expect(text).toContain('không bán dữ liệu');
  expect(text).toContain('Số đo cơ thể và bài viết nhật ký không được chia sẻ cho bất kỳ bên thứ ba nào');
  expect(text).toContain('chỉ dùng để đăng nhập và gửi mã đặt lại mật khẩu');
  // encryption before storage with a server-held key is not end-to-end encryption
  expect(text).toContain('mã hóa trước khi lưu và chỉ tài khoản của bạn truy cập được');
  expect(text).not.toMatch(/chỉ bạn đọc được/i);
  expect(text).toContain('trong vòng 30 ngày');
});

test('the two terms that matter for use are there: not medical advice, 16 and over', () => {
  expect(text).toContain('không thay thế ý kiến của bác sĩ');
  expect(text).toContain('từ 16 tuổi trở lên');
});

test('guild members see what the contract gives them and never the body data', () => {
  const guild = legalVi.sections.find(s => s.heading === 'Điều thành viên tổ đội thấy')?.body ?? '';
  for (const seen of ['tên hiển thị', 'cấp độ', 'vai trò', 'nhiệm vụ chính']) expect(guild).toContain(seen);
  for (const hidden of ['số đo cơ thể', 'cân nặng', 'lượng calo', 'nhật ký']) expect(guild).toContain(hidden);
  expect(guild).not.toMatch(/^Chỉ/);
});
